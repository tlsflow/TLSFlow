import { createHash, X509Certificate } from 'node:crypto';
import { AppError } from '../../../../common/errors/app-error.js';
import type { AgentsApplicationService } from '../../../agents/application/agents.application-service.js';
import type { AgentTaskEnvelope } from '../../../agents/schema/agents.schema.js';
import type { TrustRootsApplicationService } from './trust-roots.application-service.js';
import type { RootCertificateRecordDto } from '../dto/trust-roots.dto.js';

export interface CertificateTrustPlanSnapshot {
  apiVersion: 'gcac.certificate-trust-plan/v1';
  decision: 'skip' | 'install';
  reasonCode: 'root_already_trusted' | 'root_missing_install_required';
  actionType: 'certificate.trust.install';
  actionSchemaVersion: '1.0';
  store: 'root';
  agentId: string;
  rootCertificateId: string;
  fingerprintSha256: string;
  certificatePem: string;
  plannedAt: string;
  inspection: {
    actionType: 'certificate.trust.inspect';
    actionSchemaVersion: '1.0';
    status: 'found' | 'not_found';
    inspectedAt: string;
    detail: Record<string, unknown>;
  };
}

export interface BuildCertificateTrustPlanInput {
  tenantId: string;
  actorId: string;
  agentId: string;
  certificateVersionId: string;
  requestId: string;
}

export interface BuildCertificateTrustPlanResult {
  plan: CertificateTrustPlanSnapshot;
  root: RootCertificateRecordDto;
}

export interface CertificateTrustPlanDependencies {
  agents: Pick<AgentsApplicationService, 'enqueueTask' | 'createFactCollectionRequest' | 'findTaskByIdempotencyKey'>;
  trustRoots: Pick<TrustRootsApplicationService, 'discoverRoot' | 'resolveVersionInstallableRoot'>;
}

// 事实采集合同时绑定了 Windows Root 证书库字段。合同升级后不能复用旧版
// `certificate.trust.inspect` 失败任务，否则历史失败会永久阻断新的只读检查。
const CERTIFICATE_TRUST_INSPECT_CONTRACT_VERSION = 'v2';

export class CertificateTrustPlanService {
  constructor(private readonly dependencies: CertificateTrustPlanDependencies) {}

  async build(input: BuildCertificateTrustPlanInput): Promise<BuildCertificateTrustPlanResult> {
    const resolvedRoot = await this.dependencies.trustRoots.resolveVersionInstallableRoot(
      input.certificateVersionId,
      input.tenantId,
      input.actorId,
    );
    if (!resolvedRoot) {
      const discovered = await this.dependencies.trustRoots.discoverRoot({
        tenantId: input.tenantId,
        certificateVersionId: input.certificateVersionId,
        createdBy: input.actorId,
      });
      if (discovered.status !== 'found') {
        throw new AppError('VALIDATION_FAILED', '证书版本缺少可安装的已验证根证书，不能生成宿主根信任计划', {
          code: 'CERTIFICATE_TRUST_ROOT_UNRESOLVED',
          certificateVersionId: input.certificateVersionId,
          fingerprintSha256: discovered.fingerprintSha256,
          failureCode: discovered.failureCode,
        });
      }
    }

    const material = await this.dependencies.trustRoots.resolveVersionInstallableRoot(
      input.certificateVersionId,
      input.tenantId,
      input.actorId,
    );
    if (!material) {
      throw new AppError('VALIDATION_FAILED', '证书版本根证书解析后仍不可用，拒绝生成宿主根信任计划', {
        code: 'CERTIFICATE_TRUST_ROOT_UNRESOLVED',
        certificateVersionId: input.certificateVersionId,
      });
    }

    // 根信任检查属于一次部署会话的子任务。将请求会话摘要纳入幂等键，
    // 避免某次 Agent 配置故障留下的 failed 任务永久阻断后续新会话。
    const requestDigest = createHash('sha256').update(input.requestId, 'utf8').digest('hex');
    const idempotencyKey = `certificate.trust.inspect:${CERTIFICATE_TRUST_INSPECT_CONTRACT_VERSION}:${input.agentId}:${material.root.fingerprintSha256}:${requestDigest}`;
    const existingTask = await this.dependencies.agents.findTaskByIdempotencyKey(
      input.tenantId,
      input.agentId,
      idempotencyKey,
    );
    if (existingTask?.status === 'succeeded') {
      return buildTrustPlanFromFactTask(existingTask, material.root, material.certificatePem, input);
    }
    if (existingTask?.status === 'failed' || existingTask?.status === 'rejected') {
      throw new AppError('VALIDATION_FAILED', '宿主根信任检查任务失败，拒绝继续部署', {
        code: 'CERTIFICATE_TRUST_INSPECT_FAILED',
        certificateVersionId: input.certificateVersionId,
        agentId: input.agentId,
        taskId: existingTask.id,
        errorCode: readRecord(existingTask.result)?.errorCode,
        errorMessage: readRecord(existingTask.result)?.errorMessage,
      });
    }
    if (existingTask && ['queued', 'leased', 'acked'].includes(existingTask.status)) {
      throwPendingTrustInspection(existingTask.id, input);
    }
    const factRequest = await this.dependencies.agents.createFactCollectionRequest(
      input.tenantId,
      input.agentId,
      input.actorId,
      input.requestId,
    );
    const inspectTask = await this.dependencies.agents.enqueueTask(input.tenantId, {
      agentId: input.agentId,
      executionRunId: `trustplan:${input.certificateVersionId}`,
      executionStepId: `trustinspect:${input.agentId}:${material.root.fingerprintSha256}`,
      idempotencyKey,
      payload: factRequest.payload,
    }, input.requestId);
    throwPendingTrustInspection(inspectTask.id, input);
  }
}

function throwPendingTrustInspection(taskId: string, input: BuildCertificateTrustPlanInput): never {
  throw new AppError('EXECUTION_TARGET_UNAVAILABLE', '宿主根信任检查已提交 Agent v2 事实采集任务，必须等待 Receipt 后再生成计划', {
    code: 'CERTIFICATE_TRUST_INSPECT_PENDING',
    certificateVersionId: input.certificateVersionId,
    agentId: input.agentId,
    taskId,
    actionType: 'agent.fact.collect',
    asyncPending: true,
  });
}

function buildTrustPlanFromFactTask(
  task: AgentTaskEnvelope,
  root: RootCertificateRecordDto,
  certificatePem: string,
  input: BuildCertificateTrustPlanInput,
): BuildCertificateTrustPlanResult {
  const result = readRecord(task.result);
  const detail = readRecord(result?.detail);
  const factEnvelope = readRecord(detail?.factEnvelope);
  if (!factEnvelope || !Array.isArray(factEnvelope.facts)) {
    throw new AppError('VALIDATION_FAILED', '宿主根信任检查 Receipt 缺少有效事实快照，拒绝继续部署', {
      code: 'CERTIFICATE_TRUST_INSPECT_INVALID',
      taskId: task.id,
      certificateVersionId: input.certificateVersionId,
    });
  }
  const facts = factEnvelope.facts;
  const expected = normalizeFingerprint(root.fingerprintSha256);
  const found = facts.some((fact) => {
    const item = readRecord(fact);
    const fingerprint = normalizeFingerprint(readString(item?.sha256Fingerprint) ?? readString(item?.fingerprintSha256));
    return item?.kind === 'certificate_store' && fingerprint === expected;
  });
  const status = found ? 'found' : 'not_found';
  const plannedAt = new Date().toISOString();
  return {
    root,
    plan: {
      apiVersion: 'gcac.certificate-trust-plan/v1',
      decision: found ? 'skip' : 'install',
      reasonCode: found ? 'root_already_trusted' : 'root_missing_install_required',
      actionType: 'certificate.trust.install',
      actionSchemaVersion: '1.0',
      store: 'root',
      agentId: input.agentId,
      rootCertificateId: root.id,
      fingerprintSha256: root.fingerprintSha256,
      certificatePem,
      plannedAt,
      inspection: {
        actionType: 'certificate.trust.inspect',
        actionSchemaVersion: '1.0',
        status,
        inspectedAt: plannedAt,
        detail: { taskId: task.id, factCount: facts.length, factEnvelopeDigest: readString(factEnvelope?.digest) },
      },
    },
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeFingerprint(value: string | undefined): string | undefined {
  return value?.replaceAll(':', '').trim().toLowerCase() || undefined;
}

export function derToPem(der: Buffer): string {
  const certificate = new X509Certificate(der);
  return certificate.toString();
}

import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type { RequestContext } from '../../../shared/security-types.js';
import type { CertificatesApplicationService } from '../../certificates/application/certificates.application-service.js';
import type { CertificateVersionEntity } from '../../certificates/schema/certificates.schema.js';
import type { InternalCaApplicationService, CreateCertificateRequestInput, IssuedCertificateLifecycleResult } from './internal-ca.application-service.js';
import type { InternalCaRepository } from '../repository/internal-ca.repository.js';
import type { CertificateRotationEntity } from '../schema/internal-ca.schema.js';
import { ManagedKeyCustodyAdapter } from './managed-key-custody.adapter.js';
import { AgentKeyCustodyAdapter, type AgentKeyCsrTaskInput } from './agent-key-custody.adapter.js';
import { DeviceLocalKeyCustodyAdapter, type DeviceLocalActionReceipt } from './device-local-key-custody.adapter.js';
import type { DeploymentPlanDto, CreateDeploymentPlanFromApplicationAssetInput } from '../../deployment-plans/dto/deployment-plans.dto.js';

export interface CreateCertificateRotationInput {
  tenantId: string;
  applicationAssetId: string;
  sourceCertificateVersionId: string;
  custodyMode?: CreateCertificateRequestInput['custodyMode'];
  csrPem?: string;
  opaqueKeyReference?: string;
  keyBackend?: CreateCertificateRequestInput['keyBackend'];
  exportability?: CreateCertificateRequestInput['exportability'];
  requestedKeyAlgorithm?: CreateCertificateRequestInput['requestedKeyAlgorithm'];
  agentId?: string;
  targetId?: string;
  keyPath?: string;
  certificatePath?: string;
  /** Tomcat 配置文件绝对路径；仅作为 Agent 本机取密钥库密码的路径引用。 */
  configPath?: string;
  storageMode?: 'file_pem' | 'windows_cng';
  format?: 'pem' | 'pkcs12' | 'jks';
  alias?: string;
  pluginId?: string;
  pluginVersionId?: string;
  idempotencyKey: string;
  actorId: string;
  context?: RequestContext;
}

/**
 * 证书生命周期的最小闭环：创建新密钥申请、等待/完成签发、生成精确安装输入，
 * TLS 验证成功后才提交旧版本撤销。远程写入仍由 Agent/DeploymentPlan 执行。
 */
export class CertificateLifecycleService {
  private readonly managedKeyCustody: ManagedKeyCustodyAdapter;
  private agentKeyCustody?: AgentKeyCustodyAdapter;
  private deviceLocalKeyCustody?: DeviceLocalKeyCustodyAdapter;
  private applicationPolicyStatusUpdater?: (tenantId: string, applicationAssetId: string, status: 'issued' | 'ready_to_deploy' | 'deployed' | 'tls_verified' | 'needs_attention' | 'renewing', certificateVersionId?: string) => Promise<void>;
  private deploymentPlans?: {
    createFromApplicationAsset(input: CreateDeploymentPlanFromApplicationAssetInput, context?: RequestContext): Promise<DeploymentPlanDto>;
  };

  constructor(
    private readonly dependencies: {
      internalCa: InternalCaApplicationService;
      certificates: CertificatesApplicationService;
      repository: InternalCaRepository;
      managedKeyCustody?: ManagedKeyCustodyAdapter;
      agentKeyCustody?: AgentKeyCustodyAdapter;
      deviceLocalKeyCustody?: DeviceLocalKeyCustodyAdapter;
    },
  ) {
    this.managedKeyCustody = dependencies.managedKeyCustody ?? new ManagedKeyCustodyAdapter(dependencies.internalCa);
    this.agentKeyCustody = dependencies.agentKeyCustody;
    this.deviceLocalKeyCustody = dependencies.deviceLocalKeyCustody;
  }

  /** 在部署计划服务完成装配后接入，避免生命周期与部署模块形成构造循环。 */
  setDeploymentPlans(deploymentPlans?: CertificateLifecycleService['deploymentPlans']): void {
    this.deploymentPlans = deploymentPlans;
  }

  setAgentKeyCustody(adapter?: AgentKeyCustodyAdapter): void {
    this.agentKeyCustody = adapter;
  }

  setDeviceLocalKeyCustody(adapter?: DeviceLocalKeyCustodyAdapter): void {
    this.deviceLocalKeyCustody = adapter;
  }

  setApplicationPolicyStatusUpdater(updater?: CertificateLifecycleService['applicationPolicyStatusUpdater']): void {
    this.applicationPolicyStatusUpdater = updater;
  }

  /** 为 Citrix/F5 等设备生成 CSR；设备适配器不得退化为通用 Shell。 */
  async generateDeviceCsr(input: {
    tenantId: string;
    certificateRequestId: string;
    deviceId: string;
    pluginId: string;
    pluginVersionId: string;
    commonName: string;
    sans: string[];
    algorithm: 'rsa' | 'ec';
    idempotencyKey: string;
  }): Promise<DeviceLocalActionReceipt> {
    if (!this.deviceLocalKeyCustody) throw new AppError('EXECUTION_TARGET_UNAVAILABLE', '网关本机持钥适配器未配置', { fallback: false });
    const request = (await this.dependencies.internalCa.listRequests(input.tenantId)).find((item) => item.id === input.certificateRequestId);
    if (!request) throw new AppError('RESOURCE_NOT_FOUND', '证书申请不存在', { certificateRequestId: input.certificateRequestId });
    if (!['pending_key', 'pending_csr'].includes(request.status)) throw new AppError('RESOURCE_VERSION_CONFLICT', '证书申请当前不等待设备 CSR', { status: request.status });
    const key = await this.dependencies.repository.getKeyReference(input.tenantId, request.keyReferenceId);
    if (key?.custodyMode !== 'device_local') throw new AppError('RESOURCE_VERSION_CONFLICT', '证书申请的密钥托管模式不是设备本机');
    return this.deviceLocalKeyCustody.generateCsr(input);
  }

  /** 设备导入已签发证书；证书公钥和 localKeyRef 由设备适配器/回执校验。 */
  async installDeviceIssued(input: {
    tenantId: string;
    certificateRequestId: string;
    deviceId: string;
    pluginId: string;
    pluginVersionId: string;
    localKeyRef: string;
    expectedPublicKeyFingerprintSha256: string;
    certificatePem: string;
    certificateChainPem: string;
    idempotencyKey: string;
  }): Promise<DeviceLocalActionReceipt> {
    if (!this.deviceLocalKeyCustody) throw new AppError('EXECUTION_TARGET_UNAVAILABLE', '网关本机持钥适配器未配置', { fallback: false });
    const request = (await this.dependencies.internalCa.listRequests(input.tenantId)).find((item) => item.id === input.certificateRequestId);
    if (!request) throw new AppError('RESOURCE_NOT_FOUND', '证书申请不存在', { certificateRequestId: input.certificateRequestId });
    if (!request.certificateVersionId) throw new AppError('RESOURCE_VERSION_CONFLICT', '证书申请尚未签发');
    const key = await this.dependencies.repository.getKeyReference(input.tenantId, request.keyReferenceId);
    if (key?.custodyMode !== 'device_local') throw new AppError('RESOURCE_VERSION_CONFLICT', '证书申请的密钥托管模式不是设备本机');
    if (key.publicKeyFingerprintSha256.toLowerCase() !== input.expectedPublicKeyFingerprintSha256.toLowerCase()) throw new AppError('PUBLIC_KEY_MISMATCH', '设备本机密钥公钥指纹不匹配');
    return this.deviceLocalKeyCustody.installIssued(input);
  }

  /** 为已经落库的 pending_key 申请生成本机 CSR 任务。 */
  async generateLocalCsr(input: AgentKeyCsrTaskInput & { tenantId: string }): Promise<Record<string, unknown>> {
    if (!this.agentKeyCustody) throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', '本机持钥 Agent 编排器未配置', { fallback: false });
    const request = (await this.dependencies.internalCa.listRequests(input.tenantId)).find((item) => item.id === input.certificateRequestId);
    if (!request) throw new AppError('RESOURCE_NOT_FOUND', '证书申请不存在', { requestId: input.certificateRequestId });
    if (request.status !== 'pending_key' && request.status !== 'pending_csr') throw new AppError('RESOURCE_VERSION_CONFLICT', '证书申请当前不等待本机 CSR', { status: request.status });
    if (!input.certificatePath?.trim()) throw new AppError('VALIDATION_FAILED', 'certificatePath 不能为空');
    const requestedContext = {
      agentId: input.agentId.trim(),
      targetId: input.targetId.trim(),
      keyPath: input.keyPath.trim(),
      certificatePath: input.certificatePath.trim(),
      ...(input.configPath?.trim() ? { configPath: input.configPath.trim() } : {}),
      format: input.format ?? 'pem',
      ...(input.storageMode === undefined ? {} : { storageMode: input.storageMode }),
      ...(input.alias?.trim() ? { alias: input.alias.trim() } : {}),
      ...(input.pluginId?.trim() ? { pluginId: input.pluginId.trim() } : {}),
      ...(input.pluginVersionId?.trim() ? { pluginVersionId: input.pluginVersionId.trim() } : {}),
    } satisfies NonNullable<import('../schema/internal-ca.schema.js').CertificateRequestEntity['agentContext']>;
    if (request.agentContext && !sameAgentContext(request.agentContext, requestedContext)) {
      throw new AppError('TENANT_SCOPE_DENIED', '证书申请已绑定其他 Agent 或目标，拒绝改写本机持钥上下文', {
        requestId: request.id,
        agentId: request.agentContext.agentId,
        targetId: request.agentContext.targetId,
      });
    }
    if (!request.agentContext) {
      await this.dependencies.repository.saveRequest({
        ...request,
        agentContext: requestedContext,
        updatedAt: new Date().toISOString(),
      });
    }
    const task = await this.agentKeyCustody.generateCsr(input.tenantId, {
      ...input,
      commonName: request.subjectCommonName,
      sans: [...request.sans],
      certificatePath: requestedContext.certificatePath,
      ...(requestedContext.configPath ? { configPath: requestedContext.configPath } : {}),
      format: requestedContext.format,
      ...(requestedContext.alias ? { alias: requestedContext.alias } : {}),
      ...(requestedContext.storageMode ? { storageMode: requestedContext.storageMode } : {}),
      ...(requestedContext.pluginId ? { pluginId: requestedContext.pluginId } : {}),
      ...(requestedContext.pluginVersionId ? { pluginVersionId: requestedContext.pluginVersionId } : {}),
    });
    return { requestId: request.id, status: request.status, taskId: task.id, idempotencyKey: task.idempotencyKey };
  }

  /** 签发成功后生成同一申请的 certificate.install_issued Agent 任务。 */
  async enqueueIssuedCertificateInstall(input: { tenantId: string; request: import('../schema/internal-ca.schema.js').CertificateRequestEntity; actorId: string }): Promise<Record<string, unknown> | undefined> {
    if (!input.request.applicationAssetId || !input.request.certificateVersionId) return undefined;
    // CA 已返回可验证证书；应用策略先进入 issued，待 Agent 公开回执后再进入 deployed。
    await this.updateApplicationPolicyStatus(input.tenantId, input.request.applicationAssetId, 'issued', input.request.certificateVersionId);
    if (!this.agentKeyCustody || input.request.keyReferenceId === undefined || !input.request.agentContext) return undefined;
    const key = await this.dependencies.repository.getKeyReference(input.tenantId, input.request.keyReferenceId);
    if (!key?.opaqueReference) return undefined;
    try {
      const material = await this.dependencies.certificates.getPublicVersionMaterial(input.tenantId, input.request.certificateVersionId);
      const context = input.request.agentContext;
      const task = await this.agentKeyCustody.installIssuedCertificate(input.tenantId, {
        certificateRequestId: input.request.id,
        agentId: context.agentId,
        targetId: context.targetId,
        keyPath: context.keyPath,
        certificatePath: context.certificatePath,
        ...(context.configPath ? { configPath: context.configPath } : {}),
        localKeyRef: key.opaqueReference,
        expectedPublicKeyFingerprintSha256: key.publicKeyFingerprintSha256,
        certificatePem: material.certificatePem,
        certificateChainPem: material.certificateChainPem,
        format: context.format,
        storageMode: context.storageMode,
        alias: context.alias,
        idempotencyKey: `certificate-request:${input.request.id}:certificate-install`,
        pluginId: context.pluginId,
        pluginVersionId: context.pluginVersionId,
      });
      // 任务已提交但尚未收到目标回执；策略只能进入待部署，不能提前宣称已部署。
      await this.updateApplicationPolicyStatus(input.tenantId, input.request.applicationAssetId, 'ready_to_deploy', input.request.certificateVersionId);
      return { taskId: task.id, idempotencyKey: task.idempotencyKey, certificateVersionId: input.request.certificateVersionId };
    } catch (error) {
      await this.updateApplicationPolicyStatus(input.tenantId, input.request.applicationAssetId, 'needs_attention', input.request.certificateVersionId);
      throw error;
    }
  }

  /** 由 Agent 回执同步服务调用，安装成功后才把应用策略标记为已部署。 */
  async reconcileCertificateInstallResult(input: {
    tenantId: string;
    requestId: string;
    status: 'SUCCESS' | 'FAILED' | 'UNKNOWN';
  }): Promise<void> {
    const request = (await this.dependencies.internalCa.listRequests(input.tenantId)).find((item) => item.id === input.requestId);
    if (!request?.applicationAssetId) return;
    await this.updateApplicationPolicyStatus(
      input.tenantId,
      request.applicationAssetId,
      input.status === 'SUCCESS' ? 'deployed' : 'needs_attention',
      request.certificateVersionId,
    );
  }

  /**
   * 托管密钥签发后的唯一部署入口。部署计划服务负责校验目标、连接、凭据和
   * SSH/CURL Workflow；缺少上下文时只回写阻断事实，不撤销已签发证书。
   */
  async enqueueManagedCertificateDeployment(input: {
    tenantId: string;
    request: import('../schema/internal-ca.schema.js').CertificateRequestEntity;
    actorId: string;
    context?: RequestContext;
  }): Promise<IssuedCertificateLifecycleResult> {
    const request = input.request;
    if (!request.applicationAssetId) {
      return { deploymentPlanStatus: 'not_required' };
    }
    if (!request.certificateVersionId) {
      await this.updateApplicationPolicyStatus(input.tenantId, request.applicationAssetId, 'needs_attention');
      return { deploymentPlanStatus: 'blocked', deploymentWarnings: ['证书申请尚未生成证书版本'] };
    }
    // CA 已签发，部署计划创建前的策略状态必须可观察。
    await this.updateApplicationPolicyStatus(input.tenantId, request.applicationAssetId, 'issued', request.certificateVersionId);
    if (request.deploymentPlanId) {
      return {
        deploymentPlanId: request.deploymentPlanId,
        deploymentPlanStatus: request.deploymentPlanStatus ?? 'created',
        deploymentPlanCertificateVersionId: request.deploymentPlanCertificateVersionId ?? request.certificateVersionId,
        ...(request.deploymentWarnings ? { deploymentWarnings: [...request.deploymentWarnings] } : {}),
      };
    }
    if (!this.deploymentPlans) {
      await this.updateApplicationPolicyStatus(input.tenantId, request.applicationAssetId, 'needs_attention');
      return { deploymentPlanStatus: 'blocked', deploymentWarnings: ['部署计划服务未接入'] };
    }
    try {
      const plan = await this.deploymentPlans.createFromApplicationAsset({
        applicationAssetId: request.applicationAssetId,
        targetCertificateVersionId: request.certificateVersionId,
        selectionMode: 'EXPLICIT',
        planType: 'UPDATE',
        reuseDraft: false,
        idempotencyKey: `certificate-request:${request.id}:deployment`,
        actorId: input.actorId,
        tenantId: input.tenantId,
      }, input.context);
      if (plan.certificateVersionId !== request.certificateVersionId) {
        throw new AppError('RESOURCE_VERSION_CONFLICT', '托管密钥部署计划未绑定本次签发的证书版本', {
          requestId: request.id,
          expectedCertificateVersionId: request.certificateVersionId,
          actualCertificateVersionId: plan.certificateVersionId,
        });
      }
      await this.updateApplicationPolicyStatus(input.tenantId, request.applicationAssetId, 'ready_to_deploy', request.certificateVersionId);
      return {
        deploymentPlanId: plan.id,
        deploymentPlanStatus: plan.status,
        deploymentPlanCertificateVersionId: plan.certificateVersionId,
      };
    } catch (error) {
      // 只保存脱敏错误摘要；任何私钥/密码不得随申请事实持久化。
      const warning = redactLifecycleError(error);
      await this.updateApplicationPolicyStatus(input.tenantId, request.applicationAssetId, 'needs_attention', request.certificateVersionId);
      return { deploymentPlanStatus: 'blocked', deploymentWarnings: [warning] };
    }
  }

  async createRotation(input: CreateCertificateRotationInput): Promise<CertificateRotationEntity> {
    const existing = await this.dependencies.repository.getRotationByIdempotencyKey(input.tenantId, input.idempotencyKey);
    if (existing) return existing;
    const source = await this.requireVersion(input.tenantId, input.sourceCertificateVersionId);
    const sourceRequest = source.certificateRequestId
      ? (await this.dependencies.internalCa.listRequests(input.tenantId)).find((item) => item.id === source.certificateRequestId)
      : undefined;
    const sourceBelongsToApplication = sourceRequest
      ? sourceRequest.applicationAssetId === input.applicationAssetId
        && (!sourceRequest.certificateAssetId || sourceRequest.certificateAssetId === source.certificateAssetId)
      : (await this.dependencies.certificates.getRepository().getAsset(source.certificateAssetId, input.tenantId))?.applicationAssetId === input.applicationAssetId;
    if (!sourceBelongsToApplication) throw new AppError('TENANT_SCOPE_DENIED', '轮换源证书不属于指定应用资产');
    if (!source.issuingCaId || !source.certificateProfileVersionId) throw new AppError('RESOURCE_VERSION_CONFLICT', '源证书缺少签发 CA 或 Profile 版本，不能自动轮换');
    const sourceKey = source.keyReferenceId ? await this.dependencies.repository.getKeyReference(input.tenantId, source.keyReferenceId) : undefined;
    const now = new Date().toISOString();
    let rotation: CertificateRotationEntity = {
      id: newId('rotation'), tenantId: input.tenantId, applicationAssetId: input.applicationAssetId,
      sourceCertificateVersionId: source.id, sourceKeyReferenceId: source.keyReferenceId,
      policyVersionId: undefined, idempotencyKey: input.idempotencyKey, status: 'requested',
      evidence: { sourcePublicKeyFingerprintSha256: source.publicKeyFingerprintSha256 }, warnings: [], requestedBy: input.actorId,
      createdAt: now, updatedAt: now,
    };
    rotation = await this.dependencies.repository.saveRotation(rotation);
    try {
      const custodyMode = input.custodyMode ?? source.keyCustodyMode ?? 'managed_secret';
      if (custodyMode !== 'managed_secret' && (!input.csrPem || !input.opaqueKeyReference)) {
        if (custodyMode !== 'local_agent') return this.dependencies.repository.saveRotation({ ...rotation, status: 'key_csr_pending', updatedAt: new Date().toISOString() });
      }
      const requestInput: CreateCertificateRequestInput = {
        applicationAssetId: input.applicationAssetId,
        ...(source.certificateAssetId ? { certificateAssetId: source.certificateAssetId } : {}),
        ...(sourceRequest?.applicationCertificatePolicyVersionId
          ? { applicationCertificatePolicyVersionId: sourceRequest.applicationCertificatePolicyVersionId }
          : {}),
        caId: source.issuingCaId,
        profileVersionId: source.certificateProfileVersionId,
        commonName: source.commonName ?? source.subject.commonName ?? input.applicationAssetId,
        sans: source.sans,
        requestedValidityDays: Math.max(1, Math.ceil((Date.parse(source.notAfter) - Date.now()) / 86_400_000)),
        custodyMode,
        csrPem: input.csrPem,
        opaqueKeyReference: input.opaqueKeyReference,
        keyBackend: input.keyBackend,
        exportability: input.exportability,
        requestedKeyAlgorithm: input.requestedKeyAlgorithm,
        idempotencyKey: `rotation-request:${input.idempotencyKey}`,
        actorId: input.actorId,
        deferIssuance: false,
      };
      const { custodyMode: _managedCustodyMode, ...managedRequestInput } = requestInput;
      const request = custodyMode === 'managed_secret'
        ? await this.managedKeyCustody.createRequest(input.tenantId, managedRequestInput, input.context)
        : await this.dependencies.internalCa.createCertificateRequest(input.tenantId, requestInput, input.context);
      if (custodyMode === 'local_agent' && !input.csrPem && input.agentId && input.keyPath && input.certificatePath) {
        await this.generateLocalCsr({
          tenantId: input.tenantId,
          certificateRequestId: request.id,
          agentId: input.agentId,
          targetId: input.targetId ?? input.applicationAssetId,
          commonName: request.subjectCommonName,
          sans: request.sans,
          keyPath: input.keyPath,
          ...(input.configPath ? { configPath: input.configPath } : {}),
          algorithm: input.requestedKeyAlgorithm ?? 'rsa',
          storageMode: input.storageMode,
          format: input.format ?? 'pem',
          alias: input.alias,
          idempotencyKey: `rotation-key:${input.idempotencyKey}`,
          pluginId: input.pluginId,
          pluginVersionId: input.pluginVersionId,
        });
      }
      const targetKey = await this.dependencies.repository.getKeyReference(input.tenantId, request.keyReferenceId);
      if (sourceKey && targetKey && sourceKey.id === targetKey.id) throw new AppError('PUBLIC_KEY_MISMATCH', '轮换不能复用源密钥引用');
      if (targetKey && source.publicKeyFingerprintSha256 && targetKey.publicKeyFingerprintSha256.toLowerCase() === source.publicKeyFingerprintSha256.toLowerCase()) throw new AppError('PUBLIC_KEY_MISMATCH', '轮换生成了与源证书相同的公钥');
      const status: CertificateRotationEntity['status'] = request.status === 'issued' ? 'install_pending' : request.status === 'issuing' ? 'issuing' : 'key_csr_pending';
      let completed = await this.dependencies.repository.saveRotation({
        ...rotation, status, targetKeyReferenceId: request.keyReferenceId, targetCertificateRequestId: request.id,
        policyVersionId: request.applicationCertificatePolicyVersionId ?? request.certificatePolicyVersionId,
        targetCertificateVersionId: request.certificateVersionId,
        evidence: { ...rotation.evidence, targetPublicKeyFingerprintSha256: targetKey?.publicKeyFingerprintSha256, targetRequestStatus: request.status }, updatedAt: new Date().toISOString(),
      });
      if (request.status === 'issued' && request.certificateVersionId) {
        completed = await this.attachDeploymentPlan(completed, request.certificateVersionId, input.actorId, input.context);
      }
      return completed;
    } catch (error) {
      const status: CertificateRotationEntity['status'] = error instanceof AppError && error.errorCode === 'CA_PROVIDER_UNAVAILABLE' ? 'unknown' : 'failed';
      return this.dependencies.repository.saveRotation({ ...rotation, status, warnings: [error instanceof Error ? error.message : String(error)], updatedAt: new Date().toISOString() });
    }
  }

  private async attachDeploymentPlan(
    rotation: CertificateRotationEntity,
    certificateVersionId: string,
    actorId: string,
    context?: RequestContext,
  ): Promise<CertificateRotationEntity> {
    if (!this.deploymentPlans) return rotation;
    try {
      const plan = await this.deploymentPlans.createFromApplicationAsset({
        applicationAssetId: rotation.applicationAssetId,
        targetCertificateVersionId: certificateVersionId,
        selectionMode: 'EXPLICIT',
        planType: 'UPDATE',
        reuseDraft: false,
        idempotencyKey: `rotation-plan:${rotation.id}`,
        actorId,
        tenantId: rotation.tenantId,
      }, context);
      if (plan.certificateVersionId !== certificateVersionId) {
        throw new AppError('RESOURCE_VERSION_CONFLICT', '轮换部署计划未绑定目标证书版本', {
          rotationId: rotation.id,
          expectedCertificateVersionId: certificateVersionId,
          actualCertificateVersionId: plan.certificateVersionId,
        });
      }
      return this.dependencies.repository.saveRotation({
        ...rotation,
        status: 'install_pending',
        evidence: {
          ...rotation.evidence,
          deploymentPlanId: plan.id,
          deploymentPlanStatus: plan.status,
          deploymentPlanSelectionMode: plan.selectionMode,
          deploymentPlanCertificateVersionId: plan.certificateVersionId,
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return this.dependencies.repository.saveRotation({
        ...rotation,
        status: 'install_pending',
        warnings: [...rotation.warnings, error instanceof Error ? error.message : String(error)],
        evidence: { ...rotation.evidence, deploymentPlanStatus: 'unavailable' },
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async listRotations(tenantId: string): Promise<CertificateRotationEntity[]> { return this.dependencies.repository.listRotations(tenantId); }
  async getRotation(tenantId: string, rotationId: string): Promise<CertificateRotationEntity> {
    const value = await this.dependencies.repository.getRotation(tenantId, rotationId);
    if (!value) throw new AppError('RESOURCE_NOT_FOUND', '证书轮换任务不存在', { rotationId });
    return value;
  }

  async getInstallAction(tenantId: string, rotationId: string): Promise<Record<string, unknown>> {
    const rotation = await this.getRotation(tenantId, rotationId);
    if (!rotation.targetCertificateRequestId) throw new AppError('RESOURCE_VERSION_CONFLICT', '轮换尚未生成证书申请');
    const request = (await this.dependencies.internalCa.listRequests(tenantId)).find((item) => item.id === rotation.targetCertificateRequestId);
    if (!request || !request.certificateVersionId) throw new AppError('RESOURCE_VERSION_CONFLICT', '轮换证书尚未签发，不能生成安装动作');
    const targetKey = rotation.targetKeyReferenceId ? await this.dependencies.repository.getKeyReference(tenantId, rotation.targetKeyReferenceId) : undefined;
    return {
      operation: 'certificate.install_issued',
      rotationId: rotation.id,
      targetId: rotation.applicationAssetId,
      localKeyRef: targetKey?.opaqueReference,
      publicKeyFingerprintSha256: targetKey?.publicKeyFingerprintSha256 ?? request.publicKeyFingerprintSha256,
      certificateVersionId: request.certificateVersionId,
      certificateRequestId: request.id,
      certificateArtifactRef: `certificate-version://${request.certificateVersionId}`,
      privateKeyTransported: false,
    };
  }

  async markTlsVerified(input: { tenantId: string; rotationId: string; certificateVersionId: string; tlsEvidence: Record<string, unknown>; actorId: string; context?: RequestContext }): Promise<CertificateRotationEntity> {
    const rotation = await this.getRotation(input.tenantId, input.rotationId);
    if (rotation.status === 'completed') return rotation;
    if (!['install_pending', 'deploying', 'cutover_verified', 'revoke_pending'].includes(rotation.status)) throw new AppError('RESOURCE_VERSION_CONFLICT', '轮换当前不允许提交 TLS 验证', { status: rotation.status });
    if (input.tlsEvidence.verified !== true) {
      throw new AppError('VALIDATION_FAILED', 'TLS 验证回执必须明确 verified=true', {
        code: 'TLS_VERIFICATION_REQUIRED',
        rotationId: rotation.id,
      });
    }
    const target = await this.requireVersion(input.tenantId, input.certificateVersionId);
    const source = await this.requireVersion(input.tenantId, rotation.sourceCertificateVersionId);
    if (target.id === source.id || target.publicKeyFingerprintSha256?.toLowerCase() === source.publicKeyFingerprintSha256?.toLowerCase()) throw new AppError('PUBLIC_KEY_MISMATCH', 'TLS 验证目标没有证明新公钥');
    let next = await this.dependencies.repository.saveRotation({
      ...rotation, targetCertificateVersionId: target.id, status: 'cutover_verified',
      evidence: { ...rotation.evidence, tls: structuredClone(input.tlsEvidence), targetPublicKeyFingerprintSha256: target.publicKeyFingerprintSha256 }, updatedAt: new Date().toISOString(),
    });
    try {
      const existingRevocationId = typeof next.evidence.revocationId === 'string' ? next.evidence.revocationId : undefined;
      const revocation = existingRevocationId
        ? (await this.dependencies.internalCa.listRevocations(input.tenantId)).find((item) => item.id === existingRevocationId)
          ?? await this.dependencies.internalCa.requestRevocation(input.tenantId, source.id, 'superseded', input.actorId, input.context)
        : await this.dependencies.internalCa.requestRevocation(input.tenantId, source.id, 'superseded', input.actorId, input.context);
      const completed = revocation.status === 'revoked';
      next = await this.dependencies.repository.saveRotation({ ...next, status: completed ? 'completed' : 'revoke_pending', evidence: { ...next.evidence, revocationId: revocation.id, revocationStatus: revocation.status }, updatedAt: new Date().toISOString() });
    } catch (error) {
      next = await this.dependencies.repository.saveRotation({ ...next, status: 'revoke_pending', warnings: [...next.warnings, error instanceof Error ? error.message : String(error)], updatedAt: new Date().toISOString() });
    }
    // 新证书已经完成 TLS 终验，应用切换事实由策略版本记录；旧证书撤销是独立事实。
    await this.updateApplicationPolicyStatus(input.tenantId, rotation.applicationAssetId, 'tls_verified', target.id);
    return next;
  }

  /**
   * 由执行结果同步服务调用。DeploymentPlan 是远程写入的唯一事实源，
   * 轮换账本只保存其引用和脱敏证据，不重新派发第二次安装动作。
   */
  async reconcileDeploymentPlanResult(input: {
    tenantId: string;
    deploymentPlanId: string;
    status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'UNKNOWN';
    executionStatus?: string;
    evidence?: Record<string, unknown>;
    actorId: string;
    context?: RequestContext;
  }): Promise<CertificateRotationEntity | undefined> {
    const rotation = (await this.listRotations(input.tenantId)).find((item) => (
      item.evidence.deploymentPlanId === input.deploymentPlanId
    ));
    if (!rotation) return undefined;
    const evidence = {
      ...rotation.evidence,
      deploymentPlanStatus: input.status,
      executionStatus: input.executionStatus ?? input.status,
      ...(input.evidence ? { deployment: structuredClone(input.evidence) } : {}),
    };
    if (rotation.status === 'completed') return rotation;
    if (input.status === 'UNKNOWN') {
      await this.updateApplicationPolicyStatus(input.tenantId, rotation.applicationAssetId, 'needs_attention', rotation.targetCertificateVersionId);
      return this.dependencies.repository.saveRotation({
        ...rotation,
        status: 'unknown',
        evidence,
        warnings: [...rotation.warnings, '部署执行结果未知，等待原计划回执恢复'],
        updatedAt: new Date().toISOString(),
      });
    }
    if (input.status === 'FAILED' || input.status === 'TIMEOUT') {
      await this.updateApplicationPolicyStatus(input.tenantId, rotation.applicationAssetId, 'needs_attention', rotation.targetCertificateVersionId);
      return this.dependencies.repository.saveRotation({
        ...rotation,
        status: 'failed',
        evidence: { ...evidence, rollbackRequired: true },
        warnings: [...rotation.warnings, '新证书部署或验证失败，旧证书未自动撤销'],
        updatedAt: new Date().toISOString(),
      });
    }
    if (!rotation.targetCertificateVersionId) {
      return this.dependencies.repository.saveRotation({ ...rotation, status: 'install_pending', evidence, updatedAt: new Date().toISOString() });
    }
    const tlsEvidence = readTlsEvidence(input.evidence);
    if (!tlsEvidence) {
      // 计划执行成功只证明证书已部署；TLS 终验仍是独立步骤，完成后再进入 tls_verified。
      await this.updateApplicationPolicyStatus(input.tenantId, rotation.applicationAssetId, 'deployed', rotation.targetCertificateVersionId);
      return this.dependencies.repository.saveRotation({
        ...rotation,
        status: 'deploying',
        evidence: { ...evidence, tlsVerification: 'pending', deploymentCompleted: true },
        updatedAt: new Date().toISOString(),
      });
    }
    return this.markTlsVerified({
      tenantId: input.tenantId,
      rotationId: rotation.id,
      certificateVersionId: rotation.targetCertificateVersionId,
      tlsEvidence,
      actorId: input.actorId,
      context: input.context,
    });
  }

  private async requireVersion(tenantId: string, id: string): Promise<CertificateVersionEntity> {
    const version = await this.dependencies.certificates.getRepository().getVersion(id, tenantId);
    if (!version) throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: id });
    return version;
  }

  private async updateApplicationPolicyStatus(tenantId: string, applicationAssetId: string, status: 'issued' | 'ready_to_deploy' | 'deployed' | 'tls_verified' | 'needs_attention' | 'renewing', certificateVersionId?: string): Promise<void> {
    if (!this.applicationPolicyStatusUpdater) return;
    try {
      await this.applicationPolicyStatusUpdater(tenantId, applicationAssetId, status, certificateVersionId);
    } catch (error) {
      // 策略回写是派生视图；不得让它的瞬时故障破坏已完成的签发、部署或 TLS 事实。
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[certificate-lifecycle] application policy status update failed', {
        tenantId,
        applicationAssetId,
        status,
        error: redactLifecycleError(new Error(message)),
      });
    }
  }
}

function redactLifecycleError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/(?:password|passphrase|secret|token)\s*[:=]\s*[^,;\s]+/gi, '$1=[REDACTED]');
}

function sameAgentContext(
  left: NonNullable<import('../schema/internal-ca.schema.js').CertificateRequestEntity['agentContext']>,
  right: NonNullable<import('../schema/internal-ca.schema.js').CertificateRequestEntity['agentContext']>,
): boolean {
  return left.agentId === right.agentId
    && left.targetId === right.targetId
    && left.keyPath === right.keyPath
    && left.certificatePath === right.certificatePath
    && left.configPath === right.configPath
    && left.format === right.format
    && left.storageMode === right.storageMode
    && left.alias === right.alias
    && left.pluginId === right.pluginId
    && left.pluginVersionId === right.pluginVersionId;
}

function readTlsEvidence(value?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const direct = value.tlsEvidence;
  if (direct && typeof direct === 'object' && !Array.isArray(direct) && (direct as Record<string, unknown>).verified === true) {
    return structuredClone(direct as Record<string, unknown>);
  }
  const verification = value.certificateVerification;
  if (verification && typeof verification === 'object' && !Array.isArray(verification) && (verification as Record<string, unknown>).verified === true) {
    return structuredClone(verification as Record<string, unknown>);
  }
  if (value.verified === true && (value.fingerprintSha256 || value.remoteCertificateSha256 || value.expectedFingerprintSha256)) {
    return structuredClone(value);
  }
  return undefined;
}

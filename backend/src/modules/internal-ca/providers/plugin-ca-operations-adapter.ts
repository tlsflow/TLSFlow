import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { CaPluginActionDispatcher } from './ca-provider.js';
import type {
  CaOperationsAdapter,
  CaOperationsCapabilities,
  CaOperationRecordBatch,
  ExternalCaObservationInput,
  ListCaOperationRecordsInput,
} from './ca-operations.js';
import type { ProviderActionBindingEntity } from '../schema/internal-ca.schema.js';

/**
 * Microsoft AD CS 的历史记录适配器。
 *
 * 列表动作仍走固定 Plugin Action 和独立 AD CS Agent；控制面只负责把
 * Agent 返回的公开字段转换成运营观察事实，不在本机执行 certutil。
 */
export class PluginCaOperationsAdapter implements CaOperationsAdapter {
  constructor(
    private readonly dispatcher: CaPluginActionDispatcher,
    private readonly bindings: Pick<BindingResolver, 'getActiveProviderActionBinding'>,
  ) {}

  getOperationsCapabilities(): CaOperationsCapabilities {
    return {
      listRequests: true,
      listIssuedCertificates: true,
      listRevokedCertificates: true,
      listTemplates: false,
      synchronizeHistory: true,
      approvePendingRequest: false,
      denyPendingRequest: false,
      publishCrl: false,
    };
  }

  async listOperationRecords(input: ListCaOperationRecordsInput): Promise<CaOperationRecordBatch> {
    if (input.provider.configuration.providerKind !== 'microsoft_adcs') {
      throw new AppError('CA_OPERATIONS_CAPABILITY_UNSUPPORTED', '当前 Plugin Provider 未接入历史同步');
    }
    const binding = await this.bindings.getActiveProviderActionBinding(input.provider.tenantId, input.provider.id);
    if (!binding) {
      throw new AppError('CA_OPERATIONS_CAPABILITY_UNSUPPORTED', 'Microsoft AD CS Provider 缺少历史列表动作绑定');
    }
    // 旧版绑定只保存生命周期动作；列表动作属于同一官方插件，可在调用时补齐，
    // 这样已关联的 Agent 不需要重新安装或手工编辑绑定记录。
    const effectiveBinding = binding.listAction
      ? binding
      : { ...binding, listAction: { actionId: 'ca.certificate.list.v1', actionVersion: 'v1' } };
    const idempotencyKey = `ca-history:${digest({
      runId: input.syncRunId ?? 'adhoc', objectType: input.objectType,
      cursor: input.cursor ?? '', changedAfter: input.changedAfter ?? '', limit: input.limit,
    })}`;
    const output = await this.dispatcher.execute({
      provider: input.provider,
      authority: input.authority,
      binding: effectiveBinding,
      action: 'list',
      actorId: 'ca-sync-worker',
      idempotencyKey,
      payload: {
        operation: 'ca.certificate.list',
        objectType: input.objectType,
        cursor: input.cursor,
        changedAfter: input.changedAfter,
        limit: input.limit,
        authorityId: input.authority.id,
      },
    });
    if (output.status === 'pending') {
      throw new AppError('CA_SYNC_SOURCE_UNAVAILABLE', 'AD CS Agent 历史查询任务尚未完成', { pending: true, taskId: output.detail });
    }
    if (!Array.isArray(output.records) || typeof output.complete !== 'boolean') {
      throw new AppError('CA_PROVIDER_RESULT_INVALID', 'AD CS Agent 历史查询结果无效');
    }
    return {
      records: output.records.map((record) => normalizeObservation(record)),
      complete: output.complete,
      nextCursor: stringValue(output.nextCursor),
      sourceWatermark: stringValue(output.sourceWatermark),
    };
  }
}

interface BindingResolver {
  getActiveProviderActionBinding(tenantId: string, providerId: string): Promise<ProviderActionBindingEntity | undefined>;
}

function normalizeObservation(value: unknown): ExternalCaObservationInput {
  if (!isRecord(value)) throw new AppError('CA_PROVIDER_RESULT_INVALID', 'AD CS 历史记录不是对象');
  const externalObjectId = stringValue(value.externalObjectId) ?? stringValue(value.requestId);
  if (!externalObjectId) throw new AppError('CA_PROVIDER_RESULT_INVALID', 'AD CS 历史记录缺少 RequestID');
  const normalizedStatus = value.normalizedStatus;
  if (!['pending', 'issued', 'rejected', 'revoked', 'failed', 'unknown'].includes(String(normalizedStatus))) {
    throw new AppError('CA_PROVIDER_RESULT_INVALID', 'AD CS 历史记录状态无效');
  }
  const rawSummary = isRecord(value.rawSummary) ? value.rawSummary : {};
  return {
    externalObjectId,
    externalParentId: stringValue(value.externalParentId),
    normalizedStatus: normalizedStatus as ExternalCaObservationInput['normalizedStatus'],
    sourceStatus: stringValue(value.sourceStatus),
    sourceRevision: stringValue(value.sourceRevision),
    subjectCommonName: stringValue(value.subjectCommonName),
    serialNumber: stringValue(value.serialNumber),
    templateExternalId: stringValue(value.templateExternalId),
    requestedByDisplay: stringValue(value.requestedByDisplay),
    submittedAt: stringValue(value.submittedAt),
    issuedAt: stringValue(value.issuedAt),
    revokedAt: stringValue(value.revokedAt),
    notBefore: stringValue(value.notBefore),
    notAfter: stringValue(value.notAfter),
    rawSummary: Object.fromEntries(Object.entries(rawSummary).flatMap(([key, item]) => (
      item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
        ? [[key, item]] as Array<[string, string | number | boolean | null]>
        : []
    ))),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex').slice(0, 32);
}

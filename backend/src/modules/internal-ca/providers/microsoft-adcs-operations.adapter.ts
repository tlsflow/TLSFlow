import { AppError } from '../../../common/errors/app-error.js';
import type { CaNodeTaskEntity, CaOperationNormalizedStatus } from '../schema/internal-ca.schema.js';
import type {
  CaOperationsAdapter,
  CaOperationRecordBatch,
  CaOperationsCapabilities,
  ExternalCaObservationInput,
  ListCaOperationRecordsInput,
} from './ca-operations.js';

export interface AdcsNodeTaskClient {
  enqueue(input: {
    tenantId: string;
    providerId: string;
    taskType: CaNodeTaskEntity['taskType'];
    payload: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<CaNodeTaskEntity>;
  waitForResult(tenantId: string, taskId: string): Promise<CaNodeTaskEntity>;
}

export class MicrosoftAdcsOperationsAdapter implements CaOperationsAdapter {
  constructor(private readonly tasks: AdcsNodeTaskClient) {}

  getOperationsCapabilities(): CaOperationsCapabilities {
    return {
      listRequests: true,
      listIssuedCertificates: true,
      listRevokedCertificates: true,
      listTemplates: true,
      synchronizeHistory: true,
      approvePendingRequest: false,
      denyPendingRequest: false,
      publishCrl: true,
    };
  }

  async listOperationRecords(input: ListCaOperationRecordsInput): Promise<CaOperationRecordBatch> {
    const discovered = asObject(input.provider.configuration.discovered);
    const caConfig = textValue(discovered.caConfig);
    if (!caConfig) throw new AppError('CA_PROVIDER_UNAVAILABLE', 'Microsoft AD CS Agent 尚未发现 CA Config');
    const task = await this.tasks.enqueue({
      tenantId: input.provider.tenantId,
      providerId: input.provider.id,
      taskType: 'sync_adcs_records',
      payload: {
        caConfig,
        objectType: input.objectType,
        ...(input.cursor ? { cursor: input.cursor } : {}),
        limit: input.limit,
        ...(input.changedAfter ? { changedAfter: input.changedAfter } : {}),
      },
      idempotencyKey: [
        'sync-adcs-records', input.syncRunId ?? 'direct', input.authority.id, input.objectType,
        input.changedAfter ?? 'history', input.cursor ?? 'initial',
      ].join(':'),
    });
    const completed = await this.tasks.waitForResult(input.provider.tenantId, task.id);
    if (completed.status !== 'succeeded' || !completed.result) {
      throw new AppError('CA_SYNC_SOURCE_UNAVAILABLE', completed.errorMessage ?? 'Microsoft AD CS Agent 同步任务失败', {
        taskId: task.id,
        errorCode: completed.errorCode,
      });
    }
    return normalizeBatch(completed.result, input.objectType);
  }
}

function normalizeBatch(result: Record<string, unknown>, objectType: ListCaOperationRecordsInput['objectType']): CaOperationRecordBatch {
  const rawRecords = result.records;
  if (!Array.isArray(rawRecords)) throw new AppError('CA_SYNC_CURSOR_INVALID', 'Microsoft AD CS Agent 返回缺少 records');
  const records = rawRecords.map((value) => normalizeRecord(value, objectType));
  const complete = result.complete;
  if (typeof complete !== 'boolean') throw new AppError('CA_SYNC_CURSOR_INVALID', 'Microsoft AD CS Agent 返回缺少 complete');
  const nextCursor = textValue(result.nextCursor);
  return {
    records,
    complete,
    ...(nextCursor ? { nextCursor } : {}),
    ...(textValue(result.sourceWatermark) ? { sourceWatermark: textValue(result.sourceWatermark) } : {}),
  };
}

function normalizeRecord(value: unknown, objectType: ListCaOperationRecordsInput['objectType']): ExternalCaObservationInput {
  const record = asObject(value);
  const externalObjectId = textValue(record.externalObjectId);
  if (!externalObjectId) throw new AppError('CA_SYNC_CURSOR_INVALID', 'Microsoft AD CS Agent 返回记录缺少 externalObjectId');
  const normalizedStatus = normalizeStatus(record.normalizedStatus);
  const rawSummary = normalizeRawSummary(record.rawSummary);
  return {
    externalObjectId,
    externalParentId: textValue(record.externalParentId),
    normalizedStatus,
    sourceStatus: textValue(record.sourceStatus),
    sourceRevision: textValue(record.sourceRevision),
    subjectCommonName: textValue(record.subjectCommonName),
    serialNumber: textValue(record.serialNumber),
    templateExternalId: textValue(record.templateExternalId),
    requestedByDisplay: textValue(record.requestedByDisplay),
    submittedAt: textValue(record.submittedAt),
    issuedAt: textValue(record.issuedAt),
    revokedAt: textValue(record.revokedAt),
    notBefore: textValue(record.notBefore),
    notAfter: textValue(record.notAfter),
    rawSummary: { objectType, ...rawSummary },
  };
}

function normalizeStatus(value: unknown): CaOperationNormalizedStatus {
  return ['pending', 'issued', 'rejected', 'revoked', 'failed', 'unknown'].includes(String(value))
    ? String(value) as CaOperationNormalizedStatus
    : 'unknown';
}

function normalizeRawSummary(value: unknown): Record<string, string | number | boolean | null> {
  const source = asObject(value);
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(source)) {
    if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') output[key] = item;
    else output[key] = String(item);
  }
  return output;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

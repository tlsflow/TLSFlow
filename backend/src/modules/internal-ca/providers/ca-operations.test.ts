import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import type { CaProviderEntity, CertificateAuthorityEntity } from '../schema/internal-ca.schema.js';
import {
  CaOperationsAdapterRegistry,
  assertCaOperationListInput,
  assertCaOperationRecordBatch,
  emptyCaOperationsCapabilities,
} from './ca-operations.js';
import { caOperationsOpenApiSchemas } from '../dto/ca-operations.dto.js';

const provider: CaProviderEntity = {
  id: 'provider-adcs', tenantId: 'tenant-operations', name: 'AD CS', type: 'microsoft_adcs',
  deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single', capabilities: {
    discoverHierarchy: true, createRoot: false, createIntermediate: false, signCsr: true, queryIssuance: true,
    revokeCertificate: true, publishCrl: true, ocsp: false, listProfiles: true, deviceLocalCsr: false,
    hardwareBackedKey: true, highAvailability: false,
  }, status: 'active', configuration: {}, createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z',
};

const authority: CertificateAuthorityEntity = {
  id: 'ca-adcs', tenantId: provider.tenantId, name: 'AD CS CA', role: 'root', topologyMode: 'external_managed',
  providerId: provider.id, securityDomain: 'production', status: 'active', subjectCommonName: 'AD CS CA',
  createdAt: provider.createdAt, updatedAt: provider.updatedAt,
};

test('运营能力与既有签发能力分离，默认全部关闭', () => {
  assert.deepEqual(emptyCaOperationsCapabilities(), {
    listRequests: false, listIssuedCertificates: false, listRevokedCertificates: false, listTemplates: false,
    synchronizeHistory: false, approvePendingRequest: false, denyPendingRequest: false, publishCrl: false,
  });
});

test('运营查询输入拒绝越界批量和 CA Provider 不匹配', () => {
  assert.throws(
    () => assertCaOperationListInput({ provider, authority, objectType: 'request', limit: 501 }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'CA_OPERATIONS_QUERY_INVALID',
  );
  assert.throws(
    () => assertCaOperationListInput({ provider, authority: { ...authority, providerId: 'other' }, objectType: 'request', limit: 20 }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'CA_OPERATIONS_QUERY_INVALID',
  );
});

test('运营批次要求稳定外部 ID、受限摘要且批次内不重复', () => {
  const record = {
    externalObjectId: 'request:2', normalizedStatus: 'issued' as const,
    rawSummary: { disposition: 20, dispositionMessage: 'Issued' },
  };
  assert.doesNotThrow(() => assertCaOperationRecordBatch({ records: [record], complete: true }, 20));
  assert.throws(
    () => assertCaOperationRecordBatch({ records: [record, record], complete: true }, 20),
    (error: unknown) => error instanceof AppError && error.errorCode === 'CA_OPERATIONS_QUERY_INVALID',
  );
  assert.throws(
    () => assertCaOperationRecordBatch({ records: [{ ...record, rawSummary: { detail: 'x'.repeat(16 * 1024) } }], complete: true }, 20),
    (error: unknown) => error instanceof AppError && error.errorCode === 'CA_SYNC_BATCH_TOO_LARGE',
  );
});

test('未注册运营适配器必须明确拒绝，不能伪造通用能力', () => {
  const registry = new CaOperationsAdapterRegistry();
  assert.equal(registry.has('microsoft_adcs'), false);
  assert.throws(
    () => registry.get('microsoft_adcs'),
    (error: unknown) => error instanceof AppError && error.errorCode === 'CA_OPERATIONS_CAPABILITY_UNSUPPORTED',
  );
});

test('运营查询 OpenAPI schema 与合同对象类型和分页边界一致', () => {
  assert.deepEqual(caOperationsOpenApiSchemas.operationObjectType.enum, ['request', 'issuance', 'revocation', 'template']);
  assert.equal(caOperationsOpenApiSchemas.operationRecordQuery.properties.limit.maximum, 200);
  assert.equal(caOperationsOpenApiSchemas.operationRecordQuery.properties.cursor.maxLength, 2048);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { caOperationNormalizedStatuses, caOperationObjectTypes } from './ca-operations.js';
import { caOperationsOpenApiSchemas } from '../dto/ca-operations.dto.js';

test('CA 运营对象类型和状态枚举保持主动观测协议一致', () => {
  assert.deepEqual(caOperationObjectTypes, ['request', 'issuance', 'revocation', 'template']);
  assert.deepEqual(caOperationNormalizedStatuses, ['pending', 'issued', 'rejected', 'revoked', 'failed', 'unknown']);
});

test('运营查询 OpenAPI schema 与合同对象类型和分页边界一致', () => {
  assert.deepEqual(caOperationsOpenApiSchemas.operationObjectType.enum, ['request', 'issuance', 'revocation', 'template']);
  assert.equal(caOperationsOpenApiSchemas.operationRecordQuery.properties.limit.maximum, 200);
  assert.equal(caOperationsOpenApiSchemas.operationRecordQuery.properties.cursor.maxLength, 2048);
});

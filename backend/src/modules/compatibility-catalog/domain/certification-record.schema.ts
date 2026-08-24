import { AdapterKinds, type AdapterComposition } from '../../../shared/contracts/adapter-contracts.js';
import {
  CERTIFICATION_RECORD_API_VERSION,
  CertificationRecordStatuses,
  type CertificationAgentArtifact,
  type CertificationEnvironment,
  type CertificationRecord,
  type CertificationTestResult,
} from '../../../shared/contracts/compatibility-governance-contracts.js';
import {
  assertKnownKeys,
  invalid,
  optionalIsoDate,
  requireBoolean,
  requireEnum,
  requireIdentifier,
  requireIsoDate,
  requireRecord,
  requireReference,
  requireString,
  requireStringArray,
  requireVersion,
} from './compatibility-governance.schema-utils.js';

const errorCode = 'COMPATIBILITY_CERTIFICATION_INVALID' as const;

export function parseCertificationRecord(input: unknown): CertificationRecord {
  const value = requireRecord(input, 'Certification Record', errorCode);
  assertKnownKeys(value, [
    'apiVersion', 'recordId', 'baselineRef', 'recipeRef', 'environment', 'agentArtifact', 'resolvedComposition',
    'testSuite', 'results', 'status', 'observedAt', 'expiresAt', 'evidenceReferences', 'supersedes',
  ], errorCode);
  if (value.apiVersion !== CERTIFICATION_RECORD_API_VERSION) invalid(errorCode, 'apiVersion 只支持 gcac.certification-record/v1');
  const results = value.results;
  if (!Array.isArray(results) || results.length === 0) invalid(errorCode, 'results 必须是非空数组');
  const record: CertificationRecord = {
    apiVersion: CERTIFICATION_RECORD_API_VERSION,
    recordId: requireIdentifier(value, 'recordId', errorCode),
    baselineRef: requireReference(value, 'baselineRef', errorCode),
    recipeRef: requireReference(value, 'recipeRef', errorCode),
    environment: parseEnvironment(value.environment),
    agentArtifact: parseAgentArtifact(value.agentArtifact),
    resolvedComposition: parseComposition(value.resolvedComposition),
    testSuite: requireString(value, 'testSuite', errorCode),
    results: results.map(parseTestResult),
    status: requireEnum(value, 'status', CertificationRecordStatuses, errorCode),
    observedAt: requireIsoDate(value, 'observedAt', errorCode),
    expiresAt: optionalIsoDate(value, 'expiresAt', errorCode),
    evidenceReferences: requireStringArray(value, 'evidenceReferences', errorCode, false),
  };
  if (value.supersedes !== undefined) record.supersedes = requireIdentifier(value, 'supersedes', errorCode);
  if (record.status === 'passed' && record.results.some((result) => result.status !== 'passed')) invalid(errorCode, 'passed 认证记录的测试结果必须全部通过');
  return record;
}

function parseEnvironment(input: unknown): CertificationEnvironment {
  const value = requireRecord(input, 'environment', errorCode);
  const keys = ['osName', 'osVersion', 'kernelOrBuild', 'architecture', 'serviceModel', 'privilegeMode', 'securityModule', 'securityMode', 'productName', 'productVersion', 'certificateFormat', 'transport'] as const;
  assertKnownKeys(value, keys, errorCode);
  return Object.fromEntries(keys.map((key) => [key, requireString(value, key, errorCode)])) as unknown as CertificationEnvironment;
}

function parseAgentArtifact(input: unknown): CertificationAgentArtifact {
  const value = requireRecord(input, 'agentArtifact', errorCode);
  assertKnownKeys(value, ['productLine', 'version', 'revision', 'sha256', 'signatureVerified', 'vcsModified'], errorCode);
  const sha256 = requireString(value, 'sha256', errorCode).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) invalid(errorCode, 'agentArtifact.sha256 必须是 64 位 SHA-256');
  return {
    productLine: requireIdentifier(value, 'productLine', errorCode),
    version: requireVersion(value, 'version', errorCode),
    revision: requireString(value, 'revision', errorCode),
    sha256,
    signatureVerified: requireBoolean(value, 'signatureVerified', errorCode),
    vcsModified: requireBoolean(value, 'vcsModified', errorCode),
  };
}

function parseTestResult(input: unknown): CertificationTestResult {
  const value = requireRecord(input, 'results item', errorCode);
  assertKnownKeys(value, ['testId', 'category', 'status', 'reference'], errorCode);
  return {
    testId: requireIdentifier(value, 'testId', errorCode),
    category: requireEnum(value, 'category', ['contract', 'integration', 'real_environment', 'security', 'recovery'] as const, errorCode),
    status: requireEnum(value, 'status', ['passed', 'failed', 'blocked'] as const, errorCode),
    reference: requireString(value, 'reference', errorCode),
  };
}

function parseComposition(input: unknown): AdapterComposition {
  const value = requireRecord(input, 'resolvedComposition', errorCode);
  const result: AdapterComposition = {};
  for (const [kind, adapterId] of Object.entries(value)) {
    if (!AdapterKinds.includes(kind as (typeof AdapterKinds)[number])) invalid(errorCode, `resolvedComposition 包含未知适配器类型 ${kind}`);
    if (typeof adapterId !== 'string' || adapterId.trim() === '') invalid(errorCode, `resolvedComposition.${kind} 必须是适配器 ID`);
    result[kind as (typeof AdapterKinds)[number]] = adapterId;
  }
  if (Object.keys(result).length === 0) invalid(errorCode, 'resolvedComposition 不得为空');
  return result;
}

import { createHash, sign, verify, type KeyObject } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { AppError } from '../../../common/errors/app-error.js';
import type { JsonSchema } from '../../../common/validation/json-schema.js';

export const agentSecurityContractVersion = 'gcac.agent-security/v1' as const;
/** Agent v2 长期合同的唯一动作集合。旧动作没有兼容入口。 */
export const agentV2ContractTypes = [
  'agent.fact.collect',
  'agent.plan.validate',
  'agent.plan.execute',
  'agent.execution.receipt',
] as const;
export type AgentV2ContractType = typeof agentV2ContractTypes[number];
/**
 * Canonical Plugin ID 的语法必须覆盖注册表里的连字符产品段，例如
 * `app.java-keystore`、`app.service-certificate-file` 和 `ca.microsoft-adcs`。
 */
export const canonicalPluginIdPattern = '^(?:web|app|device|cloud|ca)\\.[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)*$';
export const maximumFactTtlSeconds = 24 * 60 * 60;
export const maximumFileContentBytes = 64 * 1024;
export const maximumPlanOperations = 100;
export const maximumTokenLifetimeSeconds = 15 * 60;

export const allowedAgentOperationTypes = [
  'process.list',
  'service.list',
  'service.status',
  'filesystem.stat',
  'filesystem.read',
  'filesystem.backup',
  'filesystem.atomic_replace',
  'filesystem.restore',
  'certificate.material.validate',
  'certificate.store.inspect',
  'service.start',
  'service.stop',
  'service.reload',
  'command.execute_allowlisted',
] as const;

export type AgentOperationType = typeof allowedAgentOperationTypes[number];
export type AgentPlanStage = 'prepare' | 'execute' | 'verify' | 'compensate';
export type AgentFactKind = 'process' | 'service' | 'listening_port' | 'file_stat' | 'file_content' | 'certificate_file' | 'certificate_store' | 'privilege';
export type AgentSecurityStatus = 'SUCCESS' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';

export interface ProcessFactV1 {
  kind: 'process';
  pid: number;
  parentPid?: number;
  executablePath: string;
  executableSha256?: string;
  commandLine?: string;
  startedAt?: string;
}

export interface ServiceFactV1 {
  kind: 'service';
  name: string;
  status: 'running' | 'stopped' | 'paused' | 'unknown';
  executablePath?: string;
  startType?: 'automatic' | 'manual' | 'disabled' | 'unknown';
}

export interface ListeningPortFactV1 {
  kind: 'listening_port';
  address: string;
  port: number;
  protocol: 'tcp' | 'udp';
  pid?: number;
}

export interface FileStatFactV1 {
  kind: 'file_stat';
  path: string;
  exists: boolean;
  sizeBytes: number;
  sha256?: string;
  modifiedAt?: string;
  mode?: string;
}

export interface FileContentFactV1 {
  kind: 'file_content';
  path: string;
  contentBase64: string;
  bytesRead: number;
  truncated: boolean;
  sha256: string;
}

export interface CertificateStoreFactV1 {
  kind: 'certificate_store';
  /** Windows 证书库 URI，仅定位公开证书条目，不含任何私钥材料。 */
  path?: string;
  store: string;
  storeLocation?: string;
  subject: string;
  thumbprint: string;
  sha256Fingerprint?: string;
  issuer?: string;
  notBefore?: string;
  notAfter?: string;
  hasPrivateKey: boolean;
}

/**
 * 磁盘证书的只读摘要。Agent 只能上报公开字段，禁止上传 PEM、DER、PFX、JKS
 * 或私钥内容；配置解析器只需要路径和指纹完成绑定关联。
 */
export interface CertificateFileFactV1 {
  kind: 'certificate_file';
  path: string;
  configuredPaths?: string[];
  sha256Fingerprint?: string;
  thumbprint?: string;
  subject?: string;
  issuer?: string;
  notBefore?: string;
  notAfter?: string;
}

export interface PrivilegeFactV1 {
  kind: 'privilege';
  principal: string;
  elevated: boolean;
  groups: string[];
}

export type AgentRawFactV1 = ProcessFactV1 | ServiceFactV1 | ListeningPortFactV1 | FileStatFactV1 | FileContentFactV1 | CertificateFileFactV1 | CertificateStoreFactV1 | PrivilegeFactV1;

export interface AgentFactEnvelopeV1 {
  contractVersion: typeof agentSecurityContractVersion;
  factId: string;
  agentId: string;
  tenantId: string;
  collectedAt: string;
  ttlSeconds: number;
  source: 'windows' | 'linux' | 'compatibility';
  facts: AgentRawFactV1[];
  digest: string;
  warnings: string[];
}

export interface AgentPlanOperationV1 {
  operationId: string;
  operationType: AgentOperationType;
  stage: AgentPlanStage;
  input: Record<string, unknown>;
  dependsOn: string[];
  idempotencyKey: string;
  timeoutSeconds: number;
  compensation?: string;
}

export interface AgentPlanV1 {
  planVersion: typeof agentSecurityContractVersion;
  planId: string;
  agentId: string;
  tenantId: string;
  pluginId: string;
  pluginVersionId: string;
  capability: string;
  operations: AgentPlanOperationV1[];
  planDigest: string;
  tokenId: string;
  policyDecisionId: string;
  nonce: string;
  expiresAt: string;
  writeEffect: boolean;
  approvalRef?: string;
}

export interface AgentCapabilityTokenV1 {
  tokenVersion: typeof agentSecurityContractVersion;
  tokenId: string;
  agentId: string;
  tenantId: string;
  pluginId: string;
  pluginVersionId: string;
  capability: string;
  actions: string[];
  allowedPaths: string[];
  allowedServices: string[];
  artifactDigests: string[];
  approvalRef?: string;
  policyRef: string;
  policyVersion: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  planDigest: string;
  authorityKeyId: string;
  signature: string;
}

export interface PolicyAuthorityDecisionV1 {
  decisionVersion: typeof agentSecurityContractVersion;
  decisionId: string;
  allowed: boolean;
  agentId: string;
  tenantId: string;
  pluginId: string;
  pluginVersionId: string;
  capability: string;
  actions: string[];
  allowedPaths: string[];
  allowedServices: string[];
  artifactDigests: string[];
  policyRef: string;
  policyVersion: string;
  planDigest: string;
  tokenId: string;
  nonce: string;
  approvalRef?: string;
  issuedAt: string;
  validUntil: string;
  authorityKeyId: string;
  revocationRef: string;
  signature: string;
  reason?: string;
}

export interface AgentExecutionReceiptV1 {
  receiptVersion: typeof agentSecurityContractVersion;
  operationId: string;
  planId: string;
  planDigest: string;
  agentId: string;
  tenantId: string;
  tokenId: string;
  status: AgentSecurityStatus;
  startedAt: string;
  completedAt: string;
  operationResults: Record<string, unknown>[];
  nonceConsumed: boolean;
  errorCode?: string;
  unknownReason?: string;
  digest: string;
  /** Agent 自身的回执签名标识；生产 Agent v2 会提供，旧测试合同可省略。 */
  agentKeyId?: string;
  /** 对完整回执（不含 signature）的签名；摘要仍由控制面重新计算。 */
  signature?: string;
}

export interface AgentLocalPathRuleV1 {
  prefix: string;
  operations: string[];
}

export interface AgentLocalCommandRuleV1 {
  executablePath: string;
  executableSha256: string;
  argumentTemplate: string[];
  environmentAllowlist: string[];
  workingDirectory: string;
  networkScopes: string[];
  childProcessPolicy: 'deny' | 'allow-listed';
  timeoutSeconds: number;
  outputLimitBytes: number;
}

export interface AgentLocalPolicyV1 {
  policyVersion: typeof agentSecurityContractVersion;
  agentId: string;
  authorityKeyIds: string[];
  allowedActions: string[];
  pathRules: AgentLocalPathRuleV1[];
  serviceRules: string[];
  commandRules: AgentLocalCommandRuleV1[];
  disabled: boolean;
  updatedAt: string;
}

export interface PolicyAuthorityKeyV1 {
  keyId: string;
  algorithm: 'Ed25519';
  publicKeyPem: string;
  status: 'ACTIVE' | 'REVOKED';
  notBefore: string;
  notAfter: string;
}

export interface PolicyAuthorityKeySetV1 {
  keySetVersion: typeof agentSecurityContractVersion;
  authorityId: string;
  activeKeyId: string;
  keys: PolicyAuthorityKeyV1[];
  issuedAt: string;
}

export interface TokenRevocationRecordV1 {
  recordVersion: typeof agentSecurityContractVersion;
  tokenId: string;
  authorityKeyId: string;
  reason: string;
  revokedAt: string;
}

export interface DecisionRevocationRecordV1 {
  recordVersion: typeof agentSecurityContractVersion;
  decisionId: string;
  authorityKeyId: string;
  reason: string;
  revokedAt: string;
}

export interface NonceConsumptionRecordV1 {
  recordVersion: typeof agentSecurityContractVersion;
  nonce: string;
  tokenId: string;
  consumedAt: string;
  resultDigest: string;
}

export const agentSecuritySchemas: Record<string, JsonSchema> = {
  AgentFactEnvelopeV1: { type: 'object', additionalProperties: false, required: ['contractVersion', 'factId', 'agentId', 'tenantId', 'collectedAt', 'ttlSeconds', 'source', 'facts', 'digest', 'warnings'], properties: { contractVersion: { const: agentSecurityContractVersion }, factId: identifierSchema(), agentId: identifierSchema(), tenantId: identifierSchema(), collectedAt: dateTimeSchema(), ttlSeconds: { type: 'integer', minimum: 1, maximum: maximumFactTtlSeconds }, source: { enum: ['windows', 'linux', 'compatibility'] }, facts: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'object', additionalProperties: true } }, digest: digestSchema(), warnings: stringArraySchema() } },
  ProcessFactV1: { type: 'object', additionalProperties: false, required: ['kind', 'pid', 'executablePath'], properties: { kind: { const: 'process' }, pid: positiveIntegerSchema(), parentPid: positiveIntegerSchema(), executablePath: absolutePathSchema(), executableSha256: digestSchema(), commandLine: { type: 'string', maxLength: 4096 }, startedAt: dateTimeSchema() } },
  ServiceFactV1: { type: 'object', additionalProperties: false, required: ['kind', 'name', 'status'], properties: { kind: { const: 'service' }, name: identifierSchema(), status: { enum: ['running', 'stopped', 'paused', 'unknown'] }, executablePath: absolutePathSchema(), startType: { enum: ['automatic', 'manual', 'disabled', 'unknown'] } } },
  ListeningPortFactV1: { type: 'object', additionalProperties: false, required: ['kind', 'address', 'port', 'protocol'], properties: { kind: { const: 'listening_port' }, address: { type: 'string', minLength: 1, maxLength: 128 }, port: { type: 'integer', minimum: 1, maximum: 65535 }, protocol: { enum: ['tcp', 'udp'] }, pid: positiveIntegerSchema() } },
  FileStatFactV1: { type: 'object', additionalProperties: false, required: ['kind', 'path', 'exists', 'sizeBytes'], properties: { kind: { const: 'file_stat' }, path: absolutePathSchema(), exists: { type: 'boolean' }, sizeBytes: { type: 'integer', minimum: 0, maximum: 1024 * 1024 * 1024 }, sha256: digestSchema(), modifiedAt: dateTimeSchema(), mode: { type: 'string', maxLength: 32 } } },
  FileContentFactV1: { type: 'object', additionalProperties: false, required: ['kind', 'path', 'contentBase64', 'bytesRead', 'truncated', 'sha256'], properties: { kind: { const: 'file_content' }, path: absolutePathSchema(), contentBase64: { type: 'string', maxLength: maximumFileContentBytes * 2 }, bytesRead: { type: 'integer', minimum: 0, maximum: maximumFileContentBytes }, truncated: { type: 'boolean' }, sha256: digestSchema() } },
  CertificateFileFactV1: { type: 'object', additionalProperties: false, required: ['kind', 'path'], properties: { kind: { const: 'certificate_file' }, path: absolutePathSchema(), configuredPaths: stringArraySchema(), sha256Fingerprint: digestSchema(), thumbprint: nonEmptyStringSchema(), subject: nonEmptyStringSchema(), issuer: nonEmptyStringSchema(), notBefore: dateTimeSchema(), notAfter: dateTimeSchema() } },
  CertificateStoreFactV1: { type: 'object', additionalProperties: false, required: ['kind', 'store', 'subject', 'thumbprint', 'hasPrivateKey'], properties: { kind: { const: 'certificate_store' }, path: nonEmptyStringSchema(), store: identifierSchema(), storeLocation: identifierSchema(), subject: nonEmptyStringSchema(), thumbprint: nonEmptyStringSchema(), sha256Fingerprint: digestSchema(), issuer: nonEmptyStringSchema(), notBefore: dateTimeSchema(), notAfter: dateTimeSchema(), hasPrivateKey: { type: 'boolean' } } },
  PrivilegeFactV1: { type: 'object', additionalProperties: false, required: ['kind', 'principal', 'elevated', 'groups'], properties: { kind: { const: 'privilege' }, principal: nonEmptyStringSchema(), elevated: { type: 'boolean' }, groups: stringArraySchema() } },
  AgentPlanV1: { type: 'object', additionalProperties: false, required: ['planVersion', 'planId', 'agentId', 'tenantId', 'pluginId', 'pluginVersionId', 'capability', 'operations', 'planDigest', 'tokenId', 'policyDecisionId', 'nonce', 'expiresAt', 'writeEffect'], properties: { planVersion: { const: agentSecurityContractVersion }, planId: identifierSchema(), agentId: identifierSchema(), tenantId: identifierSchema(), pluginId: canonicalPluginIdSchema(), pluginVersionId: identifierSchema(), capability: identifierSchema(), operations: { type: 'array', minItems: 1, maxItems: maximumPlanOperations, items: { type: 'object' } }, planDigest: digestSchema(), tokenId: identifierSchema(), policyDecisionId: identifierSchema(), nonce: identifierSchema(), expiresAt: dateTimeSchema(), writeEffect: { type: 'boolean' }, approvalRef: identifierSchema() } },
  AgentPlanOperationV1: { type: 'object', additionalProperties: false, required: ['operationId', 'operationType', 'stage', 'input', 'dependsOn', 'idempotencyKey', 'timeoutSeconds'], properties: { operationId: identifierSchema(), operationType: { enum: [...allowedAgentOperationTypes] }, stage: { enum: ['prepare', 'execute', 'verify', 'compensate'] }, input: { type: 'object' }, dependsOn: stringArraySchema(), idempotencyKey: identifierSchema(), timeoutSeconds: { type: 'integer', minimum: 1, maximum: 3600 }, compensation: identifierSchema() } },
  AgentCapabilityTokenV1: { type: 'object', additionalProperties: false, required: ['tokenVersion', 'tokenId', 'agentId', 'tenantId', 'pluginId', 'pluginVersionId', 'capability', 'actions', 'allowedPaths', 'allowedServices', 'artifactDigests', 'policyRef', 'policyVersion', 'issuedAt', 'expiresAt', 'nonce', 'planDigest', 'authorityKeyId', 'signature'], properties: { tokenVersion: { const: agentSecurityContractVersion }, tokenId: identifierSchema(), agentId: identifierSchema(), tenantId: identifierSchema(), pluginId: canonicalPluginIdSchema(), pluginVersionId: identifierSchema(), capability: identifierSchema(), actions: stringArraySchema(), allowedPaths: { type: 'array', items: absolutePathSchema(), maxItems: 100 }, allowedServices: stringArraySchema(), artifactDigests: { type: 'array', items: digestSchema(), maxItems: 100 }, approvalRef: identifierSchema(), policyRef: identifierSchema(), policyVersion: identifierSchema(), issuedAt: dateTimeSchema(), expiresAt: dateTimeSchema(), nonce: identifierSchema(), planDigest: digestSchema(), authorityKeyId: identifierSchema(), signature: nonEmptyStringSchema() } },
  PolicyAuthorityDecisionV1: { type: 'object', additionalProperties: false, required: ['decisionVersion', 'decisionId', 'allowed', 'agentId', 'tenantId', 'pluginId', 'pluginVersionId', 'capability', 'actions', 'allowedPaths', 'allowedServices', 'artifactDigests', 'policyRef', 'policyVersion', 'planDigest', 'tokenId', 'nonce', 'issuedAt', 'validUntil', 'authorityKeyId', 'revocationRef', 'signature'], properties: { decisionVersion: { const: agentSecurityContractVersion }, decisionId: identifierSchema(), allowed: { type: 'boolean' }, agentId: identifierSchema(), tenantId: identifierSchema(), pluginId: canonicalPluginIdSchema(), pluginVersionId: identifierSchema(), capability: identifierSchema(), actions: stringArraySchema(), allowedPaths: { type: 'array', items: absolutePathSchema(), maxItems: 100 }, allowedServices: stringArraySchema(), artifactDigests: { type: 'array', items: digestSchema(), maxItems: 100 }, policyRef: identifierSchema(), policyVersion: identifierSchema(), planDigest: digestSchema(), tokenId: identifierSchema(), nonce: identifierSchema(), approvalRef: identifierSchema(), issuedAt: dateTimeSchema(), validUntil: dateTimeSchema(), authorityKeyId: identifierSchema(), revocationRef: identifierSchema(), signature: nonEmptyStringSchema(), reason: nonEmptyStringSchema() } },
  AgentExecutionReceiptV1: { type: 'object', additionalProperties: false, required: ['receiptVersion', 'operationId', 'planId', 'planDigest', 'agentId', 'tenantId', 'tokenId', 'status', 'startedAt', 'completedAt', 'operationResults', 'nonceConsumed', 'digest'], properties: { receiptVersion: { const: agentSecurityContractVersion }, operationId: identifierSchema(), planId: identifierSchema(), planDigest: digestSchema(), agentId: identifierSchema(), tenantId: identifierSchema(), tokenId: identifierSchema(), status: { enum: ['SUCCESS', 'FAILED', 'UNKNOWN', 'CANCELLED'] }, startedAt: dateTimeSchema(), completedAt: dateTimeSchema(), operationResults: { type: 'array', items: { type: 'object' }, maxItems: maximumPlanOperations }, nonceConsumed: { type: 'boolean' }, errorCode: identifierSchema(), unknownReason: nonEmptyStringSchema(), digest: digestSchema(), agentKeyId: identifierSchema(), signature: nonEmptyStringSchema() } },
  AgentLocalPolicyV1: { type: 'object', additionalProperties: false, required: ['policyVersion', 'agentId', 'authorityKeyIds', 'allowedActions', 'pathRules', 'serviceRules', 'commandRules', 'disabled', 'updatedAt'], properties: { policyVersion: { const: agentSecurityContractVersion }, agentId: identifierSchema(), authorityKeyIds: stringArraySchema(), allowedActions: stringArraySchema(), pathRules: { type: 'array', items: { type: 'object' }, maxItems: 100 }, serviceRules: stringArraySchema(), commandRules: { type: 'array', items: { type: 'object' }, maxItems: 100 }, disabled: { type: 'boolean' }, updatedAt: dateTimeSchema() } },
  PolicyAuthorityKeySetV1: { type: 'object', additionalProperties: false, required: ['keySetVersion', 'authorityId', 'activeKeyId', 'keys', 'issuedAt'], properties: { keySetVersion: { const: agentSecurityContractVersion }, authorityId: identifierSchema(), activeKeyId: identifierSchema(), keys: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object' } }, issuedAt: dateTimeSchema() } },
  TokenRevocationRecordV1: { type: 'object', additionalProperties: false, required: ['recordVersion', 'tokenId', 'authorityKeyId', 'reason', 'revokedAt'], properties: { recordVersion: { const: agentSecurityContractVersion }, tokenId: identifierSchema(), authorityKeyId: identifierSchema(), reason: nonEmptyStringSchema(), revokedAt: dateTimeSchema() } },
  DecisionRevocationRecordV1: { type: 'object', additionalProperties: false, required: ['recordVersion', 'decisionId', 'authorityKeyId', 'reason', 'revokedAt'], properties: { recordVersion: { const: agentSecurityContractVersion }, decisionId: identifierSchema(), authorityKeyId: identifierSchema(), reason: nonEmptyStringSchema(), revokedAt: dateTimeSchema() } },
  NonceConsumptionRecordV1: { type: 'object', additionalProperties: false, required: ['recordVersion', 'nonce', 'tokenId', 'consumedAt', 'resultDigest'], properties: { recordVersion: { const: agentSecurityContractVersion }, nonce: identifierSchema(), tokenId: identifierSchema(), consumedAt: dateTimeSchema(), resultDigest: digestSchema() } },
};

function identifierSchema(): JsonSchema { return { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,256}$' }; }
function canonicalPluginIdSchema(): JsonSchema { return { type: 'string', pattern: canonicalPluginIdPattern }; }
function nonEmptyStringSchema(): JsonSchema { return { type: 'string', minLength: 1, maxLength: 512 }; }
function dateTimeSchema(): JsonSchema { return { type: 'string', format: 'date-time', maxLength: 64 }; }
function positiveIntegerSchema(): JsonSchema { return { type: 'integer', minimum: 1, maximum: 2147483647 }; }
function digestSchema(): JsonSchema { return { type: 'string', pattern: '^[a-f0-9]{64}$' }; }
function stringArraySchema(): JsonSchema { return { type: 'array', items: nonEmptyStringSchema(), maxItems: 200 }; }
function absolutePathSchema(): JsonSchema { return { type: 'string', minLength: 1, maxLength: 1024 }; }

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON 不支持非有限数字');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  throw new TypeError('Canonical JSON 不支持 undefined 或函数');
}

export function sha256Digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function computeAgentFactDigest(fact: AgentFactEnvelopeV1): string {
  const { digest: _digest, ...payload } = fact;
  return sha256Digest(payload);
}

export function computeAgentPlanDigest(plan: AgentPlanV1): string {
  // Token、Decision、Nonce 和过期时间由授权阶段生成，不能参与计划内容摘要；审批引用在授权前已确定，必须参与绑定。
  const { planDigest: _planDigest, tokenId: _tokenId, policyDecisionId: _policyDecisionId, nonce: _nonce, expiresAt: _expiresAt, ...payload } = plan;
  return sha256Digest(payload);
}

export function computeAgentExecutionReceiptDigest(receipt: AgentExecutionReceiptV1): string {
  // Receipt 签名覆盖不含 signature 的完整回执；控制面重新计算摘要时也必须排除签名字段。
  const { digest: _digest, signature: _signature, ...payload } = receipt;
  return sha256Digest(payload);
}

export function validateAgentFactEnvelope(input: unknown): AgentFactEnvelopeV1 {
  const value = record(input, 'AgentFactEnvelopeV1');
  exactKeys(value, ['contractVersion', 'factId', 'agentId', 'tenantId', 'collectedAt', 'ttlSeconds', 'source', 'facts', 'digest', 'warnings'], 'AgentFactEnvelopeV1');
  exact(value.contractVersion, agentSecurityContractVersion, 'contractVersion');
  identifier(value.factId, 'factId'); identifier(value.agentId, 'agentId'); identifier(value.tenantId, 'tenantId');
  dateTime(value.collectedAt, 'collectedAt'); integerRange(value.ttlSeconds, 1, maximumFactTtlSeconds, 'ttlSeconds');
  enumValue(value.source, ['windows', 'linux', 'compatibility'], 'source');
  if (!Array.isArray(value.facts) || value.facts.length === 0 || value.facts.length > 1000) fail('facts', '事实数量不合法');
  const facts = value.facts.map((fact, index) => validateFact(fact, `facts.${index}`));
  digest(value.digest, 'digest');
  if (computeAgentFactDigest({ ...value, facts } as unknown as AgentFactEnvelopeV1) !== value.digest) fail('digest', '事实摘要与合同内容不匹配');
  const warnings = stringArray(value.warnings, 'warnings');
  return { ...value, facts, warnings } as AgentFactEnvelopeV1;
}

export function validateAgentRawFact(input: unknown): AgentRawFactV1 {
  return validateFact(input, 'AgentRawFactV1');
}

export function validateAgentPlan(input: unknown): AgentPlanV1 {
  const value = record(input, 'AgentPlanV1');
  exactKeys(value, ['planVersion', 'planId', 'agentId', 'tenantId', 'pluginId', 'pluginVersionId', 'capability', 'operations', 'planDigest', 'tokenId', 'policyDecisionId', 'nonce', 'expiresAt', 'writeEffect', 'approvalRef'], 'AgentPlanV1');
  exact(value.planVersion, agentSecurityContractVersion, 'planVersion');
  identifier(value.planId, 'planId'); identifier(value.agentId, 'agentId'); identifier(value.tenantId, 'tenantId'); canonicalPluginId(value.pluginId, 'pluginId'); identifier(value.pluginVersionId, 'pluginVersionId'); identifier(value.capability, 'capability');
  if (!Array.isArray(value.operations) || value.operations.length === 0 || value.operations.length > maximumPlanOperations) fail('operations', 'Plan 操作数量不合法');
  const operations = value.operations.map((operation, index) => validatePlanOperation(operation, `operations.${index}`));
  validatePlanGraph(operations);
  digest(value.planDigest, 'planDigest'); identifier(value.tokenId, 'tokenId'); identifier(value.policyDecisionId, 'policyDecisionId'); identifier(value.nonce, 'nonce'); dateTime(value.expiresAt, 'expiresAt');
  if (computeAgentPlanDigest({ ...value, operations } as unknown as AgentPlanV1) !== value.planDigest) fail('planDigest', '计划摘要与合同内容不匹配');
  if (typeof value.writeEffect !== 'boolean') fail('writeEffect', '必须是布尔值');
  if (value.approvalRef !== undefined) identifier(value.approvalRef, 'approvalRef');
  return { ...value, operations } as AgentPlanV1;
}

export function validateAgentPlanOperation(input: unknown): AgentPlanOperationV1 {
  return validatePlanOperation(input, 'AgentPlanOperationV1');
}

export function validateAgentCapabilityToken(input: unknown): AgentCapabilityTokenV1 {
  const value = record(input, 'AgentCapabilityTokenV1');
  exactKeys(value, ['tokenVersion', 'tokenId', 'agentId', 'tenantId', 'pluginId', 'pluginVersionId', 'capability', 'actions', 'allowedPaths', 'allowedServices', 'artifactDigests', 'approvalRef', 'policyRef', 'policyVersion', 'issuedAt', 'expiresAt', 'nonce', 'planDigest', 'authorityKeyId', 'signature'], 'AgentCapabilityTokenV1');
  exact(value.tokenVersion, agentSecurityContractVersion, 'tokenVersion');
  identifier(value.tokenId, 'tokenId'); identifier(value.agentId, 'agentId'); identifier(value.tenantId, 'tenantId'); canonicalPluginId(value.pluginId, 'pluginId'); identifier(value.pluginVersionId, 'pluginVersionId'); identifier(value.capability, 'capability');
  const actions = validateActionArray(value.actions, 'actions');
  const allowedPaths = stringArray(value.allowedPaths, 'allowedPaths').map((path, index) => normalizeAbsolutePath(path, `allowedPaths.${index}`));
  const allowedServices = stringArray(value.allowedServices, 'allowedServices');
  const artifactDigests = stringArray(value.artifactDigests, 'artifactDigests'); artifactDigests.forEach((item, index) => digest(item, `artifactDigests.${index}`));
  if (value.approvalRef !== undefined) identifier(value.approvalRef, 'approvalRef'); identifier(value.policyRef, 'policyRef'); identifier(value.policyVersion, 'policyVersion'); dateTime(value.issuedAt, 'issuedAt'); dateTime(value.expiresAt, 'expiresAt'); assertTimeWindow(value.issuedAt as string, value.expiresAt as string, maximumTokenLifetimeSeconds, 'token'); identifier(value.nonce, 'nonce'); digest(value.planDigest, 'planDigest'); identifier(value.authorityKeyId, 'authorityKeyId'); nonEmptyString(value.signature, 'signature'); rejectDevelopmentKey(value.authorityKeyId, 'authorityKeyId');
  return { ...value, actions, allowedPaths, allowedServices, artifactDigests } as AgentCapabilityTokenV1;
}

export function validatePolicyAuthorityDecision(input: unknown): PolicyAuthorityDecisionV1 {
  const value = record(input, 'PolicyAuthorityDecisionV1');
  exactKeys(value, ['decisionVersion', 'decisionId', 'allowed', 'agentId', 'tenantId', 'pluginId', 'pluginVersionId', 'capability', 'actions', 'allowedPaths', 'allowedServices', 'artifactDigests', 'policyRef', 'policyVersion', 'planDigest', 'tokenId', 'nonce', 'approvalRef', 'issuedAt', 'validUntil', 'authorityKeyId', 'revocationRef', 'signature', 'reason'], 'PolicyAuthorityDecisionV1');
  exact(value.decisionVersion, agentSecurityContractVersion, 'decisionVersion'); identifier(value.decisionId, 'decisionId');
  if (typeof value.allowed !== 'boolean') fail('allowed', '必须是布尔值'); identifier(value.agentId, 'agentId'); identifier(value.tenantId, 'tenantId'); canonicalPluginId(value.pluginId, 'pluginId'); identifier(value.pluginVersionId, 'pluginVersionId'); identifier(value.capability, 'capability');
  const actions = validateActionArray(value.actions, 'actions'); const allowedPaths = stringArray(value.allowedPaths, 'allowedPaths').map((path, index) => normalizeAbsolutePath(path, `allowedPaths.${index}`)); const allowedServices = stringArray(value.allowedServices, 'allowedServices'); const artifactDigests = stringArray(value.artifactDigests, 'artifactDigests'); artifactDigests.forEach((item, index) => digest(item, `artifactDigests.${index}`));
  identifier(value.policyRef, 'policyRef'); identifier(value.policyVersion, 'policyVersion'); digest(value.planDigest, 'planDigest'); identifier(value.tokenId, 'tokenId'); identifier(value.nonce, 'nonce'); if (value.approvalRef !== undefined) identifier(value.approvalRef, 'approvalRef'); dateTime(value.issuedAt, 'issuedAt'); dateTime(value.validUntil, 'validUntil'); assertTimeWindow(value.issuedAt as string, value.validUntil as string, maximumTokenLifetimeSeconds, 'decision'); identifier(value.authorityKeyId, 'authorityKeyId'); identifier(value.revocationRef, 'revocationRef'); nonEmptyString(value.signature, 'signature'); if (value.reason !== undefined) nonEmptyString(value.reason, 'reason'); rejectDevelopmentKey(value.authorityKeyId, 'authorityKeyId');
  return { ...value, actions, allowedPaths, allowedServices, artifactDigests } as PolicyAuthorityDecisionV1;
}

export function validateAgentExecutionReceipt(input: unknown): AgentExecutionReceiptV1 {
  const value = record(input, 'AgentExecutionReceiptV1');
  exactKeys(value, ['receiptVersion', 'operationId', 'planId', 'planDigest', 'agentId', 'tenantId', 'tokenId', 'status', 'startedAt', 'completedAt', 'operationResults', 'nonceConsumed', 'errorCode', 'unknownReason', 'digest', 'agentKeyId', 'signature'], 'AgentExecutionReceiptV1');
  exact(value.receiptVersion, agentSecurityContractVersion, 'receiptVersion'); identifier(value.operationId, 'operationId'); identifier(value.planId, 'planId'); digest(value.planDigest, 'planDigest'); identifier(value.agentId, 'agentId'); identifier(value.tenantId, 'tenantId'); identifier(value.tokenId, 'tokenId'); enumValue(value.status, ['SUCCESS', 'FAILED', 'UNKNOWN', 'CANCELLED'], 'status'); dateTime(value.startedAt, 'startedAt'); dateTime(value.completedAt, 'completedAt');
  if (!Array.isArray(value.operationResults) || value.operationResults.length > maximumPlanOperations) fail('operationResults', '回执结果数量不合法'); value.operationResults.forEach((item, index) => record(item, `operationResults.${index}`));
  if (typeof value.nonceConsumed !== 'boolean') fail('nonceConsumed', '必须是布尔值'); if (value.status === 'UNKNOWN' && value.unknownReason === undefined) fail('unknownReason', 'UNKNOWN 回执必须说明原因'); if (value.status === 'SUCCESS' && value.errorCode !== undefined) fail('errorCode', 'SUCCESS 回执不能携带错误码'); if (value.errorCode !== undefined) identifier(value.errorCode, 'errorCode'); if (value.unknownReason !== undefined) nonEmptyString(value.unknownReason, 'unknownReason'); if (value.agentKeyId !== undefined) identifier(value.agentKeyId, 'agentKeyId'); if (value.signature !== undefined) nonEmptyString(value.signature, 'signature'); if ((value.agentKeyId === undefined) !== (value.signature === undefined)) fail('signature', 'Agent 回执 agentKeyId 与 signature 必须成对出现'); if (Date.parse(value.completedAt as string) < Date.parse(value.startedAt as string)) fail('completedAt', '完成时间不能早于开始时间'); digest(value.digest, 'digest'); if (computeAgentExecutionReceiptDigest(value as unknown as AgentExecutionReceiptV1) !== value.digest) fail('digest', '执行回执摘要与合同内容不匹配');
  return value as unknown as AgentExecutionReceiptV1;
}

export function validateAgentLocalPolicy(input: unknown): AgentLocalPolicyV1 {
  const value = record(input, 'AgentLocalPolicyV1');
  exactKeys(value, ['policyVersion', 'agentId', 'authorityKeyIds', 'allowedActions', 'pathRules', 'serviceRules', 'commandRules', 'disabled', 'updatedAt'], 'AgentLocalPolicyV1'); exact(value.policyVersion, agentSecurityContractVersion, 'policyVersion'); identifier(value.agentId, 'agentId');
  const authorityKeyIds = stringArray(value.authorityKeyIds, 'authorityKeyIds'); if (authorityKeyIds.length === 0) fail('authorityKeyIds', '必须至少允许一个策略根'); authorityKeyIds.forEach((key, index) => rejectDevelopmentKey(key, `authorityKeyIds.${index}`));
  const allowedActions = validateActionArray(value.allowedActions, 'allowedActions');
  const pathRules = array(value.pathRules, 'pathRules').map((item, index) => validatePathRule(item, `pathRules.${index}`));
  const serviceRules = stringArray(value.serviceRules, 'serviceRules');
  const commandRules = array(value.commandRules, 'commandRules').map((item, index) => validateCommandRule(item, `commandRules.${index}`));
  if (typeof value.disabled !== 'boolean') fail('disabled', '必须是布尔值'); dateTime(value.updatedAt, 'updatedAt');
  return { ...value, authorityKeyIds, allowedActions, pathRules, serviceRules, commandRules } as AgentLocalPolicyV1;
}

export function validatePolicyAuthorityKeySet(input: unknown): PolicyAuthorityKeySetV1 {
  const value = record(input, 'PolicyAuthorityKeySetV1');
  exactKeys(value, ['keySetVersion', 'authorityId', 'activeKeyId', 'keys', 'issuedAt'], 'PolicyAuthorityKeySetV1'); exact(value.keySetVersion, agentSecurityContractVersion, 'keySetVersion'); identifier(value.authorityId, 'authorityId'); identifier(value.activeKeyId, 'activeKeyId'); dateTime(value.issuedAt, 'issuedAt');
  const keys = array(value.keys, 'keys').map((item, index) => validatePolicyKey(item, `keys.${index}`)); if (!keys.some((key) => key.keyId === value.activeKeyId && key.status === 'ACTIVE')) fail('activeKeyId', 'activeKeyId 必须指向未撤销的 ACTIVE key'); if (new Set(keys.map((key) => key.keyId)).size !== keys.length) fail('keys', 'authority keyId 不能重复');
  return { ...value, keys } as PolicyAuthorityKeySetV1;
}

export function validateTokenRevocationRecord(input: unknown): TokenRevocationRecordV1 {
  const value = record(input, 'TokenRevocationRecordV1'); exactKeys(value, ['recordVersion', 'tokenId', 'authorityKeyId', 'reason', 'revokedAt'], 'TokenRevocationRecordV1'); exact(value.recordVersion, agentSecurityContractVersion, 'recordVersion'); identifier(value.tokenId, 'tokenId'); identifier(value.authorityKeyId, 'authorityKeyId'); nonEmptyString(value.reason, 'reason'); dateTime(value.revokedAt, 'revokedAt'); rejectDevelopmentKey(value.authorityKeyId, 'authorityKeyId'); return value as unknown as TokenRevocationRecordV1;
}

export function validateDecisionRevocationRecord(input: unknown): DecisionRevocationRecordV1 {
  const value = record(input, 'DecisionRevocationRecordV1'); exactKeys(value, ['recordVersion', 'decisionId', 'authorityKeyId', 'reason', 'revokedAt'], 'DecisionRevocationRecordV1'); exact(value.recordVersion, agentSecurityContractVersion, 'recordVersion'); identifier(value.decisionId, 'decisionId'); identifier(value.authorityKeyId, 'authorityKeyId'); nonEmptyString(value.reason, 'reason'); dateTime(value.revokedAt, 'revokedAt'); rejectDevelopmentKey(value.authorityKeyId, 'authorityKeyId'); return value as unknown as DecisionRevocationRecordV1;
}

export function validateNonceConsumptionRecord(input: unknown): NonceConsumptionRecordV1 {
  const value = record(input, 'NonceConsumptionRecordV1'); exactKeys(value, ['recordVersion', 'nonce', 'tokenId', 'consumedAt', 'resultDigest'], 'NonceConsumptionRecordV1'); exact(value.recordVersion, agentSecurityContractVersion, 'recordVersion'); identifier(value.nonce, 'nonce'); identifier(value.tokenId, 'tokenId'); dateTime(value.consumedAt, 'consumedAt'); digest(value.resultDigest, 'resultDigest'); return value as unknown as NonceConsumptionRecordV1;
}

/** Nonce 必须由实现提供原子 consume；调用方不能先 check 再决定是否消费。 */
export interface NonceStoreV1Port {
  consume(record: NonceConsumptionRecordV1): NonceConsumptionRecordV1;
  /** 仅供审计和测试查询，授权路径不得依赖先查后消费。 */
  has?(nonce: string): boolean;
}

export interface AgentAuthorizationInput {
  plan: AgentPlanV1;
  token: AgentCapabilityTokenV1;
  decision: PolicyAuthorityDecisionV1;
  keySet: PolicyAuthorityKeySetV1;
  localPolicy: AgentLocalPolicyV1;
  revokedTokenIds?: readonly string[];
  revokedKeyIds?: readonly string[];
  nonceStore: NonceStoreV1Port;
  now?: string;
}

export function authorizeAgentPlan(input: AgentAuthorizationInput): NonceConsumptionRecordV1 {
  const now = input.now ?? new Date().toISOString();
  dateTime(now, 'now');
  const { plan, token, decision, keySet, localPolicy } = input;
  const key = keySet.keys.find((candidate) => candidate.keyId === token.authorityKeyId);
  if (!key || key.status !== 'ACTIVE') fail('authorityKeyId', '未知或已撤销的 authority key');
  if (!isWithin(now, key.notBefore, key.notAfter)) fail('authorityKeyId', 'authority key 不在有效时间窗内');
  if (input.revokedKeyIds?.includes(token.authorityKeyId)) fail('authorityKeyId', 'authority key 已撤销');
  if (input.revokedTokenIds?.includes(token.tokenId)) fail('tokenId', 'Token 已撤销');
  if (localPolicy.disabled) fail('localPolicy', 'Agent 本地策略已紧急禁用');
  if (!localPolicy.authorityKeyIds.includes(token.authorityKeyId)) fail('authorityKeyId', 'Agent 本地策略不信任该 authority key');
  if (localPolicy.agentId !== plan.agentId) fail('localPolicy.agentId', 'Agent 本地策略绑定不匹配');
  if (!isWithin(now, token.issuedAt, token.expiresAt)) fail('token', 'Token 已过期或尚未生效');
  if (!isWithin(now, decision.issuedAt, decision.validUntil)) fail('decision', 'Policy Authority 决策已过期或尚未生效');
  if (Date.parse(now) > Date.parse(plan.expiresAt)) fail('plan', 'Plan 已过期');
  if (Date.parse(plan.expiresAt) > Date.parse(token.expiresAt) || Date.parse(plan.expiresAt) > Date.parse(decision.validUntil)) fail('plan.expiresAt', 'Plan 生命周期不能超过 Token 或 Policy Authority 决策');
  if (!decision.allowed) fail('decision', 'Policy Authority 拒绝该计划');
  if (!verifyPolicyPayload(token, token.signature, key.publicKeyPem)) fail('token.signature', 'Capability Token 签名无效');
  if (decision.authorityKeyId !== token.authorityKeyId || !verifyPolicyPayload(decision, decision.signature, key.publicKeyPem)) fail('decision.signature', 'Policy Authority 决策签名无效');
  for (const [field, left, right] of [
    ['agentId', token.agentId, plan.agentId], ['tenantId', token.tenantId, plan.tenantId], ['pluginId', token.pluginId, plan.pluginId], ['pluginVersionId', token.pluginVersionId, plan.pluginVersionId], ['capability', token.capability, plan.capability], ['planDigest', token.planDigest, plan.planDigest], ['nonce', token.nonce, plan.nonce], ['tokenId', token.tokenId, plan.tokenId], ['policyDecisionId', decision.decisionId, plan.policyDecisionId], ['decisionPlanDigest', decision.planDigest, plan.planDigest], ['decisionTokenId', decision.tokenId, token.tokenId], ['decisionNonce', decision.nonce, token.nonce],
  ] as Array<[string, string, string]>) if (left !== right) fail(field, '授权绑定不匹配');
  if (plan.approvalRef !== token.approvalRef || plan.approvalRef !== decision.approvalRef) fail('approvalRef', 'Plan、Token 和 Policy Authority 决策的审批引用不一致');
  if (decision.agentId !== plan.agentId || decision.tenantId !== plan.tenantId || decision.pluginId !== plan.pluginId || decision.pluginVersionId !== plan.pluginVersionId || decision.capability !== plan.capability || decision.policyRef !== token.policyRef || decision.policyVersion !== token.policyVersion || decision.approvalRef !== token.approvalRef) fail('decision', 'Policy Authority 决策绑定不匹配');
  validateOperationsAgainstPolicy(plan.operations, token, decision, localPolicy);
  const expected = { recordVersion: agentSecurityContractVersion, nonce: token.nonce, tokenId: token.tokenId, consumedAt: now, resultDigest: sha256Digest(plan) } as NonceConsumptionRecordV1;
  const consumed = input.nonceStore.consume(expected);
  validateNonceConsumptionRecord(consumed);
  if (consumed.nonce !== expected.nonce || consumed.tokenId !== expected.tokenId || consumed.resultDigest !== expected.resultDigest) fail('nonce', 'Nonce 存储返回的消费记录绑定不匹配');
  return consumed;
}

export class NonceStoreV1 implements NonceStoreV1Port {
  private readonly records = new Map<string, NonceConsumptionRecordV1>();

  has(nonce: string): boolean { return this.records.has(nonce); }

  consume(record: NonceConsumptionRecordV1): NonceConsumptionRecordV1 {
    if (this.records.has(record.nonce)) fail('nonce', 'Nonce 已消费');
    validateNonceConsumptionRecord(record);
    this.records.set(record.nonce, structuredClone(record));
    return structuredClone(record);
  }

  get(nonce: string): NonceConsumptionRecordV1 | undefined { return this.records.get(nonce) ? structuredClone(this.records.get(nonce)!) : undefined; }
}

export function signPolicyPayload(value: unknown, privateKey: KeyObject | string): string {
  return sign(null, Buffer.from(canonicalJson(unsignedPolicyPayload(value)), 'utf8'), privateKey).toString('base64url');
}

export function verifyPolicyPayload(value: unknown, signature: string, publicKey: KeyObject | string): boolean {
  try { return verify(null, Buffer.from(canonicalJson(unsignedPolicyPayload(value)), 'utf8'), publicKey, Buffer.from(signature, 'base64url')); } catch { return false; }
}

function unsignedPolicyPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const { signature: _signature, ...payload } = value as Record<string, unknown>;
  return payload;
}

function validateFact(input: unknown, path: string): AgentRawFactV1 {
  const value = record(input, path); const kind = enumValue(value.kind, ['process', 'service', 'listening_port', 'file_stat', 'file_content', 'certificate_file', 'certificate_store', 'privilege'], `${path}.kind`);
  rejectProductJudgement(value, path);
  if (kind === 'process') { exactKeys(value, ['kind', 'pid', 'parentPid', 'executablePath', 'executableSha256', 'commandLine', 'startedAt'], path); positiveInteger(value.pid, `${path}.pid`); if (value.parentPid !== undefined) positiveInteger(value.parentPid, `${path}.parentPid`); normalizeAbsolutePath(value.executablePath, `${path}.executablePath`); if (value.executableSha256 !== undefined) digest(value.executableSha256, `${path}.executableSha256`); if (value.commandLine !== undefined) sensitiveCommandLine(value.commandLine, `${path}.commandLine`); if (value.startedAt !== undefined) dateTime(value.startedAt, `${path}.startedAt`); return value as unknown as ProcessFactV1; }
  if (kind === 'service') { exactKeys(value, ['kind', 'name', 'status', 'executablePath', 'startType'], path); identifier(value.name, `${path}.name`); enumValue(value.status, ['running', 'stopped', 'paused', 'unknown'], `${path}.status`); if (value.executablePath !== undefined) normalizeAbsolutePath(value.executablePath, `${path}.executablePath`); if (value.startType !== undefined) enumValue(value.startType, ['automatic', 'manual', 'disabled', 'unknown'], `${path}.startType`); return value as unknown as ServiceFactV1; }
  if (kind === 'listening_port') { exactKeys(value, ['kind', 'address', 'port', 'protocol', 'pid'], path); nonEmptyString(value.address, `${path}.address`); integerRange(value.port, 1, 65535, `${path}.port`); enumValue(value.protocol, ['tcp', 'udp'], `${path}.protocol`); if (value.pid !== undefined) positiveInteger(value.pid, `${path}.pid`); return value as unknown as ListeningPortFactV1; }
  if (kind === 'file_stat') { exactKeys(value, ['kind', 'path', 'exists', 'sizeBytes', 'sha256', 'modifiedAt', 'mode'], path); normalizeAbsolutePath(value.path, `${path}.path`); if (typeof value.exists !== 'boolean') fail(`${path}.exists`, '必须是布尔值'); integerRange(value.sizeBytes, 0, 1024 * 1024 * 1024, `${path}.sizeBytes`); if (value.sha256 !== undefined) digest(value.sha256, `${path}.sha256`); if (value.modifiedAt !== undefined) dateTime(value.modifiedAt, `${path}.modifiedAt`); if (value.mode !== undefined) nonEmptyString(value.mode, `${path}.mode`); return value as unknown as FileStatFactV1; }
  if (kind === 'file_content') { exactKeys(value, ['kind', 'path', 'contentBase64', 'bytesRead', 'truncated', 'sha256'], path); normalizeAbsolutePath(value.path, `${path}.path`); const content = nonEmptyString(value.contentBase64, `${path}.contentBase64`); if (Buffer.byteLength(content, 'base64') > maximumFileContentBytes) fail(`${path}.contentBase64`, '文件内容超过最大读取量'); integerRange(value.bytesRead, 0, maximumFileContentBytes, `${path}.bytesRead`); if (typeof value.truncated !== 'boolean') fail(`${path}.truncated`, '必须是布尔值'); digest(value.sha256, `${path}.sha256`); return value as unknown as FileContentFactV1; }
  if (kind === 'certificate_file') {
    exactKeys(value, ['kind', 'path', 'configuredPaths', 'sha256Fingerprint', 'thumbprint', 'subject', 'issuer', 'notBefore', 'notAfter'], path);
    normalizeAbsolutePath(value.path, `${path}.path`);
    if (value.configuredPaths !== undefined) stringArray(value.configuredPaths, `${path}.configuredPaths`);
    if (value.sha256Fingerprint !== undefined) digest(value.sha256Fingerprint, `${path}.sha256Fingerprint`);
    if (value.thumbprint !== undefined) nonEmptyString(value.thumbprint, `${path}.thumbprint`);
    if (value.sha256Fingerprint === undefined && value.thumbprint === undefined) fail(path, '证书文件事实至少需要一个公开指纹');
    if (value.subject !== undefined) nonEmptyString(value.subject, `${path}.subject`);
    if (value.issuer !== undefined) nonEmptyString(value.issuer, `${path}.issuer`);
    if (value.notBefore !== undefined) dateTime(value.notBefore, `${path}.notBefore`);
    if (value.notAfter !== undefined) dateTime(value.notAfter, `${path}.notAfter`);
    return value as unknown as CertificateFileFactV1;
  }
  if (kind === 'certificate_store') {
    exactKeys(value, ['kind', 'path', 'store', 'storeLocation', 'subject', 'thumbprint', 'sha256Fingerprint', 'issuer', 'notBefore', 'notAfter', 'hasPrivateKey'], path);
    if (value.path !== undefined) nonEmptyString(value.path, `${path}.path`);
    identifier(value.store, `${path}.store`); if (value.storeLocation !== undefined) identifier(value.storeLocation, `${path}.storeLocation`);
    nonEmptyString(value.subject, `${path}.subject`); nonEmptyString(value.thumbprint, `${path}.thumbprint`);
    if (value.sha256Fingerprint !== undefined) digest(value.sha256Fingerprint, `${path}.sha256Fingerprint`);
    if (value.issuer !== undefined) nonEmptyString(value.issuer, `${path}.issuer`);
    if (value.notBefore !== undefined) dateTime(value.notBefore, `${path}.notBefore`);
    if (value.notAfter !== undefined) dateTime(value.notAfter, `${path}.notAfter`);
    if (typeof value.hasPrivateKey !== 'boolean') fail(`${path}.hasPrivateKey`, '必须是布尔值'); return value as unknown as CertificateStoreFactV1;
  }
  exactKeys(value, ['kind', 'principal', 'elevated', 'groups'], path); nonEmptyString(value.principal, `${path}.principal`); if (typeof value.elevated !== 'boolean') fail(`${path}.elevated`, '必须是布尔值'); return { ...value, groups: stringArray(value.groups, `${path}.groups`) } as unknown as PrivilegeFactV1;
}

function validatePlanOperation(input: unknown, path: string): AgentPlanOperationV1 {
  const value = record(input, path); exactKeys(value, ['operationId', 'operationType', 'stage', 'input', 'dependsOn', 'idempotencyKey', 'timeoutSeconds', 'compensation'], path); identifier(value.operationId, `${path}.operationId`); const operationType = enumValue(value.operationType, allowedAgentOperationTypes, `${path}.operationType`) as AgentOperationType; const stage = enumValue(value.stage, ['prepare', 'execute', 'verify', 'compensate'], `${path}.stage`) as AgentPlanStage; const operationInput = record(value.input, `${path}.input`); const dependsOn = stringArray(value.dependsOn, `${path}.dependsOn`); identifier(value.idempotencyKey, `${path}.idempotencyKey`); integerRange(value.timeoutSeconds, 1, 3600, `${path}.timeoutSeconds`); if (value.compensation !== undefined) identifier(value.compensation, `${path}.compensation`); rejectDangerousInput(operationInput, `${path}.input`); validateOperationInput(operationType, operationInput, `${path}.input`); return { operationId: value.operationId as string, operationType, stage, input: operationInput, dependsOn, idempotencyKey: value.idempotencyKey as string, timeoutSeconds: value.timeoutSeconds as number, ...(value.compensation !== undefined ? { compensation: value.compensation as string } : {}) };
}

function validateOperationInput(operationType: AgentOperationType, input: Record<string, unknown>, path: string): void {
  if (['filesystem.stat', 'filesystem.read', 'filesystem.backup', 'filesystem.atomic_replace', 'filesystem.restore'].includes(operationType)) normalizeAbsolutePath(input.path, `${path}.path`);
  if (['service.status', 'service.start', 'service.stop', 'service.reload'].includes(operationType)) identifier(input.serviceName, `${path}.serviceName`);
  if (operationType === 'command.execute_allowlisted') {
    exactKeys(input, ['executablePath', 'executableSha256', 'args', 'argumentTemplate', 'environmentAllowlist', 'workingDirectory', 'networkScopes', 'childProcessPolicy', 'timeoutSeconds', 'outputLimitBytes', 'artifactDigest'], path);
    normalizeAbsolutePath(input.executablePath, `${path}.executablePath`); digest(input.executableSha256, `${path}.executableSha256`); const args = input.args; if (!Array.isArray(args) || args.length > 100) fail(`${path}.args`, 'command.execute_allowlisted 必须使用数量受限参数数组'); args.forEach((item, index) => nonEmptyString(item, `${path}.args.${index}`)); const argsTemplate = input.argumentTemplate; if (!Array.isArray(argsTemplate) || argsTemplate.length > 100) fail(`${path}.argumentTemplate`, '必须是数量受限固定参数模板数组'); if (argsTemplate.length !== args.length) fail(`${path}.argumentTemplate`, '参数数量必须与模板一致'); argsTemplate.forEach((item, index) => { nonEmptyString(item, `${path}.argumentTemplate.${index}`); if (!/^\{[A-Za-z0-9_.:-]+\}$/.test(item) && item !== args[index]) fail(`${path}.args.${index}`, '参数不符合固定模板'); }); const env = input.environmentAllowlist; if (!Array.isArray(env)) fail(`${path}.environmentAllowlist`, '必须是环境变量白名单数组'); env.forEach((item, index) => identifier(item, `${path}.environmentAllowlist.${index}`)); normalizeAbsolutePath(input.workingDirectory, `${path}.workingDirectory`); integerRange(input.timeoutSeconds, 1, 3600, `${path}.timeoutSeconds`); integerRange(input.outputLimitBytes, 1, 16 * 1024 * 1024, `${path}.outputLimitBytes`); enumValue(input.childProcessPolicy, ['deny', 'allow-listed'], `${path}.childProcessPolicy`); const networkScopes = input.networkScopes; if (!Array.isArray(networkScopes) || networkScopes.length > 100) fail(`${path}.networkScopes`, '必须是数量受限网络范围数组'); networkScopes.forEach((item, index) => nonEmptyString(item, `${path}.networkScopes.${index}`)); if (input.artifactDigest !== undefined) digest(input.artifactDigest, `${path}.artifactDigest`); rejectInterpreter(input.executablePath as string, path);
  }
}

function validatePlanGraph(operations: AgentPlanOperationV1[]): void {
  const ids = new Set<string>(); const byId = new Map<string, AgentPlanOperationV1>();
  for (const operation of operations) { if (ids.has(operation.operationId)) fail('operations', 'operationId 不能重复'); ids.add(operation.operationId); byId.set(operation.operationId, operation); }
  for (const operation of operations) for (const dependency of operation.dependsOn) if (!byId.has(dependency)) fail(`operations.${operation.operationId}`, '依赖操作不存在', { dependency });
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (idValue: string): void => { if (visiting.has(idValue)) fail('operations', 'Plan 存在循环依赖'); if (visited.has(idValue)) return; visiting.add(idValue); for (const dependency of byId.get(idValue)?.dependsOn ?? []) visit(dependency); visiting.delete(idValue); visited.add(idValue); };
  for (const operation of operations) visit(operation.operationId);
}

function validatePathRule(input: unknown, path: string): AgentLocalPathRuleV1 { const value = record(input, path); exactKeys(value, ['prefix', 'operations'], path); const prefix = normalizeAbsolutePath(value.prefix, `${path}.prefix`); const operations = stringArray(value.operations, `${path}.operations`); operations.forEach((operation) => { if (!allowedAgentOperationTypes.includes(operation as never)) fail(`${path}.operations`, '包含未允许的操作类型'); }); return { prefix, operations }; }
function validateCommandRule(input: unknown, path: string): AgentLocalCommandRuleV1 { const value = record(input, path); exactKeys(value, ['executablePath', 'executableSha256', 'argumentTemplate', 'environmentAllowlist', 'workingDirectory', 'networkScopes', 'childProcessPolicy', 'timeoutSeconds', 'outputLimitBytes'], path); const executablePath = normalizeAbsolutePath(value.executablePath, `${path}.executablePath`); rejectInterpreter(executablePath, path); digest(value.executableSha256, `${path}.executableSha256`); const argumentTemplate = stringArray(value.argumentTemplate, `${path}.argumentTemplate`); const environmentAllowlist = stringArray(value.environmentAllowlist, `${path}.environmentAllowlist`); const workingDirectory = normalizeAbsolutePath(value.workingDirectory, `${path}.workingDirectory`); const networkScopes = stringArray(value.networkScopes, `${path}.networkScopes`); const childProcessPolicy = enumValue(value.childProcessPolicy, ['deny', 'allow-listed'], `${path}.childProcessPolicy`) as AgentLocalCommandRuleV1['childProcessPolicy']; integerRange(value.timeoutSeconds, 1, 3600, `${path}.timeoutSeconds`); integerRange(value.outputLimitBytes, 1, 16 * 1024 * 1024, `${path}.outputLimitBytes`); return { executablePath, executableSha256: value.executableSha256 as string, argumentTemplate, environmentAllowlist, workingDirectory, networkScopes, childProcessPolicy, timeoutSeconds: value.timeoutSeconds as number, outputLimitBytes: value.outputLimitBytes as number }; }
function validateActionArray(value: unknown, path: string): string[] {
  const actions = stringArray(value, path);
  actions.forEach((action, index) => {
    if (!allowedAgentOperationTypes.includes(action as AgentOperationType)) fail(`${path}.${index}`, '包含未允许的操作类型');
  });
  return actions;
}
function validatePolicyKey(input: unknown, path: string): PolicyAuthorityKeyV1 { const value = record(input, path); exactKeys(value, ['keyId', 'algorithm', 'publicKeyPem', 'status', 'notBefore', 'notAfter'], path); identifier(value.keyId, `${path}.keyId`); rejectDevelopmentKey(value.keyId, `${path}.keyId`); exact(value.algorithm, 'Ed25519', `${path}.algorithm`); const pem = nonEmptyString(value.publicKeyPem, `${path}.publicKeyPem`); if (!pem.includes('BEGIN PUBLIC KEY')) fail(`${path}.publicKeyPem`, '必须是公钥 PEM'); enumValue(value.status, ['ACTIVE', 'REVOKED'], `${path}.status`); dateTime(value.notBefore, `${path}.notBefore`); dateTime(value.notAfter, `${path}.notAfter`); if (Date.parse(value.notAfter as string) <= Date.parse(value.notBefore as string)) fail(`${path}.notAfter`, 'Key 有效期必须晚于生效时间'); return value as unknown as PolicyAuthorityKeyV1; }
function validateOperationsAgainstPolicy(operations: AgentPlanOperationV1[], token: AgentCapabilityTokenV1, decision: PolicyAuthorityDecisionV1, policy: AgentLocalPolicyV1): void {
  for (const operation of operations) {
    if (!token.actions.includes(operation.operationType) || !decision.actions.includes(operation.operationType)) fail(`operations.${operation.operationId}`, 'Token 和 Policy Decision 必须同时授权该动作');
    if (!policy.allowedActions.includes(operation.operationType)) fail(`operations.${operation.operationId}`, '本地策略未授权该动作');
    const path = typeof operation.input.path === 'string' ? normalizeAbsolutePath(operation.input.path, `operations.${operation.operationId}.input.path`) : undefined;
    const localPrefixes = policy.pathRules.filter((rule) => rule.operations.includes(operation.operationType)).map((rule) => rule.prefix);
    if (path && (!isPathAllowed(path, token.allowedPaths) || !isPathAllowed(path, decision.allowedPaths) || !isPathAllowed(path, localPrefixes))) fail(`operations.${operation.operationId}.input.path`, '路径必须同时位于 Token、Decision 和本地策略范围');
    const serviceName = typeof operation.input.serviceName === 'string' ? operation.input.serviceName : undefined;
    if (serviceName && (!token.allowedServices.includes(serviceName) || !decision.allowedServices.includes(serviceName) || !policy.serviceRules.includes(serviceName))) fail(`operations.${operation.operationId}.input.serviceName`, '服务必须同时位于 Token、Decision 和本地策略范围');
    const artifactDigest = typeof operation.input.artifactDigest === 'string' ? operation.input.artifactDigest : undefined;
    if (artifactDigest && (!token.artifactDigests.includes(artifactDigest) || !decision.artifactDigests.includes(artifactDigest))) fail(`operations.${operation.operationId}.input.artifactDigest`, 'Artifact 摘要必须同时位于 Token 和 Decision 范围');
    if (operation.operationType === 'command.execute_allowlisted') validateCommandAgainstPolicy(operation.input, policy.commandRules, operation.operationId);
  }
}
function validateCommandAgainstPolicy(input: Record<string, unknown>, rules: AgentLocalCommandRuleV1[], operationId: string): void {
  const executablePath = normalizeAbsolutePath(input.executablePath, `operations.${operationId}.input.executablePath`);
  const rule = rules.find((candidate) => candidate.executablePath.toLowerCase() === executablePath.toLowerCase() && candidate.executableSha256 === input.executableSha256);
  if (!rule) fail(`operations.${operationId}`, '命令不在本地可执行文件白名单');
  const args = input.args as string[];
  const argumentTemplate = input.argumentTemplate as string[];
  if (!sameStringArray(argumentTemplate, rule.argumentTemplate) || !templateMatches(args, rule.argumentTemplate)) fail(`operations.${operationId}.input.args`, '命令参数不符合本地固定模板');
  if (!subset(input.environmentAllowlist as string[], rule.environmentAllowlist) || !subset(input.networkScopes as string[], rule.networkScopes)) fail(`operations.${operationId}`, '命令环境或网络范围超出本地策略');
  if (normalizeAbsolutePath(input.workingDirectory, `operations.${operationId}.input.workingDirectory`).toLowerCase() !== rule.workingDirectory.toLowerCase()) fail(`operations.${operationId}.input.workingDirectory`, '命令工作目录不匹配本地策略');
  if (input.childProcessPolicy !== rule.childProcessPolicy || (input.timeoutSeconds as number) > rule.timeoutSeconds || (input.outputLimitBytes as number) > rule.outputLimitBytes) fail(`operations.${operationId}`, '命令子进程或资源上限超出本地策略');
}
function templateMatches(values: string[], template: string[]): boolean { return values.length === template.length && values.every((value, index) => /^\{[A-Za-z0-9_.:-]+\}$/.test(template[index]!) || value === template[index]); }
function sameStringArray(left: string[], right: string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function subset(values: string[], allowed: string[]): boolean { return values.every((value) => allowed.includes(value)); }
function rejectDangerousInput(input: Record<string, unknown>, path: string): void { const serialized = JSON.stringify(input); if (/(?:\||&&|;|\$\(|`|download|invoke-webrequest|curl\s+-o)/i.test(serialized)) fail(path, '输入包含管道、解释器或下载后执行语义'); for (const key of Object.keys(input)) if (['command', 'shell', 'script', 'powershell', 'cmd', 'spawn', 'exec', 'interpreter', 'detached', 'stdio', 'inheritparentenvironment', 'childprocessescape'].includes(key.toLowerCase())) fail(`${path}.${key}`, '不允许自由命令、脚本或子进程逃逸字段'); }
function rejectInterpreter(pathValue: string, path: string): void { const base = pathValue.replace(/\\/g, '/').split('/').at(-1)?.toLowerCase() ?? ''; if (['cmd.exe', 'command.com', 'powershell.exe', 'pwsh.exe', 'sh', 'bash', 'wscript.exe', 'cscript.exe', 'python', 'python.exe', 'perl', 'ruby', 'node', 'node.exe'].includes(base)) fail(path, '不允许使用 Shell 或解释器作为外部程序'); }
function sensitiveCommandLine(value: unknown, path: string): void { const commandLine = nonEmptyString(value, path); if (/(?:password|passwd|token|secret|private[_-]?key)\s*[:=]/i.test(commandLine)) fail(path, '进程命令行包含未脱敏敏感参数'); }
function rejectProductJudgement(value: Record<string, unknown>, path: string): void { const forbidden = Object.keys(value).filter((key) => /(?:product|framework|provider|detected|recognition|deploymentSemantic)/i.test(key)); if (forbidden.length > 0) fail(path, '原始事实不得包含产品判断字段', { forbidden }); }
function isPathAllowed(pathValue: string, prefixes: string[]): boolean { const normalized = pathValue.toLowerCase(); return prefixes.some((prefix) => { const root = prefix.toLowerCase().replace(/[\\/]+$/, ''); return normalized === root || normalized.startsWith(`${root}\\`) || normalized.startsWith(`${root}/`); }); }
function normalizeAbsolutePath(value: unknown, path: string): string { const original = nonEmptyString(value, path); if (original.startsWith('/')) { if (original.split('/').includes('..')) fail(path, '路径不能包含 ..'); const normalized = posix.normalize(original); if (normalized.includes('..')) fail(path, '规范化路径越权'); return normalized; } const raw = original.replaceAll('/', '\\'); if (!/^(?:[A-Za-z]:\\|\\\\)/.test(raw)) fail(path, '必须是规范化绝对路径'); if (raw.split('\\').includes('..')) fail(path, '路径不能包含 ..'); const normalized = win32.normalize(raw); if (normalized.includes('..')) fail(path, '规范化路径越权'); return normalized; }
function isWithin(now: string, start: string, end: string): boolean { const nowMs = Date.parse(now); const startMs = Date.parse(start); const endMs = Date.parse(end); return Number.isFinite(nowMs) && Number.isFinite(startMs) && Number.isFinite(endMs) && nowMs >= startMs && nowMs <= endMs; }
function assertTimeWindow(start: string, end: string, maximumSeconds: number, path: string): void { const startMs = Date.parse(start); const endMs = Date.parse(end); if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || endMs - startMs > maximumSeconds * 1000) fail(path, '时间窗不合法或超过最大生命周期'); }
function array(value: unknown, path: string): unknown[] { if (!Array.isArray(value) || value.length > 200) fail(path, '必须是数量受限数组'); return value; }
function record(value: unknown, path: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '必须是对象'); return value as Record<string, unknown>; }
function exactKeys(value: Record<string, unknown>, allowed: string[], path: string): void { const unknown = Object.keys(value).filter((key) => !allowed.includes(key)); if (unknown.length > 0) fail(path, '包含未知字段', { unknown }); }
function exact(value: unknown, expected: unknown, path: string): void { if (value !== expected) fail(path, '固定值不匹配', { expected }); }
function identifier(value: unknown, path: string): string { const result = nonEmptyString(value, path); if (!/^[A-Za-z0-9._:-]{1,256}$/.test(result)) fail(path, '标识符格式不合法'); return result; }
function canonicalPluginId(value: unknown, path: string): string {
  const result = identifier(value, path);
  if (!new RegExp(canonicalPluginIdPattern).test(result)) {
    fail(path, '必须是 Canonical Plugin ID', { actual: result });
  }
  return result;
}
function nonEmptyString(value: unknown, path: string): string { if (typeof value !== 'string' || value.trim() === '') fail(path, '必须是非空字符串'); return value; }
function stringArray(value: unknown, path: string): string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '') || value.length > 200) fail(path, '必须是数量受限字符串数组'); return value as string[]; }
function positiveInteger(value: unknown, path: string): void { integerRange(value, 1, 2147483647, path); }
function integerRange(value: unknown, minimum: number, maximum: number, path: string): void { if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) fail(path, `必须是 ${minimum} 到 ${maximum} 的整数`); }
function dateTime(value: unknown, path: string): string { const result = nonEmptyString(value, path); if (Number.isNaN(Date.parse(result)) || !result.includes('T')) fail(path, '必须是 ISO date-time'); return result; }
function digest(value: unknown, path: string): void { const result = nonEmptyString(value, path); if (!/^[a-f0-9]{64}$/.test(result)) fail(path, '必须是 SHA-256 十六进制摘要'); }
function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string): T { if (typeof value !== 'string' || !allowed.includes(value as T)) fail(path, '枚举值不合法', { allowed }); return value as T; }
function rejectDevelopmentKey(value: unknown, path: string): void { const normalized = nonEmptyString(value, path).toLowerCase(); if (normalized.includes('default') || normalized.includes('development') || normalized.includes('dev-key')) fail(path, '禁止使用开发默认密钥'); }
function fail(path: string, message: string, details: Record<string, unknown> = {}): never { throw new AppError('VALIDATION_FAILED', `Agent 安全合同无效：${message}`, { path, ...details }); }

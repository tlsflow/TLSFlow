import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateJsonSchema, type JsonSchema } from '../../../common/validation/json-schema.js';
import {
  agentSecuritySchemas,
  agentV2ContractTypes,
  authorizeAgentPlan,
  computeAgentPlanDigest,
  sha256Digest,
  NonceStoreV1,
  signPolicyPayload,
  validateAgentCapabilityToken,
  validateAgentExecutionReceipt,
  validateAgentFactEnvelope,
  validateAgentLocalPolicy,
  validateAgentPlan,
  validateAgentPlanOperation,
  validateAgentRawFact,
  validateDecisionRevocationRecord,
  validateNonceConsumptionRecord,
  validatePolicyAuthorityDecision,
  validatePolicyAuthorityKeySet,
  validateTokenRevocationRecord,
  type AgentAuthorizationInput,
  type AgentCapabilityTokenV1,
  type AgentPlanV1,
  type PolicyAuthorityDecisionV1,
  type PolicyAuthorityKeySetV1,
} from './agent-security.contract.js';

const fixtureRoot = resolve(process.cwd(), 'src/modules/agents/security/fixtures');
const schemaPath = resolve(process.cwd(), 'src/modules/agents/security/schemas/agent-security-v1.schema.json');
const validFixture = readJson(resolve(fixtureRoot, 'agent-security.valid.json')) as { contracts: Record<string, unknown> };
const invalidFixture = readJson(resolve(fixtureRoot, 'agent-security.invalid.json')) as {
  schemaCases: Array<{ name: string; type: string; path: string; value: unknown }>;
  authorizationCases: Array<{ name: string; change: Record<string, unknown> }>;
};
const diskSchema = readJson(schemaPath) as JsonSchema & { $defs: Record<string, JsonSchema> };

const schemaNames: Record<string, string> = {
  AgentFactEnvelopeV1: 'agentFactEnvelope', ProcessFactV1: 'processFact', ServiceFactV1: 'serviceFact', ListeningPortFactV1: 'listeningPortFact',
  FileStatFactV1: 'fileStatFact', FileContentFactV1: 'fileContentFact', CertificateFileFactV1: 'certificateFileFact', CertificateStoreFactV1: 'certificateStoreFact', PrivilegeFactV1: 'privilegeFact',
  AgentPlanOperationV1: 'planOperation', AgentPlanV1: 'agentPlan', AgentCapabilityTokenV1: 'capabilityToken', PolicyAuthorityDecisionV1: 'authorityDecision',
  AgentExecutionReceiptV1: 'executionReceipt', AgentLocalPolicyV1: 'localPolicy', PolicyAuthorityKeySetV1: 'keySet', TokenRevocationRecordV1: 'tokenRevocation', DecisionRevocationRecordV1: 'decisionRevocation', NonceConsumptionRecordV1: 'nonceConsumption',
};

const validators: Record<string, (value: unknown) => unknown> = {
  AgentFactEnvelopeV1: validateAgentFactEnvelope,
  ProcessFactV1: validateAgentRawFact,
  ServiceFactV1: validateAgentRawFact,
  ListeningPortFactV1: validateAgentRawFact,
  FileStatFactV1: validateAgentRawFact,
  FileContentFactV1: validateAgentRawFact,
  CertificateFileFactV1: validateAgentRawFact,
  CertificateStoreFactV1: validateAgentRawFact,
  PrivilegeFactV1: validateAgentRawFact,
  AgentPlanOperationV1: validateAgentPlanOperation,
  AgentPlanV1: validateAgentPlan,
  AgentCapabilityTokenV1: validateAgentCapabilityToken,
  PolicyAuthorityDecisionV1: validatePolicyAuthorityDecision,
  AgentExecutionReceiptV1: validateAgentExecutionReceipt,
  AgentLocalPolicyV1: validateAgentLocalPolicy,
  PolicyAuthorityKeySetV1: validatePolicyAuthorityKeySet,
  TokenRevocationRecordV1: validateTokenRevocationRecord,
  DecisionRevocationRecordV1: validateDecisionRevocationRecord,
  NonceConsumptionRecordV1: validateNonceConsumptionRecord,
};

test('Agent 安全合同的 TypeScript Schema、JSON Schema 和正例 Fixture 一致', () => {
  assert.deepEqual(Object.keys(agentSecuritySchemas).sort(), Object.keys(schemaNames).sort());
  assert.deepEqual(Object.keys(validFixture.contracts).sort(), Object.keys(schemaNames).sort());
  for (const [name, value] of Object.entries(validFixture.contracts)) {
    const schema = { $defs: diskSchema.$defs, $ref: `#/$defs/${schemaNames[name]}` };
    const result = validateJsonSchema(value, schema, { maxDepth: 24, maxArrayItems: 1000 });
    assert.equal(result.valid, true, `${name}: ${JSON.stringify(result.errors)}`);
    assert.doesNotThrow(() => validators[name](value), name);
    assert.equal(validateJsonSchema(value, agentSecuritySchemas[name]).valid, true, `${name} TypeScript Schema`);
  }
});

test('Agent v2 长期合同严格收敛为四个动作', () => {
  assert.deepEqual(agentV2ContractTypes, ['agent.fact.collect', 'agent.plan.validate', 'agent.plan.execute', 'agent.execution.receipt']);
});

test('兼容旧 Linux Agent 将空摘要字段纳入回执摘要的已落盘结果', () => {
  const source = structuredClone(validFixture.contracts.AgentExecutionReceiptV1) as Record<string, unknown>;
  const legacyPayload = { ...source, digest: '', signature: '' };
  const legacy = { ...source, digest: sha256Digest(legacyPayload) };
  assert.doesNotThrow(() => validateAgentExecutionReceipt(legacy));
});

test('Canonical Plugin ID 支持注册表中的连字符 ID', () => {
  for (const pluginId of ['app.java-keystore', 'app.service-certificate-file', 'device.synology-dsm', 'ca.microsoft-adcs']) {
    const token = structuredClone(validFixture.contracts.AgentCapabilityTokenV1) as Record<string, unknown>;
    token.pluginId = pluginId;
    assert.doesNotThrow(() => validateAgentCapabilityToken(token), pluginId);
    assert.equal(
      validateJsonSchema(token, { $defs: diskSchema.$defs, $ref: '#/$defs/capabilityToken' }).valid,
      true,
      pluginId,
    );
  }
});

test('计划内容被篡改时摘要绑定失败关闭', () => {
  const plan = structuredClone(validFixture.contracts.AgentPlanV1) as Record<string, unknown>;
  ((plan.operations as Array<Record<string, unknown>>)[0]!.input as Record<string, unknown>).path = '/var/lib/gcac/other.json';
  assert.throws(() => validateAgentPlan(plan), /摘要/);
});

test('审批引用必须进入 Plan 摘要并绑定 Token 与 Decision', () => {
  const base = createAuthorizationInput({ plan: { approvalRef: 'approval-2' } });
  const { approvalRef: _approvalRef, ...withoutApprovalRef } = base.plan;
  assert.notEqual(base.plan.planDigest, computeAgentPlanDigest(withoutApprovalRef as AgentPlanV1));
  assert.throws(() => authorizeAgentPlan(base), /审批引用/);
});

test('Agent 安全合同负例 Fixture 对默认密钥、越权输入和危险执行语义失败关闭', () => {
  for (const item of invalidFixture.schemaCases) {
    const value = structuredClone(validFixture.contracts[item.type]) as unknown;
    setPath(value, item.path, structuredClone(item.value));
    const schema = { $defs: diskSchema.$defs, $ref: `#/$defs/${schemaNames[item.type]}` };
    const schemaResult = validateJsonSchema(value, schema, { maxDepth: 24, maxArrayItems: 1000 });
    let rejected = !schemaResult.valid;
    try { validators[item.type](value); } catch { rejected = true; }
    assert.equal(rejected, true, `${item.name} 未被拒绝`);
  }
});

test('Policy Authority 签名、绑定、撤销和 Nonce 一次性消费可验证', () => {
  const base = createAuthorizationInput();
  const consumed = authorizeAgentPlan(base);
  assert.equal(consumed.recordVersion, 'gcac.agent-security/v1');
  assert.equal(base.nonceStore.has?.(base.token.nonce), true);
  assert.throws(() => authorizeAgentPlan(base), /Nonce/);

  for (const item of invalidFixture.authorizationCases) {
    const input = createAuthorizationInput(item.change);
    assert.throws(() => authorizeAgentPlan(input), item.name);
  }
});

function createAuthorizationInput(change: Record<string, unknown> = {}): AgentAuthorizationInput {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const basePlan = validateAgentPlan(structuredClone(validFixture.contracts.AgentPlanV1));
  const baseToken = validateAgentCapabilityToken(structuredClone(validFixture.contracts.AgentCapabilityTokenV1));
  const baseDecision = validatePolicyAuthorityDecision(structuredClone(validFixture.contracts.PolicyAuthorityDecisionV1));
  const basePolicy = validateAgentLocalPolicy(structuredClone(validFixture.contracts.AgentLocalPolicyV1));
  const baseKeySet = structuredClone(validFixture.contracts.PolicyAuthorityKeySetV1) as PolicyAuthorityKeySetV1;
  baseKeySet.keys[0]!.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keySet = change.keyStatus === 'REVOKED'
    ? { ...baseKeySet, keys: baseKeySet.keys.map((key) => ({ ...key, status: 'REVOKED' as const })) }
    : validatePolicyAuthorityKeySet(baseKeySet);
  const planChange = asRecord(change.plan);
  const tokenChange = asRecord(change.token);
  const planValue = { ...basePlan, ...planChange, ...(planChange?.operations ? { operations: planChange.operations } : {}) } as AgentPlanV1;
  if (planChange && planChange.planDigest === undefined) planValue.planDigest = computeAgentPlanDigest(planValue);
  const tokenValue = { ...baseToken, ...tokenChange, ...(planChange && tokenChange?.planDigest === undefined ? { planDigest: planValue.planDigest } : {}) };
  const decisionChange = asRecord(change.decision);
  const decisionValue = { ...baseDecision, ...decisionChange, ...(planChange && decisionChange?.planDigest === undefined ? { planDigest: planValue.planDigest } : {}) };
  const token = validateAgentCapabilityToken({ ...tokenValue, signature: signPolicyPayload(tokenValue, privateKey) });
  const decision = validatePolicyAuthorityDecision({ ...decisionValue, signature: signPolicyPayload(decisionValue, privateKey) });
  const plan = validateAgentPlan(planValue);
  const localPolicy = basePolicy;
  return { plan, token, decision, keySet, localPolicy, revokedTokenIds: readStringArray(change.revokedTokenIds), nonceStore: new NonceStoreV1(), now: '2026-08-08T00:05:00.000Z' };
}

function setPath(value: unknown, path: string, next: unknown): void {
  const segments = path.replaceAll(']', '').split(/[.[/]/).filter(Boolean).map((segment) => segment);
  let current = value as Record<string, unknown> | unknown[];
  for (let index = 0; index < segments.length - 1; index += 1) current = (current as Record<string, unknown>)[segments[index]!] as Record<string, unknown> | unknown[];
  (current as Record<string, unknown>)[segments.at(-1)!] = next;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value as string[] : undefined;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

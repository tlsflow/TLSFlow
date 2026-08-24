import { createHash, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateJsonSchema, type JsonSchema } from '../../../common/validation/json-schema.js';
import {
  agentSecurityContractVersion,
  computeAgentPlanDigest,
  NonceStoreV1,
  signPolicyPayload,
  type AgentLocalPolicyV1,
  type AgentPlanV1,
  type PolicyAuthorityKeySetV1,
} from './agent-security.contract.js';
import {
  InMemoryPolicyAuthorityRevocationStoreV1,
  InMemoryPolicyAuthorityProvisioningStoreV1,
  FilePolicyAuthorityProvisioningStoreV1,
  createProductionPolicyAuthorityServicesV1,
  isProductionPolicyAuthorityServicesV1,
  PolicyAuthorityServiceV1,
  requireProductionPolicyAuthorityServicesV1,
  type PolicyAuthorityAuthorizationRequestV1,
  type PolicyAuthorityTrustRootV1,
  type SignedPolicyAuthorityKeySetV1,
} from './policy-authority.service.js';

const fixtureRoot = resolve(process.cwd(), 'src/modules/agents/security/fixtures');
const validFixture = readJson(resolve(fixtureRoot, 'agent-security.valid.json')) as { contracts: Record<string, unknown> };
const serviceSchema = readJson(resolve(process.cwd(), 'src/modules/agents/security/schemas/policy-authority-service-v1.schema.json')) as JsonSchema;
const provisioningSchema = readJson(resolve(process.cwd(), 'src/modules/agents/security/schemas/policy-authority-provisioning-v1.schema.json')) as JsonSchema;
const now = '2026-08-08T00:05:00.000Z';

test('生产服务验证独立信任根并签发绑定的 Decision 和 Token', () => {
  const context = createContext();
  const result = context.service.issueAuthorization(context.request);
  assert.ok(result.token);
  assert.equal(result.decision.allowed, true);
  assert.equal(result.token?.authorityKeyId, 'authority-key-1');
  assert.equal(result.token?.tenantId, context.request.tenantId);
  assert.equal(result.token?.planDigest, context.request.planDigest);
  assert.doesNotThrow(() => context.service.authorize({ plan: createPlan(result), token: result.token, decision: result.decision, localPolicy: context.localPolicy }));
});

test('Policy Authority 自动签发 Agent 初始信任材料，不要求宿主提供 localPolicy 签名', () => {
  const context = createContext();
  const material = context.service.issueAgentTrustMaterial({ tenantId: context.request.tenantId, agentId: context.request.agentId, osType: 'linux' });
  assert.equal(material.localPolicy.agentId, context.request.agentId);
  assert.equal(material.localPolicy.disabled, false);
  assert.deepEqual(material.localPolicy.authorityKeyIds, ['authority-key-1']);
  assert.equal(material.localPolicySignature.length > 0, true);
  assert.equal(JSON.stringify(material.localPolicy).includes(context.request.artifactDigests[0]!), false);
});

test('provisioning JSON Schema 要求完整 compiledPlan 且拒绝缺失', () => {
  const context = createContext();
  const request = {
    ...context.request,
    commandRules: [],
    currentLocalPolicy: context.localPolicy,
    compiledPlan: structuredClone(validFixture.contracts.AgentPlanV1),
  };
  assert.equal(validateJsonSchema(request, provisioningSchema).valid, true);
  const missing = { ...request } as Record<string, unknown>;
  delete missing.compiledPlan;
  assert.equal(validateJsonSchema(missing, provisioningSchema).valid, false);
});

test('同一编译计划 provisioning 幂等，并将 Artifact 摘要排除在 Agent 本地材料之外', () => {
  const context = createContext();
  const provisioning = new InMemoryPolicyAuthorityProvisioningStoreV1();
  const service = new PolicyAuthorityServiceV1({ ...context.options, provisioning });
  const request = {
    ...context.request,
    commandRules: [],
    currentLocalPolicy: context.localPolicy,
    compiledPlan: structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1,
  };
  const first = service.provisionAgentPlan(request);
  const second = service.provisionAgentPlan(request);
  assert.equal(first.revision, second.revision);
  assert.equal(first.receipt.ruleDigest, second.receipt.ruleDigest);
  assert.equal(first.rule.artifactDigests[0], context.request.artifactDigests[0]);
  assert.equal(JSON.stringify(first.localPolicyMaterial).includes(context.request.artifactDigests[0]), false);
  const issued = service.issueAuthorization(context.request);
  assert.equal(issued.decision.allowed, true);
});

test('首次 provisioning 自动绑定 PA Key，不要求调用方预先填写本地信任 Key', () => {
  const context = createContext();
  const service = new PolicyAuthorityServiceV1({ ...context.options, provisioning: new InMemoryPolicyAuthorityProvisioningStoreV1() });
  const result = service.provisionAgentPlan({
    ...context.request,
    commandRules: [],
    bootstrapLocalPolicy: true,
    currentLocalPolicy: { ...context.localPolicy, authorityKeyIds: ['bootstrap-pending'] },
    compiledPlan: structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1,
  });
  assert.deepEqual(result.localPolicyMaterial.localPolicy.authorityKeyIds, ['authority-key-1']);
  assert.equal(JSON.stringify(result.localPolicyMaterial.localPolicy).includes(context.request.artifactDigests[0]), false);
});

test('生产 provisioning 接受 IIS 绑定、回滚和本机 TLS 验证动作', () => {
  const context = createContext();
  const service = new PolicyAuthorityServiceV1({ ...context.options, provisioning: new InMemoryPolicyAuthorityProvisioningStoreV1() });
  const artifactDigest = 'a'.repeat(64);
  const fingerprint = 'b'.repeat(64);
  const configFingerprint = 'c'.repeat(64);
  const basePlan = structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1;
  const operations = [
    {
      ...basePlan.operations[0]!,
      operationId: 'iis-update',
      operationType: 'certificate.iis.binding.update' as const,
      stage: 'execute' as const,
      input: {
        siteName: 'Default Web Site',
        bindingInformation: '*:443:iis.example.test',
        storeName: 'My',
        storeLocation: 'LocalMachine',
        pfxBase64: 'AA==',
        pfxPassword: 'password',
        expectedFingerprintSha256: fingerprint,
        artifactDigest,
        bindingKey: 'iis.example.test:443',
        configFingerprint,
      },
    },
    {
      ...basePlan.operations[0]!,
      operationId: 'iis-verify',
      operationType: 'certificate.iis.binding.verify' as const,
      stage: 'verify' as const,
      input: {
        siteName: 'Default Web Site',
        bindingInformation: '*:443:iis.example.test',
        storeName: 'My',
        storeLocation: 'LocalMachine',
        expectedFingerprintSha256: fingerprint,
        artifactDigest,
        bindingKey: 'iis.example.test:443',
        configFingerprint,
      },
    },
    {
      ...basePlan.operations[0]!,
      operationId: 'iis-tls-verify',
      operationType: 'certificate.tls.verify' as const,
      stage: 'verify' as const,
      input: {
        connectHost: '127.0.0.1',
        serverName: 'iis.example.test',
        port: 443,
        expectedFingerprintSha256: fingerprint,
        bindingId: 'binding-iis',
        bindingKey: 'iis.example.test:443',
        checkedAt: '2026-08-08T00:00:00.000Z',
      },
    },
    {
      ...basePlan.operations[0]!,
      operationId: 'iis-rollback',
      operationType: 'certificate.iis.binding.rollback' as const,
      stage: 'compensate' as const,
      input: {
        siteName: 'Default Web Site',
        bindingInformation: '*:443:iis.example.test',
        storeName: 'My',
        storeLocation: 'LocalMachine',
        previousThumbprint: 'A'.repeat(40),
        bindingKey: 'iis.example.test:443',
        configFingerprint,
      },
    },
  ];
  const plan = {
    ...basePlan,
    planId: 'iis-certificate-plan',
    pluginId: 'web.iis',
    capability: 'certificate.deploy',
    operations,
    writeEffect: true,
    planDigest: '',
  } as AgentPlanV1;
  plan.planDigest = computeAgentPlanDigest(plan);
  const actions = operations.map((operation) => operation.operationType);
  assert.doesNotThrow(() => service.provisionAgentPlan({
    ...context.request,
    pluginId: 'web.iis',
    capability: 'certificate.deploy',
    policyRef: 'certificate-update-policy',
    policyVersion: 'v1',
    actions,
    allowedPaths: [],
    allowedServices: ['W3SVC'],
    artifactDigests: [artifactDigest],
    planDigest: plan.planDigest,
    commandRules: [],
    currentLocalPolicy: {
      ...context.localPolicy,
      allowedActions: actions,
      pathRules: [],
      serviceRules: ['W3SVC'],
      commandRules: [],
    },
    compiledPlan: plan,
  }));
});

test('provisioning 存在时错误 Plan 摘要不得回退到旧策略评估器', () => {
  const context = createContext();
  const service = new PolicyAuthorityServiceV1({ ...context.options, provisioning: new InMemoryPolicyAuthorityProvisioningStoreV1() });
  service.provisionAgentPlan({
    ...context.request,
    commandRules: [],
    currentLocalPolicy: context.localPolicy,
    compiledPlan: structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1,
  });
  const result = service.issueAuthorization({ ...context.request, planDigest: 'f'.repeat(64) });
  assert.equal(result.decision.allowed, false);
  assert.match(result.decision.reason ?? '', /provisioning|Plan/);
  const artifactMismatch = service.issueAuthorization({ ...context.request, artifactDigests: ['b'.repeat(64)] });
  assert.equal(artifactMismatch.decision.allowed, false);
  assert.match(artifactMismatch.decision.reason ?? '', /provisioning|范围/);
});

test('provisioning 超出本地动作、路径或命令能力时整体失败', () => {
  const context = createContext();
  const service = new PolicyAuthorityServiceV1({ ...context.options, provisioning: new InMemoryPolicyAuthorityProvisioningStoreV1() });
  const restartPlan = structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1;
  restartPlan.operations[0] = { ...restartPlan.operations[0]!, operationType: 'service.restart', input: { serviceName: 'gcac-test' } };
  restartPlan.planDigest = computeAgentPlanDigest({ ...restartPlan, planDigest: '' });
  assert.throws(() => service.provisionAgentPlan({
    ...context.request,
    actions: ['service.restart'],
    allowedServices: ['gcac-test'],
    commandRules: [],
    currentLocalPolicy: context.localPolicy,
    planDigest: restartPlan.planDigest,
    compiledPlan: restartPlan,
  }), /超出 Agent 本地能力上限/);
  const pathPlan = structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1;
  pathPlan.operations[0] = { ...pathPlan.operations[0]!, input: { path: '/etc/shadow' } };
  pathPlan.planDigest = computeAgentPlanDigest({ ...pathPlan, planDigest: '' });
  assert.throws(() => service.provisionAgentPlan({
    ...context.request,
    allowedPaths: ['/etc/shadow'],
    commandRules: [],
    currentLocalPolicy: context.localPolicy,
    planDigest: pathPlan.planDigest,
    compiledPlan: pathPlan,
  }), /受控目录/);
});

test('provisioning 从已编译 Plan 派生命令规则，兼容旧快照中的过期规则', () => {
  const context = createContext();
  const service = new PolicyAuthorityServiceV1({ ...context.options, provisioning: new InMemoryPolicyAuthorityProvisioningStoreV1() });
  const executableSha256 = 'b'.repeat(64);
  const commandRule = {
    executablePath: '/usr/sbin/apache2',
    executableSha256,
    argumentTemplate: ['-t', '-f', '{configPath}'],
    environmentAllowlist: [],
    workingDirectory: '/etc/apache2',
    networkScopes: [],
    childProcessPolicy: 'deny' as const,
    timeoutSeconds: 60,
    outputLimitBytes: 65536,
  };
  const plan = structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1;
  plan.capability = 'certificate.deploy';
  plan.operations[0] = {
    ...plan.operations[0]!,
    operationType: 'command.execute_allowlisted',
    input: {
      executablePath: commandRule.executablePath,
      executableSha256,
      args: ['-t', '-f', '/etc/apache2/httpd.conf'],
      argumentTemplate: commandRule.argumentTemplate,
      environmentAllowlist: [],
      workingDirectory: commandRule.workingDirectory,
      networkScopes: [],
      childProcessPolicy: 'deny',
      timeoutSeconds: 60,
      outputLimitBytes: 65536,
      artifactDigest: executableSha256,
    },
  };
  plan.planDigest = computeAgentPlanDigest({ ...plan, planDigest: '' });
  const staleRule = { ...commandRule, executablePath: '/usr/sbin/old-apache', executableSha256: 'c'.repeat(64) };
  const result = service.provisionAgentPlan({
    ...context.request,
    capability: plan.capability,
    actions: ['command.execute_allowlisted'],
    allowedPaths: ['/usr/sbin', '/etc/apache2'],
    artifactDigests: [context.request.artifactDigests[0]!, executableSha256],
    planDigest: plan.planDigest,
    commandRules: [staleRule],
    currentLocalPolicy: {
      ...context.localPolicy,
      allowedActions: ['command.execute_allowlisted'],
      pathRules: [{ prefix: '/usr/sbin', operations: ['command.execute_allowlisted'] }, { prefix: '/etc/apache2', operations: ['command.execute_allowlisted'] }],
      serviceRules: [],
      commandRules: [commandRule],
    },
    compiledPlan: plan,
  });
  assert.deepEqual(result.rule.commandRules, [commandRule]);
});

test('首次 bootstrap 从编译计划生成 Apache 命令上限，不被 discovery-only localPolicy 阻断', () => {
  const context = createContext();
  const service = new PolicyAuthorityServiceV1({ ...context.options, provisioning: new InMemoryPolicyAuthorityProvisioningStoreV1() });
  const executableSha256 = 'b'.repeat(64);
  const commandRule = {
    executablePath: '/usr/sbin/apache2',
    executableSha256,
    argumentTemplate: ['-t', '-f', '{configPath}'],
    environmentAllowlist: [],
    workingDirectory: '/etc/apache2',
    networkScopes: [],
    childProcessPolicy: 'deny' as const,
    timeoutSeconds: 60,
    outputLimitBytes: 65536,
  };
  const plan = structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1;
  plan.capability = 'certificate.deploy';
  plan.operations[0] = {
    ...plan.operations[0]!,
    operationType: 'command.execute_allowlisted',
    input: { ...commandRule, args: ['-t', '-f', '/etc/apache2/httpd.conf'], artifactDigest: executableSha256 },
  };
  plan.planDigest = computeAgentPlanDigest({ ...plan, planDigest: '' });
  const result = service.provisionAgentPlan({
    ...context.request,
    capability: plan.capability,
    actions: ['command.execute_allowlisted'],
    allowedPaths: ['/usr/sbin', '/etc/apache2'],
    artifactDigests: [context.request.artifactDigests[0]!, executableSha256],
    planDigest: plan.planDigest,
    commandRules: [],
    bootstrapLocalPolicy: true,
    currentLocalPolicy: {
      ...context.localPolicy,
      authorityKeyIds: ['bootstrap-pending'],
      allowedActions: ['command.execute_allowlisted'],
      pathRules: [{ prefix: '/usr/sbin', operations: ['command.execute_allowlisted'] }, { prefix: '/etc/apache2', operations: ['command.execute_allowlisted'] }],
      serviceRules: [],
      commandRules: [],
    },
    compiledPlan: plan,
  });
  assert.deepEqual(result.rule.commandRules, [commandRule]);
  assert.deepEqual(result.localPolicyMaterial.localPolicy.commandRules, [commandRule]);
});

test('Windows 计划使用正斜杠路径时 provisioning 仍按 Agent 合同规范化后匹配命令', () => {
  const context = createContext();
  const service = new PolicyAuthorityServiceV1({ ...context.options, provisioning: new InMemoryPolicyAuthorityProvisioningStoreV1() });
  const executableSha256 = 'b'.repeat(64);
  const commandRule = {
    executablePath: 'C:/GCAC-Lab/Apache24/bin/httpd.exe',
    executableSha256,
    argumentTemplate: ['-t', '-d', 'C:/GCAC-Lab/Apache24', '-f', 'C:/GCAC-Lab/Apache24/conf/httpd-gcac.conf'],
    environmentAllowlist: [],
    workingDirectory: 'C:/GCAC-Lab/Apache24',
    networkScopes: [],
    childProcessPolicy: 'deny' as const,
    timeoutSeconds: 60,
    outputLimitBytes: 65536,
  };
  const plan = structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1;
  plan.capability = 'certificate.deploy';
  plan.operations[0] = {
    ...plan.operations[0]!,
    operationType: 'command.execute_allowlisted',
    input: {
      ...commandRule,
      args: ['-t', '-d', 'C:/GCAC-Lab/Apache24', '-f', 'C:/GCAC-Lab/Apache24/conf/httpd-gcac.conf'],
      artifactDigest: executableSha256,
    },
  };
  plan.planDigest = computeAgentPlanDigest({ ...plan, planDigest: '' });
  assert.doesNotThrow(() => service.provisionAgentPlan({
    ...context.request,
    capability: plan.capability,
    actions: ['command.execute_allowlisted'],
    allowedPaths: ['C:/GCAC-Lab/Apache24'],
    artifactDigests: [context.request.artifactDigests[0]!, executableSha256],
    planDigest: plan.planDigest,
    commandRules: [],
    currentLocalPolicy: {
      ...context.localPolicy,
      allowedActions: ['command.execute_allowlisted'],
      pathRules: [{ prefix: 'C:/GCAC-Lab/Apache24', operations: ['command.execute_allowlisted'] }],
      serviceRules: [],
      commandRules: [commandRule],
    },
    compiledPlan: plan,
  }));
});

test('provisioning 签名或持久化失败不会留下半份材料', () => {
  const context = createContext();
  const store = {
    find: (_requestDigest: string) => undefined,
    findMatching: (_input: unknown) => undefined,
    commit: () => { throw new Error('storage failed'); },
  };
  const service = new PolicyAuthorityServiceV1({ ...context.options, provisioning: store });
  assert.throws(() => service.provisionAgentPlan({ ...context.request, commandRules: [], currentLocalPolicy: context.localPolicy, compiledPlan: structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1 }), /持久化|storage failed/);
  assert.equal(store.find('missing'), undefined);
});

test('文件 provisioning 持久化失败后内存索引不提前提交', () => {
  const context = createContext();
  const store = new FilePolicyAuthorityProvisioningStoreV1('/dev/null/gcac-provisioning.json');
  const service = new PolicyAuthorityServiceV1({ ...context.options, provisioning: store });
  const request = { ...context.request, commandRules: [], currentLocalPolicy: context.localPolicy, compiledPlan: structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1 };
  assert.throws(() => service.provisionAgentPlan(request), /持久化失败/);
  assert.equal(store.find('missing'), undefined);
});

test('证书更新策略拒绝旧的数字 policyVersion', () => {
  const context = createContext();
  const service = new PolicyAuthorityServiceV1({ ...context.options, provisioning: new InMemoryPolicyAuthorityProvisioningStoreV1() });
  assert.throws(() => service.issueAuthorization({ ...context.request, policyRef: 'certificate-update-policy', policyVersion: '1' }), /policyVersion.*v1/);
  assert.throws(() => service.provisionAgentPlan({
    ...context.request,
    policyRef: 'certificate-update-policy',
    policyVersion: '1',
    commandRules: [],
    currentLocalPolicy: context.localPolicy,
    compiledPlan: structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1,
  }), /policyVersion.*v1/);
});

test('生产签发结果的 allowed 必须来自根签名策略，宿主请求不能自行放行', () => {
  const context = createContext();
  const environment = createProductionEnvironment(context);
  try {
    const policy = JSON.parse(environment.GCAC_POLICY_AUTHORITY_POLICY_BUNDLE_JSON!) as Record<string, unknown>;
    const rules = structuredClone(policy.rules) as Array<Record<string, unknown>>;
    if (rules.length === 0) throw new Error('测试策略包缺少规则');
    rules[0] = { ...rules[0], tenantId: 'tenant-other' };
    const unsigned = { ...policy, rules };
    environment.GCAC_POLICY_AUTHORITY_POLICY_BUNDLE_JSON = JSON.stringify({ ...unsigned, signature: signPolicyPayload(unsigned, context.rootPrivateKey) });

    const production = createProductionPolicyAuthorityServicesV1(environment);
    const result = production.service.issueAuthorization(context.request);
    assert.equal(result.decision.allowed, false);
    assert.equal(result.token, undefined);
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

test('授权请求未知字段和空审批引用必须失败关闭', () => {
  const context = createContext();
  assert.throws(
    () => context.service.issueAuthorization({ ...context.request, unexpected: true } as never),
    /未知字段/,
  );
  assert.throws(
    () => context.service.issueAuthorization({ ...context.request, approvalRef: '' }),
    /非空字符串|标识符不合法|失败关闭/,
  );
});

test('策略评估原因必须是受约束的非空字符串', () => {
  const context = createContext();
  const service = new PolicyAuthorityServiceV1({
    ...context.options,
    evaluator: {
      evaluate: () => ({
        allowed: false,
        actions: context.request.actions,
        allowedPaths: context.request.allowedPaths,
        allowedServices: context.request.allowedServices,
        artifactDigests: context.request.artifactDigests,
        policyRef: context.request.policyRef,
        policyVersion: context.request.policyVersion,
        reason: 42 as never,
      }),
    },
  });
  assert.throws(() => service.issueAuthorization(context.request), /策略拒绝原因不能为空|失败关闭/);
});

test('Token 与 Decision 的授权范围不能互相扩大', () => {
  const context = createContext();
  const result = context.service.issueAuthorization(context.request);
  const decisionValue = { ...result.decision, actions: ['filesystem.stat'] };
  const decision = { ...decisionValue, signature: signPolicyPayload(decisionValue, context.signingKeySource.keys.get('authority-key-1')!) };
  const plan = createPlan(result);
  const localPolicy = { ...context.localPolicy, allowedActions: ['filesystem.read', 'filesystem.stat'], pathRules: [{ prefix: '/var/lib/gcac', operations: ['filesystem.read', 'filesystem.stat'] }] };
  assert.throws(() => context.service.authorize({ plan, token: result.token, decision, localPolicy }), /同时授权/);
});

test('生产缺少根、KeySet、签名私钥或撤销状态时失败关闭', () => {
  const context = createContext();
  assert.throws(() => createProductionPolicyAuthorityServicesV1({}), /失败关闭/);
  assert.throws(() => new PolicyAuthorityServiceV1({ ...context.options, signingKeySource: { getPrivateKey: () => undefined } }), /失败关闭/);
  assert.throws(() => new PolicyAuthorityServiceV1({ ...context.options, signingKeySource: {} as never }), /失败关闭/);
  assert.throws(() => new PolicyAuthorityServiceV1({ ...context.options, evaluator: {} as never }), /失败关闭/);
  assert.throws(() => new PolicyAuthorityServiceV1({ ...context.options, revocations: undefined as never }), /失败关闭/);
  assert.throws(() => new PolicyAuthorityServiceV1({ ...context.options, keySet: { ...context.envelope, signature: 'tampered' } }), /失败关闭/);
  assert.throws(() => new PolicyAuthorityServiceV1({ ...context.options, keySet: { ...context.envelope, unexpected: true } as never }), /失败关闭/);
  assert.throws(() => new PolicyAuthorityServiceV1({ ...context.options, keySet: { ...context.envelope, keySet: { ...context.keySet, authorityId: 'other-authority' } } }), /authorityId/);
});

test('生产注册资源必须来自生产工厂，合同或内存替身不得冒充', () => {
  const context = createContext();
  assert.equal(isProductionPolicyAuthorityServicesV1(context), false);
  assert.throws(() => requireProductionPolicyAuthorityServicesV1(context), /失败关闭/);

  const environment = createProductionEnvironment(context);
  try {
    const production = createProductionPolicyAuthorityServicesV1(environment);
    assert.equal(isProductionPolicyAuthorityServicesV1(production), true);
    assert.doesNotThrow(() => requireProductionPolicyAuthorityServicesV1(production));
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

test('Policy Authority signing key 必须与独立信任根分离', () => {
  const context = createContext();
  const rootPublicKey = createPublicKey(context.rootPrivateKey);
  const sameIdKey = createPolicyKey(context.trustRoot.rootKeyId, rootPublicKey, 'ACTIVE');
  const sameIdEnvelope = createEnvelope(context.rootPrivateKey, { ...context.keySet, activeKeyId: sameIdKey.keyId, keys: [sameIdKey] });
  assert.throws(() => new PolicyAuthorityServiceV1({
    ...context.options,
    keySet: sameIdEnvelope,
    signingKeySource: { getPrivateKey: () => context.rootPrivateKey },
  }), /独立/);

  const samePublicKey = createPolicyKey('authority-key-2', rootPublicKey, 'ACTIVE');
  const samePublicEnvelope = createEnvelope(context.rootPrivateKey, { ...context.keySet, activeKeyId: samePublicKey.keyId, keys: [samePublicKey] });
  assert.throws(() => new PolicyAuthorityServiceV1({
    ...context.options,
    keySet: samePublicEnvelope,
    signingKeySource: { getPrivateKey: () => context.rootPrivateKey },
  }), /独立/);
});

test('生产 KeySet 或签名密钥配置缺失时装配失败关闭', () => {
  const context = createContext();
  const environment = createProductionEnvironment(context);
  try {
    delete environment.GCAC_POLICY_AUTHORITY_KEYSET_JSON;
    assert.throws(() => createProductionPolicyAuthorityServicesV1(environment), /失败关闭/);
    const missingSigningKeyFile = createProductionEnvironment(context);
    try {
      delete missingSigningKeyFile.GCAC_POLICY_AUTHORITY_SIGNING_KEYS_FILE;
      assert.throws(() => createProductionPolicyAuthorityServicesV1(missingSigningKeyFile), /失败关闭/);
    } finally {
      cleanupProductionEnvironment(missingSigningKeyFile);
    }
    const invalidKeys = createProductionEnvironment(context);
    try {
      writeFileSync(invalidKeys.GCAC_POLICY_AUTHORITY_SIGNING_KEYS_FILE!, '{}');
      assert.throws(() => createProductionPolicyAuthorityServicesV1(invalidKeys), /失败关闭/);
    } finally {
      cleanupProductionEnvironment(invalidKeys);
    }
    const hostHmac = createProductionEnvironment(context);
    try {
      writeFileSync(hostHmac.GCAC_POLICY_AUTHORITY_SIGNING_KEYS_FILE!, JSON.stringify({ 'authority-key-1': 'ordinary-host-hmac-secret' }));
      assert.throws(() => createProductionPolicyAuthorityServicesV1(hostHmac), /失败关闭/);
    } finally {
      cleanupProductionEnvironment(hostHmac);
    }
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

test('生产 Bootstrap 缺失、根绑定篡改或过期时失败关闭', () => {
  const context = createContext();
  const environment = createProductionEnvironment(context);
  try {
    const missing = { ...environment };
    delete missing.GCAC_POLICY_AUTHORITY_BOOTSTRAP_JSON;
    assert.throws(() => createProductionPolicyAuthorityServicesV1(missing), /Bootstrap|失败关闭/);

    const bootstrap = JSON.parse(environment.GCAC_POLICY_AUTHORITY_BOOTSTRAP_JSON!) as Record<string, unknown>;
    const tamperedValue = { ...bootstrap, rootKeyId: 'other-root-key' };
    const tampered = {
      ...environment,
      GCAC_POLICY_AUTHORITY_BOOTSTRAP_JSON: JSON.stringify({
        ...tamperedValue,
        signature: signPolicyPayload(tamperedValue, context.rootPrivateKey),
      }),
    };
    assert.throws(() => createProductionPolicyAuthorityServicesV1(tampered), /未绑定|失败关闭/);

    const expiredValue = { ...bootstrap, validUntil: '2026-08-10T00:00:00.000Z' };
    const expired = {
      ...environment,
      GCAC_POLICY_AUTHORITY_BOOTSTRAP_JSON: JSON.stringify({
        ...expiredValue,
        signature: signPolicyPayload(expiredValue, context.rootPrivateKey),
      }),
    };
    assert.throws(() => createProductionPolicyAuthorityServicesV1(expired), /过期|尚未生效|失败关闭/);
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

test('生产状态或 Agent 本地策略缺失时失败关闭', () => {
  const context = createContext();
  const environment = createProductionEnvironment(context);
  try {
    const missingState = { ...environment };
    delete missingState.GCAC_POLICY_AUTHORITY_STATE_FILE;
    assert.throws(() => createProductionPolicyAuthorityServicesV1(missingState), /失败关闭/);

    const production = createProductionPolicyAuthorityServicesV1(environment);
    const result = production.service.issueAuthorization(context.request);
    assert.throws(() => production.service.authorize({ plan: createPlan(result), token: result.token, decision: result.decision, localPolicy: undefined }), /失败关闭|必须是对象/);
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

test('生产装配使用真实签名策略包、持久撤销状态和一次性 Nonce', () => {
  const context = createContext();
  const environment = createProductionEnvironment(context);
  try {
    const production = createProductionPolicyAuthorityServicesV1(environment);
    const result = production.service.issueAuthorization(context.request);
    assert.ok(result.token);
    const plan = createPlan(result);
    assert.doesNotThrow(() => production.service.authorize({ plan, token: result.token, decision: result.decision, localPolicy: context.localPolicy }));
    assert.throws(() => production.service.authorize({ plan, token: result.token, decision: result.decision, localPolicy: context.localPolicy }), /Nonce/);

    const second = production.service.issueAuthorization(context.request);
    production.service.revokeToken(second.token, '生产撤销测试');
    assert.throws(() => production.service.authorize({ plan: createPlan(second), token: second.token, decision: second.decision, localPolicy: context.localPolicy }), /失败关闭/);

    const third = production.service.issueAuthorization(context.request);
    production.service.revokeDecision(third.decision, '生产决策撤销测试');
    assert.throws(() => production.service.authorize({ plan: createPlan(third), token: third.token, decision: third.decision, localPolicy: context.localPolicy }), /失败关闭/);

    const restarted = createProductionPolicyAuthorityServicesV1(environment);
    assert.throws(() => restarted.service.authorize({ plan, token: result.token, decision: result.decision, localPolicy: context.localPolicy }), /Nonce/);
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

test('生产 Key 撤销通过 Policy Authority 入口持久化，并在重启后优先于旧凭证', () => {
  const context = createContext();
  const environment = createProductionEnvironment(context);
  try {
    const production = createProductionPolicyAuthorityServicesV1(environment);
    const result = production.service.issueAuthorization(context.request);
    const plan = createPlan(result);

    production.service.revokeKey('authority-key-1');
    assert.throws(
      () => production.service.authorize({ plan, token: result.token, decision: result.decision, localPolicy: context.localPolicy }),
      /authority key 已被撤销|失败关闭/,
    );
    assert.equal(production.state.isKeyRevoked('authority-key-1'), true);
    assert.throws(() => createProductionPolicyAuthorityServicesV1(environment), /当前 authority key 已被撤销|失败关闭/);
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

test('生产 KeySet 与签名私钥来源在轮换后自动重新装载', () => {
  const context = createContext();
  const environment = createProductionEnvironment(context);
  try {
    const production = createProductionPolicyAuthorityServicesV1(environment);
    const next = generateKeyPairSync('ed25519');
    const nowValue = Date.now();
    const nextKey = {
      ...createPolicyKey('authority-key-2', next.publicKey, 'ACTIVE'),
      notBefore: new Date(nowValue - 60_000).toISOString(),
      notAfter: '2099-01-01T00:00:00.000Z',
    };
    const rotated = {
      ...context.keySet,
      activeKeyId: nextKey.keyId,
      issuedAt: new Date(nowValue - 30_000).toISOString(),
      keys: [context.keySet.keys[0]!, nextKey],
    };
    environment.GCAC_POLICY_AUTHORITY_KEYSET_JSON = JSON.stringify(createEnvelope(context.rootPrivateKey, rotated));
    const oldSigningKey = context.signingKeySource.keys.get('authority-key-1');
    if (!oldSigningKey || typeof oldSigningKey === 'string') throw new Error('测试上下文缺少旧签名私钥');
    writeFileSync(environment.GCAC_POLICY_AUTHORITY_SIGNING_KEYS_FILE!, JSON.stringify({
      'authority-key-1': oldSigningKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      'authority-key-2': next.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }));

    const result = production.service.issueAuthorization(context.request);
    assert.equal(result.token?.authorityKeyId, 'authority-key-2');
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

test('Key rotation 使用新 ACTIVE key，旧 key 在撤销后立即失败', () => {
  const context = createContext();
  const oldResult = context.service.issueAuthorization(context.request);
  const next = generateKeyPairSync('ed25519');
  const nextKey = createPolicyKey('authority-key-2', next.publicKey, 'ACTIVE');
  const rotated = createEnvelope(context.rootPrivateKey, { ...context.keySet, activeKeyId: nextKey.keyId, issuedAt: '2026-08-08T00:04:00.000Z', keys: [context.keySet.keys[0]!, nextKey] });
  context.signingKeySource.keys.set(nextKey.keyId, next.privateKey);
  context.service.refreshKeySet(rotated);
  const nextResult = context.service.issueAuthorization(context.request);
  assert.equal(nextResult.token?.authorityKeyId, 'authority-key-2');
  const revokedOld = createEnvelope(context.rootPrivateKey, { ...rotated.keySet, issuedAt: '2026-08-08T00:05:00.000Z', keys: rotated.keySet.keys.map((key) => key.keyId === 'authority-key-1' ? { ...key, status: 'REVOKED' as const } : key) });
  context.service.refreshKeySet(revokedOld);
  assert.throws(() => context.service.authorize({ plan: createPlan(oldResult), token: oldResult.token, decision: oldResult.decision, localPolicy: context.localPolicy }), /失败关闭/);
});

test('撤销、过期和 Nonce 重放均不可绕过', () => {
  let currentNow = now;
  const context = createContext(() => currentNow);
  const result = context.service.issueAuthorization(context.request);
  const plan = createPlan(result);
  context.service.authorize({ plan, token: result.token, decision: result.decision, localPolicy: context.localPolicy });
  assert.throws(() => context.service.authorize({ plan, token: result.token, decision: result.decision, localPolicy: context.localPolicy }), /Nonce/);

  const second = context.service.issueAuthorization(context.request);
  context.service.revokeToken(second.token, 'incident response');
  assert.throws(() => context.service.authorize({ plan: createPlan(second), token: second.token, decision: second.decision, localPolicy: context.localPolicy }), /失败关闭/);

  currentNow = '2026-08-08T00:05:30.000Z';
  const third = context.service.issueAuthorization(context.request);
  currentNow = '2026-08-08T00:20:01.000Z';
  assert.throws(() => context.service.authorize({ plan: createPlan(third), token: third.token, decision: third.decision, localPolicy: context.localPolicy }), /过期|生效/);
});

test('Policy Authority Decision 撤销与 Token 撤销同样立即阻断授权', () => {
  const context = createContext();
  const result = context.service.issueAuthorization(context.request);
  const plan = createPlan(result);
  context.service.revokeDecision(result.decision, 'decision incident response');
  assert.throws(
    () => context.service.authorize({ plan, token: result.token, decision: result.decision, localPolicy: context.localPolicy }),
    /决策已被撤销/,
  );
});

test('Nonce 存储异常不会降级为执行允许', () => {
  const context = createContext();
  const failingNonceStore = { consume() { throw new Error('persistent nonce store unavailable'); } };
  const service = new PolicyAuthorityServiceV1({ ...context.options, nonceStore: failingNonceStore });
  const result = service.issueAuthorization(context.request);
  assert.throws(() => service.authorize({ plan: createPlan(result), token: result.token, decision: result.decision, localPolicy: context.localPolicy }), /失败关闭/);
});

test('Policy Authority 服务 Schema 拒绝缺少独立根绑定的 KeySet Envelope', () => {
  const context = createContext();
  const rootSchema = { $defs: (serviceSchema as JsonSchema & { $defs: Record<string, JsonSchema> }).$defs, $ref: '#/$defs/trustRoot' };
  const envelopeSchema = { $defs: (serviceSchema as JsonSchema & { $defs: Record<string, JsonSchema> }).$defs, $ref: '#/$defs/keySetEnvelope' };
  assert.equal(validateJsonSchema(context.trustRoot, rootSchema).valid, true);
  assert.equal(validateJsonSchema(context.envelope, envelopeSchema).valid, true);
  assert.equal(validateJsonSchema({ ...context.envelope, rootKeyId: undefined }, envelopeSchema).valid, false);
  assert.equal(validateJsonSchema({ ...context.envelope, unexpected: true }, envelopeSchema).valid, false);
});

test('生产签名策略规则结构不完整时失败关闭', () => {
  const context = createContext();
  const environment = createProductionEnvironment(context);
  try {
    const policy = JSON.parse(environment.GCAC_POLICY_AUTHORITY_POLICY_BUNDLE_JSON!) as Record<string, unknown>;
    const unsigned = { ...policy, rules: [{ ...(policy.rules as Array<Record<string, unknown>>)[0], allowedPaths: ['relative/path'] }] };
    environment.GCAC_POLICY_AUTHORITY_POLICY_BUNDLE_JSON = JSON.stringify({ ...unsigned, signature: signPolicyPayload(unsigned, context.rootPrivateKey) });
    assert.throws(() => createProductionPolicyAuthorityServicesV1(environment), /非法路径/);
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

test('生产撤销状态缺少 Decision 撤销集合时失败关闭', () => {
  const context = createContext();
  const environment = createProductionEnvironment(context);
  try {
    writeFileSync(environment.GCAC_POLICY_AUTHORITY_STATE_FILE!, JSON.stringify({
      stateVersion: 'gcac.policy-authority-state/v1',
      revokedTokenIds: [],
      revokedKeyIds: [],
      nonces: [],
    }));
    assert.throws(() => createProductionPolicyAuthorityServicesV1(environment), /状态格式无效/);
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

test('生产撤销状态含开发 Key 标识时失败关闭', () => {
  const context = createContext();
  const environment = createProductionEnvironment(context);
  try {
    writeFileSync(environment.GCAC_POLICY_AUTHORITY_STATE_FILE!, JSON.stringify({
      stateVersion: 'gcac.policy-authority-state/v1',
      revokedTokenIds: ['authority-test-key:token-1'],
      revokedDecisionIds: ['authority-key-1:decision-1'],
      revokedKeyIds: ['authority-fixture-key'],
      nonces: [],
    }));
    assert.throws(() => createProductionPolicyAuthorityServicesV1(environment), /开发默认密钥|状态格式无效/);
  } finally {
    cleanupProductionEnvironment(environment);
  }
});

function createContext(nowFactory: () => string = () => now) {
  const root = generateKeyPairSync('ed25519');
  const signer = generateKeyPairSync('ed25519');
  const keySet: PolicyAuthorityKeySetV1 = {
    keySetVersion: agentSecurityContractVersion,
    authorityId: 'policy-authority-1',
    activeKeyId: 'authority-key-1',
    keys: [createPolicyKey('authority-key-1', signer.publicKey, 'ACTIVE')],
    issuedAt: '2026-08-07T00:00:00.000Z',
  };
  const trustRoot = createTrustRoot(root.publicKey);
  const envelope = createEnvelope(root.privateKey, keySet);
  const signingKeySource = { keys: new Map<string, KeyObject | string>([['authority-key-1', signer.privateKey]]), getPrivateKey(keyId: string) { return this.keys.get(keyId); } };
  const revocations = new InMemoryPolicyAuthorityRevocationStoreV1();
  const evaluator = { evaluate(input: PolicyAuthorityAuthorizationRequestV1 & { issuedAt: string; validUntil: string }) { return { allowed: true, actions: input.actions, allowedPaths: input.allowedPaths, allowedServices: input.allowedServices, artifactDigests: input.artifactDigests, policyRef: input.policyRef, policyVersion: input.policyVersion }; } };
  const fixturePlan = structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1;
  const request: PolicyAuthorityAuthorizationRequestV1 = { agentId: 'agent-1', tenantId: 'tenant-1', pluginId: 'web.nginx', pluginVersionId: 'plugin-version-1', capability: 'filesystem.read', actions: ['filesystem.read'], allowedPaths: ['/var/lib/gcac'], allowedServices: [], artifactDigests: ['a'.repeat(64)], policyRef: 'policy-1', policyVersion: '1', planDigest: computeAgentPlanDigest(fixturePlan), lifetimeSeconds: 300 };
  const localPolicy = { ...(structuredClone(validFixture.contracts.AgentLocalPolicyV1) as AgentLocalPolicyV1), authorityKeyIds: ['authority-key-1', 'authority-key-2'] };
  const options = { trustRoot, keySet: envelope, signingKeySource, evaluator, revocations, nonceStore: new NonceStoreV1(), now: nowFactory };
  return { rootPrivateKey: root.privateKey, trustRoot, envelope, keySet, signingKeySource, evaluator, revocations, request, localPolicy, options, service: new PolicyAuthorityServiceV1(options) };
}

function createProductionEnvironment(context: ReturnType<typeof createContext>): NodeJS.ProcessEnv {
  const signingKey = context.signingKeySource.keys.get('authority-key-1');
  if (!signingKey || typeof signingKey === 'string') throw new Error('测试上下文缺少签名私钥');
  const productionKeySet: PolicyAuthorityKeySetV1 = {
    ...context.keySet,
    keys: context.keySet.keys.map((key) => ({ ...key, notAfter: '2099-01-01T00:00:00.000Z' })),
  };
  const productionEnvelope = createEnvelope(context.rootPrivateKey, productionKeySet);
  const stateDir = mkdtempSync(join(tmpdir(), 'gcac-policy-authority-'));
  const stateFile = join(stateDir, 'state.json');
    writeFileSync(stateFile, JSON.stringify({ stateVersion: 'gcac.policy-authority-state/v1', revokedTokenIds: [], revokedDecisionIds: [], revokedKeyIds: [], nonces: [] }));
  const policyValue = {
    bundleVersion: 'gcac.policy-authority/v1',
    authorityId: context.trustRoot.authorityId,
    issuedAt: '2026-08-07T00:00:00.000Z',
    rules: [{
      policyRef: context.request.policyRef,
      policyVersion: context.request.policyVersion,
      agentId: context.request.agentId,
      tenantId: context.request.tenantId,
      pluginId: context.request.pluginId,
      pluginVersionId: context.request.pluginVersionId,
      capability: context.request.capability,
      actions: context.request.actions,
      allowedPaths: context.request.allowedPaths,
      allowedServices: context.request.allowedServices,
      artifactDigests: context.request.artifactDigests,
    }],
  };
  const policy = { ...policyValue, signature: signPolicyPayload(policyValue, context.rootPrivateKey) };
  const bootstrapValue = {
    bootstrapVersion: 'gcac.policy-authority-bootstrap/v1',
    bootstrapId: 'bootstrap-1',
    authorityId: context.trustRoot.authorityId,
    rootKeyId: context.trustRoot.rootKeyId,
    rootFingerprintSha256: context.trustRoot.fingerprintSha256,
    issuedAt: '2026-08-07T00:00:00.000Z',
    validUntil: '2099-01-01T00:00:00.000Z',
  };
  const bootstrap = { ...bootstrapValue, signature: signPolicyPayload(bootstrapValue, context.rootPrivateKey) };
  const signingKeysFile = join(stateDir, 'signing-keys.json');
  writeFileSync(signingKeysFile, JSON.stringify({
    'authority-key-1': signingKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }), { encoding: 'utf8', mode: 0o600 });
  return {
    NODE_ENV: 'production',
    GCAC_POLICY_AUTHORITY_PROCESS_ROLE: 'standalone',
    GCAC_POLICY_AUTHORITY_ROOT_KEY_ID: context.trustRoot.rootKeyId,
    GCAC_POLICY_AUTHORITY_ID: context.trustRoot.authorityId,
    GCAC_POLICY_AUTHORITY_ROOT_PUBLIC_KEY_PEM: context.trustRoot.publicKeyPem,
    GCAC_POLICY_AUTHORITY_ROOT_FINGERPRINT_SHA256: context.trustRoot.fingerprintSha256,
    GCAC_POLICY_AUTHORITY_BOOTSTRAP_JSON: JSON.stringify(bootstrap),
    GCAC_POLICY_AUTHORITY_KEYSET_JSON: JSON.stringify(productionEnvelope),
    GCAC_POLICY_AUTHORITY_POLICY_BUNDLE_JSON: JSON.stringify(policy),
    GCAC_POLICY_AUTHORITY_STATE_FILE: stateFile,
    GCAC_POLICY_AUTHORITY_SIGNING_KEYS_FILE: signingKeysFile,
  };
}

function cleanupProductionEnvironment(environment: NodeJS.ProcessEnv): void {
  const stateFile = environment.GCAC_POLICY_AUTHORITY_STATE_FILE;
  if (stateFile) rmSync(resolve(stateFile, '..'), { recursive: true, force: true });
}

function createPlan(result: { token?: { tokenId: string; nonce: string; expiresAt: string }; decision: { decisionId: string } }): AgentPlanV1 {
  const plan = structuredClone(validFixture.contracts.AgentPlanV1) as AgentPlanV1;
  plan.tokenId = result.token!.tokenId;
  plan.nonce = result.token!.nonce;
  plan.expiresAt = result.token!.expiresAt;
  plan.policyDecisionId = result.decision.decisionId;
  plan.planDigest = computeAgentPlanDigest(plan);
  return plan;
}

function createTrustRoot(publicKey: KeyObject): PolicyAuthorityTrustRootV1 {
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return { rootKeyId: 'root-key-1', authorityId: 'policy-authority-1', algorithm: 'Ed25519', publicKeyPem, fingerprintSha256: publicKeyFingerprint(publicKeyPem) };
}

function createPolicyKey(keyId: string, publicKey: KeyObject, status: 'ACTIVE' | 'REVOKED') {
  return { keyId, algorithm: 'Ed25519' as const, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), status, notBefore: '2026-08-07T00:00:00.000Z', notAfter: '2026-08-09T00:00:00.000Z' };
}

function createEnvelope(rootPrivateKey: KeyObject, keySet: PolicyAuthorityKeySetV1): SignedPolicyAuthorityKeySetV1 {
  const value = { envelopeVersion: agentSecurityContractVersion, rootKeyId: 'root-key-1', authorityId: keySet.authorityId, keySet };
  return { ...value, signature: signPolicyPayload(value, rootPrivateKey) };
}

function publicKeyFingerprint(publicKeyPem: string): string { return createHash('sha256').update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })).digest('hex'); }
function readJson(path: string): unknown { return JSON.parse(readFileSync(path, 'utf8')) as unknown; }

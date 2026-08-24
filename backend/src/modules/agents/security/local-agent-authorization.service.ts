import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { AppError } from '../../../common/errors/app-error.js';
import {
  agentSecurityContractVersion,
  signPolicyPayload,
  type AgentLocalPolicyV1,
  type PolicyAuthorityKeySetV1,
  validateAgentLocalPolicy,
} from './agent-security.contract.js';
import {
  FilePolicyAuthorityStateStoreV1,
  PolicyAuthorityServiceV1,
  policyAuthorityBootstrapVersion,
  policyAuthorityStateVersion,
  type PolicyAuthorityEvaluationInputV1,
  type PolicyAuthorityEvaluationV1,
  type PolicyAuthorityTrustRootV1,
  type SignedPolicyAuthorityKeySetV1,
} from './policy-authority.service.js';
import type {
  UnifiedAgentPlanAuthorizationDependenciesV1,
  UnifiedAgentPlanGrantPortV1,
  UnifiedAgentPlanLocalPolicyPortV1,
  UnifiedAgentPlanPolicyAuthorityPortV1,
} from '../../plugins/application/unified-agent-plan-authorization.port.js';
import type { AgentTrustMaterialIssuer } from '../application/agents.application-service.js';
import {
  LINUX_WEB_DISCOVERY_PATHS,
  WINDOWS_WEB_DISCOVERY_PATHS,
  isAllowedWebDiscoveryPathSet,
} from '../agent-discovery-paths.js';

const localAuthorityFileVersion = 'gcac.local-agent-authority/v1' as const;
const agentTrustMaterialVersion = 'gcac.agent-trust-material/v1' as const;
const WINDOWS_OS_TYPES = new Set(['windows']);
const discoveryPolicyRef = 'gcac.agent.discovery';
const discoveryPolicyVersion = '1';
const discoveryCapability = 'application.discover';
const discoveryActions = Object.freeze(['filesystem.read', 'process.list', 'service.list']);
const executionPolicyFileVersion = 'gcac.local-agent-execution-policy/v1' as const;
const executionPolicyFileName = 'execution-policy.json';

interface LocalExecutionBindingV1 {
  tenantId: string;
  agentId: string;
  pluginId: string;
  pluginVersionId: string;
  capability: string;
  policyRef: string;
  policyVersion: string;
  actions: string[];
  allowedPaths: string[];
  allowedServices: string[];
  artifactDigests: string[];
  commandRules: AgentLocalPolicyV1['commandRules'];
}

interface LocalExecutionPolicyFileV1 {
  version: typeof executionPolicyFileVersion;
  bindings: LocalExecutionBindingV1[];
}

interface LocalAuthorityMaterialFileV1 {
  version: typeof localAuthorityFileVersion;
  rootKeyId: string;
  authorityId: string;
  signingKeyId: string;
  rootPrivateKeyPem: string;
  signingPrivateKeyPem: string;
  createdAt: string;
}

export interface AgentTrustMaterialV1 {
  materialVersion: typeof agentTrustMaterialVersion;
  issuedAt: string;
  validUntil: string;
  capabilityKeySet: Record<string, string>;
  policyAuthorityKeySet: Record<string, string>;
  localPolicy: AgentLocalPolicyV1;
  localPolicyAuthorityKeyId: string;
  localPolicySignature: string;
  /** Compatibility Agent 使用的完整签名材料；Linux Agent 仍只读取上面的统一 wire 字段。 */
  policyAuthorityTrustRoot?: PolicyAuthorityTrustRootV1;
  compatibilityPolicyAuthorityKeySet?: SignedPolicyAuthorityKeySetV1;
  localPolicyTrustRoot?: PolicyAuthorityTrustRootV1;
  compatibilityLocalPolicyBundle?: SignedAgentLocalPolicyBundleV1;
  revokedTokenIds?: string[];
  revokedDecisionIds?: string[];
  revokedKeyIds?: string[];
}

interface SignedAgentLocalPolicyBundleV1 {
  bundleVersion: 'gcac.agent-local-policy/v1';
  rootKeyId: string;
  policies: Array<{ tenantId: string; policy: AgentLocalPolicyV1 }>;
  signature: string;
}

export interface LocalAgentAuthorizationServicesV1 {
  readonly authorization: UnifiedAgentPlanAuthorizationDependenciesV1;
  readonly trustMaterialIssuer: AgentTrustMaterialIssuer;
  readonly authorityId: string;
  readonly signingKeyId: string;
}

/**
 * 本机控制面专用的持久化授权根。它只允许 Agent Core 的 Web 发现只读范围，
 * 不使用测试密钥，也不会为写操作、自由命令或旧 Plugin Runner 签发授权。
 */
export function createLocalAgentAuthorizationServicesV1(
  environment: NodeJS.ProcessEnv = process.env,
  options: { grants?: UnifiedAgentPlanGrantPortV1 } = {},
): LocalAgentAuthorizationServicesV1 | undefined {
  if (environment.NODE_ENV === 'production') return undefined;
  const directory = environment.GCAC_LOCAL_AGENT_AUTHORITY_DIR?.trim();
  if (!directory) return undefined;
  if (!isAbsolute(directory)) {
    throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', '本机 Agent Authority 目录必须使用绝对路径', { fallback: false });
  }

  const material = loadOrCreateMaterial(resolve(directory));
  const rootPrivateKey = createPrivateKey(material.rootPrivateKeyPem);
  const signingPrivateKey = createPrivateKey(material.signingPrivateKeyPem);
  const rootPublicKey = createPublicKey(rootPrivateKey);
  const signingPublicKey = createPublicKey(signingPrivateKey);
  const trustRoot = createTrustRoot(material, rootPublicKey);
  const keySet = createKeySet(material, signingPublicKey);
  const keySetEnvelope = signKeySet(trustRoot, keySet, rootPrivateKey);
  const bootstrap = signBootstrap(trustRoot, rootPrivateKey, material.createdAt);
  const executionPolicy = loadExecutionPolicy(resolve(directory));
  const state = ensureAuthorityState(resolve(directory, 'state.json'));
  const authority = new PolicyAuthorityServiceV1({
    trustRoot,
    keySet: keySetEnvelope,
    bootstrap,
    signingKeySource: {
      getPrivateKey: (keyId) => keyId === material.signingKeyId ? signingPrivateKey : undefined,
    },
    evaluator: {
      evaluate: (input) => evaluateRequest(input, executionPolicy),
    },
    revocations: state,
    nonceStore: state,
  });
  const policyAuthority: UnifiedAgentPlanPolicyAuthorityPortV1 = {
    assertReady: () => {
      authority.getTrustedKeySet();
      authority.getBootstrap();
    },
    issueAuthorization: (request) => authority.issueAuthorization(request),
  };
  const localPolicy: UnifiedAgentPlanLocalPolicyPortV1 = {
    resolve: async ({ agentId, tenantId }) => createContextLocalPolicy(agentId, tenantId, material.signingKeyId, executionPolicy),
  };
  const trustMaterialIssuer: AgentTrustMaterialIssuer = {
    issue: async ({ tenantId, agentId, osType }) => createAgentTrustMaterial(
      agentId,
      tenantId,
      osType,
      material,
      material.signingKeyId,
      signingPrivateKey,
      rootPrivateKey,
      trustRoot,
      keySet,
      executionPolicy,
    ),
    getTrustedKeySet: () => Object.fromEntries(keySet.keys.map((key) => [key.keyId, rawEd25519PublicKey(key.publicKeyPem)])),
  };
  return Object.freeze({
    authorization: {
      policyAuthority,
      grants: {
        // 没有显式执行策略时，开发 Authority 仍然只允许发现；写操作保持失败关闭。
        validate: async (input: Parameters<UnifiedAgentPlanGrantPortV1['validate']>[0]) => {
          if (executionPolicy && options.grants) return options.grants.validate(input);
          throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', '本机 Agent Authority 不签发执行 Grant', { fallback: false });
        },
      },
      localPolicy,
    },
    trustMaterialIssuer,
    authorityId: material.authorityId,
    signingKeyId: material.signingKeyId,
  });
}

function loadOrCreateMaterial(directory: string): LocalAuthorityMaterialFileV1 {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const filePath = resolve(directory, 'authority.json');
  if (existsSync(filePath)) return validateMaterialFile(readJson(filePath), filePath);

  const root = generateKeyPairSync('ed25519');
  const signing = generateKeyPairSync('ed25519');
  const now = new Date().toISOString();
  const suffix = createHash('sha256')
    .update(root.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .slice(0, 16);
  const material: LocalAuthorityMaterialFileV1 = {
    version: localAuthorityFileVersion,
    rootKeyId: `local-root-${suffix}`,
    authorityId: `local-authority-${suffix}`,
    signingKeyId: `local-signing-${suffix}`,
    rootPrivateKeyPem: root.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    signingPrivateKeyPem: signing.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    createdAt: now,
  };
  writePrivateJson(filePath, material);
  return material;
}

function validateMaterialFile(input: unknown, source: string): LocalAuthorityMaterialFileV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) unavailable(`本机 Agent Authority 文件无效：${source}`);
  const value = input as Record<string, unknown>;
  const expected = ['version', 'rootKeyId', 'authorityId', 'signingKeyId', 'rootPrivateKeyPem', 'signingPrivateKeyPem', 'createdAt'];
  if (Object.keys(value).length !== expected.length || expected.some((key) => typeof value[key] !== 'string' || !String(value[key]).trim())) {
    unavailable(`本机 Agent Authority 文件字段无效：${source}`);
  }
  if (value.version !== localAuthorityFileVersion
    || !isIdentifier(value.rootKeyId)
    || !isIdentifier(value.authorityId)
    || !isIdentifier(value.signingKeyId)
    || Number.isNaN(Date.parse(value.createdAt as string))) {
    unavailable(`本机 Agent Authority 文件内容无效：${source}`);
  }
  try {
    if (createPrivateKey(value.rootPrivateKeyPem as string).asymmetricKeyType !== 'ed25519'
      || createPrivateKey(value.signingPrivateKeyPem as string).asymmetricKeyType !== 'ed25519') {
      unavailable('本机 Agent Authority 必须使用 Ed25519 私钥');
    }
  } catch {
    unavailable('本机 Agent Authority 私钥无法解析');
  }
  return value as unknown as LocalAuthorityMaterialFileV1;
}

function createTrustRoot(material: LocalAuthorityMaterialFileV1, publicKey: KeyObject): PolicyAuthorityTrustRootV1 {
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const fingerprintSha256 = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
  return {
    rootKeyId: material.rootKeyId,
    authorityId: material.authorityId,
    algorithm: 'Ed25519',
    publicKeyPem,
    fingerprintSha256,
  };
}

function createKeySet(material: LocalAuthorityMaterialFileV1, publicKey: KeyObject): PolicyAuthorityKeySetV1 {
  const issuedAt = material.createdAt;
  const notAfter = new Date(Date.parse(issuedAt) + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();
  return {
    keySetVersion: agentSecurityContractVersion,
    authorityId: material.authorityId,
    activeKeyId: material.signingKeyId,
    keys: [{
      keyId: material.signingKeyId,
      algorithm: 'Ed25519',
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'ACTIVE',
      notBefore: issuedAt,
      notAfter,
    }],
    issuedAt,
  };
}

function signKeySet(
  trustRoot: PolicyAuthorityTrustRootV1,
  keySet: PolicyAuthorityKeySetV1,
  rootPrivateKey: KeyObject,
): SignedPolicyAuthorityKeySetV1 {
  const unsigned = {
    envelopeVersion: agentSecurityContractVersion,
    rootKeyId: trustRoot.rootKeyId,
    authorityId: trustRoot.authorityId,
    keySet,
  } as const;
  return { ...unsigned, signature: signPolicyPayload(unsigned, rootPrivateKey) };
}

function signBootstrap(
  trustRoot: PolicyAuthorityTrustRootV1,
  rootPrivateKey: KeyObject,
  issuedAt: string,
) {
  const unsigned = {
    bootstrapVersion: policyAuthorityBootstrapVersion,
    bootstrapId: `bootstrap-${trustRoot.authorityId}`,
    authorityId: trustRoot.authorityId,
    rootKeyId: trustRoot.rootKeyId,
    rootFingerprintSha256: trustRoot.fingerprintSha256,
    issuedAt,
    validUntil: new Date(Date.parse(issuedAt) + 10 * 365 * 24 * 60 * 60 * 1000).toISOString(),
  } as const;
  return { ...unsigned, signature: signPolicyPayload(unsigned, rootPrivateKey) };
}

function ensureAuthorityState(statePath: string): FilePolicyAuthorityStateStoreV1 {
  if (!existsSync(statePath)) {
    writePrivateJson(statePath, {
      stateVersion: policyAuthorityStateVersion,
      revokedTokenIds: [],
      revokedDecisionIds: [],
      revokedKeyIds: [],
      nonces: [],
    });
  }
  return new FilePolicyAuthorityStateStoreV1(statePath);
}

function evaluateDiscoveryRequest(input: PolicyAuthorityEvaluationInputV1): PolicyAuthorityEvaluationV1 {
  const allowed = input.policyRef === discoveryPolicyRef
    && input.policyVersion === discoveryPolicyVersion
    && input.capability === discoveryCapability
    && sameSet(input.actions, discoveryActions)
    && input.allowedServices.length === 0
    && input.artifactDigests.length === 0
    && isAllowedWebDiscoveryPathSet(input.allowedPaths);
  return {
    allowed,
    actions: [...input.actions],
    allowedPaths: [...input.allowedPaths],
    allowedServices: [...input.allowedServices],
    artifactDigests: [...input.artifactDigests],
    policyRef: input.policyRef,
    policyVersion: input.policyVersion,
    ...(allowed ? {} : { reason: '本机 Authority 只允许 Agent Core 的 Web 发现只读范围' }),
  };
}

function evaluateRequest(
  input: PolicyAuthorityEvaluationInputV1,
  executionPolicy: LocalExecutionPolicyFileV1 | undefined,
): PolicyAuthorityEvaluationV1 {
  const discovery = evaluateDiscoveryRequest(input);
  if (discovery.allowed) return discovery;
  const binding = executionPolicy?.bindings.find((candidate) => candidate.tenantId === input.tenantId
    && candidate.agentId === input.agentId
    && candidate.pluginId === input.pluginId
    && candidate.pluginVersionId === input.pluginVersionId
    && candidate.capability === input.capability
    && candidate.policyRef === input.policyRef
    && candidate.policyVersion === input.policyVersion);
  const allowed = binding !== undefined
    && isSubset(input.actions, binding.actions)
    && input.allowedPaths.every((path) => isPathWithin(path, binding.allowedPaths))
    && isSubset(input.allowedServices, binding.allowedServices)
    && isSubset(input.artifactDigests, binding.artifactDigests);
  return {
    allowed,
    actions: [...input.actions],
    allowedPaths: [...input.allowedPaths],
    allowedServices: [...input.allowedServices],
    artifactDigests: [...input.artifactDigests],
    policyRef: input.policyRef,
    policyVersion: input.policyVersion,
    ...(allowed ? {} : { reason: '本机执行策略未精确匹配当前租户、Agent、插件版本或请求范围' }),
  };
}

function createAgentTrustMaterial(
  agentId: string,
  tenantId: string,
  osType: string | undefined,
  authorityMaterial: LocalAuthorityMaterialFileV1,
  signingKeyId: string,
  signingPrivateKey: KeyObject,
  rootPrivateKey: KeyObject,
  trustRoot: PolicyAuthorityTrustRootV1,
  keySet: PolicyAuthorityKeySetV1,
  executionPolicy: LocalExecutionPolicyFileV1 | undefined,
): AgentTrustMaterialV1 {
  const policy = createContextLocalPolicy(agentId, tenantId, signingKeyId, executionPolicy, osType);
  const keyMap = Object.fromEntries(keySet.keys.map((key) => [key.keyId, rawEd25519PublicKey(key.publicKeyPem)]));
  const issuedAt = new Date().toISOString();
  const compatibility = WINDOWS_OS_TYPES.has(osType?.toLowerCase().split(/[-_]/u)[0] ?? '');
  const policyAuthorityKeySet = signKeySet(trustRoot, keySet, rootPrivateKey);
  const localPolicyTrustRoot = trustRoot;
  const localPolicyUnsigned = {
    bundleVersion: 'gcac.agent-local-policy/v1' as const,
    rootKeyId: trustRoot.rootKeyId,
    policies: [{ tenantId, policy }],
  };
  const localPolicyBundle = {
    ...localPolicyUnsigned,
    signature: signPolicyPayload(localPolicyUnsigned, rootPrivateKey),
  };
  return {
    materialVersion: agentTrustMaterialVersion,
    issuedAt,
    validUntil: new Date(Date.parse(issuedAt) + 365 * 24 * 60 * 60 * 1000).toISOString(),
    capabilityKeySet: keyMap,
    policyAuthorityKeySet: keyMap,
    localPolicy: policy,
    localPolicyAuthorityKeyId: signingKeyId,
    localPolicySignature: signPolicyPayload(policy, signingPrivateKey),
    ...(compatibility ? {
      policyAuthorityTrustRoot: trustRoot,
      compatibilityPolicyAuthorityKeySet: policyAuthorityKeySet,
      localPolicyTrustRoot,
      compatibilityLocalPolicyBundle: localPolicyBundle,
      revokedTokenIds: [],
      revokedDecisionIds: [],
      revokedKeyIds: [],
    } : {}),
  };
}

function createLocalPolicy(agentId: string, signingKeyId: string, allowedPaths: readonly string[]): AgentLocalPolicyV1 {
  return {
    policyVersion: agentSecurityContractVersion,
    agentId,
    authorityKeyIds: [signingKeyId],
    allowedActions: [...discoveryActions],
    pathRules: allowedPaths.map((prefix) => ({ prefix, operations: ['filesystem.read'] })),
    serviceRules: [],
    commandRules: [],
    disabled: false,
    updatedAt: new Date().toISOString(),
  };
}

function createContextLocalPolicy(
  agentId: string,
  tenantId: string,
  signingKeyId: string,
  executionPolicy: LocalExecutionPolicyFileV1 | undefined,
  osType?: string,
): AgentLocalPolicyV1 {
  const bindings = executionPolicy?.bindings.filter((binding) => binding.tenantId === tenantId && binding.agentId === agentId) ?? [];
  if (bindings.length === 0) {
    const discoveryPaths = osType?.toLowerCase().includes('windows') ? WINDOWS_WEB_DISCOVERY_PATHS : LINUX_WEB_DISCOVERY_PATHS;
    return createLocalPolicy(agentId, signingKeyId, discoveryPaths);
  }
  const actions = [...new Set([...discoveryActions, ...bindings.flatMap((binding) => binding.actions)])];
  const paths = [...new Set(bindings.flatMap((binding) => binding.allowedPaths))];
  const pathOperations = [...new Set(bindings.flatMap((binding) => binding.actions))];
  const commandRules = bindings.flatMap((binding) => binding.commandRules);
  return validateAgentLocalPolicy({
    policyVersion: agentSecurityContractVersion,
    agentId,
    authorityKeyIds: [signingKeyId],
    allowedActions: actions,
    pathRules: paths.map((prefix) => ({ prefix, operations: pathOperations })),
    serviceRules: [...new Set(bindings.flatMap((binding) => binding.allowedServices))],
    commandRules,
    disabled: false,
    updatedAt: new Date().toISOString(),
  });
}

function loadExecutionPolicy(directory: string): LocalExecutionPolicyFileV1 | undefined {
  const filePath = resolve(directory, executionPolicyFileName);
  if (!existsSync(filePath)) return undefined;
  const value = readJson(filePath);
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable('本机执行策略文件必须是对象');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['version', 'bindings'].includes(key))
    || record.version !== executionPolicyFileVersion
    || !Array.isArray(record.bindings)
    || record.bindings.length === 0
    || record.bindings.length > 100) {
    unavailable(`本机执行策略文件无效：${filePath}`);
  }
  const bindings = record.bindings.map((item, index) => parseExecutionBinding(item, `bindings.${index}`));
  const identities = bindings.map((binding) => `${binding.tenantId}:${binding.agentId}:${binding.pluginVersionId}:${binding.capability}`);
  if (new Set(identities).size !== identities.length) unavailable('本机执行策略包含重复绑定');
  return { version: executionPolicyFileVersion, bindings };
}

function parseExecutionBinding(value: unknown, path: string): LocalExecutionBindingV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable(`${path} 必须是对象`);
  const record = value as Record<string, unknown>;
  const required = ['tenantId', 'agentId', 'pluginId', 'pluginVersionId', 'capability', 'policyRef', 'policyVersion', 'actions', 'allowedPaths', 'allowedServices', 'artifactDigests', 'commandRules'];
  if (Object.keys(record).some((key) => !required.includes(key))
    || required.some((key) => record[key] === undefined)) unavailable(`${path} 字段不完整`);
  const strings = (key: string): string[] => {
    const candidate = record[key];
    if (!Array.isArray(candidate) || candidate.some((item) => typeof item !== 'string' || !item.trim())) unavailable(`${path}.${key} 必须是非空字符串数组`);
    return [...new Set(candidate as string[])];
  };
  const text = (key: string): string => {
    const candidate = record[key];
    if (typeof candidate !== 'string' || !candidate.trim()) unavailable(`${path}.${key} 无效`);
    return candidate;
  };
  const binding: LocalExecutionBindingV1 = {
    tenantId: text('tenantId'),
    agentId: text('agentId'),
    pluginId: text('pluginId'),
    pluginVersionId: text('pluginVersionId'),
    capability: text('capability'),
    policyRef: text('policyRef'),
    policyVersion: text('policyVersion'),
    actions: strings('actions'),
    allowedPaths: strings('allowedPaths'),
    allowedServices: strings('allowedServices'),
    artifactDigests: strings('artifactDigests'),
    commandRules: Array.isArray(record.commandRules) ? record.commandRules as AgentLocalPolicyV1['commandRules'] : [],
  };
  // 通过统一本地策略合同校验路径、动作、命令和摘要格式，拒绝拼接式旁路配置。
  const validatedPolicy = validateAgentLocalPolicy({
    policyVersion: agentSecurityContractVersion,
    agentId: binding.agentId,
    authorityKeyIds: ['local-execution-policy-key'],
    allowedActions: binding.actions,
    pathRules: binding.allowedPaths.map((prefix) => ({ prefix, operations: binding.actions })),
    serviceRules: binding.allowedServices,
    commandRules: binding.commandRules,
    disabled: false,
    updatedAt: new Date().toISOString(),
  });
  return {
    ...binding,
    allowedPaths: validatedPolicy.pathRules.map((rule) => rule.prefix),
    commandRules: validatedPolicy.commandRules,
  };
}

function isSubset(values: readonly string[], allowed: readonly string[]): boolean {
  return values.every((value) => allowed.includes(value));
}

function isPathWithin(value: string, prefixes: readonly string[]): boolean {
  const normalized = value.replaceAll('/', '\\').toLowerCase().replace(/[\\]+$/u, '');
  return prefixes.some((prefix) => {
    const root = prefix.replaceAll('/', '\\').toLowerCase().replace(/[\\]+$/u, '');
    return normalized === root || normalized.startsWith(`${root}\\`);
  });
}

function rawEd25519PublicKey(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  const key = der.subarray(-32);
  if (key.length !== 32) unavailable('本机 Authority Ed25519 公钥长度无效');
  return key.toString('base64');
}

function writePrivateJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp-${process.pid}`;
  let handle: number | undefined;
  try {
    handle = openSync(temporary, 'wx', 0o600);
    writeFileSync(handle, `${JSON.stringify(value)}\n`, 'utf8');
    closeSync(handle);
    handle = undefined;
    renameSync(temporary, filePath);
    chmodSync(filePath, 0o600);
  } catch (error) {
    if (handle !== undefined) closeSync(handle);
    throw error;
  }
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return unavailable(`本机 Agent Authority 文件无法读取：${filePath}`);
  }
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value) && !/(?:^|[-_.:])(?:default|development|dev|test|fixture)(?:[-_.:]|$)/i.test(value);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function unavailable(message: string): never {
  throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', `本机 Agent Authority 已失败关闭：${message}`, { fallback: false });
}

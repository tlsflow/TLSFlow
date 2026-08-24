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
const discoveryPolicyRef = 'gcac.agent.discovery';
const discoveryPolicyVersion = '1';
const discoveryCapability = 'application.discover';
const discoveryActions = Object.freeze(['filesystem.read', 'process.list', 'service.list']);

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
  const state = ensureAuthorityState(resolve(directory, 'state.json'));
  const authority = new PolicyAuthorityServiceV1({
    trustRoot,
    keySet: keySetEnvelope,
    bootstrap,
    signingKeySource: {
      getPrivateKey: (keyId) => keyId === material.signingKeyId ? signingPrivateKey : undefined,
    },
    evaluator: {
      evaluate: (input) => evaluateDiscoveryRequest(input),
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
    resolve: async ({ agentId }) => createLocalPolicy(agentId, material.signingKeyId, LINUX_WEB_DISCOVERY_PATHS),
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
      osType?.toLowerCase().includes('windows') ? WINDOWS_WEB_DISCOVERY_PATHS : LINUX_WEB_DISCOVERY_PATHS,
    ),
    getTrustedKeySet: () => Object.fromEntries(keySet.keys.map((key) => [key.keyId, rawEd25519PublicKey(key.publicKeyPem)])),
  };
  return Object.freeze({
    authorization: {
      policyAuthority,
      grants: {
        // 手动发现不编译写 Plan；该端口保留失败关闭，防止本机 Authority 被错误复用。
        validate: async () => {
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
  allowedPaths: readonly string[],
): AgentTrustMaterialV1 {
  const policy = createLocalPolicy(agentId, signingKeyId, allowedPaths);
  const keyMap = Object.fromEntries(keySet.keys.map((key) => [key.keyId, rawEd25519PublicKey(key.publicKeyPem)]));
  const issuedAt = new Date().toISOString();
  const compatibility = osType?.toLowerCase().includes('windows') === true;
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

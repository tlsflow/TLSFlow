import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  scryptSync,
  type KeyObject,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import { signPolicyPayload } from '../modules/agents/security/agent-security.contract.js';
import {
  policyAuthorityBootstrapVersion,
  policyAuthorityPolicyBundleVersion,
  policyAuthorityStateVersion,
} from '../modules/agents/security/policy-authority.service.js';

const runtimeSecretsVersion = 'gcac.production-runtime-secrets/v1' as const;
const securityContractVersion = 'gcac.agent-security/v1' as const;
const defaultRuntimeSecretsFile = '/app/data/runtime/runtime-secrets.enc';
const defaultPolicyAuthorityStateFile = '/app/data/runtime/policy-authority-state.json';
const defaultPolicyAuthoritySigningKeysFile = '/app/data/runtime/policy-authority-signing-keys.json';
const fixedPluginRunnerEnvironment = {
  GCAC_PLUGIN_RUNNER_EXECUTOR_MODULE_PATH: '/app/dist/modules/plugins/runner/runner-server.js',
  GCAC_PLUGIN_RUNNER_VERSION: 'gcac-plugin-runner-v1',
  GCAC_PLUGIN_SDK_VERSION: 'gcac-plugin-sdk-v1',
} as const;

const generatedEnvironmentKeys = [
  'GCAC_POLICY_AUTHORITY_ROOT_KEY_ID',
  'GCAC_POLICY_AUTHORITY_ID',
  'GCAC_POLICY_AUTHORITY_ROOT_PUBLIC_KEY_PEM',
  'GCAC_POLICY_AUTHORITY_ROOT_FINGERPRINT_SHA256',
  'GCAC_POLICY_AUTHORITY_BOOTSTRAP_JSON',
  'GCAC_POLICY_AUTHORITY_KEYSET_JSON',
  'GCAC_POLICY_AUTHORITY_SIGNING_KEYS_JSON',
  'GCAC_POLICY_AUTHORITY_POLICY_BUNDLE_JSON',
  'GCAC_AGENT_LOCAL_POLICY_ROOT_KEY_ID',
  'GCAC_AGENT_LOCAL_POLICY_ROOT_PUBLIC_KEY_PEM',
  'GCAC_AGENT_LOCAL_POLICY_ROOT_FINGERPRINT_SHA256',
  'GCAC_AGENT_LOCAL_POLICY_BUNDLE_JSON',
] as const;

type GeneratedEnvironmentKey = typeof generatedEnvironmentKeys[number];
type RuntimeEnvironment = Record<GeneratedEnvironmentKey, string>;

interface EncryptedRuntimeSecretsV1 {
  version: typeof runtimeSecretsVersion;
  algorithm: 'aes-256-gcm';
  kdf: 'scrypt';
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface RuntimeSecretsPayloadV1 {
  version: typeof runtimeSecretsVersion;
  environment: RuntimeEnvironment;
}

/**
 * 生产容器首启时生成策略信任材料，并用 GCAC_SECRET_KEK 加密持久化。
 * 镜像只包含生成逻辑，不包含任何实例级根密钥、签名私钥或策略包。
 */
export function ensureProductionRuntimeSecurityEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.NODE_ENV !== 'production') return;

  for (const [name, value] of Object.entries(fixedPluginRunnerEnvironment)) {
    if (!environment[name]?.trim()) environment[name] = value;
  }

  const secretsFile = resolveSecretsFile(environment);
  const signingKeysFile = resolveSigningKeysFile(environment, secretsFile);
  environment.GCAC_POLICY_AUTHORITY_SIGNING_KEYS_FILE = signingKeysFile;
  const encryptionSecret = requiredEncryptionSecret(environment);
  const configured = readConfiguredEnvironment(environment);
  const generated = existsSync(secretsFile)
    ? decryptRuntimeSecrets(secretsFile, encryptionSecret)
    : configured ?? generateRuntimeEnvironment();

  for (const key of generatedEnvironmentKeys) {
    const current = environment[key]?.trim();
    if (current && current !== generated[key]) {
      throw new Error(`生产运行时安全材料与持久化文件不一致：${key}`);
    }
    environment[key] = generated[key];
  }

  environment.GCAC_POLICY_AUTHORITY_STATE_FILE = environment.GCAC_POLICY_AUTHORITY_STATE_FILE?.trim()
    || defaultPolicyAuthorityStateFile;
  ensurePolicyAuthorityState(environment.GCAC_POLICY_AUTHORITY_STATE_FILE);

  let signingKeys: unknown;
  try {
    signingKeys = JSON.parse(generated.GCAC_POLICY_AUTHORITY_SIGNING_KEYS_JSON);
  } catch {
    throw new Error('生产 Policy Authority 签名密钥材料不是有效 JSON');
  }
  writePrivateJson(signingKeysFile, signingKeys);
  // 私钥只落在独立文件中，宿主进程环境不保留 JSON 副本。
  delete environment.GCAC_POLICY_AUTHORITY_SIGNING_KEYS_JSON;

  if (!existsSync(secretsFile)) {
    encryptRuntimeSecrets(secretsFile, encryptionSecret, generated);
    process.stdout.write(`已生成并加密保存生产运行时安全材料：${secretsFile}\n`);
  }
}

function resolveSecretsFile(environment: NodeJS.ProcessEnv): string {
  const configured = environment.GCAC_RUNTIME_SECRETS_FILE?.trim();
  return configured ? resolve(configured) : defaultRuntimeSecretsFile;
}

function resolveSigningKeysFile(environment: NodeJS.ProcessEnv, secretsFile: string): string {
  const configured = environment.GCAC_POLICY_AUTHORITY_SIGNING_KEYS_FILE?.trim();
  return configured ? resolve(configured) : (secretsFile === defaultRuntimeSecretsFile
    ? defaultPolicyAuthoritySigningKeysFile
    : resolve(dirname(secretsFile), 'policy-authority-signing-keys.json'));
}

function requiredEncryptionSecret(environment: NodeJS.ProcessEnv): string {
  const value = environment.GCAC_SECRET_KEK?.trim();
  if (!value || value === 'CHANGE_ME') {
    throw new Error('生产首启安全材料需要有效的 GCAC_SECRET_KEK；禁止使用 CHANGE_ME');
  }
  return value;
}

function readConfiguredEnvironment(environment: NodeJS.ProcessEnv): RuntimeEnvironment | undefined {
  const publicAndBundleKeys = generatedEnvironmentKeys.filter((key) => key !== 'GCAC_POLICY_AUTHORITY_SIGNING_KEYS_JSON');
  const present = publicAndBundleKeys.filter((key) => Boolean(environment[key]?.trim()));
  if (present.length === 0) return undefined;
  if (present.length !== publicAndBundleKeys.length) {
    const missing = publicAndBundleKeys.filter((key) => !environment[key]?.trim());
    throw new Error(`生产安全材料配置不完整，缺少：${missing.join(', ')}`);
  }
  const signingKeysJson = environment.GCAC_POLICY_AUTHORITY_SIGNING_KEYS_JSON?.trim()
    || readSigningKeysFile(environment.GCAC_POLICY_AUTHORITY_SIGNING_KEYS_FILE!);
  return {
    ...Object.fromEntries(publicAndBundleKeys.map((key) => [key, environment[key]!])),
    GCAC_POLICY_AUTHORITY_SIGNING_KEYS_JSON: signingKeysJson,
  } as RuntimeEnvironment;
}

function readSigningKeysFile(filePath: string): string {
  try {
    return readFileSync(resolve(filePath), 'utf8');
  } catch {
    throw new Error(`生产 Policy Authority 签名密钥文件无法读取：${filePath}`);
  }
}

function generateRuntimeEnvironment(): RuntimeEnvironment {
  const issuedAt = new Date().toISOString();
  const validUntil = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const suffix = randomBytes(12).toString('hex');
  const authorityRoot = generateKeyPairSync('ed25519');
  const authoritySigning = generateKeyPairSync('ed25519');
  const agentLocalRoot = generateKeyPairSync('ed25519');
  const authorityRootKeyId = `gcac-root-${suffix}`;
  const authorityId = `gcac-authority-${suffix}`;
  const authoritySigningKeyId = `gcac-signing-${suffix}`;
  const agentLocalRootKeyId = `gcac-agent-root-${suffix}`;

  const authorityRootPublicKeyPem = publicKeyPem(authorityRoot.publicKey);
  const authoritySigningPublicKeyPem = publicKeyPem(authoritySigning.publicKey);
  const authorityRootFingerprint = publicKeyFingerprint(authorityRoot.publicKey);
  const agentLocalRootPublicKeyPem = publicKeyPem(agentLocalRoot.publicKey);
  const agentLocalRootFingerprint = publicKeyFingerprint(agentLocalRoot.publicKey);
  const keySet = {
    keySetVersion: securityContractVersion,
    authorityId,
    activeKeyId: authoritySigningKeyId,
    keys: [{
      keyId: authoritySigningKeyId,
      algorithm: 'Ed25519',
      publicKeyPem: authoritySigningPublicKeyPem,
      status: 'ACTIVE',
      notBefore: issuedAt,
      notAfter: validUntil,
    }],
    issuedAt,
  } as const;
  const keySetEnvelope = {
    envelopeVersion: securityContractVersion,
    rootKeyId: authorityRootKeyId,
    authorityId,
    keySet,
  } as const;
  const bootstrapUnsigned = {
    bootstrapVersion: policyAuthorityBootstrapVersion,
    bootstrapId: `bootstrap-${authorityId}`,
    authorityId,
    rootKeyId: authorityRootKeyId,
    rootFingerprintSha256: authorityRootFingerprint,
    issuedAt,
    validUntil,
  } as const;
  const policyBundleUnsigned = {
    bundleVersion: policyAuthorityPolicyBundleVersion,
    authorityId,
    issuedAt,
    // 首启没有任何 Agent 绑定，空策略保持失败关闭，后续由受控策略流程补充。
    rules: [],
  } as const;
  const placeholderTenantId = `bootstrap-tenant-${suffix}`;
  const placeholderAgentId = `bootstrap-agent-${suffix}`;
  const localPolicyBundleUnsigned = {
    bundleVersion: 'gcac.agent-local-policy/v1' as const,
    rootKeyId: agentLocalRootKeyId,
    policies: [{
      tenantId: placeholderTenantId,
      policy: {
        policyVersion: securityContractVersion,
        agentId: placeholderAgentId,
        authorityKeyIds: [authoritySigningKeyId],
        allowedActions: [],
        pathRules: [],
        serviceRules: [],
        commandRules: [],
        disabled: true,
        updatedAt: issuedAt,
      },
    }],
  } as const;

  return {
    GCAC_POLICY_AUTHORITY_ROOT_KEY_ID: authorityRootKeyId,
    GCAC_POLICY_AUTHORITY_ID: authorityId,
    GCAC_POLICY_AUTHORITY_ROOT_PUBLIC_KEY_PEM: authorityRootPublicKeyPem,
    GCAC_POLICY_AUTHORITY_ROOT_FINGERPRINT_SHA256: authorityRootFingerprint,
    GCAC_POLICY_AUTHORITY_BOOTSTRAP_JSON: JSON.stringify({
      ...bootstrapUnsigned,
      signature: signPolicyPayload(bootstrapUnsigned, authorityRoot.privateKey),
    }),
    GCAC_POLICY_AUTHORITY_KEYSET_JSON: JSON.stringify({
      ...keySetEnvelope,
      signature: signPolicyPayload(keySetEnvelope, authorityRoot.privateKey),
    }),
    GCAC_POLICY_AUTHORITY_SIGNING_KEYS_JSON: JSON.stringify({
      [authoritySigningKeyId]: privateKeyPem(authoritySigning.privateKey),
    }),
    GCAC_POLICY_AUTHORITY_POLICY_BUNDLE_JSON: JSON.stringify({
      ...policyBundleUnsigned,
      signature: signPolicyPayload(policyBundleUnsigned, authorityRoot.privateKey),
    }),
    GCAC_AGENT_LOCAL_POLICY_ROOT_KEY_ID: agentLocalRootKeyId,
    GCAC_AGENT_LOCAL_POLICY_ROOT_PUBLIC_KEY_PEM: agentLocalRootPublicKeyPem,
    GCAC_AGENT_LOCAL_POLICY_ROOT_FINGERPRINT_SHA256: agentLocalRootFingerprint,
    GCAC_AGENT_LOCAL_POLICY_BUNDLE_JSON: JSON.stringify({
      ...localPolicyBundleUnsigned,
      signature: signPolicyPayload(localPolicyBundleUnsigned, agentLocalRoot.privateKey),
    }),
  };
}

function encryptRuntimeSecrets(filePath: string, encryptionSecret: string, environment: RuntimeEnvironment): void {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(encryptionSecret, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify({ version: runtimeSecretsVersion, environment } satisfies RuntimeSecretsPayloadV1), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: EncryptedRuntimeSecretsV1 = {
    version: runtimeSecretsVersion,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
  writePrivateJson(filePath, envelope);
}

function decryptRuntimeSecrets(filePath: string, encryptionSecret: string): RuntimeEnvironment {
  let envelope: EncryptedRuntimeSecretsV1;
  try {
    envelope = JSON.parse(readFileSync(filePath, 'utf8')) as EncryptedRuntimeSecretsV1;
    if (envelope.version !== runtimeSecretsVersion
      || envelope.algorithm !== 'aes-256-gcm'
      || envelope.kdf !== 'scrypt') throw new Error('版本或算法不匹配');
    const salt = Buffer.from(envelope.salt, 'base64url');
    const iv = Buffer.from(envelope.iv, 'base64url');
    const authTag = Buffer.from(envelope.authTag, 'base64url');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(encryptionSecret, salt), iv);
    decipher.setAuthTag(authTag);
    const payload = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as RuntimeSecretsPayloadV1;
    if (payload.version !== runtimeSecretsVersion) throw new Error('载荷版本不匹配');
    const configured = readConfiguredEnvironment(payload.environment);
    if (!configured) throw new Error('载荷不包含完整安全材料');
    return configured;
  } catch (error) {
    throw new Error(`生产运行时安全材料无法解密：${error instanceof Error ? error.message : String(error)}`);
  }
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function ensurePolicyAuthorityState(filePath: string): void {
  if (existsSync(filePath)) return;
  writePrivateJson(filePath, {
    stateVersion: policyAuthorityStateVersion,
    revokedTokenIds: [],
    revokedDecisionIds: [],
    revokedKeyIds: [],
    nonces: [],
  });
}

function publicKeyPem(key: KeyObject): string {
  return key.export({ type: 'spki', format: 'pem' }).toString();
}

function privateKeyPem(key: KeyObject): string {
  return key.export({ type: 'pkcs8', format: 'pem' }).toString();
}

function publicKeyFingerprint(key: KeyObject): string {
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}

function writePrivateJson(filePath: string, value: unknown): void {
  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, filePath);
  chmodSync(filePath, 0o600);
}

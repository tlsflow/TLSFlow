import { AppError } from '../../../common/errors/app-error.js';
import { sha256Digest } from '../../agents/security/agent-security.contract.js';
import type { CertificateLocationV1 } from '../dto/certificate-location.dto.js';
import type { ResolvedDeploymentInputV1, RuntimeCredentialV1 } from '../dto/resolved-deployment-input.dto.js';
import type { CertificateUpdateInputContractV1 } from './certificate-update.contract.js';
import { certificateUpdateProfile } from './certificate-update.contract.js';

export interface CertificateUpdateSnapshotOptions {
  pluginVersionId?: string;
  resourceHash?: string;
}

export interface CertificateUpdateResolvedSnapshotV1 {
  apiVersion: 'gcac.certificate-update-snapshot/v1';
  pluginId: string;
  pluginVersionId?: string;
  resourceHash?: string;
  frameworkType: string;
  platform: 'linux' | 'windows';
  artifactKind: 'PEM_FILES' | 'KEYSTORE' | 'WINDOWS_CERTIFICATE_STORE';
  targetId: string;
  siteId: string;
  siteName: string;
  bindingInformation: string;
  bindingKey: string;
  storeName?: string;
  storeLocation?: string;
  storeThumbprint?: string;
  paths: string[];
  sourceConfigPath: string;
  /** Windows Nginx 可能由 nginx.exe 直接运行，不一定注册为 SCM 服务。 */
  serviceName?: string;
  programPath: string;
  programSha256: string;
  workingDirectory: string;
  configCheckArgs: string[];
  configCheckArgsTemplate: string[];
  configFingerprint: string;
  observedAt: string;
  artifactDigest: string;
  expectedFingerprintSha256?: string;
  previousFingerprintSha256?: string;
  secretRefs: string[];
  provenance: ResolvedDeploymentInputV1['provenance'];
  keystoreType?: 'JKS' | 'PKCS12';
  keyAlias?: string;
  resolvedInputSha256: string;
}

const absoluteWindowsPath = /^(?:[A-Za-z]:[\\/]|\\\\)/;
const digestPattern = /^[a-f0-9]{64}$/;

/**
 * 证书插件唯一的输入门禁。它只读取已解析快照，不接触磁盘、配置文件或网络。
 */
export function resolveCertificateUpdateSnapshot(
  resolved: ResolvedDeploymentInputV1,
  contract: CertificateUpdateInputContractV1,
  options: CertificateUpdateSnapshotOptions = {},
): CertificateUpdateResolvedSnapshotV1 {
  const profile = certificateUpdateProfile(contract.pluginId);
  if (!profile || profile.frameworkType !== contract.frameworkType || profile.platform !== contract.platform || profile.artifactKind !== contract.artifactKind) {
    fail('CONTRACT', '插件合同与固定平台/框架 Profile 不一致');
  }
  if (resolved.apiVersion !== 'gcac.resolved-deployment-input/v1' || !resolved.executable || resolved.issues.some((issue) => issue.severity === 'ERROR')) {
    fail('INPUT', '统一部署输入不可执行或包含错误');
  }
  rawDigest(resolved.resolvedSha256, 'resolvedInputSha256');
  const context = resolved.assetContext;
  const host = context.host;
  const site = context.site;
  const target = context.target;
  const location = target?.certificateLocation;
  const isIisCertificateStore = contract.artifactKind === 'WINDOWS_CERTIFICATE_STORE';
  if (!host?.osType || normalizePlatform(host.osType) !== contract.platform) fail('PLATFORM', '目标平台与插件不匹配或缺失');
  const frameworkType = exactFact(
    'frameworkType',
    target?.metadata.frameworkType,
    resolved.variables.frameworkType,
  );
  if (frameworkType !== contract.frameworkType) fail('FRAMEWORK', '目标框架与插件不匹配或缺失');
  if (!site?.id || !target?.id || !target.key) fail('TARGET', '站点、目标或 TLS 绑定事实缺失');
  // Target.bindingKey 是 ManagedTarget 持久化的规范稳定标识；历史 metadata
  // 中的 bindingKey/tls.binding 可能是旧版原生绑定值，不能拿两个不同语义的
  // 字段互相比较。只有在规范字段缺失时，才在同一 metadata 域内做一致性校验。
  const targetBindingKey = readString(target.bindingKey);
  const metadataBindingKey = targetBindingKey
    ? undefined
    : exactFact('tls.binding', target.metadata.bindingKey, target.metadata['tls.binding']);
  // 历史 ManagedTarget 可能没有持久化 bindingKey，但关联 SiteAsset 仍保存了真实绑定信息。
  // Target 绑定事实优先；只有 Target 侧完全缺失时才回退到 SiteAsset，避免不同标识格式被误判为冲突。
  const bindingKey = targetBindingKey ?? metadataBindingKey ?? exactFact('tls.binding', site?.bindingInformation);
  if (!bindingKey) fail('BINDING', 'tls.binding 事实缺失');
  const siteName = exactFact('site', site?.name, target?.metadata.siteName, resolved.variables.siteName);
  const bindingInformation = exactFact(
    'tls.binding',
    site?.bindingInformation,
    target?.metadata.bindingInformation,
    resolved.variables.bindingInformation,
    ...(isIisCertificateStore ? [] : [bindingKey]),
  );
  if (!siteName || !bindingInformation) fail('BINDING', 'IIS 站点名称或绑定信息事实缺失');
  if (isIisCertificateStore && !isIisBindingInformation(bindingInformation)) {
    fail('BINDING', 'IIS 必须使用 Windows Agent 发现的原生 bindingInformation，不能使用 ManagedTarget 稳定标识');
  }
  if (!location || location.confidence !== 'EXACT') fail('LOCATION', '证书位置缺失、不可信或 confidence=UNKNOWN');
  if (!location.observedAt || !Number.isFinite(Date.parse(location.observedAt))) fail('FINGERPRINT', '观察时间缺失或格式无效');
  const configFingerprint = rawDigest(location.configFingerprint, 'configFingerprint');
  if (location.storageKind !== contract.artifactKind) fail('LOCATION', '证书材料类型与插件合同不匹配');
  assertOptionalDigestFact(resolved.variables.configFingerprint, configFingerprint, 'configFingerprint');
  assertOptionalDigestFact(target.metadata.configFingerprint, configFingerprint, 'configFingerprint');
  const sourceConfigPath = requiredPath(location.sourceConfigPath, 'sourceConfigPath');
  const serviceName = isIisCertificateStore
    ? (readString(location.serviceName) ?? 'W3SVC')
    : !contract.requiredFacts.includes('serviceName')
      ? optionalIdentifier(location.serviceName, 'serviceName')
      : requiredIdentifier(location.serviceName, 'serviceName');
  const programPath = isIisCertificateStore
    ? (readString(location.programPath) ?? 'C:/Windows/System32/inetsrv/appcmd.exe')
    : requiredPath(location.programPath, 'programPath');
  const metadata = target.metadata;
  assertOptionalPath(resolved.variables.certificatePath, location.certificatePath, 'leafPath', contract.platform);
  assertOptionalPath(resolved.variables.privateKeyPath, location.privateKeyPath, 'privateKeyPath', contract.platform);
  assertOptionalPath(resolved.variables.chainPath, location.chainPath, 'chainPath', contract.platform);
  assertOptionalPath(resolved.variables.keystorePath, location.keystorePath, 'keystorePath', contract.platform);
  assertOptionalPath(resolved.variables.configPath, location.sourceConfigPath, 'sourceConfigPath', contract.platform);
  if (serviceName) assertOptionalFact(resolved.variables.serviceName, serviceName, 'serviceName');
  assertOptionalPath(resolved.variables.programPath, programPath, 'programPath', contract.platform);
  const programSha256 = isIisCertificateStore
    ? rawDigest(readString(metadata.programSha256, location.programSha256, '0'.repeat(64)), 'programSha256')
    : rawDigest(readString(metadata.programSha256, location.programSha256, location.programPath && readString(metadata.programDigest)), 'programSha256');
  const workingDirectory = requiredPath(
    readString(metadata.workingDirectory, metadata.programWorkingDirectory, location.workingDirectory, isIisCertificateStore ? 'C:/Windows/System32/inetsrv' : undefined),
    'workingDirectory',
  );
  const configCheckArgs = isIisCertificateStore ? [] : stringArray(metadata.configCheckArgs ?? metadata.testArgs, 'configCheckArgs');
  const configCheckArgsTemplate = isIisCertificateStore ? [] : stringArray(metadata.configCheckArgsTemplate ?? configCheckArgs, 'configCheckArgsTemplate');
  if (configCheckArgs.length !== configCheckArgsTemplate.length) fail('PROGRAM', '配置检查参数模板长度不一致');
  if (!isIisCertificateStore) assertSafeProgramFacts(programPath, configCheckArgs, configCheckArgsTemplate);
  const paths = resolvePaths(location, contract.artifactKind, contract.platform);
  const keystoreType = contract.artifactKind === 'KEYSTORE' && (location.keystoreType === 'JKS' || location.keystoreType === 'PKCS12')
    ? location.keystoreType
    : undefined;
  const keyAlias = contract.artifactKind === 'KEYSTORE' ? location.keyAlias : undefined;
  if (contract.artifactKind === 'KEYSTORE' && (!keystoreType || !['JKS', 'PKCS12'].includes(keystoreType) || !keyAlias)) {
    fail('KEYSTORE', 'KeyStore 类型、Alias 或 SecretRef 缺失');
  }
  const artifactDigest = resolveArtifactDigest(resolved, contract.artifactKind, keystoreType);
  const expectedFingerprintSha256 = contract.artifactKind === 'WINDOWS_CERTIFICATE_STORE'
    ? rawDigest(readString(
      resolved.artifacts.certificateArtifact?.outputs?.fingerprintSha256,
      resolved.artifacts.certificateArtifact?.expectedFingerprintSha256,
      resolved.artifacts.certificateArtifact?.outputs?.expectedFingerprintSha256,
    ), 'expectedFingerprintSha256')
    : undefined;
  const previousFingerprintSha256 = isIisCertificateStore
    ? optionalDigest(
      readString(
        (target.metadata.listener as Record<string, unknown> | undefined)?.certificateFingerprintSha256,
        (target.metadata.currentCertificate as Record<string, unknown> | undefined)?.fingerprintSha256,
        (target.metadata.configuredCertificate as Record<string, unknown> | undefined)?.fingerprintSha256,
      ),
      'previousFingerprintSha256',
    )
    : undefined;
  const secretRefs = resolveSecretRefs(resolved.credentials, contract);
  if (contract.artifactKind === 'KEYSTORE' && secretRefs.length === 0) fail('KEYSTORE', 'KeyStore 类型、Alias 或 SecretRef 缺失');
  return {
    apiVersion: 'gcac.certificate-update-snapshot/v1',
    pluginId: contract.pluginId,
    ...(options.pluginVersionId ? { pluginVersionId: requiredIdentifier(options.pluginVersionId, 'pluginVersionId') } : {}),
    ...(options.resourceHash ? { resourceHash: prefixedDigest(options.resourceHash, 'resourceHash') } : {}),
    frameworkType,
    platform: contract.platform,
    artifactKind: contract.artifactKind,
    targetId: target.id,
    siteId: site.id,
    siteName,
    bindingInformation,
    bindingKey,
    ...(location.storeName ? { storeName: location.storeName } : {}),
    ...(location.storeLocation ? { storeLocation: location.storeLocation } : {}),
    ...(location.storeThumbprint ? { storeThumbprint: location.storeThumbprint } : {}),
    paths,
    sourceConfigPath,
    ...(serviceName ? { serviceName } : {}),
    programPath,
    programSha256,
    workingDirectory,
    configCheckArgs,
    configCheckArgsTemplate,
    configFingerprint,
    observedAt: location.observedAt,
    artifactDigest,
    ...(expectedFingerprintSha256 ? { expectedFingerprintSha256 } : {}),
    ...(previousFingerprintSha256 ? { previousFingerprintSha256 } : {}),
    secretRefs,
    provenance: structuredClone(resolved.provenance),
    ...(keystoreType ? { keystoreType } : {}),
    ...(keyAlias ? { keyAlias } : {}),
    resolvedInputSha256: resolved.resolvedSha256,
  };
}

export function assertCertificateUpdatePlanBinding(
  plan: { pluginId: string; capability: string; operations: Array<{ operationType: string; input: Record<string, unknown> }> },
  snapshot: CertificateUpdateResolvedSnapshotV1,
): void {
  if (plan.pluginId !== snapshot.pluginId) fail('PLAN', '计划插件身份与输入快照不一致');
  if (!['certificate.deploy', 'certificate.rollback', 'certificate.verify'].includes(plan.capability)) fail('PLAN', '证书计划能力不受支持');
  const paths = new Set(snapshot.paths.map((path) => normalizePath(path, snapshot.platform)));
  const planPaths = new Set<string>();
  let hasFingerprint = false;
  let hasArtifact = false;
  let hasService = false;
  let hasProgram = false;
  let hasProgramDigest = false;
  let hasWorkingDirectory = false;
  for (const operation of plan.operations) {
    const input = operation.input;
    if (typeof input.path === 'string') planPaths.add(normalizePath(input.path, snapshot.platform));
    if (input.configFingerprint === snapshot.configFingerprint || input.expectedConfigFingerprint === snapshot.configFingerprint) hasFingerprint = true;
    if (input.artifactDigest === snapshot.artifactDigest) hasArtifact = true;
    if (input.serviceName === snapshot.serviceName) hasService = true;
    if (operation.operationType === 'command.execute_allowlisted') {
      if (typeof input.executablePath === 'string' && normalizePath(input.executablePath, snapshot.platform) === normalizePath(snapshot.programPath, snapshot.platform)) {
        hasProgram = true;
      }
      if (typeof input.executableSha256 === 'string' && normalizeDigest(input.executableSha256) === snapshot.programSha256) {
        hasProgramDigest = true;
      }
      if (typeof input.workingDirectory === 'string' && normalizePath(input.workingDirectory, snapshot.platform) === normalizePath(snapshot.workingDirectory, snapshot.platform)) {
        hasWorkingDirectory = true;
      }
    }
    if (input.path && typeof input.path !== 'string') fail('PLAN', '原子计划路径必须是已解析的事实路径');
  }
  for (const path of planPaths) if (!paths.has(path)) fail('PLAN_PATH', '计划包含不在输入快照中的路径');
  const hasLedger = plan.operations.some((operation) => operation.input.ledgerRef === 'execution-recovery-ledger');
  const isIisCertificateStore = snapshot.artifactKind === 'WINDOWS_CERTIFICATE_STORE';
  if (isIisCertificateStore) {
    const hasIisUpdate = plan.operations.some((operation) => operation.operationType === 'certificate.iis.binding.update');
    const hasIisBinding = plan.operations.some((operation) => operation.operationType === 'certificate.iis.binding.verify');
    if (!hasIisUpdate && plan.capability !== 'certificate.verify') fail('PLAN_BINDING', 'IIS 变更计划缺少固定绑定更新原语');
    if (!hasIisBinding) fail('PLAN_BINDING', 'IIS 计划缺少固定绑定验证原语');
    return;
  }
  // 非 SCM Nginx 快照没有服务名；其他插件在快照解析阶段已强制要求服务事实。
  const serviceRequired = snapshot.serviceName !== undefined;
  if (!serviceRequired && plan.operations.some((operation) => operation.operationType.startsWith('service.'))) {
    fail('PLAN_BINDING', '无服务事实的计划不得包含 service 操作');
  }
  if (!planPaths.size || !hasFingerprint || !hasArtifact || (serviceRequired && !hasService)) {
    fail('PLAN_BINDING', serviceRequired
      ? '计划未绑定路径、配置指纹、Artifact 和服务事实'
      : '计划未绑定路径、配置指纹和 Artifact');
  }
  if (plan.capability !== 'certificate.verify' && (!hasProgram || !hasProgramDigest || !hasWorkingDirectory || !hasLedger)) {
    fail('PLAN_BINDING', '变更计划未绑定程序路径、程序摘要、工作目录或执行恢复账本');
  }
}

function resolvePaths(
  location: CertificateLocationV1,
  kind: CertificateUpdateInputContractV1['artifactKind'],
  platform: CertificateUpdateInputContractV1['platform'],
): string[] {
  if (kind === 'WINDOWS_CERTIFICATE_STORE') return [];
  if (kind === 'KEYSTORE') return uniquePaths([requiredPath(location.keystorePath, 'keystorePath')], platform);
  const paths = [requiredPath(location.certificatePath, 'leafPath'), requiredPath(location.privateKeyPath, 'privateKeyPath')];
  if (location.chainPath) paths.push(requiredPath(location.chainPath, 'chainPath'));
  return uniquePaths(paths, platform);
}

function uniquePaths(paths: string[], platform: 'linux' | 'windows'): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const normalized = normalizePath(path, platform);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function resolveArtifactDigest(
  resolved: ResolvedDeploymentInputV1,
  kind: CertificateUpdateInputContractV1['artifactKind'],
  keystoreType?: CertificateUpdateResolvedSnapshotV1['keystoreType'],
): string {
  const resourceName = resolved.assetContext.deployment.certificateResourceName;
  // 六个证书更新合同都把证书材料固定在 certificateArtifact 槽位；
  // certificateResourceName 是通用工作流的历史资源名，不能覆盖合同槽位。
  // 保留资源名回退以兼容旧版已密封的通用部署输入。
  const artifact = resolved.artifacts.certificateArtifact
    ?? (resourceName ? resolved.artifacts[resourceName] : undefined);
  if (!artifact) fail('ARTIFACT', '统一部署输入缺少证书 Artifact');
  if (!artifact.outputs || typeof artifact.outputs !== 'object' || Array.isArray(artifact.outputs)) fail('ARTIFACT', '证书 Artifact outputs 格式无效');
  const value = readString(artifact.artifactSha256, artifact.sha256, artifact.outputs.artifactSha256, artifact.outputs.sha256);
  const digest = rawDigest(value, 'artifactDigest');
  validateArtifactOutputs(artifact.outputs, kind, keystoreType);
  return digest;
}

function validateArtifactOutputs(
  outputs: Record<string, unknown>,
  kind: CertificateUpdateInputContractV1['artifactKind'],
  keystoreType?: CertificateUpdateResolvedSnapshotV1['keystoreType'],
): void {
  if (kind === 'WINDOWS_CERTIFICATE_STORE') {
    if (typeof outputs.pfxBase64 !== 'string' || !isBase64(outputs.pfxBase64)) fail('ARTIFACT', 'IIS Artifact 缺少有效的 pfxBase64 输出');
    if (typeof outputs.pfxPassword !== 'string' || outputs.pfxPassword.length === 0 || outputs.pfxPassword.length > 1024) fail('ARTIFACT', 'IIS Artifact 缺少有效的 pfxPassword 输出');
    if (typeof outputs.fingerprintSha256 !== 'string') fail('ARTIFACT', 'IIS Artifact 缺少 fingerprintSha256 输出');
    rawDigest(outputs.fingerprintSha256, 'fingerprintSha256');
    return;
  }
  if (kind === 'KEYSTORE') {
    const outputName = keystoreType === 'JKS' ? 'jksBase64' : 'pfxBase64';
    if (typeof outputs[outputName] !== 'string' || !isBase64(outputs[outputName] as string)) {
      fail('ARTIFACT', `KeyStore Artifact 缺少有效的 ${outputName} Base64 输出`);
    }
    return;
  }
  validatePemOutput(outputs.leafPem, 'leafPem', ['CERTIFICATE']);
  validatePemOutput(outputs.privateKeyPem, 'privateKeyPem', ['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY', 'DSA PRIVATE KEY']);
  if (outputs.orderedChainPem !== undefined) validatePemOutput(outputs.orderedChainPem, 'orderedChainPem', ['CERTIFICATE']);
}

function validatePemOutput(value: unknown, field: string, labels: readonly string[]): void {
  if (typeof value !== 'string' || value.trim() === '') fail('ARTIFACT', `证书 Artifact 缺少 ${field}`);
  const pem = value.includes('-----BEGIN ') ? value.trim() : decodeBase64Text(value);
  if (!pem || !labels.some((label) => new RegExp(`-----BEGIN ${label}-----[\\s\\S]+-----END ${label}-----`).test(pem))) {
    fail('ARTIFACT', `证书 Artifact 的 ${field} 不是有效 PEM`);
  }
}

function decodeBase64Text(value: string): string | undefined {
  if (!isBase64(value)) return undefined;
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    return decoded.includes('-----BEGIN ') ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function isBase64(value: string): boolean {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  try {
    return Buffer.from(value, 'base64').toString('base64') === value;
  } catch {
    return false;
  }
}

function resolveSecretRefs(
  credentials: Record<string, RuntimeCredentialV1>,
  contract: CertificateUpdateInputContractV1,
): string[] {
  const expectedSlots = Object.keys(contract.deploymentInputContract.credentials);
  const actualSlots = Object.keys(credentials);
  if (actualSlots.some((slot) => !expectedSlots.includes(slot))) fail('SECRET', 'Resolved 输入包含合同未声明的凭据槽位');
  if (contract.artifactKind === 'PEM_FILES') {
    if (actualSlots.length > 0) fail('SECRET', 'PEM 证书更新不得携带凭据或 SecretRef');
    return [];
  }
  if (contract.artifactKind === 'WINDOWS_CERTIFICATE_STORE') {
    if (actualSlots.length > 0) fail('SECRET', 'IIS PFX 密码由证书 Artifact 提供，不得携带凭据或 SecretRef');
    return [];
  }

  if (actualSlots.length !== 1 || actualSlots[0] !== 'keystorePassword') fail('SECRET', 'KeyStore 只允许 keystorePassword 凭据槽位');
  const credential = credentials.keystorePassword;
  if (!credential || typeof credential !== 'object' || Array.isArray(credential) || typeof credential.credentialId !== 'string' || credential.credentialId.trim() === '') {
    fail('SECRET', 'KeyStore 凭据快照缺少 credentialId');
  }
  const credentialKind = credential.kind;
  if (credentialKind !== undefined && credentialKind !== 'USERNAME_PASSWORD') fail('SECRET', 'KeyStore 凭据类型必须是 USERNAME_PASSWORD');
  const refs = credential.secretRefs;
  if (!refs || typeof refs !== 'object' || Array.isArray(refs)) fail('SECRET', 'KeyStore 凭据缺少 SecretRef 映射');
  const entries = Object.entries(refs);
  if (entries.some(([, ref]) => typeof ref !== 'string' || !/^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(ref))) fail('SECRET', 'SecretRef 格式无效');
  const passwordRef = refs.password;
  if (typeof passwordRef !== 'string' || !/^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(passwordRef)) fail('SECRET', 'KeyStore 凭据必须提供 password SecretRef');
  return [passwordRef];
}

function normalizePlatform(value: string): 'linux' | 'windows' | undefined {
  const lower = value.trim().toLowerCase();
  if (lower.includes('win')) return 'windows';
  if (lower.includes('linux') || lower.includes('unix')) return 'linux';
  return undefined;
}

function requiredPath(value: unknown, field: string): string {
  const result = readString(value);
  if (!result || (!result.startsWith('/') && !absoluteWindowsPath.test(result))) fail('PATH', `${field} 必须是绝对路径`);
  if (/[\u0000\r\n]/.test(result)) fail('PATH', `${field} 包含非法控制字符`);
  if (result.split(/[\\/]/).includes('..')) fail('PATH', `${field} 不能包含 ..`);
  return result;
}

function requiredIdentifier(value: unknown, field: string): string {
  const result = readString(value);
  if (!result || !/^[A-Za-z0-9._:-]{1,256}$/.test(result)) fail('FACT', `${field} 缺失或格式无效`);
  return result;
}

function optionalIdentifier(value: unknown, field: string): string | undefined {
  const result = readString(value);
  if (result && !/^[A-Za-z0-9._:-]{1,256}$/.test(result)) fail('FACT', `${field} 格式无效`);
  return result;
}

/** IIS BindingInformation 的格式是 ipAddress:port:hostHeader。
 * 该校验只接受原生 Binding 形态，明确拒绝 iis:*:443:host 这类宿主稳定标识。
 */
function isIisBindingInformation(value: string): boolean {
  const normalized = value.trim();
  const match = normalized.match(/^(\*|[0-9A-Fa-f:.]+|\[[0-9A-Fa-f:]+\]):(\d{1,5}):(.*)$/u);
  if (!match) return false;
  const port = Number(match[2]);
  return Number.isInteger(port) && port >= 1 && port <= 65535 && !/[\u0000\r\n]/.test(match[3] ?? '');
}

function rawDigest(value: unknown, field: string): string {
  const result = readString(value)?.replace(/^sha256:/i, '').toLowerCase();
  if (!result || !digestPattern.test(result)) fail('DIGEST', `${field} 必须是 SHA-256 摘要`);
  return result;
}

function optionalDigest(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return rawDigest(value, field);
}

function prefixedDigest(value: unknown, field: string): string {
  return `sha256:${rawDigest(value, field)}`;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '')) fail('PROGRAM', `${field} 必须是非空字符串数组`);
  return value as string[];
}

function assertSafeProgramFacts(programPath: string, args: string[], argumentTemplate: string[]): void {
  const executableName = programPath.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? '';
  const forbiddenNames = new Set([
    'sh', 'bash', 'dash', 'zsh', 'fish', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
    'wscript', 'wscript.exe', 'cscript', 'cscript.exe', 'python', 'python.exe', 'python3', 'python3.exe',
    'perl', 'perl.exe', 'ruby', 'ruby.exe', 'node', 'node.exe',
  ]);
  if (forbiddenNames.has(executableName) || /\.(?:bat|cmd|ps1|psm1|sh)$/i.test(executableName)) {
    fail('PROGRAM', '程序事实不能指向 Shell、脚本或通用解释器');
  }
  if ([...args, ...argumentTemplate].some((value) => /[\u0000\r\n;&|<>`$()]/.test(value))) {
    fail('PROGRAM', '配置检查参数不能包含 Shell 控制字符');
  }
}

function readString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim() !== '')?.trim();
}

function exactFact(field: string, ...values: unknown[]): string | undefined {
  const present = values.filter((value): value is string => typeof value === 'string' && value.trim() !== '').map((value) => value.trim());
  if (new Set(present).size > 1) fail('FACT', `${field} 的快照来源不一致`);
  return present[0];
}

function assertOptionalDigestFact(actual: unknown, expected: string, field: string): void {
  if (actual === undefined) return;
  if (typeof actual !== 'string' || actual.trim() === '' || rawDigest(actual, field) !== expected) fail('FINGERPRINT', `${field} 与 Agent 快照不一致`);
}

function assertOptionalFact(actual: unknown, expected: string, field: string): void {
  if (actual === undefined) return;
  if (typeof actual !== 'string' || actual.trim() !== expected) fail('FACT', `${field} 与 Agent 快照不一致`);
}

function assertOptionalPath(actual: unknown, expected: string | undefined, field: string, platform: 'linux' | 'windows'): void {
  if (actual === undefined || expected === undefined) return;
  if (typeof actual !== 'string' || normalizePath(actual, platform) !== normalizePath(expected, platform)) fail('PATH', `${field} 与 Agent 快照不一致`);
}

const pathCaseNormalizers: Readonly<Record<'linux' | 'windows', (value: string) => string>> = Object.freeze({
  linux: (value) => value,
  windows: (value) => value.toLowerCase(),
});

function normalizePath(value: string, platform: 'linux' | 'windows' = 'windows'): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/\.\//g, '/');
  return pathCaseNormalizers[platform](normalized);
}

function normalizeDigest(value: string): string {
  return value.trim().replace(/^sha256:/i, '').toLowerCase();
}

function fail(category: string, message: string): never {
  throw new AppError('VALIDATION_FAILED', `证书更新输入门禁失败：${message}`, { category, fallback: false });
}

export function certificateUpdateSnapshotDigest(snapshot: CertificateUpdateResolvedSnapshotV1): string {
  return sha256Digest(snapshot);
}

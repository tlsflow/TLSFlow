import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  X509Certificate,
} from 'node:crypto';

const PLUGIN_ID = 'ca.openssl';
const PLUGIN_VERSION = '1.0.0';
const PLUGIN_VERSION_ID = 'ca.openssl:1.0.0';
const WORKFLOW_VERSION = '1.0.0';
const CAPABILITIES = Object.freeze([
  'ca.certificate.issue',
  'ca.certificate.renew',
  'ca.certificate.revoke',
]);
const PERMISSIONS = Object.freeze([
  'secret.resolve',
  'audit.append',
]);

const operationLedger = new Map();

export function createPluginRunnerExecutor() {
  const descriptor = createDescriptor();
  return {
    descriptor,
    async execute(context, hostApi) {
      return executeOperation(context, hostApi, descriptor);
    },
  };
}

async function executeOperation(context, hostApi, descriptor) {
  let security;
  let operation = 'unknown';
  try {
    assertContext(context, descriptor);
    const input = record(context.input, 'input');
    operation = text(input.operation, 'operation');
    assertWorkflow(input, context.capability);
    security = validateSecurity(input, context, descriptor);
    checkDeadline(context);
    checkCancelled(context);

    const digest = security.operationDigest;
    const previous = operationLedger.get(context.idempotencyKey);
    if (previous) {
      if (previous.digest !== digest) throw failure('CA_IDEMPOTENCY_CONFLICT', '同一幂等键绑定了不同的操作摘要', false, false);
      await appendAudit(context, hostApi, security, operation, previous.result.status === 'SUCCESS' ? 'success' : 'failure', 'idempotent-replay');
      return cloneResult(previous.result);
    }

    await resolveIssuerSecret(context, hostApi, security, input, operation);
    const result = await performOperation(context, input, operation);
    operationLedger.set(context.idempotencyKey, { digest, result: cloneResult(result) });
    await appendAudit(context, hostApi, security, operation, result.status === 'SUCCESS' ? 'success' : 'failure', result.summary);
    return result;
  } catch (error) {
    const normalized = normalizeError(error);
    const status = context?.writeEffect && normalized.mayBeUnknown ? 'UNKNOWN' : 'FAILED';
    const result = failedResult(status, normalized);
    if (context?.idempotencyKey && security && normalized.mayBeUnknown) {
      operationLedger.set(context.idempotencyKey, { digest: security.operationDigest, result: cloneResult(result) });
    }
    if (security && context && hostApi) {
      await appendAuditSafely(context, hostApi, security, operation, 'failure', normalized.code);
    }
    return result;
  }
}

async function performOperation(context, input, operation) {
  switch (operation) {
    case 'create':
      return createAuthority(context, input);
    case 'issue':
      return issueCertificate(context, input);
    case 'renew':
      return renewCertificate(context, input);
    case 'revoke':
      return revokeCertificate(context, input);
    case 'recover':
      return recoverOperation(context, input);
    default:
      throw failure('CA_OPERATION_UNSUPPORTED', 'CA Port 不支持该生命周期操作', false, false);
  }
}

function createAuthority(context, input) {
  const authorityId = identifier(input.authorityId, 'authorityId');
  const subjectCommonName = text(input.subjectCommonName, 'subjectCommonName');
  const profile = text(input.profile, 'profile');
  if (profile !== 'control-plane.ca') throw failure('CA_PROFILE_UNSUPPORTED', 'OpenSSL CA 只接受固定 control-plane.ca Profile', false, false);
  return successResult({
    operation: 'create',
    authorityId,
    normalizedObject: {
      kind: 'CertificateAuthority',
      apiVersion: 'gcac.ca-object/v1',
      stableKey: `ca:${authorityId}`,
      pluginId: PLUGIN_ID,
      pluginVersionId: context.pluginVersionId,
      profile,
      subjectCommonName,
      status: 'ready',
    },
  });
}

async function issueCertificate(context, input) {
  const csrPem = pem(input.csrPem, 'CERTIFICATE REQUEST', 'csrPem');
  const subject = text(input.subject, 'subject');
  const sans = dnsNames(input.sans);
  const validityDays = boundedInteger(input.validityDays, 1, 397, 'validityDays');
  const certificatePem = typeof input.certificatePem === 'string' ? input.certificatePem : undefined;
  const material = certificatePem
    ? inspectCertificate(certificatePem, subject, sans)
    : createIssuedCertificate(input, csrPem, subject, sans, validityDays);
  return successResult({
    operation: 'issue',
    serialNumber: material.serialNumber,
    normalizedObject: {
      kind: 'Certificate',
      apiVersion: 'gcac.ca-object/v1',
      stableKey: `certificate:${material.fingerprintSha256}`,
      pluginId: PLUGIN_ID,
      pluginVersionId: context.pluginVersionId,
      status: 'issued',
      subject,
      sans,
      serialNumber: material.serialNumber,
      fingerprintSha256: material.fingerprintSha256,
      publicKeyFingerprintSha256: material.publicKeyFingerprintSha256,
      notBefore: material.notBefore,
      notAfter: material.notAfter,
      certificatePem: material.certificatePem,
      ...(material.certificateChainPem ? { certificateChainPem: material.certificateChainPem } : {}),
    },
  });
}

async function renewCertificate(context, input) {
  const sourceCertificateId = identifier(input.sourceCertificateId, 'sourceCertificateId');
  const sourceCertificatePem = pem(input.sourceCertificatePem, 'CERTIFICATE', 'sourceCertificatePem');
  const nextInput = { ...input, csrPem: input.csrPem ?? input.sourceCsrPem };
  const issued = await issueCertificate(context, nextInput);
  return {
    ...issued,
    summary: { ...issued.summary, operation: 'renew', sourceCertificateId },
    normalizedObjects: issued.normalizedObjects.map((item) => ({ ...item, renewalOf: sourceCertificateId, sourceCertificateFingerprintSha256: fingerprint(sourceCertificatePem) })),
  };
}

function revokeCertificate(context, input) {
  const serialNumber = text(input.serialNumber, 'serialNumber').toUpperCase();
  if (!/^[0-9A-F]{2,128}$/.test(serialNumber)) throw failure('CA_SERIAL_INVALID', '证书序列号格式无效', false, false);
  const reason = text(input.reason, 'reason');
  const allowedReasons = new Set(['unspecified', 'keyCompromise', 'caCompromise', 'affiliationChanged', 'superseded', 'cessationOfOperation']);
  if (!allowedReasons.has(reason)) throw failure('CA_REVOCATION_REASON_INVALID', '吊销原因不在固定集合中', false, false);
  if (input.failureMode === 'timeout' || input.failureMode === 'unknown') {
    throw failure('CA_PROVIDER_OPERATION_UNKNOWN_STATE', '吊销请求已发送但外部结果不可确认', true, true);
  }
  return successResult({
    operation: 'revoke',
    serialNumber,
    normalizedObject: {
      kind: 'CertificateRevocation',
      apiVersion: 'gcac.ca-object/v1',
      stableKey: `revocation:${serialNumber}`,
      pluginId: PLUGIN_ID,
      pluginVersionId: context.pluginVersionId,
      serialNumber,
      reason,
      status: 'revoked',
      revokedAt: new Date().toISOString(),
    },
  });
}

function recoverOperation(context, input) {
  const operationId = identifier(input.operationId, 'operationId');
  const recordValue = operationLedger.get(operationId);
  if (!recordValue) throw failure('CA_OPERATION_UNKNOWN_STATE', '找不到原操作的固定检查点，不能推断外部状态', false, true);
  const recovered = cloneResult(recordValue.result);
  return {
    ...recovered,
    summary: { ...recovered.summary, operation: 'recover', operationId, recovered: true },
    warnings: [{ code: 'CA_RECOVERY_REQUIRES_RECEIPT', message: '恢复结果必须由宿主 Receipt 账本最终确认', secretRedacted: true }],
  };
}

function createIssuedCertificate(input, csrPem, subject, sans, validityDays) {
  if (typeof input.issuerPrivateKeyPem === 'string') {
    throw failure('CA_SECRET_INLINE_FORBIDDEN', '签发私钥必须通过 Secret Grant 提供，不能放入执行输入', false, false);
  }
  const issuerPrivateKeyPem = input._resolvedIssuerPrivateKeyPem;
  const issuerCertificatePem = input._resolvedIssuerCertificatePem;
  const publicKeyPem = pem(input.publicKeyPem, 'PUBLIC KEY', 'publicKeyPem');
  if (!issuerPrivateKeyPem || !issuerCertificatePem) throw failure('CA_ISSUER_MATERIAL_MISSING', '缺少已授权的 CA 私钥或 issuer 证书材料', false, false);
  const privateKey = createPrivateKey(issuerPrivateKeyPem);
  if (privateKey.asymmetricKeyType !== 'rsa') throw failure('CA_KEY_ALGORITHM_UNSUPPORTED', '开发版 OpenSSL CA 只接受 RSA issuer 密钥', false, false);
  const issuer = new X509Certificate(issuerCertificatePem);
  const publicKey = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  const serialBytes = createHash('sha256').update(`${csrPem}\u0000${subject}\u0000${sans.join(',')}`).digest().subarray(0, 16);
  const now = new Date();
  const notAfter = new Date(now.getTime() + validityDays * 86400000);
  const algorithm = sequence(oid('1.2.840.113549.1.1.11'), nullValue());
  const tbs = sequence(
    explicit(0, integerBytes(Buffer.from([2]))),
    integerBytes(serialBytes),
    algorithm,
    nameFromCommonName(commonNameFromSubject(issuer.subject)),
    sequence(utcTime(now), utcTime(notAfter)),
    nameFromCommonName(subject.replace(/^CN=/i, '')),
    Buffer.from(publicKey),
    explicit(3, sequence(
      extension('2.5.29.19', sequence(booleanValue(false))),
      extension('2.5.29.17', sequence(...sans.map(generalName))),
    )),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(tbs);
  const signature = signer.sign(privateKey);
  const der = sequence(tbs, algorithm, bitString(signature));
  const certificate = toPem('CERTIFICATE', der);
  return inspectCertificate(certificate, subject, sans, issuerCertificatePem);
}

async function resolveIssuerSecret(context, hostApi, security, input, operation) {
  const secretRef = text(input.secretRef, 'secretRef');
  if (!/^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(secretRef)) throw failure('CA_SECRET_REF_INVALID', 'CA SecretRef 格式无效', false, false);
  const result = await hostApi.call('secret.grant.resolve', {
    grantId: security.grantRef,
    secretRef,
    purpose: `ca.${operation}.issuer-material`,
  }, context.grantRefs, 5000);
  const data = record(result.data ?? result, 'secretResult');
  const issuerPrivateKeyPem = data.privateKeyPem ?? data.issuerPrivateKeyPem;
  const issuerCertificatePem = data.certificatePem ?? data.issuerCertificatePem;
  if (typeof issuerPrivateKeyPem !== 'string' || typeof issuerCertificatePem !== 'string') {
    throw failure('CA_ISSUER_MATERIAL_MISSING', 'Secret Grant 未返回完整 issuer 材料', false, false);
  }
  // 私钥只在 Runner 内存中使用，任何标准对象、摘要和审计均不携带该字段。
  input._resolvedIssuerPrivateKeyPem = issuerPrivateKeyPem;
  input._resolvedIssuerCertificatePem = issuerCertificatePem;
}

async function appendAudit(context, hostApi, security, operation, result, detail) {
  await hostApi.call('audit.append', {
    eventType: 'ca.plugin.operation',
    action: `${PLUGIN_ID}.${operation}`,
    resourceType: 'ca_operation',
    resourceId: context.idempotencyKey,
    result,
    detail: {
      pluginVersionId: context.pluginVersionId,
      capability: context.capability,
      operation,
      detail: safeDetail(detail),
      receiptRef: security.receiptRef,
      operationDigest: security.operationDigest,
    },
  }, context.grantRefs, 5000);
}

async function appendAuditSafely(context, hostApi, security, operation, result, detail) {
  try {
    await appendAudit(context, hostApi, security, operation, result, detail);
  } catch {
    // 原始业务错误优先；审计失败会由宿主的失败记录和恢复账本接管。
  }
}

function validateSecurity(input, context, descriptor) {
  const security = record(input.security, 'security');
  for (const key of ['tokenId', 'decisionId', 'nonce', 'receiptRef', 'localPolicyRef', 'grantRef']) identifier(security[key], `security.${key}`);
  const fixedDigests = record(security.fixedDigests, 'security.fixedDigests');
  for (const key of ['packageHash', 'resourceHash', 'manifestHash']) {
    if (fixedDigests[key] !== descriptor[key]) throw failure('CA_FIXED_DIGEST_MISMATCH', '固定 PluginVersion 摘要不匹配', false, false);
  }
  const operationDigest = text(security.operationDigest, 'security.operationDigest');
  if (!/^sha256:[a-f0-9]{64}$/.test(operationDigest)) throw failure('CA_OPERATION_DIGEST_INVALID', '操作摘要格式无效', false, false);
  const calculated = operationInputDigest(context, input);
  if (calculated !== operationDigest) throw failure('CA_OPERATION_DIGEST_MISMATCH', '操作摘要与输入快照不一致', false, false);
  if (!context.grantRefs.includes(security.grantRef)) throw failure('CA_GRANT_NOT_BOUND', 'Secret/Audit Grant 未绑定当前执行', false, false);
  if (security.nonce.length < 16 || security.nonce.length > 128) throw failure('CA_NONCE_INVALID', 'Nonce 长度无效', false, false);
  return security;
}

function assertWorkflow(input, capability) {
  const expected = input.operation === 'recover' ? 'ca.operation.recover' : capability;
  if (text(input.workflowKey, 'workflowKey') !== expected) throw failure('CA_WORKFLOW_BINDING_INVALID', 'Workflow 必须绑定当前 Capability 或固定恢复合同', false, false);
  if (text(input.workflowVersion, 'workflowVersion') !== WORKFLOW_VERSION) throw failure('CA_WORKFLOW_VERSION_INVALID', 'WorkflowVersion 未固定到首版', false, false);
}

function assertContext(context, descriptor) {
  if (!context || typeof context !== 'object') throw failure('PLUGIN_CONTRACT_INVALID', 'Runner 执行上下文缺失', false, false);
  if (context.pluginVersionId !== descriptor.pluginVersionId || context.pluginId !== descriptor.pluginId || context.pluginVersion !== descriptor.pluginVersion) throw failure('PLUGIN_RUNNER_VERSION_MISMATCH', 'PluginVersion 绑定不匹配', false, false);
  if (!CAPABILITIES.includes(context.capability)) throw failure('PLUGIN_RUNNER_VERSION_MISMATCH', 'Capability 未绑定到当前插件', false, false);
  if (!Array.isArray(context.grantRefs) || context.grantRefs.length === 0) throw failure('PLUGIN_HOST_CALL_DENIED', '执行缺少 Grant 引用', false, false);
}

function checkDeadline(context) {
  const deadline = Date.parse(context.deadlineAt);
  if (!Number.isFinite(deadline) || deadline <= Date.now()) throw failure('PLUGIN_RUNNER_TIMEOUT', '执行已超过 deadline', true, Boolean(context.writeEffect));
}

function checkCancelled(context) {
  if (context.signal?.aborted) throw failure('PLUGIN_OPERATION_CANCELLED', '插件执行已取消', false, Boolean(context.writeEffect));
}

function operationInputDigest(context, input) {
  const copy = clone(input);
  if (copy.security && typeof copy.security === 'object') delete copy.security.operationDigest;
  delete copy._resolvedIssuerPrivateKeyPem;
  delete copy._resolvedIssuerCertificatePem;
  return `sha256:${createHash('sha256').update(canonicalJson({ capability: context.capability, input: copy })).digest('hex')}`;
}

function inspectCertificate(certificatePem, subject, sans, chainPem) {
  const certificate = new X509Certificate(pem(certificatePem, 'CERTIFICATE', 'certificatePem'));
  const publicKey = certificate.publicKey.export({ type: 'spki', format: 'der' });
  const fingerprintSha256 = fingerprint(certificatePem);
  return {
    certificatePem,
    ...(chainPem ? { certificateChainPem: chainPem } : {}),
    serialNumber: certificate.serialNumber.toLowerCase(),
    fingerprintSha256,
    publicKeyFingerprintSha256: `sha256:${createHash('sha256').update(publicKey).digest('hex')}`,
    notBefore: new Date(certificate.validFrom).toISOString(),
    notAfter: new Date(certificate.validTo).toISOString(),
    subject,
    sans,
  };
}

function successResult({ operation, normalizedObject, serialNumber }) {
  return {
    success: true,
    status: 'SUCCESS',
    summary: { operation, ...(serialNumber ? { serialNumber } : {}), objectCount: 1 },
    normalizedObjects: [normalizedObject],
    warnings: [],
  };
}

function failedResult(status, error) {
  return { success: false, status, summary: {}, normalizedObjects: [], warnings: [], error };
}

function failure(code, message, retryable, mayBeUnknown) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  error.mayBeUnknown = mayBeUnknown;
  return error;
}

function normalizeError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'PLUGIN_CAPABILITY_EXECUTION_FAILED';
  const message = redact(typeof error?.message === 'string' ? error.message : 'CA 插件执行失败');
  return { code, message: message.slice(0, 512), retryable: error?.retryable === true, mayBeUnknown: error?.mayBeUnknown === true, secretRedacted: true };
}

function safeDetail(value) {
  if (typeof value === 'string') return redact(value).slice(0, 256);
  if (value && typeof value === 'object') return { result: 'recorded' };
  return String(value);
}

function redact(value) {
  return value.replace(/-----BEGIN[\s\S]*?-----[\s\S]*?-----END[\s\S]*?-----/g, '[REDACTED_PEM]').replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]').replace(/secret:\/\/[^\s"']+/gi, 'secret://[REDACTED]');
}

function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('PLUGIN_CONTRACT_INVALID', `${name} 必须是对象`, false, false);
  return value;
}

function text(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw failure('PLUGIN_CONTRACT_INVALID', `${name} 必须是非空字符串`, false, false);
  return value;
}

function identifier(value, name) {
  const result = text(value, name);
  if (!/^[A-Za-z0-9._:/#-]{1,512}$/.test(result)) throw failure('PLUGIN_CONTRACT_INVALID', `${name} 格式无效`, false, false);
  return result;
}

function boundedInteger(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw failure('PLUGIN_CONTRACT_INVALID', `${name} 超出固定范围`, false, false);
  return value;
}

function dnsNames(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw failure('PLUGIN_CONTRACT_INVALID', 'sans 必须是非空数组', false, false);
  return value.map((item) => {
    const name = text(item, 'sans');
    if (!/^(?:\*\.)?[A-Za-z0-9](?:[A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/.test(name)) throw failure('CA_SAN_INVALID', 'SAN 不是合法 DNS 名称', false, false);
    return name.toLowerCase();
  });
}

function pem(value, label, name) {
  const result = text(value, name);
  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  if (!result.includes(begin) || !result.includes(end) || result.length > 4 * 1024 * 1024) throw failure('CA_PEM_INVALID', `${name} 不是有效的 PEM 材料`, false, false);
  return result;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneResult(value) {
  return clone(value);
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function fingerprint(certificatePem) {
  const certificate = new X509Certificate(certificatePem);
  return `sha256:${certificate.fingerprint256.replaceAll(':', '').toLowerCase()}`;
}

function commonNameFromSubject(subject) {
  const match = /CN=([^,]+)/i.exec(subject);
  return match?.[1] ?? 'GCAC Development CA';
}

function toPem(label, bytes) {
  const body = Buffer.from(bytes).toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function length(value) {
  if (value < 128) return Buffer.from([value]);
  const bytes = [];
  let remaining = value;
  while (remaining > 0) { bytes.unshift(remaining & 255); remaining >>>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tag(tagValue, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return Buffer.concat([Buffer.from([tagValue]), length(bytes.length), bytes]);
}

function sequence(...values) { return tag(0x30, Buffer.concat(values.map((value) => Buffer.from(value)))); }
function explicit(number, value) { return tag(0xa0 | number, value); }
function integerBytes(value) {
  const bytes = Buffer.from(value);
  const normalized = bytes.length === 0 ? Buffer.from([0]) : bytes;
  return tag(0x02, normalized[0] & 0x80 ? Buffer.concat([Buffer.from([0]), normalized]) : normalized);
}
function oid(value) {
  const parts = value.split('.').map(Number);
  const output = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const bytes = [part & 0x7f];
    let remaining = part >>> 7;
    while (remaining > 0) { bytes.unshift((remaining & 0x7f) | 0x80); remaining >>>= 7; }
    output.push(...bytes);
  }
  return tag(0x06, Buffer.from(output));
}
function nullValue() { return tag(0x05, Buffer.alloc(0)); }
function booleanValue(value) { return tag(0x01, Buffer.from([value ? 0xff : 0])); }
function utf8(value) { return tag(0x0c, Buffer.from(value, 'utf8')); }
function utcTime(value) {
  const year = String(value.getUTCFullYear()).slice(-2);
  const data = `${year}${String(value.getUTCMonth() + 1).padStart(2, '0')}${String(value.getUTCDate()).padStart(2, '0')}${String(value.getUTCHours()).padStart(2, '0')}${String(value.getUTCMinutes()).padStart(2, '0')}${String(value.getUTCSeconds()).padStart(2, '0')}Z`;
  return tag(0x17, data);
}
function nameFromCommonName(value) { return sequence(tag(0x31, sequence(oid('2.5.4.3'), utf8(value)))); }
function bitString(value) { return tag(0x03, Buffer.concat([Buffer.from([0]), Buffer.from(value)])); }
function generalName(value) { return tag(0x82, Buffer.from(value, 'ascii')); }
function extension(extensionOid, value) { return sequence(oid(extensionOid), booleanValue(true), tag(0x04, value)); }

function createDescriptor() {
  const pluginVersionId = requiredEnvironment('GCAC_PLUGIN_VERSION_ID');
  if (pluginVersionId !== PLUGIN_VERSION_ID) throw failure('PLUGIN_RUNNER_VERSION_MISMATCH', 'Runner 注入的 PluginVersion 与包身份不匹配', false, false);
  return Object.freeze({
    pluginVersionId,
    pluginId: PLUGIN_ID,
    pluginVersion: PLUGIN_VERSION,
    capabilities: [...CAPABILITIES],
    permissions: [...PERMISSIONS],
    packageHash: requiredDigest('GCAC_PLUGIN_PACKAGE_HASH'),
    resourceHash: requiredDigest('GCAC_PLUGIN_RESOURCE_HASH'),
    manifestHash: requiredDigest('GCAC_PLUGIN_MANIFEST_HASH'),
  });
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw failure('PLUGIN_RUNNER_START_FAILED', `Runner 缺少必需环境变量 ${name}`, false, false);
  return value;
}

function requiredDigest(name) {
  const value = requiredEnvironment(name);
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw failure('PLUGIN_RUNNER_START_FAILED', `Runner 环境变量 ${name} 不是有效 SHA-256 摘要`, false, false);
  return value;
}

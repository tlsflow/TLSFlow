import { AppError } from '../../../common/errors/app-error.js';

/** 网关本机持钥的窄合同：固定版本设备插件只能执行两个原子动作。 */
export type DeviceLocalAction = 'generate_csr' | 'install_issued';

export interface DeviceLocalActionReceipt {
  status: 'SUCCESS' | 'FAILED' | 'UNKNOWN';
  deviceId: string;
  pluginId: string;
  pluginVersionId: string;
  action: DeviceLocalAction;
  idempotencyKey: string;
  localKeyRef?: string;
  csrPem?: string;
  csrSha256?: string;
  publicKeyFingerprintSha256?: string;
  certificateFingerprintSha256?: string;
  privateKeyTransported: false;
  evidence?: Record<string, unknown>;
}

export interface DeviceLocalActionDispatcher {
  dispatch(input: {
    tenantId: string;
    deviceId: string;
    pluginId: string;
    pluginVersionId: string;
    action: DeviceLocalAction;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }): Promise<DeviceLocalActionReceipt>;
}

export interface DeviceLocalGenerateCsrInput {
  tenantId: string;
  deviceId: string;
  pluginId: string;
  pluginVersionId: string;
  commonName: string;
  sans: string[];
  algorithm: 'rsa' | 'ec';
  idempotencyKey: string;
}

export interface DeviceLocalInstallIssuedInput {
  tenantId: string;
  deviceId: string;
  pluginId: string;
  pluginVersionId: string;
  localKeyRef: string;
  expectedPublicKeyFingerprintSha256: string;
  certificatePem: string;
  certificateChainPem: string;
  idempotencyKey: string;
}

/** 设备私钥不进入控制面；设备协议由 dispatcher 对接固定版本插件。 */
export class DeviceLocalKeyCustodyAdapter {
  constructor(private readonly dispatcher: DeviceLocalActionDispatcher) {}

  generateCsr(input: DeviceLocalGenerateCsrInput): Promise<DeviceLocalActionReceipt> {
    const commonName = required(input.commonName, 'commonName');
    const deviceId = required(input.deviceId, 'deviceId');
    if (!Array.isArray(input.sans)) throw new AppError('VALIDATION_FAILED', 'sans 必须是数组');
    return this.dispatcher.dispatch({
      tenantId: required(input.tenantId, 'tenantId'),
      deviceId,
      pluginId: requiredPlugin(input.pluginId),
      pluginVersionId: required(input.pluginVersionId, 'pluginVersionId'),
      action: 'generate_csr',
      idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'),
      payload: { deviceId, commonName, sans: [...input.sans], algorithm: input.algorithm },
    });
  }

  installIssued(input: DeviceLocalInstallIssuedInput): Promise<DeviceLocalActionReceipt> {
    const certificatePem = publicCertificate(input.certificatePem, 'certificatePem');
    const certificateChainPem = publicCertificate(input.certificateChainPem, 'certificateChainPem');
    const localKeyRef = required(input.localKeyRef, 'localKeyRef');
    if (/private.?key|pfx|passphrase|password/i.test(localKeyRef)) throw new AppError('VALIDATION_FAILED', 'localKeyRef 不能包含私钥或密码材料');
    const fingerprint = required(input.expectedPublicKeyFingerprintSha256, 'expectedPublicKeyFingerprintSha256').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new AppError('VALIDATION_FAILED', 'expectedPublicKeyFingerprintSha256 必须是 SHA-256 摘要');
    return this.dispatcher.dispatch({
      tenantId: required(input.tenantId, 'tenantId'),
      deviceId: required(input.deviceId, 'deviceId'),
      pluginId: requiredPlugin(input.pluginId),
      pluginVersionId: required(input.pluginVersionId, 'pluginVersionId'),
      action: 'install_issued',
      idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'),
      payload: { deviceId: input.deviceId, localKeyRef, expectedPublicKeyFingerprintSha256: fingerprint, certificatePem, certificateChainPem, privateKeyTransported: false },
    });
  }
}

function required(value: string, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_FAILED', field + ' 不能为空');
  return value.trim();
}

function requiredPlugin(value: string): string {
  const result = required(value, 'pluginId');
  if (!/^(?:device|web)\.[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/i.test(result)) throw new AppError('VALIDATION_FAILED', 'pluginId 必须是固定设备插件标识');
  return result;
}

function publicCertificate(value: string, field: string): string {
  const result = required(value, field);
  if (result.length > 256 * 1024 || !result.includes('BEGIN CERTIFICATE') || /BEGIN [A-Z ]*PRIVATE KEY/.test(result)) throw new AppError('VALIDATION_FAILED', field + ' 只能包含公开证书 PEM');
  return result;
}

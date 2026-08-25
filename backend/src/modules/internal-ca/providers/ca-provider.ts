import { AppError } from '../../../common/errors/app-error.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type {
  CaProviderCapabilities,
  CaProviderEntity,
  CertificateAuthorityEntity,
  CertificateProfileRules,
  ProviderActionBindingEntity,
} from '../schema/internal-ca.schema.js';
import { AcmeProviderAdapter } from './acme-provider.js';
import { OpenSslCa } from './openssl-ca.js';
import type { CaIssuanceRecordEntity } from '../schema/internal-ca.schema.js';

export interface CaProviderValidationResult {
  reachable: boolean;
  capabilities: CaProviderCapabilities;
  detail?: string;
  /** ACME Directory 探测的最小公开摘要，不包含条款 URL、授权 URL 或响应原文。 */
  directory?: {
    externalAccountRequired: boolean;
  };
}

export interface IssuedCertificateMaterial {
  certificatePem: string;
  certificateChainPem: string;
  serialNumber: string;
  fingerprintSha256: string;
  publicKeyFingerprintSha256: string;
  notBefore: string;
  notAfter: string;
}

export interface SignCsrCommand {
  provider: CaProviderEntity;
  authority: CertificateAuthorityEntity;
  csrPem: string;
  subject?: string;
  sans: string[];
  validityDays: number;
  profileRules: CertificateProfileRules;
  idempotencyKey: string;
  actorId: string;
  serialNumber?: string;
  actionBinding?: ProviderActionBindingEntity;
}

export type CaIssuanceResult =
  | ({ status: 'issued' } & IssuedCertificateMaterial & { providerRequestId: string })
  | { status: 'pending' | 'unknown'; providerRequestId: string; detail?: string }
  | { status: 'rejected'; providerRequestId: string; detail?: string };

/** CA 执行端口。内置 CA 与 ACME 由宿主实现；外部 CA 由插件提供执行端。 */
export interface CaProviderAdapter {
  getCapabilities(): CaProviderCapabilities;
  validateConnection(provider: CaProviderEntity): Promise<CaProviderValidationResult>;
  signCsr(command: SignCsrCommand): Promise<CaIssuanceResult>;
  queryIssuance?(input: { provider: CaProviderEntity; providerRequestId: string; actorId: string; actionBinding?: ProviderActionBindingEntity; idempotencyKey?: string }): Promise<CaIssuanceResult>;
  revoke?(input: { provider: CaProviderEntity; authority: CertificateAuthorityEntity; serialNumber: string; reason: string; actorId: string; actionBinding?: ProviderActionBindingEntity; idempotencyKey?: string }): Promise<{ revokedAt: string }>;
  publishCrl?(input: {
    provider: CaProviderEntity;
    authority: CertificateAuthorityEntity;
    issuanceRecords: CaIssuanceRecordEntity[];
    crlNumber: number;
    actorId: string;
    actionBinding?: ProviderActionBindingEntity;
  }): Promise<{
    crlPem: string;
    crlDerBase64: string;
    crlNumber: number;
    thisUpdate: string;
    nextUpdate: string;
    crlFingerprintSha256: string;
    revokedSerialNumbers: string[];
    issuerFingerprintSha256: string;
    signatureVerified: boolean;
  }>;
}

/** 统一外部 Provider 执行口；插件差异只存在于固定 Action Binding 的输入输出。 */
export interface CaPluginActionDispatcher {
  execute(input: {
    provider: CaProviderEntity;
    binding: ProviderActionBindingEntity;
    action: 'issue' | 'query' | 'revoke' | 'revocation_evidence';
    payload: Record<string, unknown>;
    actorId: string;
    idempotencyKey: string;
  }): Promise<Record<string, unknown>>;
}

export class CaProviderRegistry {
  private readonly adapters = new Map<CaProviderEntity['type'], CaProviderAdapter>();

  register(type: CaProviderEntity['type'], adapter: CaProviderAdapter): this {
    this.adapters.set(type, adapter);
    return this;
  }

  get(type: CaProviderEntity['type']): CaProviderAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) throw new AppError('CA_CAPABILITY_UNSUPPORTED', 'CA Provider 尚未注册', { type });
    return adapter;
  }
}

/**
 * 内置 CA 和 ACME 是宿主能力，不能依赖 Plugin Runner。
 * plugin 类型仍然失败关闭，Microsoft ADCS 等外部 CA 必须由其插件运行时明确接入。
 */
export function createDefaultCaProviderRegistry(secrets: SecretService, pluginDispatcher?: CaPluginActionDispatcher): CaProviderRegistry {
  const registry = new CaProviderRegistry();
  registry.register('gcac_builtin', new BuiltinCaProviderAdapter(new OpenSslCa(), secrets));
  registry.register('acme', new AcmeProviderAdapter(secrets));
  registry.register('plugin', new PluginCaProviderAdapter(pluginDispatcher));
  return registry;
}

export class PluginCaProviderAdapter implements CaProviderAdapter {
  constructor(private readonly dispatcher?: CaPluginActionDispatcher) {}

  getCapabilities(): CaProviderCapabilities {
    return { ...unavailableCapabilities(), signCsr: true, queryIssuance: true, revokeCertificate: true, publishCrl: true };
  }

  async validateConnection(provider: CaProviderEntity): Promise<CaProviderValidationResult> {
    return { reachable: Boolean(this.dispatcher), capabilities: this.getCapabilities(), detail: this.dispatcher ? undefined : unavailableDetail('validate_connection', provider.id, 'plugin') };
  }

  async signCsr(command: SignCsrCommand): Promise<CaIssuanceResult> {
    const binding = command.actionBinding;
    if (!binding?.issueAction) throw new AppError('CA_PROVIDER_ACTION_UNBOUND', '外部 CA 缺少固定签发动作绑定');
    const output = await this.execute('issue', command.provider, binding, command.actorId, command.idempotencyKey, {
      operation: 'issue', csrPem: command.csrPem, sans: command.sans, validityDays: command.validityDays,
      profileRules: command.profileRules, serialNumber: command.serialNumber, subject: command.subject,
    });
    return normalizeExternalIssuance(output);
  }

  async queryIssuance(input: { provider: CaProviderEntity; providerRequestId: string; actorId: string; actionBinding?: ProviderActionBindingEntity; idempotencyKey?: string }): Promise<CaIssuanceResult> {
    const binding = input.actionBinding;
    if (!binding?.queryAction) throw new AppError('CA_PROVIDER_ACTION_UNBOUND', '外部 CA 缺少固定查询动作绑定');
    const output = await this.execute('query', input.provider, binding, input.actorId, input.idempotencyKey ?? `query:${input.providerRequestId}`, { operation: 'query', providerRequestId: input.providerRequestId });
    return normalizeExternalIssuance(output);
  }

  async revoke(input: { provider: CaProviderEntity; authority: CertificateAuthorityEntity; serialNumber: string; reason: string; actorId: string; actionBinding?: ProviderActionBindingEntity; idempotencyKey?: string }): Promise<{ revokedAt: string }> {
    const binding = input.actionBinding;
    if (!binding?.revokeAction) throw new AppError('CA_PROVIDER_ACTION_UNBOUND', '外部 CA 缺少固定吊销动作绑定');
    const output = await this.execute('revoke', input.provider, binding, input.actorId, input.idempotencyKey ?? `revoke:${input.authority.id}:${input.serialNumber}`, { operation: 'revoke', serialNumber: input.serialNumber, reason: input.reason });
    const revokedAt = typeof output.revokedAt === 'string' ? output.revokedAt : undefined;
    if (!revokedAt) throw new AppError('CA_PROVIDER_RESULT_INVALID', '外部 CA 吊销回执缺少 revokedAt');
    return { revokedAt };
  }

  async publishCrl(input: Parameters<NonNullable<CaProviderAdapter['publishCrl']>>[0]) {
    const binding = input.actionBinding;
    if (!binding?.revocationEvidenceAction) throw new AppError('CA_PROVIDER_ACTION_UNBOUND', '外部 CA 缺少 CRL/撤销传播查询动作绑定');
    const output = await this.execute('revocation_evidence', input.provider, binding, input.actorId, `crl:${input.authority.id}:${input.crlNumber}`, { operation: 'revocation_evidence', crlNumber: input.crlNumber });
    const crlPem = typeof output.crlPem === 'string' ? output.crlPem : '';
    const status = output.status === 'published' || crlPem ? 'published' : 'failed';
    if (status !== 'published') throw new AppError('CA_CRL_PUBLICATION_FAILED', '外部 CA 未返回可验证 CRL 制品');
    return {
      crlPem, crlDerBase64: typeof output.crlDerBase64 === 'string' ? output.crlDerBase64 : '',
      crlNumber: Number(output.crlNumber ?? input.crlNumber), thisUpdate: String(output.thisUpdate ?? new Date().toISOString()),
      nextUpdate: String(output.nextUpdate ?? new Date(Date.now() + 7 * 86400000).toISOString()),
      crlFingerprintSha256: String(output.crlFingerprintSha256 ?? ''), revokedSerialNumbers: Array.isArray(output.revokedSerialNumbers) ? output.revokedSerialNumbers.filter((value): value is string => typeof value === 'string') : [],
      issuerFingerprintSha256: typeof output.issuerFingerprintSha256 === 'string' ? output.issuerFingerprintSha256 : '',
      signatureVerified: output.signatureVerified === true,
    };
  }

  private async execute(action: 'issue' | 'query' | 'revoke' | 'revocation_evidence', provider: CaProviderEntity, binding: ProviderActionBindingEntity, actorId: string, idempotencyKey: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.dispatcher) throw caPluginRunnerUnavailable(action, provider);
    return this.dispatcher.execute({ provider, binding, action, payload, actorId, idempotencyKey });
  }
}

class BuiltinCaProviderAdapter implements CaProviderAdapter {
  constructor(
    private readonly openssl: OpenSslCa,
    private readonly secrets: SecretService,
  ) {}

  getCapabilities(): CaProviderCapabilities {
    return {
      discoverHierarchy: true,
      createRoot: true,
      createIntermediate: true,
      signCsr: true,
      queryIssuance: true,
      revokeCertificate: true,
      publishCrl: true,
      ocsp: false,
      listProfiles: true,
      deviceLocalCsr: false,
      hardwareBackedKey: false,
      highAvailability: false,
    };
  }

  async validateConnection(): Promise<{ reachable: true; capabilities: CaProviderCapabilities }> {
    return { reachable: true, capabilities: this.getCapabilities() };
  }

  async signCsr(command: SignCsrCommand): Promise<CaIssuanceResult> {
    const authority = command.authority;
    if (!authority.privateKeySecretRef || !authority.certificatePem || !authority.certificateChainPem) {
      throw new AppError('CA_KEY_BACKEND_UNAVAILABLE', '内置 CA 缺少密钥或证书链', { caId: authority.id });
    }
    const privateKey = await this.secrets.resolveForService({
      secretRef: authority.privateKeySecretRef,
      tenantId: authority.tenantId,
      expectedType: 'certificate_private_key',
      purpose: 'internal_ca.sign_csr',
      actorId: command.actorId,
    });
    const issued = await this.openssl.signCsr({
      csrPem: command.csrPem,
      caPrivateKeyPem: privateKey.plainText,
      caCertificatePem: authority.certificatePem,
      caChainPem: authority.certificateChainPem,
      validityDays: command.validityDays,
      sans: command.sans,
      extendedKeyUsages: command.profileRules.extendedKeyUsages,
      serialNumber: command.serialNumber,
      crlDistributionPoint: authority.crlDistributionPoint,
    });
    return { status: 'issued', ...issued, providerRequestId: command.idempotencyKey };
  }

  async revoke(input: { provider: CaProviderEntity; authority: CertificateAuthorityEntity; serialNumber: string; reason: string; actorId: string }): Promise<{ revokedAt: string }> {
    if (!input.serialNumber.trim() || !input.reason.trim()) throw new AppError('VALIDATION_FAILED', '内置 CA 吊销缺少序列号或原因');
    return { revokedAt: new Date().toISOString() };
  }

  async publishCrl(input: {
    provider: CaProviderEntity;
    authority: CertificateAuthorityEntity;
    issuanceRecords: CaIssuanceRecordEntity[];
    crlNumber: number;
    actorId: string;
  }) {
    if (!input.authority.privateKeySecretRef || !input.authority.certificatePem) {
      throw new AppError('CA_KEY_BACKEND_UNAVAILABLE', '内置 CA 缺少 CRL 签名密钥或证书');
    }
    const privateKey = await this.secrets.resolveForService({
      secretRef: input.authority.privateKeySecretRef,
      tenantId: input.authority.tenantId,
      expectedType: 'certificate_private_key',
      purpose: 'internal_ca.publish_crl',
      actorId: input.actorId,
    });
    return this.openssl.publishCrl({
      caPrivateKeyPem: privateKey.plainText,
      caCertificatePem: input.authority.certificatePem,
      issuanceRecords: input.issuanceRecords,
      crlNumber: input.crlNumber,
      distributionPoint: input.authority.crlDistributionPoint,
    });
  }
}

export class UnavailableCaProviderAdapter implements CaProviderAdapter {
  constructor(private readonly type: CaProviderEntity['type']) {}

  getCapabilities(): CaProviderCapabilities {
    return unavailableCapabilities();
  }

  async validateConnection(provider: CaProviderEntity): Promise<{ reachable: false; capabilities: CaProviderCapabilities; detail: string }> {
    return { reachable: false, capabilities: this.getCapabilities(), detail: unavailableDetail('validate_connection', provider.id, this.type) };
  }

  async signCsr(command: SignCsrCommand): Promise<CaIssuanceResult> {
    throw unavailableError('sign_csr', command.provider);
  }

  async queryIssuance(input: { provider: CaProviderEntity; providerRequestId: string; actorId: string }): Promise<CaIssuanceResult> {
    throw unavailableError('query_issuance', input.provider, input.providerRequestId);
  }

  async revoke(input: { provider: CaProviderEntity; authority: CertificateAuthorityEntity; serialNumber: string; reason: string; actorId: string }): Promise<{ revokedAt: string }> {
    throw unavailableError('revoke', input.provider, input.authority.id);
  }
}

export function caPluginRunnerUnavailable(operation: string, provider?: Pick<CaProviderEntity, 'id' | 'type'>): AppError {
  return new AppError('CA_PROVIDER_UNAVAILABLE', '未接入 ca.* Plugin Runner，拒绝执行 CA 操作', {
    code: 'CA_PLUGIN_RUNNER_UNAVAILABLE',
    operation,
    ...(provider ? { providerId: provider.id, providerType: provider.type } : {}),
  });
}

function unavailableError(operation: string, provider: CaProviderEntity, resourceId?: string): AppError {
  return new AppError('CA_PROVIDER_UNAVAILABLE', '未接入 ca.* Plugin Runner，拒绝执行 CA 操作', {
    code: 'CA_PLUGIN_RUNNER_UNAVAILABLE',
    operation,
    providerId: provider.id,
    providerType: provider.type,
    ...(resourceId ? { resourceId } : {}),
  });
}

function unavailableDetail(operation: string, providerId: string, providerType: CaProviderEntity['type']): string {
  return JSON.stringify({ code: 'CA_PLUGIN_RUNNER_UNAVAILABLE', operation, providerId, providerType });
}

function unavailableCapabilities(): CaProviderCapabilities {
  return {
    discoverHierarchy: false,
    createRoot: false,
    createIntermediate: false,
    signCsr: false,
    queryIssuance: false,
    revokeCertificate: false,
    publishCrl: false,
    ocsp: false,
    listProfiles: false,
    deviceLocalCsr: false,
    hardwareBackedKey: false,
    highAvailability: false,
  };
}

function normalizeExternalIssuance(output: Record<string, unknown>): CaIssuanceResult {
  const status = output.status;
  const providerRequestId = typeof output.providerRequestId === 'string' ? output.providerRequestId : undefined;
  if (!providerRequestId) throw new AppError('CA_PROVIDER_RESULT_INVALID', '外部 CA 回执缺少 providerRequestId');
  if (status === 'pending' || status === 'unknown' || status === 'rejected') {
    return { status, providerRequestId, detail: typeof output.detail === 'string' ? output.detail : undefined };
  }
  if (status !== 'issued') throw new AppError('CA_PROVIDER_RESULT_INVALID', '外部 CA 返回未知签发状态');
  const required = ['certificatePem', 'certificateChainPem', 'serialNumber', 'fingerprintSha256', 'publicKeyFingerprintSha256', 'notBefore', 'notAfter'] as const;
  for (const key of required) if (typeof output[key] !== 'string' || !(output[key] as string).trim()) throw new AppError('CA_PROVIDER_RESULT_INVALID', `外部 CA 回执缺少 ${key}`);
  return {
    status: 'issued', providerRequestId,
    certificatePem: output.certificatePem as string, certificateChainPem: output.certificateChainPem as string,
    serialNumber: output.serialNumber as string, fingerprintSha256: output.fingerprintSha256 as string,
    publicKeyFingerprintSha256: output.publicKeyFingerprintSha256 as string,
    notBefore: output.notBefore as string, notAfter: output.notAfter as string,
  };
}

import { AppError } from '../../../common/errors/app-error.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type {
  CaProviderCapabilities,
  CaProviderEntity,
  CertificateAuthorityEntity,
  CertificateProfileRules,
} from '../schema/internal-ca.schema.js';
import { AcmeProviderAdapter } from './acme-provider.js';
import { OpenSslCa } from './openssl-ca.js';

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
  sans: string[];
  validityDays: number;
  profileRules: CertificateProfileRules;
  idempotencyKey: string;
  actorId: string;
  serialNumber?: string;
}

export type CaIssuanceResult =
  | ({ status: 'issued' } & IssuedCertificateMaterial & { providerRequestId: string })
  | { status: 'pending' | 'unknown'; providerRequestId: string; detail?: string }
  | { status: 'rejected'; providerRequestId: string; detail?: string };

/** CA 执行端口。内置 CA 与 ACME 由宿主实现；外部 CA 由插件提供执行端。 */
export interface CaProviderAdapter {
  getCapabilities(): CaProviderCapabilities;
  validateConnection(provider: CaProviderEntity): Promise<{ reachable: boolean; capabilities: CaProviderCapabilities; detail?: string }>;
  signCsr(command: SignCsrCommand): Promise<CaIssuanceResult>;
  queryIssuance?(input: { provider: CaProviderEntity; providerRequestId: string; actorId: string }): Promise<CaIssuanceResult>;
  revoke?(input: { provider: CaProviderEntity; authority: CertificateAuthorityEntity; serialNumber: string; reason: string; actorId: string }): Promise<{ revokedAt: string }>;
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
 * plugin 类型仍然失败关闭，外部 CA 必须由其插件运行时明确接入。
 */
export function createDefaultCaProviderRegistry(secrets: SecretService): CaProviderRegistry {
  const registry = new CaProviderRegistry();
  registry.register('gcac_builtin', new BuiltinCaProviderAdapter(new OpenSslCa(), secrets));
  registry.register('gcac_managed_node', new UnavailableCaProviderAdapter('gcac_managed_node'));
  registry.register('acme', new AcmeProviderAdapter(secrets));
  registry.register('plugin', new UnavailableCaProviderAdapter('plugin'));
  return registry;
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
      publishCrl: false,
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
    });
    return { status: 'issued', ...issued, providerRequestId: command.idempotencyKey };
  }

  async revoke(): Promise<{ revokedAt: string }> {
    return { revokedAt: new Date().toISOString() };
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

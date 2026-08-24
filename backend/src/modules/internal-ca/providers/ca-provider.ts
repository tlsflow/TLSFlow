import { AppError } from '../../../common/errors/app-error.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type {
  CaProviderCapabilities,
  CaProviderEntity,
  CertificateAuthorityEntity,
  CertificateProfileRules,
} from '../schema/internal-ca.schema.js';

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

/** CA 执行端口。宿主只依赖此合同，不拥有任何厂商执行代码。 */
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

/** 默认注册只提供失败关闭行为，Phase 2 才允许由 ca.* Plugin Runner 注入执行端。 */
export function createDefaultCaProviderRegistry(_secrets: SecretService): CaProviderRegistry {
  const registry = new CaProviderRegistry();
  const types: CaProviderEntity['type'][] = [
    'gcac_builtin', 'gcac_managed_node', 'plugin',
  ];
  for (const type of types) registry.register(type, new UnavailableCaProviderAdapter(type));
  return registry;
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

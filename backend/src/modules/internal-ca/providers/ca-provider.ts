import { AppError } from '../../../common/errors/app-error.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type {
  CaProviderCapabilities,
  CaProviderEntity,
  CertificateAuthorityEntity,
  CertificateProfileRules,
} from '../schema/internal-ca.schema.js';
import { OpenSslCa, type IssuedCertificateMaterial } from './openssl-ca.js';

export interface SignCsrCommand {
  provider: CaProviderEntity;
  authority: CertificateAuthorityEntity;
  csrPem: string;
  sans: string[];
  validityDays: number;
  profileRules: CertificateProfileRules;
  idempotencyKey: string;
  actorId: string;
}

export interface CaProviderAdapter {
  getCapabilities(): CaProviderCapabilities;
  validateConnection(provider: CaProviderEntity): Promise<{ reachable: boolean; capabilities: CaProviderCapabilities; detail?: string }>;
  signCsr(command: SignCsrCommand): Promise<IssuedCertificateMaterial & { providerRequestId: string }>;
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

export function createDefaultCaProviderRegistry(secrets: SecretService): CaProviderRegistry {
  const openssl = new OpenSslCa();
  const registry = new CaProviderRegistry();
  registry.register('gcac_builtin', new BuiltinCaProvider(openssl, secrets));
  registry.register('gcac_managed_node', new RemoteSigningCaProvider(secrets, managedNodeCapabilities()));
  registry.register('microsoft_adcs', new RemoteSigningCaProvider(secrets, externalCapabilities({ listProfiles: true, revokeCertificate: true })));
  registry.register('acme', new RemoteSigningCaProvider(secrets, externalCapabilities({ revokeCertificate: true })));
  registry.register('est', new RemoteSigningCaProvider(secrets, externalCapabilities()));
  registry.register('scep', new RemoteSigningCaProvider(secrets, externalCapabilities()));
  registry.register('product_adapter', new RemoteSigningCaProvider(secrets, externalCapabilities()));
  return registry;
}

class BuiltinCaProvider implements CaProviderAdapter {
  constructor(private readonly openssl: OpenSslCa, private readonly secrets: SecretService) {}

  getCapabilities(): CaProviderCapabilities {
    return builtinCapabilities();
  }

  async validateConnection(): Promise<{ reachable: boolean; capabilities: CaProviderCapabilities }> {
    return { reachable: true, capabilities: this.getCapabilities() };
  }

  async signCsr(command: SignCsrCommand): Promise<IssuedCertificateMaterial & { providerRequestId: string }> {
    if (!command.authority.keyReferenceId || !command.authority.certificatePem || !command.authority.certificateChainPem) {
      throw new AppError('CA_KEY_BACKEND_UNAVAILABLE', '内置 CA 缺少密钥或证书链', { caId: command.authority.id });
    }
    const secretRef = command.authority.privateKeySecretRef;
    if (!secretRef) throw new AppError('CA_KEY_BACKEND_UNAVAILABLE', '内置 CA 密钥引用不可用', { caId: command.authority.id });
    const privateKey = await this.secrets.resolveForService({
      secretRef,
      expectedType: 'certificate_private_key',
      purpose: 'internal_ca.sign_csr',
      actorId: command.actorId,
    });
    const issued = await this.openssl.signCsr({
      csrPem: command.csrPem,
      caPrivateKeyPem: privateKey.plainText,
      caCertificatePem: command.authority.certificatePem,
      caChainPem: command.authority.certificateChainPem,
      validityDays: command.validityDays,
      sans: command.sans,
      extendedKeyUsages: command.profileRules.extendedKeyUsages,
    });
    return { ...issued, providerRequestId: command.idempotencyKey };
  }

  async revoke(): Promise<{ revokedAt: string }> {
    return { revokedAt: new Date().toISOString() };
  }
}

class RemoteSigningCaProvider implements CaProviderAdapter {
  constructor(private readonly secrets: SecretService, private readonly capabilities: CaProviderCapabilities) {}

  getCapabilities(): CaProviderCapabilities {
    return { ...this.capabilities };
  }

  async validateConnection(provider: CaProviderEntity): Promise<{ reachable: boolean; capabilities: CaProviderCapabilities; detail?: string }> {
    if (!provider.endpoint) return { reachable: false, capabilities: this.getCapabilities(), detail: 'endpoint_missing' };
    try {
      const response = await fetch(new URL('/health', provider.endpoint), { signal: AbortSignal.timeout(5000) });
      return { reachable: response.ok, capabilities: this.getCapabilities(), detail: response.ok ? undefined : `http_${response.status}` };
    } catch (error) {
      return { reachable: false, capabilities: this.getCapabilities(), detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async signCsr(command: SignCsrCommand): Promise<IssuedCertificateMaterial & { providerRequestId: string }> {
    const response = await this.request(command.provider, '/v1/sign', {
      caId: command.authority.id,
      csrPem: command.csrPem,
      sans: command.sans,
      validityDays: command.validityDays,
      extendedKeyUsages: command.profileRules.extendedKeyUsages,
      idempotencyKey: command.idempotencyKey,
    }, command.actorId);
    return normalizeRemoteIssuance(response, command.idempotencyKey);
  }

  async revoke(input: { provider: CaProviderEntity; authority: CertificateAuthorityEntity; serialNumber: string; reason: string; actorId: string }): Promise<{ revokedAt: string }> {
    if (!this.capabilities.revokeCertificate) throw new AppError('CERTIFICATE_REVOCATION_UNSUPPORTED', '当前 CA Provider 不支持吊销');
    const response = await this.request(input.provider, '/v1/revoke', {
      caId: input.authority.id,
      serialNumber: input.serialNumber,
      reason: input.reason,
    }, input.actorId);
    return { revokedAt: stringValue(response, 'revokedAt') ?? new Date().toISOString() };
  }

  private async request(provider: CaProviderEntity, path: string, body: Record<string, unknown>, actorId: string): Promise<Record<string, unknown>> {
    if (!provider.endpoint) throw new AppError('CA_PROVIDER_UNAVAILABLE', 'CA Provider 未配置 endpoint', { providerId: provider.id });
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (provider.credentialSecretRef) {
      const credential = await this.secrets.resolveForService({
        secretRef: provider.credentialSecretRef,
        purpose: 'internal_ca.provider_request',
        actorId,
      });
      headers.authorization = `Bearer ${credential.plainText}`;
    }
    let response: Response;
    try {
      response = await fetch(new URL(path, provider.endpoint), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      throw new AppError('CA_PROVIDER_UNAVAILABLE', 'CA Provider 请求失败', {
        providerId: provider.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new AppError('CA_PROVIDER_UNAVAILABLE', 'CA Provider 返回失败', {
        providerId: provider.id,
        status: response.status,
        code: stringValue(result, 'code'),
      });
    }
    return result;
  }
}

function builtinCapabilities(): CaProviderCapabilities {
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

function managedNodeCapabilities(): CaProviderCapabilities {
  return { ...builtinCapabilities(), publishCrl: true, ocsp: true, hardwareBackedKey: true, highAvailability: true };
}

function externalCapabilities(patch: Partial<CaProviderCapabilities> = {}): CaProviderCapabilities {
  return {
    discoverHierarchy: true,
    createRoot: false,
    createIntermediate: false,
    signCsr: true,
    queryIssuance: true,
    revokeCertificate: false,
    publishCrl: false,
    ocsp: false,
    listProfiles: false,
    deviceLocalCsr: true,
    hardwareBackedKey: true,
    highAvailability: true,
    ...patch,
  };
}

function normalizeRemoteIssuance(value: Record<string, unknown>, fallbackRequestId: string): IssuedCertificateMaterial & { providerRequestId: string } {
  const certificatePem = requiredString(value, 'certificatePem');
  const certificateChainPem = requiredString(value, 'certificateChainPem');
  return {
    certificatePem,
    certificateChainPem,
    serialNumber: requiredString(value, 'serialNumber'),
    fingerprintSha256: requiredString(value, 'fingerprintSha256'),
    publicKeyFingerprintSha256: requiredString(value, 'publicKeyFingerprintSha256'),
    notBefore: requiredString(value, 'notBefore'),
    notAfter: requiredString(value, 'notAfter'),
    providerRequestId: stringValue(value, 'providerRequestId') ?? fallbackRequestId,
  };
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const item = stringValue(value, key);
  if (!item) throw new AppError('CA_PROVIDER_UNAVAILABLE', 'CA Provider 响应缺少必要字段', { key });
  return item;
}

function stringValue(value: object, key: string): string | undefined {
  const item = (value as Record<string, unknown>)[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

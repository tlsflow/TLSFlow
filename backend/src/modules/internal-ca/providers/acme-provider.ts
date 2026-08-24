import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  createSign,
  type KeyObject,
} from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type {
  CaProviderCapabilities,
  CaProviderEntity,
} from '../schema/internal-ca.schema.js';
import {
  type AcmeAccountEntity,
  type AcmeAuthorizationEntity,
  type AcmeChallengeEntity,
  type AcmeChallengeType,
  type AcmeDirectoryMetadata,
  type AcmeOrderEntity,
} from '../schema/acme.schema.js';
import type {
  CaIssuanceResult,
  CaProviderAdapter,
  SignCsrCommand,
} from './ca-provider.js';
import { AcmeDomainService } from '../domain/acme.domain-service.js';

interface AcmeHttpResult {
  response: Response;
  body: Record<string, unknown>;
  retryAfterAt?: string;
}

export interface CreateAcmeAccountCommand {
  provider: CaProviderEntity;
  accountKeySecretRef: string;
  contact: string[];
  termsOfServiceAgreed: boolean;
  eabKeyIdSecretRef?: string;
  eabHmacSecretRef?: string;
  actorId: string;
}

export interface CreateAcmeOrderCommand {
  provider: CaProviderEntity;
  account: AcmeAccountEntity;
  identifiers: Array<{ type: 'dns' | 'ip'; value: string }>;
  actorId: string;
}

export interface GetAcmeAuthorizationCommand {
  provider: CaProviderEntity;
  account: AcmeAccountEntity;
  authorizationUrl: string;
  actorId: string;
}

export interface RespondToAcmeChallengeCommand {
  provider: CaProviderEntity;
  account: AcmeAccountEntity;
  challengeUrl: string;
  actorId: string;
}

export interface FinalizeAcmeOrderCommand {
  provider: CaProviderEntity;
  account: AcmeAccountEntity;
  finalizeUrl: string;
  csrPem: string;
  actorId: string;
}

export interface DownloadAcmeCertificateCommand {
  provider: CaProviderEntity;
  account: AcmeAccountEntity;
  certificateUrl: string;
  actorId: string;
}

export interface AcmeOrderSnapshot {
  externalOrderUrl: string;
  status: AcmeOrderEntity['status'];
  identifiers: Array<{ type: 'dns' | 'ip'; value: string }>;
  authorizationUrls: string[];
  finalizeUrl?: string;
  certificateUrl?: string;
  expiresAt?: string;
  retryAfterAt?: string;
  errorType?: string;
  errorDetail?: string;
}

export interface AcmeAuthorizationSnapshot extends Pick<AcmeAuthorizationEntity, 'externalAuthorizationUrl' | 'identifier' | 'status' | 'expiresAt' | 'wildcard'> {
  challenges: Array<{
    url: string;
    type: AcmeChallengeType;
    token: string;
    status: AcmeChallengeEntity['status'] | 'pending' | 'processing' | 'valid' | 'invalid';
  }>;
}

export interface AcmeCertificateMaterial {
  certificatePem: string;
  certificateChainPem: string;
  certificateUrl: string;
}

export class AcmeProviderAdapter implements CaProviderAdapter {
  private readonly domain = new AcmeDomainService();

  constructor(private readonly secrets: SecretService) {}

  getCapabilities(): CaProviderCapabilities {
    return {
      discoverHierarchy: false,
      createRoot: false,
      createIntermediate: false,
      signCsr: true,
      queryIssuance: true,
      revokeCertificate: true,
      publishCrl: false,
      ocsp: false,
      listProfiles: false,
      deviceLocalCsr: false,
      hardwareBackedKey: false,
      highAvailability: true,
    };
  }

  async validateConnection(provider: CaProviderEntity): Promise<{ reachable: boolean; capabilities: CaProviderCapabilities; detail?: string }> {
    try {
      await this.getDirectory({ provider });
      return { reachable: true, capabilities: this.getCapabilities() };
    } catch (error) {
      return {
        reachable: false,
        capabilities: this.getCapabilities(),
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getDirectory(input: { provider: CaProviderEntity }): Promise<AcmeDirectoryMetadata> {
    const configuration = this.domain.assertProvider(input.provider);
    const response = await this.fetchJson(configuration.directoryUrl, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': configuration.userAgent ?? 'GCAC ACME Client' },
      provider: input.provider,
    });
    if (!response.response.ok) {
      throw new AppError('ACME_DIRECTORY_UNAVAILABLE', 'ACME Directory 返回失败', { status: response.response.status });
    }
    const directory = response.body;
    const newNonceUrl = requiredUrl(directory, 'newNonce', configuration.directoryUrl);
    const newAccountUrl = requiredUrl(directory, 'newAccount', configuration.directoryUrl);
    const newOrderUrl = requiredUrl(directory, 'newOrder', configuration.directoryUrl);
    return {
      directoryUrl: configuration.directoryUrl,
      newNonceUrl,
      newAccountUrl,
      newOrderUrl,
      revokeCertUrl: optionalUrl(directory, 'revokeCert', configuration.directoryUrl),
      keyChangeUrl: optionalUrl(directory, 'keyChange', configuration.directoryUrl),
      meta: directory.meta && typeof directory.meta === 'object' ? {
        termsOfService: stringValue(directory.meta, 'termsOfService'),
        website: stringValue(directory.meta, 'website'),
        caaIdentities: arrayValue(objectValue(directory.meta).caaIdentities).map(String),
      } : undefined,
      fetchedAt: new Date().toISOString(),
    };
  }

  async createAccount(command: CreateAcmeAccountCommand): Promise<{ accountUrl: string; status: AcmeAccountEntity['status'] }> {
    this.domain.validateAccountSecretRefs(command);
    const directory = await this.getDirectory({ provider: command.provider });
    const payload: Record<string, unknown> = {
      contact: command.contact,
      termsOfServiceAgreed: command.termsOfServiceAgreed,
    };
    if (command.eabKeyIdSecretRef || command.eabHmacSecretRef) {
      if (!command.eabKeyIdSecretRef || !command.eabHmacSecretRef) {
        throw new AppError('ACME_ACCOUNT_INVALID', 'EAB 必须同时提供 Key ID 和 HMAC SecretRef');
      }
      payload.externalAccountBinding = await this.buildExternalAccountBinding(command, directory.newAccountUrl);
    }
    const result = await this.signedRequest({
      provider: command.provider,
      secretRef: command.accountKeySecretRef,
      url: directory.newAccountUrl,
      payload,
      actorId: command.actorId,
      useJwk: true,
    });
    const location = result.response.headers.get('location');
    if (!result.response.ok || !location) {
      throw new AppError('ACME_ACCOUNT_INVALID', 'ACME Account 创建失败', {
        status: result.response.status,
        type: stringValue(result.body, 'type'),
      });
    }
    return {
      accountUrl: location,
      status: stringValue(result.body, 'status') === 'valid' ? 'active' : 'pending',
    };
  }

  async newNonce(input: { provider: CaProviderEntity }): Promise<string> {
    const directory = await this.getDirectory({ provider: input.provider });
    const configuration = this.domain.assertProvider(input.provider);
    let response: Response;
    try {
      response = await fetch(directory.newNonceUrl, {
        method: 'HEAD',
        headers: { 'user-agent': configuration.userAgent ?? 'GCAC ACME Client' },
        signal: AbortSignal.timeout(configuration.requestTimeoutMs ?? 15000),
      });
    } catch (error) {
      throw new AppError('ACME_DIRECTORY_UNAVAILABLE', 'ACME Nonce 请求失败', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    const nonce = response.headers.get('replay-nonce');
    if (!response.ok || !nonce) {
      throw new AppError('ACME_NONCE_REJECTED', 'ACME CA 未返回有效 Nonce', { status: response.status });
    }
    return nonce;
  }

  async createOrder(command: CreateAcmeOrderCommand): Promise<AcmeOrderSnapshot> {
    const directory = await this.getDirectory({ provider: command.provider });
    const result = await this.signedRequest({
      provider: command.provider,
      secretRef: command.account.accountKeySecretRef,
      kid: command.account.accountUrl,
      url: directory.newOrderUrl,
      payload: { identifiers: command.identifiers },
      actorId: command.actorId,
    });
    return this.orderSnapshot(result.response, result.body);
  }

  async getAuthorization(command: GetAcmeAuthorizationCommand): Promise<AcmeAuthorizationSnapshot> {
    const result = await this.signedRequest({
      provider: command.provider,
      secretRef: command.account.accountKeySecretRef,
      kid: command.account.accountUrl,
      url: command.authorizationUrl,
      payload: null,
      actorId: command.actorId,
    });
    const identifier = objectValue(result.body.identifier);
    const challenges = arrayValue(result.body.challenges).map((item) => {
      const challenge = objectValue(item);
      const type = stringValue(challenge, 'type');
      if (!['http-01', 'dns-01', 'tls-alpn-01'].includes(type ?? '')) {
        throw new AppError('ACME_CHALLENGE_FAILED', 'ACME CA 返回不支持的 Challenge 类型', { type });
      }
      return {
        url: requiredString(challenge, 'url'),
        type: type as AcmeChallengeType,
        token: requiredString(challenge, 'token'),
        status: (stringValue(challenge, 'status') ?? 'pending') as AcmeAuthorizationSnapshot['challenges'][number]['status'],
      };
    });
    return {
      externalAuthorizationUrl: command.authorizationUrl,
      identifier: {
        type: stringValue(identifier, 'type') === 'ip' ? 'ip' : 'dns',
        value: requiredString(identifier, 'value'),
      },
      status: normalizeAuthorizationStatus(stringValue(result.body, 'status')),
      expiresAt: stringValue(result.body, 'expires'),
      wildcard: result.body.wildcard === true,
      challenges,
    };
  }

  async respondToChallenge(command: RespondToAcmeChallengeCommand): Promise<{ status: string; retryAfterAt?: string }> {
    const result = await this.signedRequest({
      provider: command.provider,
      secretRef: command.account.accountKeySecretRef,
      kid: command.account.accountUrl,
      url: command.challengeUrl,
      payload: {},
      actorId: command.actorId,
    });
    return {
      status: stringValue(result.body, 'status') ?? 'processing',
      retryAfterAt: result.retryAfterAt,
    };
  }

  async finalizeOrder(command: FinalizeAcmeOrderCommand): Promise<AcmeOrderSnapshot> {
    const result = await this.signedRequest({
      provider: command.provider,
      secretRef: command.account.accountKeySecretRef,
      kid: command.account.accountUrl,
      url: command.finalizeUrl,
      payload: { csr: encodeBase64Url(pemToDer(command.csrPem)) },
      actorId: command.actorId,
    });
    return this.orderSnapshot(result.response, result.body);
  }

  async downloadCertificate(command: DownloadAcmeCertificateCommand): Promise<AcmeCertificateMaterial> {
    const result = await this.signedRequest({
      provider: command.provider,
      secretRef: command.account.accountKeySecretRef,
      kid: command.account.accountUrl,
      url: command.certificateUrl,
      payload: null,
      actorId: command.actorId,
      accept: 'application/pkix-cert, application/pem-certificate-chain',
    });
    if (!result.response.ok) {
      throw new AppError('ACME_DOWNLOAD_FAILED', 'ACME 证书下载失败', { status: result.response.status });
    }
    const certificatePem = String(result.body.__rawText ?? '').trim();
    if (!certificatePem.includes('BEGIN CERTIFICATE')) {
      throw new AppError('ACME_DOWNLOAD_FAILED', 'ACME 证书响应不是 PEM 证书链');
    }
    return {
      certificatePem: firstPemCertificate(certificatePem),
      certificateChainPem: certificatePem,
      certificateUrl: command.certificateUrl,
    };
  }

  async signCsr(_command: SignCsrCommand): Promise<CaIssuanceResult> {
    throw new AppError('ACME_ORDER_REQUIRED', 'ACME 必须先完成 Account、Order 和 Challenge，再提交 CSR');
  }

  async queryIssuance(_input: { provider: CaProviderEntity; providerRequestId: string; actorId: string }): Promise<CaIssuanceResult> {
    throw new AppError('ACME_ORDER_REQUIRED', 'ACME 状态查询必须由订单服务携带 Account 上下文执行');
  }

  async revoke(): Promise<{ revokedAt: string }> {
    throw new AppError('CA_CAPABILITY_UNSUPPORTED', 'ACME 证书吊销需要订单服务携带证书 URL');
  }

  private async buildExternalAccountBinding(command: CreateAcmeAccountCommand, url: string): Promise<Record<string, string>> {
    const keyId = await this.secrets.resolveForService({
      secretRef: command.eabKeyIdSecretRef!,
      purpose: 'acme.eab.key_id',
      actorId: command.actorId,
    });
    const hmac = await this.secrets.resolveForService({
      secretRef: command.eabHmacSecretRef!,
      purpose: 'acme.eab.hmac',
      actorId: command.actorId,
    });
    const accountKey = await this.resolvePrivateKey(command.accountKeySecretRef, command.actorId);
    const protectedEncoded = encodeBase64UrlJson({ alg: 'HS256', kid: keyId.plainText, url });
    const payloadEncoded = encodeBase64UrlJson(publicJwk(accountKey));
    const signature = encodeBase64Url(createHmac('sha256', hmac.plainText).update(`${protectedEncoded}.${payloadEncoded}`).digest());
    return { protected: protectedEncoded, payload: payloadEncoded, signature };
  }

  private async signedRequest(input: {
    provider: CaProviderEntity;
    secretRef: string;
    kid?: string;
    url: string;
    payload: Record<string, unknown> | null;
    actorId: string;
    useJwk?: boolean;
    accept?: string;
  }): Promise<AcmeHttpResult> {
    const configuration = this.domain.assertProvider(input.provider);
    const privateKey = await this.resolvePrivateKey(input.secretRef, input.actorId);
    let nonce = await this.newNonce({ provider: input.provider });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const protectedHeader: Record<string, unknown> = {
        alg: 'RS256',
        nonce,
        url: input.url,
        ...(input.useJwk || !input.kid ? { jwk: publicJwk(privateKey) } : { kid: input.kid }),
      };
      const protectedEncoded = encodeBase64UrlJson(protectedHeader);
      const payloadEncoded = input.payload === null ? '' : encodeBase64UrlJson(input.payload);
      const signature = signJws(privateKey, `${protectedEncoded}.${payloadEncoded}`);
      let response: Response;
      try {
        response = await fetch(input.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/jose+json',
            accept: input.accept ?? 'application/json',
            'user-agent': configuration.userAgent ?? 'GCAC ACME Client',
          },
          body: JSON.stringify({ protected: protectedEncoded, payload: payloadEncoded, signature }),
          signal: AbortSignal.timeout(configuration.requestTimeoutMs ?? 15000),
        });
      } catch (error) {
        throw new AppError('ACME_DIRECTORY_UNAVAILABLE', 'ACME 协议请求失败', {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      const bodyText = await response.text();
      const body = parseAcmeBody(bodyText);
      const retryAfterAt = parseRetryAfter(response.headers.get('retry-after'));
      if (response.status === 400 && stringValue(body, 'type')?.endsWith('badNonce') && attempt === 0) {
        nonce = await this.newNonce({ provider: input.provider });
        continue;
      }
      if (response.status === 400 && stringValue(body, 'type')?.endsWith('badNonce')) {
        throw new AppError('ACME_NONCE_REJECTED', 'ACME CA 连续拒绝 Nonce');
      }
      if (response.status === 429) throw new AppError('ACME_RATE_LIMITED', 'ACME CA 返回限流', { retryAfterAt });
      if (!response.ok && response.status >= 500) {
        throw new AppError('ACME_DIRECTORY_UNAVAILABLE', 'ACME CA 暂时不可用', { status: response.status, retryAfterAt });
      }
      if (!response.ok && stringValue(body, 'type')) {
        throw new AppError(mapAcmeError(stringValue(body, 'type')!), stringValue(body, 'detail') ?? 'ACME CA 返回协议错误', {
          type: stringValue(body, 'type'),
          retryAfterAt,
        });
      }
      if (input.accept?.includes('pkix-cert')) body.__rawText = bodyText;
      return { response, body, retryAfterAt };
    }
    throw new AppError('ACME_NONCE_REJECTED', 'ACME Nonce 重试失败');
  }

  private async fetchJson(url: string, options: RequestInit & { provider: CaProviderEntity }): Promise<AcmeHttpResult> {
    const { provider, ...requestInit } = options;
    const configuration = this.domain.assertProvider(provider);
    let response: Response;
    try {
      response = await fetch(url, {
        ...requestInit,
        signal: AbortSignal.timeout(configuration.requestTimeoutMs ?? 15000),
      });
    } catch (error) {
      throw new AppError('ACME_DIRECTORY_UNAVAILABLE', 'ACME Directory 请求失败', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      response,
      body: parseAcmeBody(await response.text()),
      retryAfterAt: parseRetryAfter(response.headers.get('retry-after')),
    };
  }

  private async resolvePrivateKey(secretRef: string, actorId: string): Promise<KeyObject> {
    try {
      const secret = await this.secrets.resolveForService({
        secretRef,
        expectedType: 'certificate_private_key',
        purpose: 'acme.account.protocol',
        actorId,
      });
      const key = createPrivateKey(secret.plainText);
      if (key.asymmetricKeyType !== 'rsa') throw new Error('only rsa acme account keys are supported');
      return key;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('ACME_SECRET_RESOLVE_DENIED', 'ACME Account Key 无法解析');
    }
  }

  private orderSnapshot(response: Response, body: Record<string, unknown>): AcmeOrderSnapshot {
    if (!response.ok) {
      throw new AppError('ACME_ORDER_CONFLICT', stringValue(body, 'detail') ?? 'ACME Order 创建或更新失败', {
        status: response.status,
      });
    }
    const externalOrderUrl = response.headers.get('location') ?? stringValue(body, 'url');
    if (!externalOrderUrl) throw new AppError('ACME_ORDER_CONFLICT', 'ACME 响应缺少 Order URL');
    const identifiers: Array<{ type: 'dns' | 'ip'; value: string }> = arrayValue(body.identifiers).map((item) => {
      const identifier = objectValue(item);
      return {
        type: (stringValue(identifier, 'type') === 'ip' ? 'ip' : 'dns') as 'dns' | 'ip',
        value: requiredString(identifier, 'value'),
      };
    });
    return {
      externalOrderUrl,
      status: normalizeOrderStatus(stringValue(body, 'status')),
      identifiers,
      authorizationUrls: arrayValue(body.authorizations).map(String),
      finalizeUrl: stringValue(body, 'finalize'),
      certificateUrl: stringValue(body, 'certificate'),
      expiresAt: stringValue(body, 'expires'),
      retryAfterAt: parseRetryAfter(response.headers.get('retry-after')),
      errorType: stringValue(objectValue(body.error), 'type'),
      errorDetail: stringValue(objectValue(body.error), 'detail'),
    };
  }
}

function publicJwk(key: KeyObject): Record<string, string> {
  const jwk = createPublicKey(key).export({ format: 'jwk' }) as Record<string, unknown>;
  if (jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
    throw new AppError('ACME_ACCOUNT_INVALID', 'ACME Account Key 必须是 RSA 私钥');
  }
  return { e: jwk.e, kty: jwk.kty, n: jwk.n };
}

function signJws(key: KeyObject, input: string): string {
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  signer.end();
  return encodeBase64Url(signer.sign(key));
}

function pemToDer(pem: string): Buffer {
  const match = pem.match(/-----BEGIN (?:NEW )?CERTIFICATE REQUEST-----([\s\S]+?)-----END (?:NEW )?CERTIFICATE REQUEST-----/);
  if (!match) throw new AppError('VALIDATION_FAILED', 'CSR 必须是 PEM PKCS#10 格式');
  return Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
}

function firstPemCertificate(value: string): string {
  const match = value.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  if (!match) throw new AppError('ACME_DOWNLOAD_FAILED', 'ACME 响应缺少 leaf certificate');
  return `${match[0]}\n`;
}

function parseAcmeBody(value: string): Record<string, unknown> {
  if (!value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return { __rawText: value };
  }
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function encodeBase64UrlJson(value: unknown): string {
  return encodeBase64Url(JSON.stringify(value));
}

function parseRetryAfter(value: string | null): string | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return new Date(Date.now() + Math.max(0, seconds) * 1000).toISOString();
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function requiredUrl(value: Record<string, unknown>, key: string, base: string): string {
  const raw = stringValue(value, key);
  if (!raw) throw new AppError('ACME_DIRECTORY_UNAVAILABLE', `ACME Directory 缺少 ${key}`);
  return new URL(raw, base).toString();
}

function optionalUrl(value: Record<string, unknown>, key: string, base: string): string | undefined {
  const raw = stringValue(value, key);
  return raw ? new URL(raw, base).toString() : undefined;
}

function stringValue(value: unknown, key: string): string | undefined {
  const candidate = objectValue(value)[key];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = stringValue(value, key);
  if (!result) throw new AppError('ACME_ORDER_CONFLICT', `ACME 响应缺少 ${key}`);
  return result;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeOrderStatus(value: string | undefined): AcmeOrderEntity['status'] {
  return ['pending', 'ready', 'processing', 'valid', 'invalid', 'expired', 'cancelled'].includes(value ?? '')
    ? value as AcmeOrderEntity['status']
    : 'pending';
}

function normalizeAuthorizationStatus(value: string | undefined): AcmeAuthorizationEntity['status'] {
  return ['pending', 'valid', 'invalid', 'deactivated', 'expired', 'revoked'].includes(value ?? '')
    ? value as AcmeAuthorizationEntity['status']
    : 'pending';
}

function mapAcmeError(type: string): 'ACME_ACCOUNT_INVALID' | 'ACME_ORDER_CONFLICT' | 'ACME_CHALLENGE_FAILED' | 'ACME_CERTIFICATE_MISMATCH' {
  if (type.endsWith('unauthorized') || type.endsWith('rejectedIdentifier') || type.endsWith('malformed')) return 'ACME_ACCOUNT_INVALID';
  if (type.endsWith('orderNotReady') || type.endsWith('orderNotFound')) return 'ACME_ORDER_CONFLICT';
  if (type.endsWith('connection') || type.endsWith('dns') || type.endsWith('tls')) return 'ACME_CHALLENGE_FAILED';
  return 'ACME_ORDER_CONFLICT';
}

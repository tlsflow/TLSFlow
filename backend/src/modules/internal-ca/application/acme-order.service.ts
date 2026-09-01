import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import { AcmeDomainService } from '../domain/acme.domain-service.js';
import type { AcmeRepository } from '../repository/acme.repository.js';
import type { InternalCaRepository } from '../repository/internal-ca.repository.js';
import type {
  AcmeAuthorizationEntity,
  AcmeChallengeEntity,
  AcmeChallengeType,
  AcmeOrderEntity,
} from '../schema/acme.schema.js';
import type { CertificateRequestEntity, CaProviderEntity } from '../schema/internal-ca.schema.js';
import { AcmeProviderAdapter, type AcmeCertificateMaterial, type AcmeOrderSnapshot } from '../providers/acme-provider.js';
import { hashAcmeMaterial } from './acme-account.service.js';
import type { SecretService } from '../../secrets/secret.service.js';
import { validateLegoCredentialPayload } from '../providers/lego-dns-issuer.js';

export interface CreateAcmeOrderServiceInput {
  tenantId: string;
  providerId: string;
  accountId: string;
  certificateRequestId: string;
  challengeType: AcmeChallengeType;
  idempotencyKey: string;
  actorId: string;
}

export interface AcmeOrderView {
  id: string;
  status: AcmeOrderEntity['status'];
  certificateRequestId: string;
  certificateAssetId?: string;
  externalOrderUrl: string;
  identifiers: AcmeOrderEntity['identifiers'];
  authorizationCount: number;
  challengeCount: number;
  challenges: Array<{
    id: string;
    type: AcmeChallengeType;
    identifier: string;
    status: AcmeChallengeEntity['status'];
    presentationId?: string;
    retryAfterAt?: string;
    failureCode?: string;
    failureSummary?: string;
  }>;
  retryAfterAt?: string;
  failureCode?: string;
  failureSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export class AcmeOrderService {
  private readonly domain: AcmeDomainService = new AcmeDomainService();

  constructor(
    private readonly repository: AcmeRepository,
    private readonly caRepository: InternalCaRepository,
    private readonly adapter: AcmeProviderAdapter,
    private readonly secrets?: Pick<SecretService, 'resolveForService'>,
  ) {}

  async create(input: CreateAcmeOrderServiceInput): Promise<AcmeOrderView> {
    const request = await this.requireRequest(input.tenantId, input.certificateRequestId);
    const provider = await this.requireProvider(input.tenantId, input.providerId);
    const account = await this.repository.getAccount(input.tenantId, input.accountId);
    if (!account || account.providerId !== provider.id || account.status !== 'active') {
      throw new AppError('ACME_ACCOUNT_INVALID', 'ACME Account 不存在、未激活或与 Provider 不匹配');
    }
    const configuration = this.domain.assertProvider(provider);
    this.domain.assertChallengeAllowed(configuration, input.challengeType);
    if (!['approved', 'issuing', 'issue_failed'].includes(request.status)) {
      throw new AppError('ACME_ORDER_CONFLICT', '证书申请当前不允许创建 ACME Order', { status: request.status });
    }

    await this.assertDedicatedAcmeBinding(input, request);

    const existing = await this.repository.getOrderByRequest(input.tenantId, request.id, true);
    if (existing) return this.toView(existing);

    const identifiers = this.domain.normalizeIdentifiers([
      { type: 'dns', value: request.subjectCommonName },
      ...request.sans.map((value) => ({ type: 'dns' as const, value })),
    ]);
    let snapshot: AcmeOrderSnapshot;
    try {
      snapshot = await this.adapter.createOrder({
        provider,
        account,
        identifiers,
        actorId: input.actorId,
      });
    } catch (error) {
      throw error;
    }
    const now = new Date().toISOString();
    const order: AcmeOrderEntity = {
      id: newId('acmeord'),
      tenantId: input.tenantId,
      providerId: provider.id,
      accountId: account.id,
      certificateRequestId: request.id,
      externalOrderUrl: snapshot.externalOrderUrl,
      status: snapshot.status,
      identifiers: snapshot.identifiers.length > 0 ? snapshot.identifiers : identifiers,
      authorizationUrls: snapshot.authorizationUrls,
      finalizeUrl: snapshot.finalizeUrl,
      certificateUrl: snapshot.certificateUrl,
      csrSha256: request.csrSha256,
      retryAfterAt: snapshot.retryAfterAt,
      attemptCount: 1,
      failureCode: snapshot.errorType,
      failureSummary: snapshot.errorDetail,
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.repository.saveOrder(order);
    await this.saveAuthorizationSnapshots(saved, provider, account, input.challengeType, input.actorId);
    await this.caRepository.saveRequest({
      ...request,
      status: 'issuing',
      providerRequestId: saved.externalOrderUrl,
      updatedAt: now,
    });
    return this.toView(saved);
  }

  /**
   * 专属 ACME 必须先通过应用策略和 DNS 凭据门禁，再允许触碰外部 Order。
   * 历史全局 ACME 申请没有策略版本，继续沿用原有流程。
   */
  private async assertDedicatedAcmeBinding(
    input: CreateAcmeOrderServiceInput,
    request: CertificateRequestEntity,
  ): Promise<void> {
    if (!request.applicationCertificatePolicyVersionId) return;
    const binding = await this.caRepository.getApplicationCertificatePolicyBinding(
      input.tenantId,
      request.applicationCertificatePolicyVersionId,
    );
    const valid = Boolean(
      binding
      && binding.tenantId === input.tenantId
      && binding.applicationAssetId === request.applicationAssetId
      && binding.supplyMode === 'dedicated'
      && binding.providerType === 'acme'
      && binding.providerId === input.providerId
      && binding.certificateAssetId
      && binding.certificateAssetId === request.certificateAssetId
      && binding.assetTenantId === input.tenantId
      && binding.assetApplicationAssetId === request.applicationAssetId,
    );
    if (!valid) {
      throw new AppError('DEDICATED_CERTIFICATE_OWNERSHIP_CONFLICT', 'ACME Order 的应用、策略版本和证书资产归属不一致', {
        applicationAssetId: request.applicationAssetId,
        certificateAssetId: request.certificateAssetId,
        applicationCertificatePolicyVersionId: request.applicationCertificatePolicyVersionId,
      });
    }

    if (!binding?.dnsProviderId || !binding.credentialRef || !this.secrets) {
      throw new AppError('ACME_DNS_AUTHORIZATION_REQUIRED', '专属 ACME 申请必须配置 DNS Provider 和凭据 SecretRef');
    }
    try {
      const resolved = await this.secrets.resolveForService({
        secretRef: binding.credentialRef,
        tenantId: input.tenantId,
        expectedType: 'password',
        purpose: 'acme.lego.dns_credentials',
        actorId: input.actorId,
      });
      validateLegoCredentialPayload(binding.dnsProviderId, resolved.plainText);
    } catch (error) {
      if (error instanceof AppError && error.errorCode === 'ACME_DNS_AUTHORIZATION_REQUIRED') throw error;
      throw new AppError('ACME_DNS_AUTHORIZATION_REQUIRED', '专属 ACME 的 DNS 凭据不可用或内容不完整', {
        dnsProviderId: binding.dnsProviderId,
      });
    }
  }

  async reconcile(tenantId: string, orderId: string, actorId: string): Promise<AcmeOrderView> {
    const order = await this.requireOrder(tenantId, orderId);
    const provider = await this.requireProvider(tenantId, order.providerId);
    const account = await this.repository.getAccount(tenantId, order.accountId);
    if (!account) throw new AppError('RESOURCE_NOT_FOUND', 'ACME Account 不存在', { accountId: order.accountId });
    const snapshot = await this.adapter.getOrder({
      provider,
      account,
      orderUrl: order.externalOrderUrl,
      actorId,
    });
    const updated = await this.repository.saveOrder({
      ...order,
      status: snapshot.status,
      authorizationUrls: snapshot.authorizationUrls.length > 0 ? snapshot.authorizationUrls : order.authorizationUrls,
      finalizeUrl: snapshot.finalizeUrl ?? order.finalizeUrl,
      certificateUrl: snapshot.certificateUrl ?? order.certificateUrl,
      retryAfterAt: snapshot.retryAfterAt,
      failureCode: snapshot.errorType,
      failureSummary: snapshot.errorDetail,
      attemptCount: order.attemptCount + 1,
      updatedAt: new Date().toISOString(),
    });
    return this.toView(updated);
  }

  async finalize(tenantId: string, orderId: string, actorId: string): Promise<AcmeOrderView> {
    const order = await this.requireOrder(tenantId, orderId);
    if (!order.finalizeUrl) throw new AppError('ACME_ORDER_CONFLICT', 'ACME Order 缺少 finalize URL');
    const request = await this.requireRequest(tenantId, order.certificateRequestId);
    const provider = await this.requireProvider(tenantId, order.providerId);
    const account = await this.repository.getAccount(tenantId, order.accountId);
    if (!account) throw new AppError('ACME_ACCOUNT_INVALID', 'ACME Account 不存在', { accountId: order.accountId });
    const snapshot = await this.adapter.finalizeOrder({
      provider,
      account,
      finalizeUrl: order.finalizeUrl,
      csrPem: request.csrPem,
      actorId,
    });
    const updated = await this.repository.saveOrder({
      ...order,
      status: snapshot.status,
      certificateUrl: snapshot.certificateUrl ?? order.certificateUrl,
      retryAfterAt: snapshot.retryAfterAt,
      failureCode: snapshot.errorType,
      failureSummary: snapshot.errorDetail,
      attemptCount: order.attemptCount + 1,
      updatedAt: new Date().toISOString(),
    });
    return this.toView(updated);
  }

  async downloadCertificate(tenantId: string, orderId: string, actorId: string): Promise<AcmeCertificateMaterial> {
    const order = await this.requireOrder(tenantId, orderId);
    if (!order.certificateUrl) throw new AppError('ACME_DOWNLOAD_FAILED', 'ACME Order 尚未提供证书 URL');
    const provider = await this.requireProvider(tenantId, order.providerId);
    const account = await this.repository.getAccount(tenantId, order.accountId);
    if (!account) throw new AppError('ACME_ACCOUNT_INVALID', 'ACME Account 不存在', { accountId: order.accountId });
    return this.adapter.downloadCertificate({
      provider,
      account,
      certificateUrl: order.certificateUrl,
      actorId,
    });
  }

  async get(tenantId: string, orderId: string): Promise<AcmeOrderView> {
    return this.toView(await this.requireOrder(tenantId, orderId));
  }

  async getEntity(tenantId: string, orderId: string): Promise<AcmeOrderEntity> {
    return this.requireOrder(tenantId, orderId);
  }

  async list(tenantId: string, status?: AcmeOrderEntity['status']): Promise<AcmeOrderView[]> {
    return Promise.all((await this.repository.listOrders(tenantId, status)).map((order) => this.toView(order)));
  }

  private async saveAuthorizationSnapshots(
    order: AcmeOrderEntity,
    provider: CaProviderEntity,
    account: NonNullable<Awaited<ReturnType<AcmeRepository['getAccount']>>>,
    challengeType: AcmeChallengeType,
    actorId: string,
  ): Promise<void> {
    for (const authorizationUrl of order.authorizationUrls) {
      const snapshot = await this.adapter.getAuthorization({
        provider,
        account,
        authorizationUrl,
        actorId,
      });
      const existing = await this.repository.getAuthorizationByUrl(order.tenantId, authorizationUrl);
      const now = new Date().toISOString();
      const authorization: AcmeAuthorizationEntity = {
        id: existing?.id ?? newId('acmeauth'),
        tenantId: order.tenantId,
        orderId: order.id,
        externalAuthorizationUrl: authorizationUrl,
        identifier: snapshot.identifier,
        status: snapshot.status,
        expiresAt: snapshot.expiresAt,
        wildcard: snapshot.wildcard,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const savedAuthorization = await this.repository.saveAuthorization(authorization);
      const challenge = snapshot.challenges.find((item) => item.type === challengeType);
      if (!challenge) {
        throw new AppError('ACME_CHALLENGE_FAILED', 'ACME Authorization 不包含策略要求的 Challenge', {
          identifier: snapshot.identifier.value,
          challengeType,
        });
      }
      const existingChallenge = await this.repository.getChallengeByUrl(order.tenantId, challenge.url);
      const entity: AcmeChallengeEntity = {
        id: existingChallenge?.id ?? newId('acmechal'),
        tenantId: order.tenantId,
        orderId: order.id,
        authorizationId: savedAuthorization.id,
        externalChallengeUrl: challenge.url,
        type: challenge.type,
        identifier: snapshot.identifier.value,
        tokenSha256: hashAcmeMaterial(challenge.token),
        keyAuthorizationSha256: hashAcmeMaterial(await this.adapter.buildKeyAuthorization({
          account,
          token: challenge.token,
          actorId,
        }).then((value) => value.keyAuthorization)),
        status: existingChallenge?.status ?? 'pending',
        presentationId: existingChallenge?.presentationId,
        attemptCount: existingChallenge?.attemptCount ?? 0,
        retryAfterAt: existingChallenge?.retryAfterAt,
        createdAt: existingChallenge?.createdAt ?? now,
        updatedAt: now,
      };
      await this.repository.saveChallenge(entity);
    }
  }

  private async requireProvider(tenantId: string, id: string): Promise<CaProviderEntity> {
    const provider = await this.caRepository.getProvider(tenantId, id);
    if (!provider || provider.type !== 'acme') throw new AppError('RESOURCE_NOT_FOUND', 'ACME Provider 不存在', { providerId: id });
    return provider;
  }

  private async requireRequest(tenantId: string, id: string): Promise<CertificateRequestEntity> {
    const request = await this.caRepository.getRequest(tenantId, id);
    if (!request) throw new AppError('RESOURCE_NOT_FOUND', '证书申请不存在', { certificateRequestId: id });
    return request;
  }

  private async requireOrder(tenantId: string, id: string): Promise<AcmeOrderEntity> {
    const order = await this.repository.getOrder(tenantId, id);
    if (!order) throw new AppError('RESOURCE_NOT_FOUND', 'ACME Order 不存在', { orderId: id });
    return order;
  }

  private async toView(order: AcmeOrderEntity): Promise<AcmeOrderView> {
    const challenges = await this.repository.listChallenges(order.tenantId, order.id);
    const request = await this.caRepository.getRequest(order.tenantId, order.certificateRequestId);
    return {
      id: order.id,
      status: order.status,
      certificateRequestId: order.certificateRequestId,
      ...(request?.certificateAssetId ? { certificateAssetId: request.certificateAssetId } : {}),
      externalOrderUrl: order.externalOrderUrl,
      identifiers: order.identifiers.map((item) => ({ ...item })),
      authorizationCount: order.authorizationUrls.length,
      challengeCount: challenges.length,
      challenges: challenges.map((challenge) => ({
        id: challenge.id,
        type: challenge.type,
        identifier: challenge.identifier,
        status: challenge.status,
        presentationId: challenge.presentationId,
        retryAfterAt: challenge.retryAfterAt,
        failureCode: challenge.failureCode,
        failureSummary: challenge.failureSummary,
      })),
      retryAfterAt: order.retryAfterAt,
      failureCode: order.failureCode,
      failureSummary: order.failureSummary,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}

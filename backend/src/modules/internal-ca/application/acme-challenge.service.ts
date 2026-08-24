import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type { AcmeProviderAdapter } from '../providers/acme-provider.js';
import type { AcmeRepository } from '../repository/acme.repository.js';
import type { InternalCaRepository } from '../repository/internal-ca.repository.js';
import type { AcmeChallengeEntity, AcmeChallengeType } from '../schema/acme.schema.js';
import {
  type AcmeChallengeAdapter,
  type AcmeChallengeMaterial,
} from '../challenges/acme-challenge-adapter.js';
import { Http01ChallengeAdapter } from '../challenges/http-01.adapter.js';
import { Dns01ChallengeAdapter } from '../challenges/dns-01.adapter.js';
import { TlsAlpn01ChallengeAdapter } from '../challenges/tls-alpn-01.adapter.js';

export interface AcmeChallengeServiceDependencies {
  repository: AcmeRepository;
  caRepository: InternalCaRepository;
  provider: AcmeProviderAdapter;
  adapters?: Partial<Record<AcmeChallengeType, AcmeChallengeAdapter>>;
}

export class AcmeChallengeService {
  private readonly adapters: Map<AcmeChallengeType, AcmeChallengeAdapter>;

  constructor(private readonly dependencies: AcmeChallengeServiceDependencies) {
    this.adapters = new Map(Object.entries({
      'http-01': new Http01ChallengeAdapter({
        async present() { throw new Error('HTTP-01 responder is not configured'); },
        async cleanup() { throw new Error('HTTP-01 responder is not configured'); },
      }),
      'dns-01': new Dns01ChallengeAdapter({
        async present() { throw new Error('DNS provider is not configured'); },
        async cleanup() { throw new Error('DNS provider is not configured'); },
      }),
      'tls-alpn-01': new TlsAlpn01ChallengeAdapter({
        async present() { throw new Error('TLS-ALPN-01 responder is not configured'); },
        async cleanup() { throw new Error('TLS-ALPN-01 responder is not configured'); },
      }),
      ...(dependencies.adapters ?? {}),
    }) as Array<[AcmeChallengeType, AcmeChallengeAdapter]>);
  }

  async present(input: {
    tenantId: string;
    challengeId: string;
    token: string;
    keyAuthorization: string;
    actorId: string;
    leaseOwner: string;
    leaseSeconds?: number;
  }): Promise<AcmeChallengeEntity> {
    const challenge = await this.requireChallenge(input.tenantId, input.challengeId);
    if (challenge.status === 'valid') return challenge;
    this.assertMaterialHash(challenge, input.token, input.keyAuthorization);
    const presentationId = challenge.presentationId ?? newId('acmepresent');
    const leaseExpiresAt = new Date(Date.now() + (input.leaseSeconds ?? 120) * 1000).toISOString();
    const claimed = await this.dependencies.repository.claimChallenge(
      input.tenantId,
      challenge.id,
      input.leaseOwner,
      leaseExpiresAt,
      new Date().toISOString(),
    );
    if (!claimed) throw new AppError('ACME_LEASE_LOST', 'ACME Challenge 当前由其他 Worker 持有');

    const adapter = this.requireAdapter(challenge.type);
    const material = this.material(challenge, { ...input, presentationId });
    try {
      const validation = await adapter.validate(material);
      if (!validation.supported) {
        throw new AppError('ACME_CHALLENGE_FAILED', validation.detail ?? 'Challenge 能力不可用');
      }
      const presentation = await adapter.present(material);
      const requested = await this.dependencies.provider.respondToChallenge({
        provider: await this.requireProvider(challenge.tenantId, challenge.orderId),
        account: await this.requireAccount(challenge.tenantId, challenge.orderId),
        challengeUrl: challenge.externalChallengeUrl,
        actorId: input.actorId,
      });
      const status = requested.status === 'valid'
        ? 'valid'
        : requested.status === 'invalid'
          ? 'invalid'
          : 'presented';
      const saved = await this.dependencies.repository.saveChallenge({
        ...challenge,
        presentationId: presentation.presentationId,
        status,
        attemptCount: challenge.attemptCount + 1,
        retryAfterAt: requested.retryAfterAt,
        leaseOwner: input.leaseOwner,
        leaseExpiresAt,
        failureCode: undefined,
        failureSummary: undefined,
        updatedAt: new Date().toISOString(),
      });
      if (status === 'invalid') {
        throw new AppError('ACME_CHALLENGE_FAILED', 'ACME CA 将 Challenge 标记为 invalid', { challengeId: saved.id });
      }
      return saved;
    } catch (error) {
      const failed = await this.dependencies.repository.saveChallenge({
        ...challenge,
        status: 'failed',
        attemptCount: challenge.attemptCount + 1,
        failureCode: error instanceof AppError ? error.errorCode : 'ACME_CHALLENGE_FAILED',
        failureSummary: summarizeError(error),
        leaseOwner: input.leaseOwner,
        leaseExpiresAt,
        updatedAt: new Date().toISOString(),
      });
      throw Object.assign(
        error instanceof AppError ? error : new AppError('ACME_CHALLENGE_FAILED', failed.failureSummary),
        { challengeId: failed.id },
      );
    }
  }

  async cleanup(input: {
    tenantId: string;
    challengeId: string;
    token: string;
    keyAuthorization: string;
    actorId: string;
    leaseOwner: string;
  }): Promise<AcmeChallengeEntity> {
    const challenge = await this.requireChallenge(input.tenantId, input.challengeId);
    if (challenge.status === 'cleaned') return challenge;
    this.assertMaterialHash(challenge, input.token, input.keyAuthorization);
    const claimed = await this.dependencies.repository.claimChallenge(
      input.tenantId,
      challenge.id,
      input.leaseOwner,
      new Date(Date.now() + 120_000).toISOString(),
      new Date().toISOString(),
    );
    if (!claimed) throw new AppError('ACME_LEASE_LOST', 'ACME Challenge 清理租约已被其他 Worker 持有');
    const adapter = this.requireAdapter(challenge.type);
    try {
      await adapter.cleanup(this.material(challenge, {
        ...input,
        presentationId: claimed.presentationId ?? newId('acmepresent'),
      }));
      return this.dependencies.repository.saveChallenge({
        ...claimed,
        status: 'cleaned',
        cleanupError: undefined,
        leaseOwner: input.leaseOwner,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const saved = await this.dependencies.repository.saveChallenge({
        ...claimed,
        status: 'cleanup_pending',
        cleanupError: summarizeError(error),
        failureCode: 'ACME_CLEANUP_FAILED',
        failureSummary: summarizeError(error),
        leaseOwner: input.leaseOwner,
        updatedAt: new Date().toISOString(),
      });
      throw Object.assign(new AppError('ACME_CLEANUP_FAILED', 'ACME Challenge 清理失败'), { challengeId: saved.id });
    }
  }

  async refreshFromProvider(input: {
    tenantId: string;
    challengeId: string;
    actorId: string;
  }): Promise<AcmeChallengeEntity> {
    const challenge = await this.requireChallenge(input.tenantId, input.challengeId);
    if (challenge.status === 'valid' || challenge.status === 'cleaned') return challenge;
    const order = await this.dependencies.repository.getOrder(input.tenantId, challenge.orderId);
    if (!order) throw new AppError('RESOURCE_NOT_FOUND', 'ACME Order 不存在', { orderId: challenge.orderId });
    const provider = await this.requireProvider(input.tenantId, challenge.orderId);
    const account = await this.requireAccount(input.tenantId, challenge.orderId);
    const authorizations = await this.dependencies.repository.listAuthorizations(input.tenantId, order.id);
    const authorizationRecord = authorizations.find((item) => item.id === challenge.authorizationId);
    if (!authorizationRecord) throw new AppError('RESOURCE_NOT_FOUND', 'ACME Authorization 不存在');
    const authorization = await this.dependencies.provider.getAuthorization({
      provider,
      account,
      authorizationUrl: authorizationRecord.externalAuthorizationUrl,
      actorId: input.actorId,
    });
    await this.dependencies.repository.saveAuthorization({
      ...authorizationRecord,
      identifier: authorization.identifier,
      status: authorization.status,
      expiresAt: authorization.expiresAt,
      wildcard: authorization.wildcard,
      updatedAt: new Date().toISOString(),
    });
    const material = authorization.challenges.find((item) => item.url === challenge.externalChallengeUrl);
    if (!material) throw new AppError('ACME_CHALLENGE_FAILED', 'ACME Authorization 未返回目标 Challenge');
    const nextStatus = material.status === 'valid'
      ? 'valid'
      : material.status === 'invalid'
        ? 'invalid'
        : material.status === 'processing'
          ? 'processing'
          : 'pending';
    const updated = await this.dependencies.repository.saveChallenge({
      ...challenge,
      status: nextStatus,
      retryAfterAt: undefined,
      failureCode: nextStatus === 'invalid' ? 'ACME_CHALLENGE_FAILED' : undefined,
      failureSummary: nextStatus === 'invalid' ? 'ACME CA 将 Challenge 标记为 invalid' : undefined,
      updatedAt: new Date().toISOString(),
    });
    if (nextStatus === 'invalid') {
      throw new AppError('ACME_CHALLENGE_FAILED', 'ACME CA 将 Challenge 标记为 invalid', { challengeId: updated.id });
    }
    return updated;
  }

  async presentFromProvider(input: {
    tenantId: string;
    challengeId: string;
    actorId: string;
    leaseOwner: string;
    leaseSeconds?: number;
  }): Promise<AcmeChallengeEntity> {
    const challenge = await this.requireChallenge(input.tenantId, input.challengeId);
    if (challenge.status === 'presented' || challenge.status === 'processing') {
      return this.refreshFromProvider({
        tenantId: input.tenantId,
        challengeId: input.challengeId,
        actorId: input.actorId,
      });
    }
    const order = await this.dependencies.repository.getOrder(input.tenantId, challenge.orderId);
    if (!order) throw new AppError('RESOURCE_NOT_FOUND', 'ACME Order 不存在', { orderId: challenge.orderId });
    const provider = await this.requireProvider(input.tenantId, challenge.orderId);
    const account = await this.requireAccount(input.tenantId, challenge.orderId);
    const authorizations = await this.dependencies.repository.listAuthorizations(input.tenantId, order.id);
    const authorizationRecord = authorizations.find((item) => item.id === challenge.authorizationId);
    if (!authorizationRecord) throw new AppError('RESOURCE_NOT_FOUND', 'ACME Authorization 不存在');
    const authorization = await this.dependencies.provider.getAuthorization({
      provider,
      account,
      authorizationUrl: authorizationRecord.externalAuthorizationUrl,
      actorId: input.actorId,
    });
    const material = authorization.challenges.find((item) => item.url === challenge.externalChallengeUrl);
    if (!material) throw new AppError('ACME_CHALLENGE_FAILED', 'ACME Authorization 未返回目标 Challenge');
    const keyAuthorization = await this.dependencies.provider.buildKeyAuthorization({
      account,
      token: material.token,
      actorId: input.actorId,
    });
    return this.present({
      ...input,
      token: material.token,
      keyAuthorization: keyAuthorization.keyAuthorization,
    });
  }

  async cleanupFromProvider(input: {
    tenantId: string;
    challengeId: string;
    actorId: string;
    leaseOwner: string;
  }): Promise<AcmeChallengeEntity> {
    const challenge = await this.requireChallenge(input.tenantId, input.challengeId);
    const order = await this.dependencies.repository.getOrder(input.tenantId, challenge.orderId);
    if (!order) throw new AppError('RESOURCE_NOT_FOUND', 'ACME Order 不存在', { orderId: challenge.orderId });
    const provider = await this.requireProvider(input.tenantId, challenge.orderId);
    const account = await this.requireAccount(input.tenantId, challenge.orderId);
    const authorizations = await this.dependencies.repository.listAuthorizations(input.tenantId, order.id);
    const authorizationRecord = authorizations.find((item) => item.id === challenge.authorizationId);
    if (!authorizationRecord) throw new AppError('RESOURCE_NOT_FOUND', 'ACME Authorization 不存在');
    const authorization = await this.dependencies.provider.getAuthorization({
      provider,
      account,
      authorizationUrl: authorizationRecord.externalAuthorizationUrl,
      actorId: input.actorId,
    });
    const material = authorization.challenges.find((item) => item.url === challenge.externalChallengeUrl);
    if (!material) throw new AppError('ACME_CHALLENGE_FAILED', 'ACME Authorization 未返回目标 Challenge');
    const keyAuthorization = await this.dependencies.provider.buildKeyAuthorization({
      account,
      token: material.token,
      actorId: input.actorId,
    });
    return this.cleanup({
      ...input,
      token: material.token,
      keyAuthorization: keyAuthorization.keyAuthorization,
    });
  }

  private requireAdapter(type: AcmeChallengeType): AcmeChallengeAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) throw new AppError('CA_CAPABILITY_UNSUPPORTED', 'ACME Challenge Adapter 未注册', { type });
    return adapter;
  }

  private async requireChallenge(tenantId: string, id: string): Promise<AcmeChallengeEntity> {
    const challenge = await this.dependencies.repository.getChallenge(tenantId, id);
    if (!challenge) throw new AppError('RESOURCE_NOT_FOUND', 'ACME Challenge 不存在', { challengeId: id });
    return challenge;
  }

  private async requireProvider(tenantId: string, orderId: string) {
    const order = await this.dependencies.repository.getOrder(tenantId, orderId);
    if (!order) throw new AppError('RESOURCE_NOT_FOUND', 'ACME Order 不存在', { orderId });
    const provider = await this.dependencies.caRepository.getProvider(tenantId, order.providerId);
    if (!provider || provider.type !== 'acme') throw new AppError('RESOURCE_NOT_FOUND', 'ACME Provider 不存在', { providerId: order.providerId });
    return provider;
  }

  private async requireAccount(tenantId: string, orderId: string) {
    const order = await this.dependencies.repository.getOrder(tenantId, orderId);
    if (!order) throw new AppError('RESOURCE_NOT_FOUND', 'ACME Order 不存在', { orderId });
    const account = await this.dependencies.repository.getAccount(tenantId, order.accountId);
    if (!account) throw new AppError('ACME_ACCOUNT_INVALID', 'ACME Account 不存在', { accountId: order.accountId });
    return account;
  }

  private material(
    challenge: AcmeChallengeEntity,
    input: { tenantId: string; token: string; keyAuthorization: string; actorId: string; presentationId: string },
  ): AcmeChallengeMaterial {
    return {
      tenantId: input.tenantId,
      challengeId: challenge.id,
      identifier: challenge.identifier,
      token: input.token,
      keyAuthorization: input.keyAuthorization,
      presentationId: input.presentationId,
      actorId: input.actorId,
    };
  }

  private assertMaterialHash(challenge: AcmeChallengeEntity, token: string, keyAuthorization: string): void {
    if (hashAcmeMaterial(token) !== challenge.tokenSha256 || hashAcmeMaterial(keyAuthorization) !== challenge.keyAuthorizationSha256) {
      throw new AppError('ACME_CHALLENGE_FAILED', 'ACME Challenge 材料与持久化摘要不匹配');
    }
  }
}

function hashAcmeMaterial(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function summarizeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

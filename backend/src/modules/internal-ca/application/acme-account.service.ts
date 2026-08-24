import { createHash, generateKeyPairSync } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type { SecretService } from '../../secrets/secret.service.js';
import { AcmeDomainService } from '../domain/acme.domain-service.js';
import type { AcmeRepository } from '../repository/acme.repository.js';
import type { InternalCaRepository } from '../repository/internal-ca.repository.js';
import type { AcmeAccountEntity } from '../schema/acme.schema.js';
import type { CaProviderEntity } from '../schema/internal-ca.schema.js';
import { AcmeProviderAdapter } from '../providers/acme-provider.js';
import { getAcmeProviderProfile, normalizeProfileKey } from '../providers/acme-provider-profiles.js';

export interface CreateAcmeAccountServiceInput {
  tenantId: string;
  providerId: string;
  accountKeySecretRef?: string;
  contact?: string[];
  termsOfServiceAgreed?: boolean;
  eabSecretRef?: string;
  eabKeyIdSecretRef?: string;
  eabHmacSecretRef?: string;
  actorId: string;
}

export interface AcmeAccountView {
  id: string;
  providerId: string;
  accountUrl?: string;
  status: AcmeAccountEntity['status'];
  contact: string[];
  hasExternalAccountBinding: boolean;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export class AcmeAccountService {
  private readonly domain = new AcmeDomainService();

  constructor(
    private readonly repository: AcmeRepository,
    private readonly caRepository: InternalCaRepository,
    private readonly adapter: AcmeProviderAdapter,
    private readonly secrets: SecretService,
  ) {}

  async create(input: CreateAcmeAccountServiceInput): Promise<AcmeAccountView> {
    const provider = await this.requireProvider(input.tenantId, input.providerId);
    const configuration = this.domain.assertProvider(provider);
    const contact = this.domain.normalizeContacts(input.contact);
    const termsOfServiceAgreed = input.termsOfServiceAgreed ?? configuration.termsOfServiceAgreed;
    if (!termsOfServiceAgreed) {
      throw new AppError('ACME_ACCOUNT_INVALID', '创建 ACME Account 前必须同意服务条款');
    }
    const directory = await this.adapter.getDirectory({ provider });
    const accountKeySecretRef = await this.resolveAccountKeySecretRef(input, provider);
    this.domain.validateAccountSecretRefs({ ...input, accountKeySecretRef });
    await this.assertSecretTypes({ ...input, accountKeySecretRef });
    await this.assertEabPolicy(provider, configuration, input, directory.meta?.externalAccountRequired === true);

    const directoryUrlHash = this.domain.directoryUrlHash(configuration.directoryUrl);
    const existing = await this.repository.getAccountByKey(
      input.tenantId,
      provider.id,
      directoryUrlHash,
      accountKeySecretRef,
    );
    if (existing) return toAccountView(existing);

    const now = new Date().toISOString();
    const account: AcmeAccountEntity = {
      id: newId('acmeacct'),
      tenantId: input.tenantId,
      providerId: provider.id,
      directoryUrlHash,
      accountKeySecretRef,
      contact,
      eabSecretRef: input.eabSecretRef,
      eabKeyIdSecretRef: input.eabKeyIdSecretRef,
      eabHmacSecretRef: input.eabHmacSecretRef,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    try {
      const created = await this.adapter.createAccount({
        provider,
        accountKeySecretRef: account.accountKeySecretRef,
        contact,
        termsOfServiceAgreed,
        eabSecretRef: account.eabSecretRef,
        eabKeyIdSecretRef: account.eabKeyIdSecretRef,
        eabHmacSecretRef: account.eabHmacSecretRef,
        actorId: input.actorId,
      });
      const saved = await this.repository.saveAccount({
        ...account,
        accountUrl: created.accountUrl,
        status: created.status,
        updatedAt: new Date().toISOString(),
      });
      return toAccountView(saved);
    } catch (error) {
      await this.repository.saveAccount({
        ...account,
        status: 'error',
        lastErrorCode: error instanceof AppError ? error.errorCode : 'ACME_ACCOUNT_INVALID',
        lastErrorMessage: summarizeError(error),
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  async list(tenantId: string, providerId?: string): Promise<AcmeAccountView[]> {
    return (await this.repository.listAccounts(tenantId, providerId)).map(toAccountView);
  }

  async get(tenantId: string, id: string): Promise<AcmeAccountView> {
    const account = await this.repository.getAccount(tenantId, id);
    if (!account) throw new AppError('RESOURCE_NOT_FOUND', 'ACME Account 不存在', { accountId: id });
    return toAccountView(account);
  }

  async getEntity(tenantId: string, id: string): Promise<AcmeAccountEntity> {
    const account = await this.repository.getAccount(tenantId, id);
    if (!account) throw new AppError('RESOURCE_NOT_FOUND', 'ACME Account 不存在', { accountId: id });
    return account;
  }

  private async requireProvider(tenantId: string, id: string): Promise<CaProviderEntity> {
    const provider = await this.caRepository.getProvider(tenantId, id);
    if (!provider || provider.type !== 'acme') {
      throw new AppError('RESOURCE_NOT_FOUND', 'ACME Provider 不存在', { providerId: id });
    }
    return provider;
  }

  private async assertSecretTypes(input: CreateAcmeAccountServiceInput): Promise<void> {
    if (!input.accountKeySecretRef) {
      throw new AppError('ACME_SECRET_RESOLVE_DENIED', 'ACME Account Key Secret 未生成');
    }
    try {
      await this.secrets.resolveForService({
        secretRef: input.accountKeySecretRef,
        tenantId: input.tenantId,
        expectedType: 'certificate_private_key',
        purpose: 'acme.account.validate',
        actorId: input.actorId,
      });
      for (const secretRef of [input.eabSecretRef, input.eabKeyIdSecretRef, input.eabHmacSecretRef]) {
        if (!secretRef) continue;
        await this.secrets.resolveForService({
          secretRef,
          tenantId: input.tenantId,
          expectedType: secretRef === input.eabSecretRef ? 'acme_eab' : undefined,
          purpose: 'acme.account.validate',
          actorId: input.actorId,
        });
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('ACME_SECRET_RESOLVE_DENIED', 'ACME Account Secret 无法验证');
    }
  }

  private async resolveAccountKeySecretRef(input: CreateAcmeAccountServiceInput, provider: CaProviderEntity): Promise<string> {
    if (input.accountKeySecretRef) return input.accountKeySecretRef;
    const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const secret = await this.secrets.create({
      tenantId: input.tenantId,
      name: `ACME Account Key - ${provider.name}`,
      type: 'certificate_private_key',
      scopeType: 'global',
      metadata: {
        purpose: 'acme_account_key',
        providerId: provider.id,
        tenantId: input.tenantId,
        managedBy: 'gcac',
      },
      plainText: privateKey,
      createdBy: input.actorId,
    });
    return secret.secretRef;
  }

  private async assertEabPolicy(
    provider: CaProviderEntity,
    configuration: ReturnType<AcmeDomainService['assertProvider']>,
    input: CreateAcmeAccountServiceInput,
    directoryRequiresEab: boolean,
  ): Promise<void> {
    const profile = getAcmeProviderProfile(normalizeProfileKey(configuration.profileKey ?? configuration.preset));
    const hasEab = Boolean(input.eabSecretRef || (input.eabKeyIdSecretRef && input.eabHmacSecretRef));
    const eabRequired = profile?.account.eab === 'required' || (profile?.account.eab === 'discover' && directoryRequiresEab);
    if (eabRequired && !hasEab) {
      throw new AppError('ACME_ACCOUNT_INVALID', '当前 ACME Provider Profile 要求配置 EAB 凭据', {
        providerId: provider.id,
        profileKey: profile.key,
        directoryRequiresEab,
      });
    }
    if (profile?.account.eab === 'not_required' && hasEab) {
      throw new AppError('ACME_ACCOUNT_INVALID', '当前 ACME Provider Profile 不接受 EAB 凭据', {
        providerId: provider.id,
        profileKey: profile.key,
      });
    }
  }
}

export function toAccountView(account: AcmeAccountEntity): AcmeAccountView {
  return {
    id: account.id,
    providerId: account.providerId,
    accountUrl: account.accountUrl,
    status: account.status,
    contact: [...account.contact],
    hasExternalAccountBinding: Boolean(account.eabSecretRef || (account.eabKeyIdSecretRef && account.eabHmacSecretRef)),
    lastErrorCode: account.lastErrorCode,
    lastErrorMessage: account.lastErrorMessage,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export function hashAcmeMaterial(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function summarizeError(error: unknown): string {
  if (error instanceof AppError) return error.message.slice(0, 500);
  if (error instanceof Error) return error.message.slice(0, 500);
  return 'ACME Account 操作失败';
}

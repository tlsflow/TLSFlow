import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import type { AuditService } from '../../audits/audit.service.js';
import {
  canonicalJson,
  decryptPrivateKey,
  encryptPrivateKey,
  generateInstallationKeyPair,
  verifyLicenseGrant,
  verifyRevocationList,
  type TrustKeyDirectory,
} from '../domain/license-crypto.js';
import { findPlan } from '../domain/product-catalog.js';
import type {
  ActivationRequest,
  ActivationResponse,
  InstallationEntity,
  LicenseGrant,
  LicenseQuotas,
  LicenseStatus,
  RevocationList,
  StoredActivationRequest,
  StoredLicenseGrant,
  StoredRevocationList,
} from '../domain/licensing.types.js';

const INSTALLATION_ID = 'singleton';
const CURRENT_LICENSE_ID = 'current';
const CURRENT_REVOCATION_LIST_ID = 'current';
const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60_000;
const ACTIVATION_REQUEST_TTL_MS = 7 * 86_400_000;
const EMPTY_QUOTAS: LicenseQuotas = { managedTargets: 0, concurrentExecutions: 0, plugins: 0 };

export interface LicensingRepositories {
  installations: PgDocumentRepository<InstallationEntity>;
  grants: PgDocumentRepository<StoredLicenseGrant>;
  revocations: PgDocumentRepository<StoredRevocationList>;
  activationRequests: PgDocumentRepository<StoredActivationRequest>;
}

export interface LicensingServiceOptions {
  now?: () => Date;
  trustKeys?: TrustKeyDirectory;
  storageKey?: Buffer;
}

export class LicensingApplicationService {
  private readonly now: () => Date;
  private readonly trustKeys: TrustKeyDirectory;
  private readonly storageKey: Buffer;
  private readonly repositories: LicensingRepositories;

  constructor(
    db: DatabasePort,
    private readonly audit?: AuditService,
    options: LicensingServiceOptions = {},
  ) {
    this.repositories = {
      installations: new PgDocumentRepository(db, 'licensing.installations'),
      grants: new PgDocumentRepository(db, 'licensing.license_grants'),
      revocations: new PgDocumentRepository(db, 'licensing.revocation_lists'),
      activationRequests: new PgDocumentRepository(db, 'licensing.activation_requests'),
    };
    this.now = options.now ?? (() => new Date());
    this.trustKeys = options.trustKeys ?? loadTrustKeys();
    this.storageKey = options.storageKey ?? loadStorageKey();
  }

  async getStatus(): Promise<LicenseStatus> {
    const installation = await this.ensureInstallation();
    const clockRollbackDetected = await this.observeClock(installation);
    const storedGrant = await this.repositories.grants.get(CURRENT_LICENSE_ID);
    const storedRevocationList = await this.repositories.revocations.get(CURRENT_REVOCATION_LIST_ID);
    const revokedGrantIds = new Set(storedRevocationList?.list.revokedGrantIds ?? []);
    const base = {
      installationId: installation.installationId,
      installationPublicKey: installation.publicKey,
      productCode: 'gcac' as const,
      features: [] as string[],
      quotas: EMPTY_QUOTAS,
      lastClockAt: installation.lastClockAt,
      clockRollbackDetected,
    };

    if (clockRollbackDetected) {
      return { ...base, state: 'clock_rollback_detected', reason: 'system clock moved backwards' };
    }
    if (!storedGrant) {
      return { ...base, state: 'unlicensed', reason: 'license not configured' };
    }

    const result = verifyLicenseGrant(
      storedGrant.grant,
      installation.installationId,
      installation.publicKey,
      this.trustKeys,
      revokedGrantIds,
      this.now(),
    );
    if (!result.valid) {
      const state = result.state === 'revoked' ? 'revoked' : result.state === 'expired' ? 'expired' : 'unlicensed';
      return {
        ...base,
        state,
        planCode: storedGrant.grant.planCode,
        grantId: storedGrant.grant.grantId,
        features: storedGrant.grant.features,
        quotas: storedGrant.grant.quotas,
        issuedAt: storedGrant.grant.issuedAt,
        startsAt: storedGrant.grant.startsAt,
        expiresAt: storedGrant.grant.expiresAt,
        graceEndsAt: graceEndsAt(storedGrant.grant),
        reason: result.reason,
      };
    }
    return {
      ...base,
      state: result.state!,
      planCode: storedGrant.grant.planCode,
      grantId: storedGrant.grant.grantId,
      features: storedGrant.grant.features,
      quotas: storedGrant.grant.quotas,
      issuedAt: storedGrant.grant.issuedAt,
      startsAt: storedGrant.grant.startsAt,
      expiresAt: storedGrant.grant.expiresAt,
      graceEndsAt: graceEndsAt(storedGrant.grant),
    };
  }

  async importLicense(grant: LicenseGrant, revocationList?: RevocationList): Promise<LicenseStatus> {
    const installation = await this.ensureInstallation();
    const current = await this.repositories.grants.get(CURRENT_LICENSE_ID);
    if (revocationList && !verifyRevocationList(revocationList, this.trustKeys, this.now())) {
      throw new AppError('LICENSE_INVALID', '撤销列表无效');
    }
    const revokedGrantIds = new Set(revocationList?.revokedGrantIds ?? (await this.repositories.revocations.get(CURRENT_REVOCATION_LIST_ID))?.list.revokedGrantIds ?? []);
    const result = verifyLicenseGrant(
      grant,
      installation.installationId,
      installation.publicKey,
      this.trustKeys,
      revokedGrantIds,
      this.now(),
    );
    if (grant.installationId !== installation.installationId || grant.installationPublicKey !== installation.publicKey) {
      throw new AppError('LICENSE_INSTANCE_MISMATCH', undefined, { installationId: installation.installationId });
    }
    validateGrantAgainstPlan(grant);
    if (!result.valid) {
      throw new AppError(result.state === 'revoked' ? 'LICENSE_REVOKED' : 'LICENSE_INVALID', undefined, { reason: result.reason });
    }
    if (current && Date.parse(current.grant.issuedAt) >= Date.parse(grant.issuedAt)) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '新许可证的签发时间不能早于当前许可证');
    }
    await this.repositories.grants.upsert({
      id: CURRENT_LICENSE_ID,
      grant: structuredClone(grant),
      importedAt: this.now().toISOString(),
    });
    if (revocationList) {
      await this.repositories.revocations.upsert({
        id: CURRENT_REVOCATION_LIST_ID,
        list: structuredClone(revocationList),
        importedAt: this.now().toISOString(),
      });
    }
    await this.audit?.write({
      eventType: 'licensing.license.imported',
      actorType: 'system',
      actorId: installation.installationId,
      action: 'licensing.license.import',
      resourceType: 'licenseGrant',
      resourceId: grant.grantId,
      result: 'success',
      riskLevel: 'medium',
      detail: { planCode: grant.planCode },
    });
    return this.getStatus();
  }

  async importActivationResponse(response: ActivationResponse): Promise<LicenseStatus> {
    if (!isActivationResponse(response)) {
      throw new AppError('LICENSE_INVALID', '激活响应格式无效');
    }
    const request = await this.repositories.activationRequests.get(response.requestId);
    if (!request || request.status !== 'pending') {
      throw new AppError('LICENSE_INVALID', '激活请求不存在或已失效');
    }
    if (Date.parse(request.expiresAt) < this.now().getTime()) {
      await this.repositories.activationRequests.update(request.id, { status: 'expired' });
      throw new AppError('LICENSE_INVALID', '激活请求已过期');
    }
    if (request.request.nonce !== response.nonce || request.request.installationId !== response.licenseGrant.installationId) {
      throw new AppError('LICENSE_INVALID', '激活响应与本地请求不匹配');
    }
    const imported = await this.importLicense(response.licenseGrant, response.revocationList);
    await this.repositories.activationRequests.update(request.id, { status: 'fulfilled' });
    return imported;
  }

  async importRevocationList(list: RevocationList): Promise<void> {
    if (!verifyRevocationList(list, this.trustKeys, this.now())) {
      throw new AppError('LICENSE_INVALID', '撤销列表无效');
    }
    await this.repositories.revocations.upsert({
      id: CURRENT_REVOCATION_LIST_ID,
      list: structuredClone(list),
      importedAt: this.now().toISOString(),
    });
  }

  async exportLicense(): Promise<{ installation: Pick<InstallationEntity, 'installationId' | 'publicKey' | 'productCode'>; licenseGrant?: LicenseGrant; revocationList?: RevocationList }> {
    const installation = await this.ensureInstallation();
    const grant = await this.repositories.grants.get(CURRENT_LICENSE_ID);
    const revocationList = await this.repositories.revocations.get(CURRENT_REVOCATION_LIST_ID);
    return {
      installation: {
        installationId: installation.installationId,
        publicKey: installation.publicKey,
        productCode: installation.productCode,
      },
      licenseGrant: grant?.grant,
      revocationList: revocationList?.list,
    };
  }

  async createActivationRequest(kind: 'online' | 'offline'): Promise<ActivationRequest> {
    const installation = await this.ensureInstallation();
    const request: ActivationRequest = {
      schemaVersion: 1,
      requestId: `lreq_${randomBytes(12).toString('hex')}`,
      nonce: randomBytes(24).toString('base64url'),
      kind,
      productCode: 'gcac',
      installationId: installation.installationId,
      installationPublicKey: installation.publicKey,
      productVersion: process.env.GCAC_VERSION?.trim() || 'unknown',
      requestedAt: this.now().toISOString(),
    };
    const createdAt = this.now().toISOString();
    await this.repositories.activationRequests.create({
      id: request.requestId,
      request,
      status: 'pending',
      createdAt,
      expiresAt: new Date(this.now().getTime() + ACTIVATION_REQUEST_TTL_MS).toISOString(),
    });
    await this.audit?.write({
      eventType: 'licensing.activation.requested',
      actorType: 'system',
      actorId: installation.installationId,
      action: 'licensing.activation.request',
      resourceType: 'activationRequest',
      resourceId: request.requestId,
      result: 'success',
      riskLevel: 'low',
      detail: { kind },
    });
    return request;
  }

  async requireFeature(featureCode: string): Promise<void> {
    const status = await this.getStatus();
    if (status.state === 'clock_rollback_detected') throw new AppError('LICENSE_CLOCK_ROLLBACK');
    if (status.state === 'unlicensed') throw new AppError('LICENSE_NOT_CONFIGURED');
    if (status.state === 'revoked') throw new AppError('LICENSE_REVOKED');
    if (status.state === 'expired') throw new AppError('LICENSE_INVALID', '许可证已过期');
    if (!status.features.includes(featureCode)) throw new AppError('LICENSE_FEATURE_DENIED', undefined, { featureCode });
  }

  async requireQuota(quotaCode: keyof LicenseQuotas, requested: number): Promise<void> {
    const status = await this.getStatus();
    if (status.state === 'clock_rollback_detected') throw new AppError('LICENSE_CLOCK_ROLLBACK');
    if (status.state === 'unlicensed') throw new AppError('LICENSE_NOT_CONFIGURED');
    if (status.state === 'revoked') throw new AppError('LICENSE_REVOKED');
    if (status.state === 'expired') throw new AppError('LICENSE_INVALID', '许可证已过期');
    const quota = status.quotas[quotaCode];
    if (quota !== null && requested > quota) {
      throw new AppError('LICENSE_QUOTA_EXCEEDED', undefined, { quotaCode, requested, limit: quota });
    }
  }

  getCanonicalActivationRequest(request: ActivationRequest): string {
    return canonicalJson(request);
  }

  async getPrivateKeyForInternalUse(): Promise<string> {
    const installation = await this.ensureInstallation();
    return decryptPrivateKey(installation.encryptedPrivateKey, this.storageKey);
  }

  private async ensureInstallation(): Promise<InstallationEntity> {
    const current = await this.repositories.installations.get(INSTALLATION_ID);
    if (current) return current;
    const keyPair = generateInstallationKeyPair();
    const now = this.now().toISOString();
    const entity: InstallationEntity = {
      id: INSTALLATION_ID,
      installationId: `inst_${randomBytes(16).toString('hex')}`,
      productCode: 'gcac',
      publicKey: keyPair.publicKey,
      encryptedPrivateKey: encryptPrivateKey(keyPair.privateKey, this.storageKey),
      createdAt: now,
      updatedAt: now,
      lastClockAt: now,
      clockRollbackDetected: false,
    };
    try {
      return await this.repositories.installations.create(entity);
    } catch {
      return this.repositories.installations.getOrThrow(INSTALLATION_ID);
    }
  }

  private async observeClock(installation: InstallationEntity): Promise<boolean> {
    const now = this.now();
    const previous = Date.parse(installation.lastClockAt);
    const current = now.getTime();
    if (Number.isFinite(previous) && current < previous - CLOCK_ROLLBACK_TOLERANCE_MS) {
      if (!installation.clockRollbackDetected) {
        await this.repositories.installations.update(INSTALLATION_ID, {
          clockRollbackDetected: true,
          updatedAt: now.toISOString(),
        });
      }
      return true;
    }
    const recovered = installation.clockRollbackDetected && current >= previous;
    if (current > previous || recovered) {
      await this.repositories.installations.update(INSTALLATION_ID, {
        lastClockAt: now.toISOString(),
        clockRollbackDetected: recovered ? false : installation.clockRollbackDetected,
        updatedAt: now.toISOString(),
      });
    }
    return recovered ? false : installation.clockRollbackDetected;
  }
}

function graceEndsAt(grant: LicenseGrant): string {
  return new Date(Date.parse(grant.expiresAt) + grant.gracePeriodDays * 86_400_000).toISOString();
}

function loadTrustKeys(): TrustKeyDirectory {
  const raw = process.env.GCAC_LICENSE_TRUST_KEYS_JSON?.trim();
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(parsed).map(([keyId, encoded]) => [keyId, Buffer.from(encoded, 'base64url')]));
  } catch {
    throw new Error('GCAC_LICENSE_TRUST_KEYS_JSON 格式无效');
  }
}

function loadStorageKey(): Buffer {
  const configured = process.env.GCAC_LICENSE_STORAGE_KEY?.trim() || process.env.GCAC_SECRET_KEK?.trim();
  if (configured) return createHash('sha256').update(configured, 'utf8').digest();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境缺少 GCAC_LICENSE_STORAGE_KEY');
  }
  return createHash('sha256').update(`gcac-license-dev-${process.pid}`, 'utf8').digest();
}

export function createDefaultLicensingService(db: DatabasePort, audit?: AuditService): LicensingApplicationService {
  return new LicensingApplicationService(db, audit);
}

export function planExists(planCode: string): boolean {
  return !!findPlan(planCode);
}

function validateGrantAgainstPlan(grant: LicenseGrant): void {
  const plan = findPlan(grant.planCode);
  if (!plan) throw new AppError('LICENSE_INVALID', '套餐代码不存在', { planCode: grant.planCode });
  if (!grant.features.every((feature) => plan.features.includes(feature))) {
    throw new AppError('LICENSE_INVALID', '许可证功能超出套餐定义', { planCode: grant.planCode });
  }
  for (const quotaCode of Object.keys(grant.quotas) as Array<keyof LicenseQuotas>) {
    const granted = grant.quotas[quotaCode];
    const allowed = plan.quotas[quotaCode];
    if (granted !== null && allowed !== null && granted > allowed) {
      throw new AppError('LICENSE_INVALID', '许可证额度超出套餐定义', { quotaCode, granted, allowed });
    }
  }
}

function isActivationResponse(value: unknown): value is ActivationResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const response = value as Partial<ActivationResponse>;
  return response.schemaVersion === 1
    && typeof response.responseId === 'string'
    && typeof response.requestId === 'string'
    && typeof response.nonce === 'string'
    && typeof response.issuedAt === 'string'
    && !!response.licenseGrant;
}

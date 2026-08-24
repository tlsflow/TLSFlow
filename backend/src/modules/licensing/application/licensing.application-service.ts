import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { GCAC_VERSION, compareSemVer } from '../../../common/version.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import type { AuditService } from '../../audits/audit.service.js';
import {
  canonicalJson,
  decryptPrivateKey,
  encryptPrivateKey,
  generateInstallationKeyPair,
  normalizeLicenseQuotas,
  readGrantExpiresAt,
  readGrantUpgradeGraceDays,
  readGrantVersionRange,
  verifyLicenseGrant,
  verifyRevocationList,
  type TrustKeyDirectory,
} from '../domain/license-crypto.js';
import { findPlan, normalizePlanCode, type ProductPlanCode } from '../domain/product-catalog.js';
import type {
  ActivationRequest,
  ActivationResponse,
  InstallationEntity,
  LicenseGrant,
  LicenseIntegrityStatus,
  LicenseQuotas,
  LicenseStatus,
  LicenseUsage,
  LicenseVersionRange,
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
const DEFAULT_UPGRADE_GRACE_DAYS = 30;
const LICENSE_TRUST_KEYS_ENV = 'GCAC_LICENSE_TRUST_KEYS_JSON';
const DEVELOPMENT_LICENSE_KEY_ID_PATTERN = new RegExp(
  `(?:^|[-_])(?:${['builtin', 'dev'].join('-')}|${['gcac', 'development'].join('-')}|${['default', 'development'].join('-')}|development|${['dev', 'key'].join('-')})(?:[-_]|$)`,
  'i',
);
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const NONE_PLAN = findPlan('none');
const NONE_QUOTAS: LicenseQuotas = normalizeLicenseQuotas(NONE_PLAN?.quotas);
const NONE_FEATURES = [...(NONE_PLAN?.features ?? [])];

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

interface VersionCompatibilityResult {
  compatible: boolean;
  reason?: string;
  versionRange?: LicenseVersionRange;
}

export class LicensingApplicationService {
  private readonly now: () => Date;
  private readonly trustKeys: TrustKeyDirectory;
  private readonly storageKey: Buffer;
  private readonly repositories: LicensingRepositories;

  constructor(
    private readonly db: DatabasePort,
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

  async getStatus(tenantId?: string): Promise<LicenseStatus> {
    const installation = await this.ensureInstallation();
    const clockRollbackDetected = await this.observeClock(installation);
    const storedGrant = await this.repositories.grants.get(CURRENT_LICENSE_ID);
    const storedRevocationList = await this.repositories.revocations.get(CURRENT_REVOCATION_LIST_ID);
    const revokedGrantIds = new Set(storedRevocationList?.list.revokedGrantIds ?? []);
    const base = {
      ...createBaseStatus(installation, clockRollbackDetected),
      usage: await this.readApplicationAssetUsage(tenantId),
    };

    if (clockRollbackDetected) {
      return { ...base, state: 'clock_rollback_detected', reason: 'system clock moved backwards' };
    }
    if (!storedGrant) {
      await this.clearVersionMismatch(installation);
      return {
        ...base,
        state: 'none',
        planCode: 'none',
        features: NONE_FEATURES,
        quotas: NONE_QUOTAS,
        reason: 'license not configured',
      };
    }

    const grant = storedGrant.grant;
    const result = verifyLicenseGrant(
      grant,
      installation.installationId,
      installation.publicKey,
      installation.deviceId,
      this.trustKeys,
      revokedGrantIds,
      this.now(),
    );
    if (!result.valid) {
      await this.clearVersionMismatch(installation);
      if (result.state !== 'revoked') {
        const integrityStatus: LicenseIntegrityStatus = result.reason === 'signature invalid' ? 'tampered' : 'invalid';
        if (integrityStatus === 'tampered') {
          await this.recordIntegrityAlert(installation, grant, result.reason ?? 'signature invalid');
        }
        return {
          ...base,
          integrityStatus,
          reason: result.reason,
        };
      }
      return {
        ...createVerifiedStatus(base, grant, {
          compatible: true,
          versionRange: readGrantVersionRange(grant),
        }),
        state: 'revoked',
        reason: result.reason,
      } as LicenseStatus;
    }

    const versionCompatibility = evaluateVersionCompatibility(grant);
    const commonStatus = createVerifiedStatus(base, grant, versionCompatibility);
    if (!versionCompatibility.compatible && result.state === 'active') {
      const versionMismatchDetectedAt = await this.getOrCreateVersionMismatchDetectedAt(installation);
      const upgradeGraceDays = readGrantUpgradeGraceDays(grant) || DEFAULT_UPGRADE_GRACE_DAYS;
      const upgradeGraceEndsAt = new Date(Date.parse(versionMismatchDetectedAt) + upgradeGraceDays * 86_400_000).toISOString();
      if (this.now().getTime() <= Date.parse(upgradeGraceEndsAt)) {
        return {
          ...commonStatus,
          state: 'upgrade_grace',
          versionMismatchDetectedAt,
          upgradeGraceEndsAt,
          reason: versionCompatibility.reason,
        } as LicenseStatus;
      }
      return {
        ...base,
        versionRange: versionCompatibility.versionRange,
        versionCompatible: false,
        versionMismatchDetectedAt,
        upgradeGraceEndsAt,
        reason: 'upgrade grace expired',
      } as LicenseStatus;
    }

    await this.clearVersionMismatch(installation);
    return {
      ...commonStatus,
      state: result.state!,
    } as LicenseStatus;
  }

  async importLicense(grant: LicenseGrant, revocationList?: RevocationList, tenantId?: string): Promise<LicenseStatus> {
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
      installation.deviceId,
      this.trustKeys,
      revokedGrantIds,
      this.now(),
    );
    if (!result.valid) {
      if (result.reason === 'signature invalid') {
        await this.audit?.write({
          eventType: 'licensing.license.tampered',
          actorType: 'system',
          actorId: installation.installationId,
          action: 'licensing.license.integrity.import',
          resourceType: 'licenseGrant',
          resourceId: grant.grantId,
          result: 'failure',
          riskLevel: 'high',
          detail: {
            grantId: grant.grantId,
            keyId: grant.keyId,
            reason: result.reason,
            deviceId: installation.deviceId,
          },
        });
        throw new AppError('LICENSE_TAMPERED', undefined, { grantId: grant.grantId, reason: result.reason });
      }
      if (result.reason === 'installation mismatch' || result.reason === 'installation public key mismatch') {
        throw new AppError('LICENSE_INSTANCE_MISMATCH', undefined, { installationId: installation.installationId });
      }
      if (result.reason === 'device mismatch') {
        throw new AppError('LICENSE_DEVICE_MISMATCH', undefined, { deviceId: installation.deviceId });
      }
      throw new AppError(result.state === 'revoked' ? 'LICENSE_REVOKED' : 'LICENSE_INVALID', undefined, { reason: result.reason });
    }
    try {
      validateGrantAgainstPlan(grant);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('LICENSE_INVALID', '许可证字段无效');
    }
    const versionCompatibility = evaluateVersionCompatibility(grant);
    if (!versionCompatibility.compatible) {
      throw new AppError('LICENSE_INVALID', '许可证版本范围与当前产品版本不兼容', {
        currentVersion: GCAC_VERSION,
        requiredVersionRange: versionCompatibility.versionRange,
      });
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
    await this.clearVersionMismatch(installation);
    await this.clearIntegrityAlert(installation);
    await this.audit?.write({
      eventType: 'licensing.license.imported',
      actorType: 'system',
      actorId: installation.installationId,
      action: 'licensing.license.import',
      resourceType: 'licenseGrant',
      resourceId: grant.grantId,
      result: 'success',
      riskLevel: 'medium',
      detail: { planCode: toCanonicalPlanCode(grant.planCode), deviceId: installation.deviceId },
    });
    return this.getStatus(tenantId);
  }

  async importActivationResponse(response: ActivationResponse, tenantId?: string): Promise<LicenseStatus> {
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
    if (
      request.request.nonce !== response.nonce
      || request.request.installationId !== response.licenseGrant.installationId
      || (request.request.deviceId && response.licenseGrant.schemaVersion === 2 && request.request.deviceId !== response.licenseGrant.deviceId)
    ) {
      throw new AppError('LICENSE_INVALID', '激活响应与本地请求不匹配');
    }
    const imported = await this.importLicense(response.licenseGrant, response.revocationList, tenantId);
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

  async createActivationRequest(): Promise<ActivationRequest> {
    const installation = await this.ensureInstallation();
    const request: ActivationRequest = {
      schemaVersion: 2,
      requestId: `lreq_${randomBytes(12).toString('hex')}`,
      nonce: randomBytes(24).toString('base64url'),
      kind: 'offline',
      productCode: 'gcac',
      installationId: installation.installationId,
      installationPublicKey: installation.publicKey,
      deviceId: installation.deviceId,
      productVersion: GCAC_VERSION,
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
      detail: { kind: 'offline', deviceId: installation.deviceId },
    });
    return request;
  }

  async requireFeature(featureCode: string): Promise<void> {
    const status = await this.getStatus();
    assertStatusUsable(status);
    if (!status.features.includes(featureCode)) {
      throw new AppError('LICENSE_FEATURE_DENIED', undefined, { featureCode, planCode: status.planCode });
    }
  }

  async requireQuota(quotaCode: keyof LicenseQuotas, requested: number): Promise<void> {
    const status = await this.getStatus();
    assertStatusUsable(status);
    const quota = status.quotas[quotaCode];
    if (quota !== null && requested > quota) {
      throw new AppError('LICENSE_QUOTA_EXCEEDED', undefined, { quotaCode, requested, limit: quota });
    }
  }

  async requireApplicationAssetQuota(nextCount: number): Promise<void> {
    await this.requireQuota('applicationAssets', nextCount);
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
    if (current?.deviceId) return current;
    if (current) {
      const deviceId = current.deviceId || createDeviceId();
      await this.repositories.installations.update(INSTALLATION_ID, {
        deviceId,
        updatedAt: this.now().toISOString(),
      });
      return { ...current, deviceId };
    }

    const keyPair = generateInstallationKeyPair();
    const now = this.now().toISOString();
    const entity: InstallationEntity = {
      id: INSTALLATION_ID,
      installationId: `inst_${randomBytes(16).toString('hex')}`,
      productCode: 'gcac',
      publicKey: keyPair.publicKey,
      encryptedPrivateKey: encryptPrivateKey(keyPair.privateKey, this.storageKey),
      deviceId: createDeviceId(),
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

  private async readApplicationAssetUsage(tenantId?: string): Promise<LicenseUsage | undefined> {
    if (!tenantId) return undefined;
    const result = await this.db.query<{ count: string }>(
      `select count(*)::text as count
         from pg_service_assets
        where tenant_id = $1
          and deleted_at is null
          and asset_kind = 'APPLICATION'`,
      [tenantId],
    );
    const count = Number(result.rows[0]?.count ?? 0);
    return { applicationAssets: Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0 };
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

  private async clearVersionMismatch(installation: InstallationEntity): Promise<void> {
    if (!installation.versionMismatchDetectedAt) return;
    await this.repositories.installations.update(INSTALLATION_ID, {
      versionMismatchDetectedAt: undefined,
      updatedAt: this.now().toISOString(),
    });
    installation.versionMismatchDetectedAt = undefined;
  }

  private async getOrCreateVersionMismatchDetectedAt(installation: InstallationEntity): Promise<string> {
    if (installation.versionMismatchDetectedAt) return installation.versionMismatchDetectedAt;
    const detectedAt = this.now().toISOString();
    await this.repositories.installations.update(INSTALLATION_ID, {
      versionMismatchDetectedAt: detectedAt,
      updatedAt: detectedAt,
    });
    installation.versionMismatchDetectedAt = detectedAt;
    return detectedAt;
  }

  private async recordIntegrityAlert(installation: InstallationEntity, grant: LicenseGrant, reason: string): Promise<void> {
    if (
      installation.licenseIntegrityAlertGrantId === grant.grantId
      && installation.licenseIntegrityAlertReason === reason
    ) {
      return;
    }
    const alertedAt = this.now().toISOString();
    await this.repositories.installations.update(INSTALLATION_ID, {
      licenseIntegrityAlertGrantId: grant.grantId,
      licenseIntegrityAlertReason: reason,
      licenseIntegrityAlertedAt: alertedAt,
      updatedAt: alertedAt,
    });
    installation.licenseIntegrityAlertGrantId = grant.grantId;
    installation.licenseIntegrityAlertReason = reason;
    installation.licenseIntegrityAlertedAt = alertedAt;
    await this.audit?.write({
      eventType: 'licensing.license.tampered',
      actorType: 'system',
      actorId: installation.installationId,
      action: 'licensing.license.integrity.check',
      resourceType: 'licenseGrant',
      resourceId: grant.grantId,
      result: 'failure',
      riskLevel: 'high',
      detail: {
        grantId: grant.grantId,
        keyId: grant.keyId,
        reason,
        deviceId: installation.deviceId,
      },
    });
  }

  private async clearIntegrityAlert(installation: InstallationEntity): Promise<void> {
    if (!installation.licenseIntegrityAlertGrantId) return;
    await this.repositories.installations.update(INSTALLATION_ID, {
      licenseIntegrityAlertGrantId: undefined,
      licenseIntegrityAlertReason: undefined,
      licenseIntegrityAlertedAt: undefined,
      updatedAt: this.now().toISOString(),
    });
    installation.licenseIntegrityAlertGrantId = undefined;
    installation.licenseIntegrityAlertReason = undefined;
    installation.licenseIntegrityAlertedAt = undefined;
  }
}

function createBaseStatus(installation: InstallationEntity, clockRollbackDetected: boolean): LicenseStatus {
  return {
    state: 'none',
    integrityStatus: 'not_configured',
    installationId: installation.installationId,
    installationPublicKey: installation.publicKey,
    deviceId: installation.deviceId,
    productCode: 'gcac',
    currentVersion: GCAC_VERSION,
    planCode: 'none',
    features: [...NONE_FEATURES],
    quotas: NONE_QUOTAS,
    versionCompatible: true,
    lastClockAt: installation.lastClockAt,
    clockRollbackDetected,
  };
}

function createVerifiedStatus(
  base: LicenseStatus,
  grant: LicenseGrant,
  versionCompatibility: VersionCompatibilityResult = evaluateVersionCompatibility(grant),
): Partial<LicenseStatus> {
  return {
    ...base,
    planCode: normalizePlanCode(grant.planCode) ?? 'none',
    userName: grant.userName,
    licenseSchemaVersion: grant.schemaVersion,
    grantId: grant.grantId,
    features: [...grant.features],
    quotas: capGrantQuotasToPlan(grant),
    issuedAt: grant.issuedAt,
    startsAt: grant.startsAt,
    expiresAt: readGrantExpiresAt(grant),
    graceEndsAt: graceEndsAt(grant),
    versionRange: versionCompatibility.versionRange,
    versionCompatible: versionCompatibility.compatible,
    integrityStatus: 'verified',
  };
}

function graceEndsAt(grant: LicenseGrant): string | undefined {
  const expiresAt = readGrantExpiresAt(grant);
  if (!expiresAt) return undefined;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp)
    ? new Date(timestamp + grant.gracePeriodDays * 86_400_000).toISOString()
    : undefined;
}

function evaluateVersionCompatibility(grant: LicenseGrant): VersionCompatibilityResult {
  const versionRange = readGrantVersionRange(grant);
  if (!versionRange) return { compatible: true };
  if (versionRange.min && compareSemVer(GCAC_VERSION, versionRange.min) < 0) {
    return { compatible: false, reason: 'current version is lower than minimum supported version', versionRange };
  }
  if (versionRange.max && compareSemVer(GCAC_VERSION, versionRange.max) > 0) {
    return { compatible: false, reason: 'current version is higher than maximum supported version', versionRange };
  }
  return { compatible: true, versionRange };
}

function assertStatusUsable(status: LicenseStatus): void {
  if (status.state === 'clock_rollback_detected') throw new AppError('LICENSE_CLOCK_ROLLBACK');
  if (status.state === 'revoked') throw new AppError('LICENSE_REVOKED');
}

function loadTrustKeys(): TrustKeyDirectory {
  const configured = process.env[LICENSE_TRUST_KEYS_ENV]?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`生产环境缺少 ${LICENSE_TRUST_KEYS_ENV}`);
    }
    return new Map();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(configured);
  } catch {
    throw new Error(`${LICENSE_TRUST_KEYS_ENV} 格式无效`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${LICENSE_TRUST_KEYS_ENV} 必须是 keyId 到 Ed25519 公钥的 JSON 对象`);
  }

  const trustKeys = new Map<string, Buffer>();
  for (const [keyId, encoded] of Object.entries(parsed as Record<string, unknown>)) {
    if (!keyId.trim() || typeof encoded !== 'string' || !BASE64URL_PATTERN.test(encoded)) {
      throw new Error(`${LICENSE_TRUST_KEYS_ENV} 包含无效的许可证信任根`);
    }
    if (process.env.NODE_ENV === 'production' && DEVELOPMENT_LICENSE_KEY_ID_PATTERN.test(keyId)) {
      throw new Error('生产环境禁止使用默认开发许可证信任根');
    }

    const publicKey = Buffer.from(encoded, 'base64url');
    try {
      const keyObject = createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
      if (keyObject.asymmetricKeyType !== 'ed25519') {
        throw new Error('信任根算法不是 Ed25519');
      }
    } catch {
      throw new Error(`${LICENSE_TRUST_KEYS_ENV} 包含无效的 Ed25519 公钥`);
    }
    trustKeys.set(keyId, publicKey);
  }
  if (trustKeys.size === 0) {
    throw new Error(`${LICENSE_TRUST_KEYS_ENV} 不得为空`);
  }
  return trustKeys;
}

function loadStorageKey(): Buffer {
  const configured = process.env.GCAC_LICENSE_STORAGE_KEY?.trim() || process.env.GCAC_SECRET_KEK?.trim();
  if (!configured) {
    throw new Error('缺少 GCAC_LICENSE_STORAGE_KEY 或 GCAC_SECRET_KEK，拒绝初始化许可证服务');
  }
  return createHash('sha256').update(configured, 'utf8').digest();
}

export function createDefaultLicensingService(db: DatabasePort, audit?: AuditService): LicensingApplicationService {
  return new LicensingApplicationService(db, audit);
}

export function planExists(planCode: string): boolean {
  const normalizedPlanCode = normalizePlanCode(planCode);
  return normalizedPlanCode !== undefined && normalizedPlanCode !== 'none';
}

function validateGrantAgainstPlan(grant: LicenseGrant): void {
  const planCode = toCanonicalPlanCode(grant.planCode);
  if (planCode === 'none') {
    throw new AppError('LICENSE_INVALID', 'none 状态不能通过许可证签发', { planCode: grant.planCode });
  }
  const plan = findPlan(planCode);
  if (!plan) throw new AppError('LICENSE_INVALID', '套餐代码不存在', { planCode: grant.planCode });
  if (planCode !== 'community' && (!grant.userName || grant.userName.trim().length === 0)) {
    throw new AppError('LICENSE_INVALID', '商业版、企业版和试用版许可证必须填写用户名称', { planCode });
  }
  if (!grant.features.every((feature) => plan.features.includes(feature))) {
    throw new AppError('LICENSE_INVALID', '许可证功能超出套餐定义', { planCode });
  }

  const quotas = normalizeLicenseQuotas(grant.quotas);
  for (const quotaCode of Object.keys(quotas) as Array<keyof LicenseQuotas>) {
    const granted = quotas[quotaCode];
    const allowed = plan.quotas[quotaCode];
    if (granted === null && allowed !== null) {
      throw new AppError('LICENSE_INVALID', '许可证额度不能超过套餐定义', { quotaCode, granted, allowed });
    }
    if (granted !== null && allowed !== null && granted > allowed) {
      throw new AppError('LICENSE_INVALID', '许可证额度超出套餐定义', { quotaCode, granted, allowed });
    }
  }

  validateVersionRange(readGrantVersionRange(grant));
  const expiresAt = readGrantExpiresAt(grant);
  if (planCode === 'trial') {
    if (!expiresAt) {
      throw new AppError('LICENSE_INVALID', '试用许可证必须有到期时间', { planCode });
    }
    if (grant.schemaVersion === 2) {
      const trialDays = grant.trialDays;
      if (typeof trialDays !== 'number' || !Number.isInteger(trialDays) || trialDays <= 0) {
        throw new AppError('LICENSE_INVALID', '试用许可证必须声明限定天数', { planCode });
      }
    }
  }
}

function capGrantQuotasToPlan(grant: LicenseGrant): LicenseQuotas {
  const quotas = normalizeLicenseQuotas(grant.quotas);
  const planCode = normalizePlanCode(grant.planCode);
  const plan = planCode ? findPlan(planCode) : undefined;
  if (!plan) return quotas;
  return {
    applicationAssets: capQuota(quotas.applicationAssets, plan.quotas.applicationAssets),
    managedTargets: capQuota(quotas.managedTargets, plan.quotas.managedTargets),
    concurrentExecutions: capQuota(quotas.concurrentExecutions, plan.quotas.concurrentExecutions),
    plugins: capQuota(quotas.plugins, plan.quotas.plugins),
  };
}

function capQuota(granted: number | null, allowed: number | null): number | null {
  if (allowed === null) return granted;
  if (granted === null) return allowed;
  return Math.min(granted, allowed);
}

function validateVersionRange(versionRange: LicenseVersionRange | undefined): void {
  if (!versionRange) return;
  if (versionRange.min) compareSemVer(versionRange.min, versionRange.min);
  if (versionRange.max) compareSemVer(versionRange.max, versionRange.max);
  if (versionRange.min && versionRange.max && compareSemVer(versionRange.min, versionRange.max) > 0) {
    throw new AppError('LICENSE_INVALID', '许可证版本范围无效', { versionRange });
  }
}

function toCanonicalPlanCode(planCode: string): ProductPlanCode {
  const normalizedPlanCode = normalizePlanCode(planCode);
  if (!normalizedPlanCode) throw new AppError('LICENSE_INVALID', '套餐代码不存在', { planCode });
  return normalizedPlanCode;
}

function createDeviceId(): string {
  return `dev_${randomBytes(16).toString('hex')}`;
}

function isActivationResponse(value: unknown): value is ActivationResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const response = value as Partial<ActivationResponse>;
  return (response.schemaVersion === 1 || response.schemaVersion === 2)
    && typeof response.responseId === 'string'
    && typeof response.requestId === 'string'
    && typeof response.nonce === 'string'
    && typeof response.issuedAt === 'string'
    && !!response.licenseGrant;
}

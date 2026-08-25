import type { PageQuery } from '../../common/pagination/pagination.js';
import type { AuditLogEntity } from '../../persistence/entities/audit-log.entity.js';
import type { AssetsRepository } from '../assets/repository/assets.repository.js';
import type { BindingsRepository } from '../bindings/repository/bindings.repository.js';
import type { CertificateBindingDto } from '../bindings/dto/bindings.dto.js';
import type { CertificatesRepository } from '../certificates/repository/certificates.repository.js';
import type { DeploymentPlansRepository } from '../deployment-plans/repository/deployment-plans.repository.js';
import type { DeploymentPlanEntity, DeploymentPlanTargetEntity } from '../deployment-plans/schema/deployment-plans.schema.js';
import type { SecretService } from '../secrets/secret.service.js';
import { isSuppressedAudit } from './audit-event-types.js';

export type AuditPresentationKind =
  | 'generic'
  | 'deployment'
  | 'caSyncStarted'
  | 'caSyncCompleted'
  | 'caSyncFailed'
  | 'permissionDenied'
  | 'taskCreated'
  | 'secretUsed'
  | 'authExternalLoginSuccess'
  | 'authExternalLoginFailed'
  | 'authLoginSuccess'
  | 'authLoginFailed'
  | 'authPasswordChanged'
  | 'authLogout'
  | 'securityIdentitySourceSynced'
  | 'securityIdentitySourceTested'
  | 'securityUserCreated';

export type AuditPresentationValue = string | number | string[];

/**
 * 审计展示描述只携带事件语义和业务参数，不携带拼接后的自然语言摘要。
 * 最终文案由前端按照当前语言包生成，避免同一条审计记录被固定为写入时语言。
 */
export interface AuditPresentation {
  readonly kind: AuditPresentationKind;
  readonly params: Record<string, AuditPresentationValue>;
}

export type PresentedAuditLog = AuditLogEntity & {
  presentation: AuditPresentation;
};

export interface AuditPresentationContext {
  readonly deploymentPlanById: Map<string, DeploymentPlanEntity>;
  readonly deploymentTargetsByPlanId: Map<string, DeploymentPlanTargetEntity[]>;
  readonly bindingById: Map<string, CertificateBindingDto>;
  readonly applicationAssetLabelById: Map<string, string>;
  readonly objectLabelByKey: Map<string, string>;
}

export interface AuditPresentationDependencies {
  deploymentPlans: DeploymentPlansRepository;
  assets: AssetsRepository;
  bindings: BindingsRepository;
  secrets?: SecretService;
  certificates?: CertificatesRepository;
}

export class AuditPresentationService {
  constructor(private readonly dependencies: AuditPresentationDependencies) {}

  async present(tenantId: string, auditLogs: AuditLogEntity[]): Promise<PresentedAuditLog[]> {
    const visibleAuditLogs = auditLogs.filter((log) => !isSuppressedAudit(log));
    try {
      const [applicationAssets, bindings] = await Promise.all([
        this.dependencies.assets.listServiceAssets(tenantId, allRowsQuery('updatedAt:desc')),
        this.dependencies.bindings.listCertificateBindings(tenantId, allRowsQuery('updatedAt:desc')),
      ]);
      const context = await buildAuditPresentationContext({
        tenantId,
        auditLogs: visibleAuditLogs,
        deploymentPlans: this.dependencies.deploymentPlans,
        applicationAssets: applicationAssets.items,
        bindings: bindings.items,
        secrets: this.dependencies.secrets,
        certificates: this.dependencies.certificates,
      });
      return visibleAuditLogs.map((log) => presentAuditLog(log, context));
    } catch {
      // 展示增强不能影响审计查询本身；缺少资产表或上下文时回退到原始审计。
      return visibleAuditLogs.map((log) => presentAuditLog(log));
    }
  }
}

export async function buildAuditPresentationContext(input: {
  tenantId: string;
  auditLogs: AuditLogEntity[];
  deploymentPlans: DeploymentPlansRepository;
  applicationAssets: Array<{ id: string; displayName?: string; address: string; port: number; protocol: string }>;
  bindings: CertificateBindingDto[];
  secrets?: SecretService;
  certificates?: CertificatesRepository;
}): Promise<AuditPresentationContext> {
  const deploymentPlanIds = new Set(input.auditLogs
    .filter((log) => log.eventType === 'deployment.executed')
    .map((log) => readDetailString(log.detail, 'deploymentPlanId'))
    .filter((id): id is string => Boolean(id)));
  const deploymentPlanById = new Map<string, DeploymentPlanEntity>();
  const deploymentTargetsByPlanId = new Map<string, DeploymentPlanTargetEntity[]>();

  await Promise.all([...deploymentPlanIds].map(async (planId) => {
    const plan = await input.deploymentPlans.getPlan(planId, input.tenantId);
    if (!plan) return;
    deploymentPlanById.set(plan.id, plan);
    deploymentTargetsByPlanId.set(plan.id, await input.deploymentPlans.listTargetsByPlan(plan.id, input.tenantId));
  }));

  const applicationAssetLabelById = new Map(input.applicationAssets.map((asset) => [asset.id, serviceAssetLabel(asset)]));
  const objectLabelByKey = new Map<string, string>();

  for (const asset of input.applicationAssets) {
    const label = serviceAssetLabel(asset);
    setObjectLabel(objectLabelByKey, ['service_asset', 'application_asset'], asset.id, label);
  }
  await addSecretLabels(objectLabelByKey, input.secrets, input.tenantId);
  await addCertificateLabels(objectLabelByKey, input.certificates, input.tenantId, input.auditLogs);

  return {
    deploymentPlanById,
    deploymentTargetsByPlanId,
    bindingById: new Map(input.bindings.map((binding) => [binding.id, binding])),
    applicationAssetLabelById,
    objectLabelByKey,
  };
}

export function emptyAuditPresentationContext(): AuditPresentationContext {
  return {
    deploymentPlanById: new Map(),
    deploymentTargetsByPlanId: new Map(),
    bindingById: new Map(),
    applicationAssetLabelById: new Map(),
    objectLabelByKey: new Map(),
  };
}

export function presentAuditLog(log: AuditLogEntity, context: AuditPresentationContext = emptyAuditPresentationContext()): PresentedAuditLog {
  return { ...log, presentation: buildAuditPresentation(log, context) };
}

export function buildAuditPresentation(log: AuditLogEntity, context: AuditPresentationContext): AuditPresentation {
  const params: Record<string, AuditPresentationValue> = {};
  const resourceName = resourceBusinessName(log, context);
  if (resourceName) params.resourceName = resourceName;

  if (log.eventType === 'deployment.executed') {
    const deploymentPlanId = readDetailString(log.detail, 'deploymentPlanId');
    if (deploymentPlanId) {
      const plan = context.deploymentPlanById.get(deploymentPlanId);
      const targetNames = deploymentTargetNames(deploymentPlanId, context);
      if (plan?.name) params.planName = cleanBusinessLabel(plan.name) ?? plan.name;
      if (targetNames.length > 0) params.targetNames = targetNames;
      params.targetCount = targetNames.length;
      params.deploymentAction = log.action.includes('dry_run')
        ? 'dryRun'
        : log.action.includes('rollback')
          ? 'rollback'
          : 'execute';
      return { kind: 'deployment', params };
    }
  }
  if (log.eventType.startsWith('ca.operations.sync.')) {
    params.objectType = readDetailString(log.detail, 'objectType') ?? '';
    const readCount = readDetailNumber(log.detail, 'readCount');
    const upsertedCount = readDetailNumber(log.detail, 'upsertedCount');
    if (readCount !== undefined) params.readCount = readCount;
    if (upsertedCount !== undefined) params.upsertedCount = upsertedCount;
    const errorCode = readDetailString(log.detail, 'errorCode');
    if (errorCode) params.errorCode = errorCode;
    return {
      kind: log.eventType.endsWith('.started')
        ? 'caSyncStarted'
        : log.eventType.endsWith('.completed')
          ? 'caSyncCompleted'
          : 'caSyncFailed',
      params,
    };
  }
  if (log.eventType === 'permission.denied') {
    const reason = readDetailString(log.detail, 'reason');
    if (reason) params.permissionReason = reason;
    params.permissionAction = log.action;
    return { kind: 'permissionDenied', params };
  }
  if (log.eventType === 'task.created') {
    params.taskType = readDetailString(log.detail, 'taskType') ?? '';
    return { kind: 'taskCreated', params };
  }
  if (log.eventType === 'secret.used') {
    params.purpose = readDetailString(log.detail, 'purpose') ?? '';
    return { kind: 'secretUsed', params };
  }
  if (log.eventType === 'auth.external_login.success' || log.eventType === 'auth.external_login.failed') {
    params.sourceType = readDetailString(log.detail, 'sourceType') ?? '';
    return { kind: log.eventType.endsWith('.success') ? 'authExternalLoginSuccess' : 'authExternalLoginFailed', params };
  }
  if (log.eventType === 'auth.login.success') return { kind: 'authLoginSuccess', params };
  if (log.eventType === 'auth.login.failed' || log.eventType === 'auth.login.failure') {
    params.authFailureReason = readDetailString(log.detail, 'reason') ?? '';
    return { kind: 'authLoginFailed', params };
  }
  if (log.eventType === 'auth.password.changed') return { kind: 'authPasswordChanged', params };
  if (log.eventType === 'auth.logout') return { kind: 'authLogout', params };
  if (log.eventType === 'security.identity_source.synced') {
    const detail = detailRecord(log.detail);
    const total = readNumber(detail, 'total');
    const created = readNumber(detail, 'created');
    const updated = readNumber(detail, 'updated');
    const failed = readNumber(detail, 'failed');
    if (total !== undefined) params.total = total;
    if (created !== undefined) params.created = created;
    if (updated !== undefined) params.updated = updated;
    if (failed !== undefined) params.failed = failed;
    return { kind: 'securityIdentitySourceSynced', params };
  }
  if (log.eventType === 'security.identity_source.tested') return { kind: 'securityIdentitySourceTested', params };
  if (log.eventType === 'security.user.created') {
    const username = cleanBusinessLabel(readDetailString(log.detail, 'username'));
    if (username) params.username = username;
    return { kind: 'securityUserCreated', params };
  }
  return { kind: 'generic', params };
}

async function addSecretLabels(
  objectLabelByKey: Map<string, string>,
  secrets: SecretService | undefined,
  tenantId: string,
): Promise<void> {
  if (!secrets) return;
  const secretItems = await secrets.listMetadata(tenantId);
  for (const secret of secretItems) {
    setObjectLabel(objectLabelByKey, ['secret'], secret.id, cleanBusinessLabel(secret.name) ?? 'Secret');
    const versions = await secrets.listSecretVersions(secret.id, tenantId);
    for (const version of versions) {
      setObjectLabel(objectLabelByKey, ['secret_version'], version.id, `${cleanBusinessLabel(secret.name) ?? 'Secret'} v${version.versionNo}`);
    }
  }
}

async function addCertificateLabels(
  objectLabelByKey: Map<string, string>,
  certificates: CertificatesRepository | undefined,
  tenantId: string,
  auditLogs: AuditLogEntity[],
): Promise<void> {
  if (!certificates) return;
  const references = collectCertificateReferences(auditLogs);
  const [certificateAssets, certificateVersions, certificateFormats] = await Promise.all([
    certificates.listAssets(allRowsQuery('updatedAt:desc'), tenantId),
    certificates.listVersions(allRowsQuery('createdAt:desc'), tenantId),
    typeof certificates.listFormats === 'function'
      ? certificates.listFormats(allRowsQuery('createdAt:desc'), tenantId)
      : Promise.resolve({ items: [], page: 1, pageSize: 1000, total: 0 }),
  ]);
  const assetsById = new Map(certificateAssets.items.map((asset) => [asset.id, asset]));
  const versionsById = new Map(certificateVersions.items.map((version) => [version.id, version]));
  const formatsById = new Map(certificateFormats.items.map((format) => [format.id, format]));

  // 列表接口会过滤已删除资产和版本；审计记录仍可能引用它们，因此只对审计中出现的 ID 做历史回查。
  if (typeof certificates.getFormat === 'function') {
    await addMissingCertificateReferences(formatsById, references.formatIds, (id) => certificates.getFormat(id, tenantId));
  }
  for (const format of formatsById.values()) {
    if (format.certificateVersionId) references.versionIds.add(format.certificateVersionId);
  }
  await addMissingCertificateReferences(versionsById, references.versionIds, (id) => certificates.getVersion(id, tenantId));
  for (const version of versionsById.values()) references.assetIds.add(version.certificateAssetId);
  await addMissingCertificateReferences(assetsById, references.assetIds, (id) => certificates.getAsset(id, tenantId));

  const assetNameById = new Map<string, string>();
  for (const asset of assetsById.values()) {
    const name = cleanBusinessLabel(asset.name) ?? cleanBusinessLabel(asset.primaryDomain);
    if (!name) continue;
    assetNameById.set(asset.id, name);
    setObjectLabel(objectLabelByKey, ['certificate', 'certificate_asset', 'certificateAsset'], asset.id, name);
  }

  const versionLabelById = new Map<string, string>();
  for (const version of versionsById.values()) {
    const assetName = assetNameById.get(version.certificateAssetId);
    const certificateName = cleanBusinessLabel(version.commonName) ?? cleanBusinessLabel(version.sans[0]);
    const name = assetName
      ? `${assetName} v${version.versionNo}`
      : certificateName
        ? `${certificateName} v${version.versionNo}`
        : undefined;
    if (!name) continue;
    versionLabelById.set(version.id, name);
    setObjectLabel(objectLabelByKey, ['certificate_version', 'certificateVersion'], version.id, name);
  }

  for (const format of formatsById.values()) {
    const versionLabel = format.certificateVersionId ? versionLabelById.get(format.certificateVersionId) : undefined;
    const name = versionLabel
      ? `${versionLabel} / ${certificateFormatLabel(format.format)}`
      : certificateFormatLabel(format.format);
    setObjectLabel(objectLabelByKey, ['certificate_version_format', 'certificate_format', 'certificateVersionFormat'], format.id, name);
  }

  // 删除格式后格式表中已没有 resourceId，利用审计详情中的版本和格式保留可读对象名。
  for (const log of auditLogs) {
    if (!log.resourceId || !isCertificateFormatType(log.resourceType)) continue;
    const detail = detailRecord(log.detail);
    const versionId = readDetailString(detail, 'certificateVersionId')
      ?? readDetailString(detail, 'certificate_version_id');
    const format = readDetailString(detail, 'format');
    if (!versionId || !format) continue;
    const versionLabel = versionLabelById.get(versionId);
    const name = versionLabel
      ? `${versionLabel} / ${certificateFormatLabel(format)}`
      : certificateFormatLabel(format);
    setObjectLabel(objectLabelByKey, ['certificate_version_format', 'certificate_format', 'certificateVersionFormat'], log.resourceId, name);
  }
}

interface CertificateReferences {
  readonly assetIds: Set<string>;
  readonly versionIds: Set<string>;
  readonly formatIds: Set<string>;
}

function collectCertificateReferences(auditLogs: AuditLogEntity[]): CertificateReferences {
  const references: CertificateReferences = {
    assetIds: new Set(),
    versionIds: new Set(),
    formatIds: new Set(),
  };
  for (const log of auditLogs) {
    if (log.resourceId) {
      if (isCertificateAssetType(log.resourceType)) references.assetIds.add(log.resourceId);
      if (isCertificateVersionType(log.resourceType)) references.versionIds.add(log.resourceId);
      if (isCertificateFormatType(log.resourceType)) references.formatIds.add(log.resourceId);
    }
    for (const detail of detailRecords(log.detail)) {
      addDetailReference(references.assetIds, detail, ['certificateAssetId', 'certificate_asset_id', 'assetId']);
      addDetailReference(references.versionIds, detail, ['certificateVersionId', 'certificate_version_id', 'versionId']);
      addDetailReference(references.formatIds, detail, ['certificateFormatId', 'certificate_format_id', 'formatId']);
    }
  }
  return references;
}

function detailRecords(detail: unknown): Record<string, unknown>[] {
  const root = detailRecord(detail);
  if (!root) return [];
  return [root, detailRecord(root.before), detailRecord(root.after)].filter((item): item is Record<string, unknown> => Boolean(item));
}

function addDetailReference(target: Set<string>, detail: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) {
    const value = detail[key];
    if (typeof value === 'string' && value) target.add(value);
  }
}

async function addMissingCertificateReferences<T>(
  entitiesById: Map<string, T>,
  ids: Set<string>,
  load: (id: string) => Promise<T | undefined>,
): Promise<void> {
  const missingIds = [...ids].filter((id) => !entitiesById.has(id));
  const loaded = await Promise.all(missingIds.map(async (id) => {
    try {
      return [id, await load(id)] as const;
    } catch {
      return [id, undefined] as const;
    }
  }));
  for (const [id, entity] of loaded) {
    if (entity) entitiesById.set(id, entity);
  }
}

function isCertificateAssetType(resourceType: string): boolean {
  return resourceType === 'certificate' || resourceType === 'certificate_asset' || resourceType === 'certificateAsset';
}

function isCertificateVersionType(resourceType: string): boolean {
  return resourceType === 'certificate_version' || resourceType === 'certificateVersion';
}

function isCertificateFormatType(resourceType: string): boolean {
  return resourceType === 'certificate_version_format'
    || resourceType === 'certificate_format'
    || resourceType === 'certificateVersionFormat';
}

function certificateFormatLabel(format: string): string {
  return format.trim().toUpperCase() || 'UNKNOWN_FORMAT';
}

function setObjectLabel(labels: Map<string, string>, resourceTypes: string[], id: string, label: string): void {
  for (const resourceType of resourceTypes) {
    labels.set(objectKey(resourceType, id), label);
  }
}

function objectKey(resourceType: string, id: string): string {
  return `${resourceType}:${id}`;
}

function resourceBusinessName(log: AuditLogEntity, context: AuditPresentationContext): string | undefined {
  const detailName = detailBusinessName(log.detail);
  if (detailName) return detailName;
  if (!log.resourceId) return undefined;
  const objectLabel = context.objectLabelByKey.get(objectKey(log.resourceType, log.resourceId))
    ?? context.objectLabelByKey.get(objectKey(normalizeResourceType(log.resourceType), log.resourceId));
  if (objectLabel) return cleanBusinessLabel(objectLabel) ?? objectLabel;
  return certificateFormatDetailLabel(log, context);
}

function certificateFormatDetailLabel(log: AuditLogEntity, context: AuditPresentationContext): string | undefined {
  if (!isCertificateFormatType(log.resourceType)) return undefined;
  const format = readDetailString(log.detail, 'format');
  if (!format) return undefined;
  const versionId = readDetailString(log.detail, 'certificateVersionId')
    ?? readDetailString(log.detail, 'certificate_version_id');
  const versionLabel = versionId
    ? context.objectLabelByKey.get(objectKey('certificate_version', versionId))
      ?? context.objectLabelByKey.get(objectKey('certificateVersion', versionId))
    : undefined;
  return versionLabel
    ? `${versionLabel} / ${certificateFormatLabel(format)}`
    : certificateFormatLabel(format);
}

function normalizeResourceType(resourceType: string): string {
  if (resourceType === 'executionRun') return 'execution';
  return resourceType;
}

function deploymentTargetNames(deploymentPlanId: string, context: AuditPresentationContext): string[] {
  const labels = (context.deploymentTargetsByPlanId.get(deploymentPlanId) ?? [])
    .map((target) => deploymentTargetLabel(target, context))
    .filter((label): label is string => Boolean(label));
  const uniqueLabels = [...new Set(labels)];
  return uniqueLabels;
}

function deploymentTargetLabel(target: DeploymentPlanTargetEntity, context: AuditPresentationContext): string | undefined {
  const binding = target.certificateBindingId ? context.bindingById.get(target.certificateBindingId) : undefined;
  const serviceAssetLabelText = binding?.serviceAssetId ? context.applicationAssetLabelById.get(binding.serviceAssetId) : undefined;
  return serviceAssetLabelText
    ?? bindingLabel(binding)
    ?? readDetailString(target.strategyPayload, 'targetName')
    ?? readDetailString(target.strategyPayload, 'assetName')
    ?? undefined;
}

function bindingLabel(binding: CertificateBindingDto | undefined): string | undefined {
  if (!binding) return undefined;
  const host = binding.domainName ?? binding.domain;
  if (!host) return binding.bindingKey;
  return [host, binding.port, binding.protocol].filter(Boolean).join(':');
}

function serviceAssetLabel(asset: { displayName?: string; address: string; port: number; protocol: string }): string {
  return cleanBusinessLabel(asset.displayName) || `${asset.protocol} ${asset.address}:${asset.port}`;
}

function readDetailString(detail: unknown, key: string): string | undefined {
  const value = detailRecord(detail)?.[key];
  return typeof value === 'string' ? value : undefined;
}

function readDetailNumber(detail: unknown, key: string): number | undefined {
  const value = detailRecord(detail)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function detailRecord(detail: unknown): Record<string, unknown> | undefined {
  return detail && typeof detail === 'object' && !Array.isArray(detail)
    ? detail as Record<string, unknown>
    : undefined;
}

function readNumber(detail: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = detail?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function detailBusinessName(detail: unknown): string | undefined {
  const root = detailRecord(detail);
  const after = detailRecord(root?.after);
  const candidates = [
    root?.name,
    root?.displayName,
    root?.username,
    root?.groupName,
    root?.commonName,
    root?.primaryDomain,
    root?.domainName,
    root?.address,
    root?.managementAddress,
    after?.name,
    after?.displayName,
    after?.username,
    after?.groupName,
    after?.commonName,
    after?.primaryDomain,
    after?.domainName,
    after?.address,
    after?.managementAddress,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const label = cleanBusinessLabel(candidate);
    if (label) return label;
  }
  return undefined;
}

function cleanBusinessLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const internalId = /(?:aud|task|casync|secv?|cert(?:asset|ver|fmt)?|pln|run|apr|autv?|arun|agt|sat|svc|sit|dev|ids|external_ids|external_group_ids|rbnd|oset|role|bpgr|agrant|caprov|canode|cantask|certreq|catd|mtg|cred|wfrun|wftplv?|artifact)[_-][a-z0-9_-]+/gi;
  const cleaned = value
    .replace(new RegExp(`\\s*[（(]\\s*${internalId.source}\\s*[）)]`, 'gi'), '')
    .replace(internalId, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || undefined;
}

function allRowsQuery(sort = 'updatedAt:desc'): PageQuery {
  const [field, direction = 'desc'] = sort.split(':');
  return {
    page: 1,
    pageSize: 1000,
    sort: { field, direction: direction === 'asc' ? 'asc' : 'desc' },
    filter: {},
  };
}

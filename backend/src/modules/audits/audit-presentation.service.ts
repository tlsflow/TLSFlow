import type { PageQuery } from '../../common/pagination/pagination.js';
import type { AuditLogEntity } from '../../persistence/entities/audit-log.entity.js';
import type { AssetsRepository } from '../assets/repository/assets.repository.js';
import type { BindingsRepository } from '../bindings/repository/bindings.repository.js';
import type { CertificateBindingDto } from '../bindings/dto/bindings.dto.js';
import type { CertificatesRepository } from '../certificates/repository/certificates.repository.js';
import type { DeploymentPlansRepository } from '../deployment-plans/repository/deployment-plans.repository.js';
import type { DeploymentPlanEntity, DeploymentPlanTargetEntity } from '../deployment-plans/schema/deployment-plans.schema.js';
import type { SecretService } from '../secrets/secret.service.js';

export type PresentedAuditLog = AuditLogEntity & {
  summary?: string;
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
    try {
      const [applicationAssets, bindings] = await Promise.all([
        this.dependencies.assets.listServiceAssets(tenantId, allRowsQuery('updatedAt:desc')),
        this.dependencies.bindings.listCertificateBindings(tenantId, allRowsQuery('updatedAt:desc')),
      ]);
      const context = await buildAuditPresentationContext({
        tenantId,
        auditLogs,
        deploymentPlans: this.dependencies.deploymentPlans,
        applicationAssets: applicationAssets.items,
        bindings: bindings.items,
        secrets: this.dependencies.secrets,
        certificates: this.dependencies.certificates,
      });
      return auditLogs.map((log) => presentAuditLog(log, context));
    } catch {
      // 展示增强不能影响审计查询本身；缺少资产表或上下文时回退到原始审计。
      return auditLogs.map((log) => presentAuditLog(log));
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
  const summary = buildAuditSummary(log, context) ?? buildGenericAuditSummary(log, context);
  return summary ? { ...log, summary } : { ...log };
}

export function buildAuditSummary(log: AuditLogEntity, context: AuditPresentationContext): string | undefined {
  if (log.eventType === 'deployment.executed') {
    return deploymentAuditSummary(log, context);
  }
  if (log.eventType.startsWith('ca.operations.sync.')) {
    return caSyncAuditSummary(log);
  }
  if (log.eventType === 'permission.denied') {
    return permissionDeniedAuditSummary(log, context);
  }
  if (log.eventType === 'task.created') {
    return taskCreatedAuditSummary(log);
  }
  if (log.eventType === 'secret.used') {
    return secretUsedAuditSummary(log);
  }
  if (log.eventType.startsWith('auth.')) {
    return authAuditSummary(log);
  }
  if (log.eventType.startsWith('security.')) {
    return securityAuditSummary(log, context);
  }
  if (log.eventType.startsWith('internal_ca.')) {
    return internalCaAuditSummary(log, context);
  }
  return undefined;
}

function buildGenericAuditSummary(log: AuditLogEntity, context: AuditPresentationContext): string {
  return `${actorLabel(log)}${resultVerb(log.result)}“${readableAction(log)}”，对象：${resourceLabel(log, context)}。`;
}

function deploymentAuditSummary(log: AuditLogEntity, context: AuditPresentationContext): string | undefined {
  const deploymentPlanId = readDetailString(log.detail, 'deploymentPlanId');
  if (!deploymentPlanId) {
    return `${actorLabel(log)}${resultVerb(log.result)}“${readableAction(log)}”，对象：${resourceLabel(log, context)}。`;
  }

  const plan = context.deploymentPlanById.get(deploymentPlanId);
  const planName = cleanBusinessLabel(plan?.name) ?? '未命名部署计划';
  const targetNames = deploymentTargetLabels(deploymentPlanId, context);
  const action = log.action.includes('dry_run')
    ? '试运行部署计划'
    : log.action.includes('rollback')
      ? '回滚部署计划'
      : '执行部署';
  return `${actorLabel(log)}${resultVerb(log.result)}“${action}”，部署计划：${planName}，资产：${targetNames || '未记录目标资产'}。`;
}

function caSyncAuditSummary(log: AuditLogEntity): string {
  const objectType = readDetailString(log.detail, 'objectType');
  const objectLabel = caObjectTypeLabels[objectType ?? ''] ?? 'CA 数据';
  const readCount = readDetailNumber(log.detail, 'readCount');
  const upsertedCount = readDetailNumber(log.detail, 'upsertedCount');
  if (log.eventType.endsWith('.started')) {
    return `${actorLabel(log)}开始同步${objectLabel}。`;
  }
  if (log.eventType.endsWith('.completed')) {
    const counts = readCount === undefined && upsertedCount === undefined
      ? ''
      : `，读取 ${readCount ?? 0} 条，新增或更新 ${upsertedCount ?? 0} 条`;
    return `${actorLabel(log)}完成${objectLabel}同步${counts}。`;
  }
  const errorCode = readDetailString(log.detail, 'errorCode');
  const reason = errorCode ? `：${caSyncErrorLabel(errorCode)}` : '';
  return `${actorLabel(log)}同步${objectLabel}失败${reason}。`;
}

function permissionDeniedAuditSummary(log: AuditLogEntity, context: AuditPresentationContext): string {
  const action = permissionActionLabel(log.action);
  const resource = resourceLabel(log, context);
  const reason = permissionReasonLabel(readDetailString(log.detail, 'reason'));
  return `${actorLabel(log)}因${reason}，访问${resource}的“${action}”操作被拒绝。`;
}

function taskCreatedAuditSummary(log: AuditLogEntity): string {
  const taskType = readDetailString(log.detail, 'taskType');
  const label = taskTypeLabels[taskType ?? ''] ?? '后台任务';
  return `${actorLabel(log)}创建“${label}”。`;
}

function secretUsedAuditSummary(log: AuditLogEntity): string {
  const purpose = readDetailString(log.detail, 'purpose');
  const purposeLabel = secretPurposeLabels[purpose ?? ''] ?? '凭据';
  return `${actorLabel(log)}读取${purposeLabel}。`;
}

function authAuditSummary(log: AuditLogEntity): string | undefined {
  if (log.eventType === 'auth.external_login.success') {
    const sourceType = identitySourceTypeLabel(readDetailString(log.detail, 'sourceType'));
    return `${actorLabel(log)}通过${sourceType}身份源登录成功。`;
  }
  if (log.eventType === 'auth.external_login.failed') {
    const sourceType = identitySourceTypeLabel(readDetailString(log.detail, 'sourceType'));
    return `${actorLabel(log)}通过${sourceType}身份源登录失败。`;
  }
  if (log.eventType === 'auth.login.success') return `${actorLabel(log)}登录成功。`;
  if (log.eventType === 'auth.login.failed' || log.eventType === 'auth.login.failure') {
    return `${actorLabel(log)}登录失败：${authFailureReasonLabel(readDetailString(log.detail, 'reason'))}。`;
  }
  if (log.eventType === 'auth.password.changed') return `${actorLabel(log)}修改了登录密码。`;
  if (log.eventType === 'auth.logout') return `${actorLabel(log)}退出登录。`;
  return undefined;
}

function securityAuditSummary(log: AuditLogEntity, context: AuditPresentationContext): string {
  const resource = resourceLabel(log, context);
  if (log.eventType === 'security.identity_source.synced') {
    const detail = detailRecord(log.detail);
    const total = readNumber(detail, 'total');
    const created = readNumber(detail, 'created');
    const updated = readNumber(detail, 'updated');
    const failed = readNumber(detail, 'failed');
    const counts = total === undefined ? '' : `，共 ${total} 个账号，新增 ${created ?? 0} 个，更新 ${updated ?? 0} 个，失败 ${failed ?? 0} 个`;
    return `${actorLabel(log)}同步${resource}${counts}。`;
  }
  if (log.eventType === 'security.identity_source.tested') {
    return `${actorLabel(log)}测试${resource}连接成功。`;
  }
  if (log.eventType === 'security.user.created') {
    const username = cleanBusinessLabel(readDetailString(log.detail, 'username'));
    return `${actorLabel(log)}创建${username ? `用户“${username}”` : resource}。`;
  }
  return `${actorLabel(log)}${resultVerb(log.result)}“${readableAction(log)}”，对象：${resource}。`;
}

function internalCaAuditSummary(log: AuditLogEntity, context: AuditPresentationContext): string {
  const resource = resourceLabel(log, context);
  return `${actorLabel(log)}${resultVerb(log.result)}“${readableAction(log)}”，对象：${resource}。`;
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
    const name = cleanBusinessLabel(asset.name) ?? cleanBusinessLabel(asset.primaryDomain) ?? '证书资产';
    assetNameById.set(asset.id, name);
    setObjectLabel(objectLabelByKey, ['certificate', 'certificate_asset', 'certificateAsset'], asset.id, name);
  }

  const versionLabelById = new Map<string, string>();
  for (const version of versionsById.values()) {
    const assetName = assetNameById.get(version.certificateAssetId);
    const name = assetName
      ? `${assetName} v${version.versionNo}`
      : `${cleanBusinessLabel(version.commonName) ?? cleanBusinessLabel(version.sans[0]) ?? '证书'} v${version.versionNo}`;
    versionLabelById.set(version.id, name);
    setObjectLabel(objectLabelByKey, ['certificate_version', 'certificateVersion'], version.id, name);
  }

  for (const format of formatsById.values()) {
    const versionLabel = format.certificateVersionId ? versionLabelById.get(format.certificateVersionId) : undefined;
    const name = versionLabel
      ? `${versionLabel} / ${certificateFormatLabel(format.format)}`
      : `${certificateFormatLabel(format.format)} 证书产物`;
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
      : `${certificateFormatLabel(format)} 证书产物`;
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
  return format.trim().toUpperCase() || '未知格式';
}

function setObjectLabel(labels: Map<string, string>, resourceTypes: string[], id: string, label: string): void {
  for (const resourceType of resourceTypes) {
    labels.set(objectKey(resourceType, id), label);
  }
}

function objectKey(resourceType: string, id: string): string {
  return `${resourceType}:${id}`;
}

function actorLabel(log: AuditLogEntity): string {
  if (log.actorId === 'system') return '系统';
  if (log.actorId.startsWith('system:') || log.actorId.startsWith('system_')) return '系统';
  if (log.actorId.startsWith('external_ids_') || log.actorId.startsWith('external_group_ids_')) return '外部身份用户';
  if (log.actorId.startsWith('ids_')) return '身份源服务';
  if (log.actorId === 'admin' || log.actorId === 'user_admin') return '管理员';
  const actorTypeLabels: Record<string, string> = {
    user: '用户',
    system: '系统',
    agent: 'Agent',
    plugin: '插件',
    executor: '执行器',
  };
  return actorTypeLabels[log.actorType] ?? '用户';
}

function resultVerb(result: string): string {
  const labels: Record<string, string> = {
    success: '完成',
    failure: '失败',
    denied: '拒绝',
  };
  return labels[result] ?? result;
}

function readableAction(log: AuditLogEntity): string {
  return auditEventActionOverrides[log.eventType]
    ?? auditActionTitles[log.action]
    ?? auditEventTitles[log.eventType]
    ?? '执行操作';
}

function resourceLabel(log: AuditLogEntity, context: AuditPresentationContext): string {
  const resourceType = auditResourceLabels[log.resourceType] ?? '业务对象';
  const detailName = detailBusinessName(log.detail);
  if (detailName) return `${resourceType} ${detailName}`;
  if (!log.resourceId) return resourceType;
  const objectLabel = context.objectLabelByKey.get(objectKey(log.resourceType, log.resourceId))
    ?? context.objectLabelByKey.get(objectKey(normalizeResourceType(log.resourceType), log.resourceId));
  if (objectLabel) return `${resourceType} ${objectLabel}`;
  const detailObjectLabel = certificateFormatDetailLabel(log, context);
  return detailObjectLabel ? `${resourceType} ${detailObjectLabel}` : resourceType;
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
    : `${certificateFormatLabel(format)} 证书产物`;
}

function normalizeResourceType(resourceType: string): string {
  if (resourceType === 'executionRun') return 'execution';
  return resourceType;
}

function deploymentTargetLabels(deploymentPlanId: string, context: AuditPresentationContext): string {
  const labels = (context.deploymentTargetsByPlanId.get(deploymentPlanId) ?? [])
    .map((target) => deploymentTargetLabel(target, context))
    .filter(Boolean);
  const uniqueLabels = [...new Set(labels)];
  if (uniqueLabels.length <= 3) return uniqueLabels.join('、');
  return `${uniqueLabels.slice(0, 3).join('、')} 等 ${uniqueLabels.length} 个资产`;
}

function deploymentTargetLabel(target: DeploymentPlanTargetEntity, context: AuditPresentationContext): string {
  const binding = target.certificateBindingId ? context.bindingById.get(target.certificateBindingId) : undefined;
  const serviceAssetLabelText = binding?.serviceAssetId ? context.applicationAssetLabelById.get(binding.serviceAssetId) : undefined;
  return serviceAssetLabelText
    ?? bindingLabel(binding)
    ?? readDetailString(target.strategyPayload, 'targetName')
    ?? readDetailString(target.strategyPayload, 'assetName')
    ?? '未命名目标资产';
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
  const internalId = /(?:aud|task|casync|secv?|cert(?:asset|ver|fmt)?|pln|run|apr|autv?|arun|agt|sat|svc|sit|dev|ids|external_ids|external_group_ids|rbnd|oset|role|bpgr|agrant|caprov|canode|cantask|certreq|catd|mtg|cred|wfrun|wftplv?|artifact)[_-][a-z0-9-]+/gi;
  const cleaned = value
    .replace(new RegExp(`\\s*[（(]\\s*${internalId.source}\\s*[）)]`, 'gi'), '')
    .replace(internalId, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || undefined;
}

const caObjectTypeLabels: Record<string, string> = {
  request: '证书申请记录',
  issuance: '证书签发记录',
  revocation: '证书吊销记录',
  template: '证书模板',
};

const caSyncErrorLabels: Record<string, string> = {
  CA_SYNC_SOURCE_UNAVAILABLE: '同步源暂不可用',
  RESOURCE_NOT_FOUND: '同步源中的对象不存在',
};

const taskTypeLabels: Record<string, string> = {
  CERTIFICATE_DRY_RUN: '证书部署试运行任务',
  CERTIFICATE_DEPLOY: '证书部署任务',
  ACME_CERTIFICATE_RENEWAL: 'ACME 证书续期任务',
  AGENT_INSTALL: 'Agent 安装任务',
  AGENT_CAPABILITY_RESCAN: 'Agent 能力重扫任务',
  PLUGIN_REFERENCE_REFRESH: '插件目录刷新任务',
  AUTOMATION_RUN: '自动化执行任务',
  AUTOMATION_TRIGGER_DELIVERY: '自动化触发投递任务',
  MONITORING: '证书监控任务',
};

const secretPurposeLabels: Record<string, string> = {
  'http.header': 'HTTP 请求头凭据',
  'certificate.deployment.private_key': '证书部署私钥',
  'certificate.deployment.password': '证书部署密码',
  'certificate.format.export.private_key': '证书导出私钥',
  'certificate.format.export.password': '证书导出密码',
  'ssh.authentication': 'SSH 登录凭据',
  'secret.provider_operation': 'Secret 提供方操作凭据',
  'ldap.bind': 'LDAP 绑定凭据',
  'http.form.passwd': 'HTTP 表单密码',
  'debug.secret.check': 'Secret 检查凭据',
};

const permissionActionLabels: Record<string, string> = {
  'task.read': '读取任务',
  'audit.read': '读取审计日志',
  'service_asset.read': '读取应用资产',
  'certificate.read': '读取证书',
  'certificate.asset.read': '读取证书资产',
  'binding.read': '读取证书绑定',
  'plugin_version.read': '读取插件版本',
  'ca.operations.read': '读取 CA 运维数据',
  'approval.decide': '执行审批决策',
  'provider.read': '读取提供方目录',
  'execution.run.read': '读取执行记录',
  'cloud_account_asset.read': '读取云账号资产',
  'managed_target.read': '读取托管目标',
  'host.read': '读取主机',
};

const permissionReasonLabels: Record<string, string> = {
  'no allow policy': '没有匹配的允许策略',
  'tenant scope denied': '租户范围不允许',
  'resource scope denied': '对象范围不允许',
};

const identitySourceTypeLabels: Record<string, string> = {
  active_directory: 'Active Directory',
  ldap: 'LDAP',
  oidc: 'OIDC',
  saml: 'SAML',
};

function caSyncErrorLabel(code: string): string {
  return caSyncErrorLabels[code] ?? '同步源返回错误';
}

function permissionActionLabel(action: string): string {
  return permissionActionLabels[action] ?? '访问资源';
}

function permissionReasonLabel(reason: string | undefined): string {
  return reason ? permissionReasonLabels[reason] ?? '访问策略未允许' : '缺少访问权限';
}

function identitySourceTypeLabel(sourceType: string | undefined): string {
  return identitySourceTypeLabels[sourceType ?? ''] ?? '外部';
}

function authFailureReasonLabel(reason: string | undefined): string {
  if (reason === 'bad credentials') return '用户名或密码错误';
  return '认证信息无效';
}

const auditActionTitles: Record<string, string> = {
  'secret.resolve.service': '服务读取 Secret',
  'secret.resolve': '执行器读取 Secret',
  'secret.create': '创建 Secret',
  'secret.version.create': '创建 Secret 版本',
  'secret.rotate': '轮换 Secret',
  'certificate.import': '导入证书',
  'certificate.format.update': '更新证书产物',
  'certificate.format.delete': '删除证书产物',
  'deployment.create': '创建部署计划',
  'deployment.execute': '执行部署计划',
  'deployment.rollback': '请求回滚',
  'approval.create': '创建审批',
  'approval.approve': '批准审批',
  'approval.reject': '拒绝审批',
  'auth.login': '用户登录',
  'auth.logout': '用户退出',
  'asset.manage': '维护应用资产',
  'service_asset.manage': '维护应用资产',
  'task.create': '创建后台任务',
  'ca.operations.sync': '同步 CA 数据',
  'certificate_request.create': '创建证书申请',
  'certificate_request.issue': '签发证书申请',
  'ca_provider.create': '创建 CA 提供方',
  'ca_provider.update': '更新 CA 提供方',
  'ca_provider.delete': '删除 CA 提供方',
  'ca_provider.inspect': '检查 CA 提供方',
  'certificate_authority.create': '管理证书颁发机构',
  'automation.create': '创建自动化规则',
  'automation.update': '更新自动化规则',
  'automation.delete': '删除自动化规则',
  'automation.execute': '执行自动化规则',
  'credential.create': '创建凭据',
  'credential.update': '更新凭据',
  'credential.delete': '删除凭据',
  'credential.disable': '停用凭据',
  'device_asset.delete': '删除设备资产',
  'device_asset.refresh_discovery': '刷新设备发现',
  'device_asset.test_connection': '测试设备连接',
  'managed_target.manage': '管理托管目标',
  'service_instance.manage': '管理服务实例',
  'site_asset.manage': '管理站点资产',
  'security.user.create_external': '创建外部用户',
  'security.user.update': '更新用户',
  'security.user.delete': '删除用户',
  'security.group.create_external': '创建外部用户组',
  'security.identity_source.create': '创建身份源',
  'security.identity_source.update': '更新身份源',
  'security.identity_source.sync_users': '同步身份源用户',
  'security.identity_source.test': '测试身份源连接',
  'security.role.create': '创建角色',
  'security.role_binding.create': '创建角色授权',
  'security.object_set.create': '创建权限对象集',
  'security.object_set_member.add': '向权限对象集添加对象',
  'security.access_grant.create': '授予对象访问权限',
  'security.business_permission.create': '创建业务权限',
  'tenant.mode.preflight': '执行租户模式预检查',
};

const auditEventActionOverrides: Record<string, string> = {
  'automation.enabled': '启用自动化规则',
  'managed_target.created': '创建托管目标',
  'service_asset.created': '创建应用资产',
  'service_asset.deleted': '删除应用资产',
  'service_asset.deployment_strategy.updated': '更新应用资产部署策略',
  'service_instance.created': '创建服务实例',
  'site_asset.created': '创建站点资产',
};

const auditEventTitles: Record<string, string> = {
  'auth.login.success': '用户登录',
  'auth.login.failure': '登录失败',
  'auth.login.failed': '登录失败',
  'auth.logout': '退出登录',
  'secret.created': '创建 Secret',
  'secret.version.created': '创建 Secret 版本',
  'secret.used': '读取 Secret',
  'secret.rotated': '轮换 Secret',
  'certificate.imported': '导入证书',
  'deployment.created': '创建部署',
  'deployment.executed': '执行部署',
  'deployment.rollback_requested': '请求部署回滚',
  'permission.denied': '权限拒绝',
  'task.created': '创建后台任务',
  'ca.operations.sync.started': '开始同步 CA 数据',
  'ca.operations.sync.completed': '完成 CA 数据同步',
  'ca.operations.sync.failed': 'CA 数据同步失败',
  'auth.external_login.success': '外部身份登录',
  'auth.external_login.failed': '外部身份登录失败',
  'auth.password.changed': '修改登录密码',
  'secret.deleted': '删除 Secret',
  'approval.created': '创建审批',
  'approval.approved': '审批通过',
  'credential.created': '创建凭据',
  'credential.updated': '更新凭据',
  'credential.deleted': '删除凭据',
  'credential.status_changed': '变更凭据状态',
  'automation.created': '创建自动化规则',
  'automation.updated': '更新自动化规则',
  'automation.enabled': '启用自动化规则',
  'automation.deleted': '删除自动化规则',
  'automation.executed': '执行自动化规则',
  'service_asset.created': '创建应用资产',
  'service_asset.updated': '更新应用资产',
  'service_asset.deleted': '删除应用资产',
  'service_asset.deployment_strategy.updated': '更新应用资产部署策略',
  'service_instance.created': '创建服务实例',
  'site_asset.created': '创建站点资产',
  'device_asset.deleted': '删除设备资产',
  'device_asset.discovery_refreshed': '刷新设备发现',
  'device_asset.connection_tested': '测试设备连接',
  'managed_target.created': '创建托管目标',
  'internal_ca.provider.created': '创建 CA 提供方',
  'internal_ca.provider.deleted': '删除 CA 提供方',
  'internal_ca.authority.created': '创建证书颁发机构',
  'internal_ca.authority.connected': '接入证书颁发机构',
  'internal_ca.request.created': '创建证书申请',
  'internal_ca.request.issued': '签发证书申请',
  'internal_ca.trust_domain.created': '创建 CA 信任域',
  'security.user.created': '创建用户',
  'security.user.updated': '更新用户',
  'security.user.deleted': '删除用户',
  'security.group.created': '创建用户组',
  'security.role.created': '创建角色',
  'security.role_binding.created': '创建角色授权',
  'security.identity_source.created': '创建身份源',
  'security.identity_source.updated': '更新身份源',
  'security.identity_source.synced': '同步身份源用户',
  'security.identity_source.tested': '测试身份源连接',
  'security.object_set.created': '创建权限对象集',
  'security.object_set_member.added': '添加权限对象集成员',
  'security.access_grant.created': '授予对象访问权限',
  'security.business_permission.created': '创建业务权限',
  'tenant.mode.preflight.completed': '完成租户模式预检查',
};

const auditResourceLabels: Record<string, string> = {
  secret: 'Secret',
  secret_version: 'Secret 版本',
  certificate: '证书',
  certificateAsset: '证书资产',
  certificate_version: '证书版本',
  certificateVersion: '证书版本',
  certificate_version_format: '证书产物',
  certificate_format: '证书产物',
  certificateVersionFormat: '证书产物',
  deployment: '部署',
  deployment_plan: '部署计划',
  deploymentPlan: '部署计划',
  execution: '执行任务',
  executionRun: '执行任务',
  execution_run: '执行任务',
  approval: '审批单',
  plugin: '插件',
  workflow_template: '工作流模板',
  gateway: '网关',
  agent: 'Agent',
  service_asset: '应用资产',
  application_asset: '应用资产',
  binding: '证书绑定',
  auditLog: '审计日志',
  task: '后台任务',
  caSyncRun: 'CA 同步记录',
  authSession: '登录会话',
  authUser: '用户账号',
  credential: '凭据',
  certificate_request: '证书申请',
  certificate_binding: '证书绑定',
  certificate_asset: '证书资产',
  certificate_authority: '证书颁发机构',
  certificate_profile: '证书模板',
  certificate_renewal: '证书续期任务',
  certificate_reuse_risk: '证书复用风险',
  certificate_revocation: '证书吊销记录',
  trust_distribution: '信任分发',
  ca_provider: 'CA 提供方',
  ca_node: 'CA 节点',
  caOperation: 'CA 运维记录',
  ca_trust_domain: 'CA 信任域',
  automation: '自动化规则',
  device_asset: '设备资产',
  managed_target: '托管目标',
  managed_target_snapshot: '托管目标快照',
  service_instance: '服务实例',
  site_asset: '站点资产',
  identitySource: '身份源',
  group: '用户组',
  role: '角色',
  permissionRoleBinding: '角色授权',
  permissionAccessGrant: '访问授权',
  permissionObjectSet: '权限对象集',
  businessPermission: '业务权限',
  plugin_version: '插件版本',
  provider_catalog: '提供方目录',
  cloud_account_asset: '云账号资产',
  tenantMode: '租户模式',
  user: '用户',
  host: '主机',
};

function allRowsQuery(sort = 'updatedAt:desc'): PageQuery {
  const [field, direction = 'desc'] = sort.split(':');
  return {
    page: 1,
    pageSize: 1000,
    sort: { field, direction: direction === 'asc' ? 'asc' : 'desc' },
    filter: {},
  };
}

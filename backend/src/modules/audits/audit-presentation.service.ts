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
    const label = labelWithId(serviceAssetLabel(asset), asset.id);
    setObjectLabel(objectLabelByKey, ['service_asset', 'application_asset'], asset.id, label);
  }
  await addSecretLabels(objectLabelByKey, input.secrets, input.tenantId);
  await addCertificateLabels(objectLabelByKey, input.certificates, input.tenantId);

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
  if (log.eventType !== 'deployment.executed') return undefined;
  const deploymentPlanId = readDetailString(log.detail, 'deploymentPlanId');
  if (!deploymentPlanId) return undefined;

  const plan = context.deploymentPlanById.get(deploymentPlanId);
  const planName = plan?.name ?? deploymentPlanId;
  const targetNames = deploymentTargetLabels(deploymentPlanId, context);
  const actor = log.actorId === 'system' ? '系统' : `用户 ${log.actorId || '未知'}`;
  const action = log.action.includes('dry_run') ? '试运行部署计划' : log.action.includes('rollback') ? '回滚部署计划' : '执行部署';
  return `${actor}完成“${action}”，部署计划：${planName}，资产：${targetNames || '未记录目标资产'}。`;
}

function buildGenericAuditSummary(log: AuditLogEntity, context: AuditPresentationContext): string {
  return `${actorLabel(log)}${resultVerb(log.result)}“${readableAction(log)}”，对象：${resourceLabel(log, context)}。`;
}

async function addSecretLabels(
  objectLabelByKey: Map<string, string>,
  secrets: SecretService | undefined,
  tenantId: string,
): Promise<void> {
  if (!secrets) return;
  const secretItems = await secrets.listMetadata(tenantId);
  for (const secret of secretItems) {
    setObjectLabel(objectLabelByKey, ['secret'], secret.id, labelWithId(secret.name, secret.id));
    const versions = await secrets.listSecretVersions(secret.id, tenantId);
    for (const version of versions) {
      setObjectLabel(objectLabelByKey, ['secret_version'], version.id, labelWithId(`${secret.name} v${version.versionNo}`, version.id));
    }
  }
}

async function addCertificateLabels(
  objectLabelByKey: Map<string, string>,
  certificates: CertificatesRepository | undefined,
  tenantId: string,
): Promise<void> {
  if (!certificates) return;
  const certificateAssets = await certificates.listAssets(allRowsQuery('updatedAt:desc'), tenantId);
  const assetNameById = new Map<string, string>();
  for (const asset of certificateAssets.items) {
    const name = asset.name || asset.primaryDomain || asset.id;
    assetNameById.set(asset.id, name);
    setObjectLabel(objectLabelByKey, ['certificate'], asset.id, labelWithId(name, asset.id));
  }

  const certificateVersions = await certificates.listVersions(allRowsQuery('createdAt:desc'), tenantId);
  for (const version of certificateVersions.items) {
    const assetName = assetNameById.get(version.certificateAssetId);
    const name = assetName
      ? `${assetName} v${version.versionNo}`
      : `${version.commonName || version.sans[0] || '证书'} v${version.versionNo}`;
    setObjectLabel(objectLabelByKey, ['certificate_version'], version.id, labelWithId(name, version.id));
  }
}

function setObjectLabel(labels: Map<string, string>, resourceTypes: string[], id: string, label: string): void {
  for (const resourceType of resourceTypes) {
    labels.set(objectKey(resourceType, id), label);
  }
}

function objectKey(resourceType: string, id: string): string {
  return `${resourceType}:${id}`;
}

function labelWithId(name: string, id: string): string {
  return `${name}（${id}）`;
}

function actorLabel(log: AuditLogEntity): string {
  if (log.actorId === 'system') return '系统';
  const actorTypeLabels: Record<string, string> = {
    user: '用户',
    system: '系统',
    agent: 'Agent',
    plugin: '插件',
    executor: '执行器',
  };
  return `${actorTypeLabels[log.actorType] ?? log.actorType} ${log.actorId || '未知'}`;
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
  return auditActionTitles[log.action] ?? auditEventTitles[log.eventType] ?? humanizeAuditCode(log.action || log.eventType);
}

function resourceLabel(log: AuditLogEntity, context: AuditPresentationContext): string {
  const resourceType = auditResourceLabels[log.resourceType] ?? log.resourceType;
  if (!log.resourceId) return resourceType;
  const objectLabel = context.objectLabelByKey.get(objectKey(log.resourceType, log.resourceId))
    ?? context.objectLabelByKey.get(objectKey(normalizeResourceType(log.resourceType), log.resourceId));
  return objectLabel ? `${resourceType} ${objectLabel}` : `${resourceType} ${log.resourceId}`;
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
    ?? readDetailString(target.strategyPayload, 'workflowRequest.applicationAssetId')
    ?? readDetailString(target.strategyPayload, 'workflowRequest.workflowId')
    ?? readDetailString(target.strategyPayload, 'targetName')
    ?? readDetailString(target.strategyPayload, 'assetName')
    ?? target.certificateBindingId
    ?? target.executionTargetId
    ?? target.id;
}

function bindingLabel(binding: CertificateBindingDto | undefined): string | undefined {
  if (!binding) return undefined;
  const host = binding.domainName ?? binding.domain;
  if (!host) return binding.bindingKey;
  return [host, binding.port, binding.protocol].filter(Boolean).join(':');
}

function serviceAssetLabel(asset: { displayName?: string; address: string; port: number; protocol: string }): string {
  return asset.displayName || `${asset.protocol} ${asset.address}:${asset.port}`;
}

function readDetailString(detail: unknown, key: string): string | undefined {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return undefined;
  const value = (detail as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
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
};

const auditResourceLabels: Record<string, string> = {
  secret: 'Secret',
  secret_version: 'Secret 版本',
  certificate: '证书',
  certificate_version: '证书版本',
  certificate_version_format: '证书产物',
  deployment: '部署',
  deployment_plan: '部署计划',
  execution: '执行任务',
  executionRun: '执行任务',
  approval: '审批单',
  plugin: '插件',
  workflow_template: '工作流模板',
  gateway: '网关',
  agent: 'Agent',
  service_asset: '应用资产',
  application_asset: '应用资产',
  binding: '证书绑定',
  auditLog: '审计日志',
};

function humanizeAuditCode(value: string): string {
  const tokenLabels: Record<string, string> = {
    auth: '认证',
    login: '登录',
    logout: '退出',
    secret: 'Secret',
    used: '使用',
    created: '创建',
    create: '创建',
    version: '版本',
    certificate: '证书',
    imported: '导入',
    import: '导入',
    deployment: '部署',
    executed: '执行',
    execute: '执行',
    approval: '审批',
    permission: '权限',
    denied: '拒绝',
    service: '服务',
    asset: '资产',
    manage: '管理',
  };
  return value
    .split(/[._-]+/)
    .filter(Boolean)
    .map((token) => tokenLabels[token] ?? token)
    .join(' ');
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

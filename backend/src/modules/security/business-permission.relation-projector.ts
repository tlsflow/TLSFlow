import type { DatabasePort } from '../../database/database-port.js';
import type { BusinessPermissionDomain } from '../../persistence/entities/business-permission.entity.js';
import type { BusinessPermissionResolverOptions } from './business-permission.resolver.js';

interface IdRow extends Record<string, unknown> {
  id: string;
}

// 中文说明：关系投影会在一次角色授权中被连续调用多次。按数据库实例缓存
// 文档表初始化，避免每个根对象都重复执行 DDL 并等待 PostgreSQL 元数据锁。
const documentStoreInitialization = new WeakMap<DatabasePort, Promise<void>>();

/**
 * 从业务表投影业务根对象的必要低基数关联资源。管理员永远只选择根对象，
 * 监控明细、执行记录等高基数资源由父级授权抽象实时判权，不再生成关系行。
 */
export function createBusinessPermissionRelationProjector(db: DatabasePort): Required<Pick<BusinessPermissionResolverOptions, 'rootExists' | 'projectRelations'>> {
  return {
    rootExists: (input) => rootExists(db, input.tenantId, input.objectType, input.objectId),
    projectRelations: (input) => projectRelations(db, input),
  };
}

async function rootExists(db: DatabasePort, tenantId: string, objectType: string, objectId: string): Promise<boolean> {
  if (objectType === 'certificate' || objectType === 'certificate_asset') {
    return (await db.query<IdRow>(
      `select id from pg_certificate_assets where tenant_id=$1 and id=$2 and status <> 'DELETED' limit 1`,
      [tenantId, objectId],
    )).rows.length > 0;
  }
  if (objectType === 'application_asset' || objectType === 'service_asset') {
    return (await db.query<IdRow>(
      `select id from pg_service_assets where tenant_id=$1 and id=$2 and deleted_at is null limit 1`,
      [tenantId, objectId],
    )).rows.length > 0;
  }
  return objectType === 'audit_log' || objectType === 'system_setting';
}

async function projectRelations(
  db: DatabasePort,
  input: { tenantId: string; domain: BusinessPermissionDomain; rootObjectType: string; rootObjectId: string },
): Promise<Array<{ relatedObjectType: string; relatedObjectId: string; relation: string }>> {
  if (input.domain === 'certificate') return projectCertificateRelations(db, input);
  if (input.domain === 'application') return projectApplicationRelations(db, input);
  return [];
}

async function projectCertificateRelations(
  db: DatabasePort,
  input: { tenantId: string; rootObjectType: string; rootObjectId: string },
): Promise<Array<{ relatedObjectType: string; relatedObjectId: string; relation: string }>> {
  const relations = [
    { relatedObjectType: 'certificate', relatedObjectId: input.rootObjectId, relation: 'certificate-root' },
    { relatedObjectType: 'certificate_asset', relatedObjectId: input.rootObjectId, relation: 'certificate-asset' },
  ];
  const versions = (await db.query<IdRow>(
    `select id from pg_certificate_versions where tenant_id=$1 and certificate_asset_id=$2`,
    [input.tenantId, input.rootObjectId],
  )).rows;
  relations.push(...versions.map((item) => ({ relatedObjectType: 'certificate_version', relatedObjectId: item.id, relation: 'certificate-version' })));
  const versionIds = versions.map((item) => item.id);
  if (versionIds.length === 0) return relations;

  const formats = (await db.query<IdRow>(
    `select format.id from pg_certificate_version_formats format
       join pg_certificate_versions version on version.id=format.certificate_version_id
      where version.tenant_id=$1 and version.certificate_asset_id=$2`,
    [input.tenantId, input.rootObjectId],
  )).rows;
  const bindings = (await db.query<IdRow>(
    `select binding.id from pg_certificate_bindings binding
       join pg_certificate_versions version on version.id in (binding.certificate_version_id, binding.target_certificate_version_id, binding.local_certificate_version_id)
      where binding.tenant_id=$1 and binding.deleted_at is null and version.certificate_asset_id=$2`,
    [input.tenantId, input.rootObjectId],
  )).rows;
  relations.push(...formats.map((item) => ({ relatedObjectType: 'certificate_version_format', relatedObjectId: item.id, relation: 'certificate-format' })));
  relations.push(...bindings.map((item) => ({ relatedObjectType: 'certificate_binding', relatedObjectId: item.id, relation: 'certificate-binding' })));
  return uniqueRelations(relations);
}

async function projectApplicationRelations(
  db: DatabasePort,
  input: { tenantId: string; rootObjectType: string; rootObjectId: string },
): Promise<Array<{ relatedObjectType: string; relatedObjectId: string; relation: string }>> {
  await ensureDocumentStore(db);
  const relations = [{
    relatedObjectType: input.rootObjectType,
    relatedObjectId: input.rootObjectId,
    relation: 'application-root',
  }];
  relations.push({
    relatedObjectType: input.rootObjectType === 'application_asset' ? 'service_asset' : 'application_asset',
    relatedObjectId: input.rootObjectId,
    relation: 'application-service-asset',
  });
  const managedTargets = (await db.query<{ device_asset_id?: string | null; service_asset_id?: string | null }>(
    `select distinct target.device_asset_id, target.service_asset_id
       from pg_application_asset_targets relation
       join pg_managed_targets target on target.tenant_id=relation.tenant_id and target.id=relation.managed_target_id
      where relation.tenant_id=$1 and relation.application_asset_id=$2 and relation.deleted_at is null
        and target.deleted_at is null`,
    [input.tenantId, input.rootObjectId],
  )).rows;
  const serviceAssetIds = [...new Set([
    input.rootObjectId,
    ...managedTargets.map((item) => item.service_asset_id).filter((id): id is string => Boolean(id)),
    ...managedTargets.map((item) => item.device_asset_id).filter((id): id is string => Boolean(id)),
  ])];
  relations.push(...serviceAssetIds
    .filter((id) => id !== input.rootObjectId)
    .map((id) => ({ relatedObjectType: 'service_asset', relatedObjectId: id, relation: 'application-service-asset' })));
  const deviceAssetIds = managedTargets
    .map((item) => item.device_asset_id)
    .filter((id): id is string => Boolean(id));
  const hosts = deviceAssetIds.length > 0
    ? await queryOptional<IdRow>(db,
      `select distinct device.host_id as id
         from pg_device_assets device
        where device.tenant_id=$1 and device.service_asset_id = any($2::text[])
          and device.host_id is not null`,
      [input.tenantId, deviceAssetIds])
    : [];
  relations.push(...hosts.map((item) => ({ relatedObjectType: 'host', relatedObjectId: item.id, relation: 'application-host' })));
  relations.push(...deviceAssetIds.map((id) => ({ relatedObjectType: 'device_asset', relatedObjectId: id, relation: 'application-device' })));
  const managedTargetIds = (await db.query<IdRow>(
    `select distinct relation.managed_target_id as id
       from pg_application_asset_targets relation
      where relation.tenant_id=$1 and relation.application_asset_id=$2 and relation.deleted_at is null`,
    [input.tenantId, input.rootObjectId],
  )).rows.map((item) => item.id);
  const bindings = (await db.query<IdRow>(
    `select distinct binding.id
       from pg_certificate_bindings binding
      where binding.tenant_id=$1 and binding.deleted_at is null and (
        binding.service_asset_id = any($2::text[])
        or binding.managed_target_id = any($3::text[])
      )`,
    [input.tenantId, serviceAssetIds, managedTargetIds],
  )).rows;
  relations.push(...bindings.map((item) => ({ relatedObjectType: 'certificate_binding', relatedObjectId: item.id, relation: 'application-certificate' })));

  const deploymentPlans = await queryOptional<IdRow>(db,
    `select distinct payload->>'deploymentPlanId' as id
       from pg_documents
      where namespace = 'deployment-plans:targets'
        and payload->>'tenantId' = $1
        and payload->>'applicationAssetId' = $2
        and coalesce(payload->>'deploymentPlanId', '') <> ''`,
    [input.tenantId, input.rootObjectId],
  );
  relations.push(...deploymentPlans.map((item) => ({ relatedObjectType: 'deployment_plan', relatedObjectId: item.id, relation: 'application-deployment-plan' })));

  const monitorTargets = await queryOptional<IdRow>(db,
    `select id from pg_monitor_targets
      where tenant_id=$1 and service_asset_id = any($2::text[]) and deleted_at is null`,
    [input.tenantId, serviceAssetIds],
  );
  relations.push(...monitorTargets.map((item) => ({ relatedObjectType: 'monitor_target', relatedObjectId: item.id, relation: 'application-monitor-target' })));
  relations.push({ relatedObjectType: 'monitor_dashboard', relatedObjectId: input.rootObjectId, relation: 'application-monitor-dashboard' });
  // 监控探针、证书观测、风险事件和执行明细通过 service_asset 父级授权判断，
  // 不再把高基数明细复制成业务权限关系。
  return uniqueRelations(relations);
}

async function ensureDocumentStore(db: DatabasePort): Promise<void> {
  const existing = documentStoreInitialization.get(db);
  if (existing) {
    await existing;
    return;
  }
  const initialization = db.exec(`
      create table if not exists pg_documents (
        namespace varchar(128) not null,
        document_id varchar(128) not null,
        payload jsonb not null,
        updated_at timestamptz not null default now(),
        primary key (namespace, document_id)
      );
    `).catch((error) => {
      documentStoreInitialization.delete(db);
      throw error;
    });
  documentStoreInitialization.set(db, initialization);
  await initialization;
}

async function queryOptional<T extends Record<string, unknown>>(db: DatabasePort, sql: string, params: unknown[]): Promise<T[]> {
  try {
    return (await db.query<T>(sql, params)).rows;
  } catch (error) {
    // 中文说明：监控表在旧租户迁移期间可能尚未创建；只跳过明确的缺表错误，
    // 连接、权限和 SQL 语义错误必须继续抛出，避免授权关系静默失真。
    if ((error as { code?: string } | undefined)?.code === '42P01') return [];
    throw error;
  }
}

function uniqueRelations(items: Array<{ relatedObjectType: string; relatedObjectId: string; relation: string }>) {
  return [...new Map(items.map((item) => [`${item.relatedObjectType}:${item.relatedObjectId}:${item.relation}`, item] as const)).values()];
}

import type { DatabasePort } from '../../database/database-port.js';
import type { BusinessPermissionDomain } from '../../persistence/entities/business-permission.entity.js';
import type { BusinessPermissionResolverOptions } from './business-permission.resolver.js';

interface DocumentRow extends Record<string, unknown> {
  document_id: string;
  payload: Record<string, unknown>;
}

interface IdRow extends Record<string, unknown> {
  id: string;
}

/**
 * 从业务表和执行记录投影业务根对象的关联资源。管理员永远只选择根对象，
 * 关联的计划、工作流和执行记录只能由服务端事实源生成。
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
  const deviceAssets = (await db.query<IdRow>(
    `select distinct target.device_asset_id as id
       from pg_application_asset_targets relation
       join pg_managed_targets target on target.tenant_id=relation.tenant_id and target.id=relation.managed_target_id
      where relation.tenant_id=$1 and relation.application_asset_id=$2 and relation.deleted_at is null
        and target.deleted_at is null and target.device_asset_id is not null`,
    [input.tenantId, input.rootObjectId],
  )).rows;
  const bindings = (await db.query<IdRow>(
    `select distinct binding.id
       from pg_certificate_bindings binding
      where binding.tenant_id=$1 and binding.deleted_at is null and (
        binding.service_asset_id=$2
        or binding.managed_target_id in (
          select relation.managed_target_id from pg_application_asset_targets relation
           where relation.tenant_id=$1 and relation.application_asset_id=$2 and relation.deleted_at is null
        )
      )`,
    [input.tenantId, input.rootObjectId],
  )).rows;
  relations.push(...deviceAssets.map((item) => ({ relatedObjectType: 'device_asset', relatedObjectId: item.id, relation: 'application-device' })));
  relations.push(...bindings.map((item) => ({ relatedObjectType: 'certificate_binding', relatedObjectId: item.id, relation: 'application-certificate' })));

  const targets = (await db.query<DocumentRow>(
    `select document_id, payload from pg_documents where namespace='deployment-plans:targets'`,
  )).rows.filter((item) => item.payload.tenantId === input.tenantId && item.payload.applicationAssetId === input.rootObjectId);
  const planIds = new Set(targets.map((item) => stringValue(item.payload.deploymentPlanId)).filter((item): item is string => Boolean(item)));
  relations.push(...[...planIds].map((id) => ({ relatedObjectType: 'deployment_plan', relatedObjectId: id, relation: 'application-plan' })));
  for (const target of targets) {
    const workflowId = workflowIdFromTarget(target.payload);
    if (workflowId) relations.push({ relatedObjectType: 'workflow', relatedObjectId: workflowId, relation: 'application-workflow' });
  }
  if (planIds.size > 0) {
    const runs = (await db.query<DocumentRow>(
      `select document_id, payload from pg_documents where namespace='executions:runs'`,
    )).rows.filter((item) => item.payload.tenantId === input.tenantId && planIds.has(stringValue(item.payload.deploymentPlanId) ?? ''));
    relations.push(...runs.map((item) => ({ relatedObjectType: 'execution_run', relatedObjectId: item.document_id, relation: 'application-execution' })));
    const runIds = new Set(runs.map((item) => item.document_id));
    if (runIds.size > 0) {
      const steps = (await db.query<DocumentRow>(
        `select document_id, payload from pg_documents where namespace='executions:steps'`,
      )).rows.filter((item) => item.payload.tenantId === input.tenantId && runIds.has(stringValue(item.payload.executionRunId) ?? ''));
      relations.push(...steps.map((item) => ({ relatedObjectType: 'execution_step', relatedObjectId: item.document_id, relation: 'application-execution-step' })));
    }
  }
  return uniqueRelations(relations);
}

async function ensureDocumentStore(db: DatabasePort): Promise<void> {
  await db.exec(`
    create table if not exists pg_documents (
      namespace varchar(128) not null,
      document_id varchar(128) not null,
      payload jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (namespace, document_id)
    );
  `);
}

function workflowIdFromTarget(target: Record<string, unknown>): string | undefined {
  const strategy = recordValue(target.strategyPayload);
  const executionSource = recordValue(strategy?.executionSource);
  const workflowRequest = recordValue(strategy?.workflowRequest);
  return stringValue(executionSource?.workflowTemplateId)
    ?? stringValue(executionSource?.workflowId)
    ?? stringValue(workflowRequest?.workflowTemplateId)
    ?? stringValue(workflowRequest?.workflowId);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function uniqueRelations(items: Array<{ relatedObjectType: string; relatedObjectId: string; relation: string }>) {
  return [...new Map(items.map((item) => [`${item.relatedObjectType}:${item.relatedObjectId}:${item.relation}`, item] as const)).values()];
}

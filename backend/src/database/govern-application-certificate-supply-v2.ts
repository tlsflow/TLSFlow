import { loadEnvFile } from '../config/load-env.js';
import type { DatabasePort } from './database-port.js';
import { bootstrapDatabase } from './database-bootstrap.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { TasksApplicationService } from '../modules/tasks/task.application-service.js';
import type { TaskRun } from '../modules/tasks/task.types.js';

const LEGACY_V2_PREFIX = 'application-certificate-supply:v2:';
const CANONICAL_V1_PREFIX = 'application-certificate-supply:v1:';
const ACTIVE_STATUSES = new Set<TaskRun['status']>([
  'QUEUED',
  'RUNNING',
  'RETRY_WAITING',
  'WAITING_RESULT',
  'AWAITING_CONFIRMATION',
  'CANCELLING',
]);

interface ParentRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  status: TaskRun['status'];
  idempotency_key: string | null;
  parent_task_id: string | null;
  application_asset_id: string | null;
  policy_version_id: string | null;
  certificate_request_id: string | null;
  certificate_version_id: string | null;
  progress: Record<string, unknown> | null;
  created_at: string;
  finished_at: string | null;
}

interface ChildRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  parent_task_id: string;
  status: TaskRun['status'];
  deployment_plan_id: string | null;
  execution_run_id: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface ApplicationCertificateSupplyV2GovernanceOptions {
  actorId?: string;
  dryRun?: boolean;
  reason?: string;
}

export interface ApplicationCertificateSupplyV2GovernanceReport {
  executedAt: string;
  dryRun: boolean;
  queriedV2TaskCount: number;
  groupedTaskCount: number;
  unresolvedTaskIds: string[];
  retainedActiveParentIds: string[];
  cancelledParentIds: string[];
  cancelledDeploymentTaskIds: string[];
  groups: ApplicationCertificateSupplyV2GovernanceGroupReport[];
}

export interface ApplicationCertificateSupplyV2GovernanceGroupReport {
  tenantId: string;
  applicationAssetId: string;
  policyVersionId: string;
  parentTaskIds: string[];
  certificateRequestIds: string[];
  certificateVersionIds: string[];
  deploymentTaskIds: string[];
  activeParentIds: string[];
  activeDeploymentTaskIds: string[];
  retainedParentId?: string;
  retainedParentKind?: 'V1' | 'V2';
  cancelledParentIds: string[];
  cancelledDeploymentTaskIds: string[];
}

/**
 * 查询并治理历史 V2 专属证书父任务。
 *
 * 这里只处理仍可能执行的重复链，终态父任务、部署任务、任务事件和审计记录
 * 都保留原样。新请求不经过此命令，而是由应用服务直接使用固定 V1 幂等键。
 */
export async function governApplicationCertificateSupplyV2(
  db: DatabasePort,
  tasks: Pick<TasksApplicationService, 'forceCancel' | 'adoptIdempotencyKey'>,
  options: ApplicationCertificateSupplyV2GovernanceOptions = {},
): Promise<ApplicationCertificateSupplyV2GovernanceReport> {
  const allParents = await querySupplyParents(db);
  const legacyParents = allParents.filter((parent) => parent.idempotency_key?.startsWith(LEGACY_V2_PREFIX));
  const canonicalParents = allParents.filter((parent) => parent.idempotency_key?.startsWith(CANONICAL_V1_PREFIX));
  const children = await queryDeploymentChildren(db, allParents.map((parent) => parent.id));
  const childrenByParent = groupByParent(children);
  const groups = new Map<string, {
    tenantId: string;
    applicationAssetId: string;
    policyVersionId: string;
    legacyParents: ParentRow[];
    canonicalParents: ParentRow[];
  }>();
  const unresolvedTaskIds: string[] = [];

  for (const parent of legacyParents) {
    const identity = parentIdentity(parent);
    if (!identity) {
      unresolvedTaskIds.push(parent.id);
      continue;
    }
    const existing = groups.get(identity.key);
    if (existing) {
      existing.legacyParents.push(parent);
      continue;
    }
    groups.set(identity.key, {
      ...identity,
      legacyParents: [parent],
      canonicalParents: canonicalParents.filter((candidate) => parentIdentity(candidate)?.key === identity.key),
    });
  }

  const reportGroups: ApplicationCertificateSupplyV2GovernanceGroupReport[] = [];
  const retainedActiveParentIds: string[] = [];
  const cancelledParentIds: string[] = [];
  const cancelledDeploymentTaskIds: string[] = [];

  for (const group of groups.values()) {
    const allGroupParents = [...group.legacyParents, ...group.canonicalParents];
    const activeV1 = group.canonicalParents.filter((parent) => ACTIVE_STATUSES.has(parent.status));
    const activeV2 = group.legacyParents.filter((parent) => ACTIVE_STATUSES.has(parent.status));
    const activeParent = chooseRetainedParent(activeV1, activeV2, childrenByParent);
    const activeDeploymentCandidates = activeParent
      ? (childrenByParent.get(activeParent.id) ?? []).filter((child) => ACTIVE_STATUSES.has(child.status))
      : [];
    const retainedDeployment = activeParent
      ? chooseRetainedDeployment(activeParent, activeDeploymentCandidates)
      : undefined;
    const groupCancelledParents: string[] = [];
    const groupCancelledDeployments: string[] = [];
    const retainedParentWasAdopted = Boolean(
      activeParent
      && activeParent.idempotency_key?.startsWith(LEGACY_V2_PREFIX)
      && activeV1.length === 0,
    );

    if (retainedParentWasAdopted && activeParent) {
      await adoptTask(
        tasks,
        activeParent,
        `${CANONICAL_V1_PREFIX}${group.applicationAssetId}:${group.policyVersionId}`,
        options,
        '历史活动 V2 链接管为规范 V1 父任务',
      );
    }

    for (const parent of allGroupParents) {
      const activeChildren = (childrenByParent.get(parent.id) ?? [])
        .filter((child) => ACTIVE_STATUSES.has(child.status))
        .filter((child) => child.id !== retainedDeployment?.id);
      for (const child of activeChildren) {
        await cancelTask(tasks, { id: child.id, tenantId: child.tenant_id }, options, `历史 V2 专属证书重复部署子任务，保留父任务 ${activeParent?.id ?? '无活动父任务'}`);
        groupCancelledDeployments.push(child.id);
        cancelledDeploymentTaskIds.push(child.id);
      }
      if (ACTIVE_STATUSES.has(parent.status) && parent.id !== activeParent?.id) {
        await cancelTask(tasks, { id: parent.id, tenantId: parent.tenant_id }, options, '历史 V2 专属证书重复父任务，已收敛到唯一活动链');
        groupCancelledParents.push(parent.id);
        cancelledParentIds.push(parent.id);
      }
    }

    if (activeParent) {
      retainedActiveParentIds.push(activeParent.id);
    }
    reportGroups.push({
      tenantId: group.tenantId,
      applicationAssetId: group.applicationAssetId,
      policyVersionId: group.policyVersionId,
      parentTaskIds: allGroupParents.map((parent) => parent.id),
      certificateRequestIds: uniqueStrings(allGroupParents.map((parent) => parent.certificate_request_id)),
      certificateVersionIds: uniqueStrings(allGroupParents.map((parent) => parent.certificate_version_id)),
      deploymentTaskIds: uniqueStrings(allGroupParents.flatMap((parent) => (childrenByParent.get(parent.id) ?? []).map((child) => child.id))),
      activeParentIds: activeParent && ACTIVE_STATUSES.has(activeParent.status) ? [activeParent.id] : [],
      activeDeploymentTaskIds: retainedDeployment && ACTIVE_STATUSES.has(retainedDeployment.status) ? [retainedDeployment.id] : [],
      ...(activeParent ? { retainedParentId: activeParent.id, retainedParentKind: retainedParentWasAdopted || activeParent.idempotency_key?.startsWith(CANONICAL_V1_PREFIX) ? 'V1' as const : 'V2' as const } : {}),
      cancelledParentIds: groupCancelledParents,
      cancelledDeploymentTaskIds: groupCancelledDeployments,
    });
  }

  return {
    executedAt: new Date().toISOString(),
    dryRun: options.dryRun === true,
    queriedV2TaskCount: legacyParents.length,
    groupedTaskCount: groups.size,
    unresolvedTaskIds,
    retainedActiveParentIds: uniqueStrings(retainedActiveParentIds),
    cancelledParentIds: uniqueStrings(cancelledParentIds),
    cancelledDeploymentTaskIds: uniqueStrings(cancelledDeploymentTaskIds),
    groups: reportGroups,
  };
}

async function adoptTask(
  tasks: Pick<TasksApplicationService, 'adoptIdempotencyKey'>,
  task: Pick<ParentRow, 'id' | 'tenant_id'>,
  idempotencyKey: string,
  options: ApplicationCertificateSupplyV2GovernanceOptions,
  reason: string,
): Promise<void> {
  if (options.dryRun === true) return;
  await tasks.adoptIdempotencyKey(
    task.tenant_id,
    task.id,
    idempotencyKey,
    options.actorId ?? 'system',
    options.reason ?? reason,
  );
}

async function cancelTask(
  tasks: Pick<TasksApplicationService, 'forceCancel'>,
  task: Pick<TaskRun, 'id' | 'tenantId'>,
  options: ApplicationCertificateSupplyV2GovernanceOptions,
  reason: string,
): Promise<void> {
  if (options.dryRun === true) return;
  await tasks.forceCancel(
    task.tenantId,
    task.id,
    options.actorId ?? 'system',
    options.reason ?? reason,
  );
}

async function querySupplyParents(db: DatabasePort): Promise<ParentRow[]> {
  const result = await db.query<ParentRow>(`
    select
      task.id,
      task.tenant_id,
      task.status,
      task.idempotency_key,
      task.parent_task_id,
      coalesce(
        nullif(task.payload->>'applicationAssetId', ''),
        nullif(task.resource_summary->>'applicationAssetId', ''),
        nullif(task.progress->>'applicationAssetId', ''),
        (
          select ref.resource_id
            from task_resource_refs ref
           where ref.task_run_id = task.id
             and ref.resource_type = 'applicationAsset'
           order by ref.created_at asc
           limit 1
        ),
        request.application_asset_id,
        policy.application_asset_id
      ) as application_asset_id,
      coalesce(
        nullif(task.payload->>'policyVersionId', ''),
        nullif(task.resource_summary->>'policyVersionId', ''),
        nullif(task.progress->>'policyVersionId', ''),
        (
          select ref.resource_id
            from task_resource_refs ref
           where ref.task_run_id = task.id
             and ref.resource_type = 'applicationCertificatePolicyVersion'
           order by ref.created_at asc
           limit 1
        ),
        request.application_certificate_policy_version_id,
        nullif(split_part(task.idempotency_key, ':', 4), '')
      ) as policy_version_id,
      coalesce(
        nullif(task.payload->>'certificateRequestId', ''),
        nullif(task.resource_summary->>'certificateRequestId', ''),
        nullif(task.progress->>'certificateRequestId', ''),
        (
          select ref.resource_id
            from task_resource_refs ref
           where ref.task_run_id = task.id
             and ref.resource_type = 'certificateRequest'
           order by ref.created_at asc
           limit 1
        ),
        request.id
      ) as certificate_request_id,
      coalesce(
        nullif(task.payload->>'certificateVersionId', ''),
        nullif(task.resource_summary->>'certificateVersionId', ''),
        nullif(task.progress->>'certificateVersionId', ''),
        request.certificate_version_id,
        policy.certificate_version_id
      ) as certificate_version_id,
      task.progress,
      task.created_at::text,
      task.finished_at::text
    from task_runs task
    left join pg_certificate_requests request
      on request.tenant_id = task.tenant_id
     and request.id = coalesce(
       nullif(task.payload->>'certificateRequestId', ''),
       nullif(task.resource_summary->>'certificateRequestId', ''),
       nullif(task.progress->>'certificateRequestId', '')
     )
    left join pg_application_certificate_policy_versions policy
      on policy.tenant_id = task.tenant_id
     and policy.id = coalesce(
       nullif(task.payload->>'policyVersionId', ''),
       nullif(task.resource_summary->>'policyVersionId', ''),
       nullif(task.progress->>'policyVersionId', ''),
       request.application_certificate_policy_version_id,
       nullif(split_part(task.idempotency_key, ':', 4), '')
     )
    where task.task_type = 'APPLICATION_CERTIFICATE_SUPPLY'
      and (
        task.idempotency_key like 'application-certificate-supply:v1:%'
        or task.idempotency_key like 'application-certificate-supply:v2:%'
      )
    order by task.created_at asc
  `);
  return result.rows;
}

async function queryDeploymentChildren(db: DatabasePort, parentIds: readonly string[]): Promise<ChildRow[]> {
  if (parentIds.length === 0) return [];
  const result = await db.query<ChildRow>(`
    select
      task.id,
      task.tenant_id,
      task.parent_task_id,
      task.status,
      coalesce(nullif(task.payload->>'deploymentPlanId', ''), nullif(task.resource_summary->>'deploymentPlanId', '')) as deployment_plan_id,
      coalesce(nullif(task.payload->>'runId', ''), nullif(task.resource_summary->>'runId', '')) as execution_run_id,
      task.created_at::text,
      task.finished_at::text
    from task_runs task
    where task.task_type = 'CERTIFICATE_DEPLOY'
      and task.parent_task_id = any($1::text[])
    order by task.created_at asc
  `, [[...parentIds]]);
  return result.rows;
}

function parentIdentity(parent: ParentRow): { key: string; tenantId: string; applicationAssetId: string; policyVersionId: string } | undefined {
  const applicationAssetId = nonEmpty(parent.application_asset_id);
  const policyVersionId = nonEmpty(parent.policy_version_id);
  if (!applicationAssetId || !policyVersionId) return undefined;
  return {
    key: `${parent.tenant_id}:${applicationAssetId}:${policyVersionId}`,
    tenantId: parent.tenant_id,
    applicationAssetId,
    policyVersionId,
  };
}

function chooseRetainedParent(
  activeV1: readonly ParentRow[],
  activeV2: readonly ParentRow[],
  childrenByParent: ReadonlyMap<string, ChildRow[]>,
): ParentRow | undefined {
  const candidates = activeV1.length > 0 ? activeV1 : activeV2;
  return [...candidates].sort((left, right) => {
    const childDelta = activeChildCount(childrenByParent.get(right.id)) - activeChildCount(childrenByParent.get(left.id));
    if (childDelta !== 0) return childDelta;
    return Date.parse(right.created_at) - Date.parse(left.created_at);
  })[0];
}

function chooseRetainedDeployment(parent: ParentRow, activeChildren: readonly ChildRow[]): ChildRow | undefined {
  const preferredId = nonEmpty(parent.progress?.deploymentTaskId);
  return [...activeChildren].sort((left, right) => {
    if (left.id === preferredId) return -1;
    if (right.id === preferredId) return 1;
    return Date.parse(right.created_at) - Date.parse(left.created_at);
  })[0];
}

function activeChildCount(children: readonly ChildRow[] | undefined): number {
  return (children ?? []).filter((child) => ACTIVE_STATUSES.has(child.status)).length;
}

function groupByParent(children: readonly ChildRow[]): Map<string, ChildRow[]> {
  const grouped = new Map<string, ChildRow[]>();
  for (const child of children) {
    const current = grouped.get(child.parent_task_id);
    if (current) current.push(child);
    else grouped.set(child.parent_task_id, [child]);
  }
  return grouped;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.map((value) => nonEmpty(value)).filter((value): value is string => value !== undefined))];
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function main(): Promise<void> {
  loadEnvFile();
  const database = await bootstrapDatabase(process.env);
  const tasks = new TasksApplicationService(new TaskRepository(database.db));
  try {
    await tasks.initialize();
    const report = await governApplicationCertificateSupplyV2(database.db, tasks, {
      actorId: process.env.GCAC_TASK_GOVERNANCE_ACTOR_ID?.trim() || 'system',
      dryRun: process.env.GCAC_TASK_GOVERNANCE_DRY_RUN === '1',
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await (database.db as { close?: () => Promise<void> }).close?.();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

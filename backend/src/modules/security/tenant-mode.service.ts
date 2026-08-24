import { AppError } from '../../common/errors/app-error.js';
import type { DatabasePort } from '../../database/database-port.js';
import type { AsyncRepositoryPort } from '../../persistence/repositories/async-repository-port.js';
import type { RequestContext, TenantMode } from '../../shared/security-types.js';
import type { AuditService } from '../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';
import type { ObjectPermissionService } from './object-permission.service.js';
import type { TenantHierarchyService } from './domain/tenant.domain-service.js';
import type { TenantModeReader } from './tenant-context.service.js';
import type { TenantContextService } from './tenant-context.service.js';

export type TenantModeLifecycleState = 'SINGLE' | 'PREFLIGHT' | 'MIGRATING' | 'HIERARCHICAL' | 'ROLLING_BACK';
export type TenantModeBatchKind = 'PREFLIGHT' | 'ENABLE' | 'ROLLBACK';
export type TenantModeBatchStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';
export type TenantModeCheckSeverity = 'info' | 'warning' | 'blocker';
export type TenantModeCheckStatus = 'passed' | 'warning' | 'blocked';

export interface TenantModeStateEntity {
  id: string;
  mode: TenantMode;
  lifecycleState: TenantModeLifecycleState;
  activeBatchId?: string;
  lastPreflightBatchId?: string;
  lastEnableBatchId?: string;
  lastRollbackBatchId?: string;
  updatedAt: string;
  version: number;
}

export interface TenantModeCheckItem {
  id: string;
  title: string;
  severity: TenantModeCheckSeverity;
  status: TenantModeCheckStatus;
  message: string;
  count?: number;
  sampleIds?: string[];
}

export interface TenantModeReport {
  generatedAt: string;
  requestedMode: TenantMode;
  modeBefore: TenantMode;
  blockers: number;
  warnings: number;
  items: TenantModeCheckItem[];
}

export interface TenantModeBatchEntity {
  id: string;
  kind: TenantModeBatchKind;
  status: TenantModeBatchStatus;
  modeBefore: TenantMode;
  targetMode: TenantMode;
  lifecycleStateBefore: TenantModeLifecycleState;
  lifecycleStateAfter?: TenantModeLifecycleState;
  confirmation?: string;
  requestedBy: string;
  requestId?: string;
  errorCode?: string;
  errorMessage?: string;
  report?: TenantModeReport;
  detail?: Record<string, unknown>;
  startedAt: string;
  finishedAt?: string;
  version: number;
}

export interface TenantModeStateSummary {
  state: TenantModeStateEntity;
  lastPreflightBatch?: TenantModeBatchEntity;
  lastEnableBatch?: TenantModeBatchEntity;
  lastRollbackBatch?: TenantModeBatchEntity;
}

type TenantHierarchyPort = Pick<TenantHierarchyService, 'listTenants' | 'listMemberships'>;
type ObjectPermissionPort = Pick<ObjectPermissionService, 'listObjectSets' | 'listRoleBindings' | 'listAccessGrants'>;
type AuditPort = Pick<AuditService, 'write'>;
type TenantContextInvalidator = Pick<TenantContextService, 'invalidateAll'>;

const STATE_ID = 'tenant-mode';
const BUILTIN_OBJECT_SET_PREFIXES = ['oset_builtin_'];
const BUILTIN_ROLE_BINDING_PREFIXES = ['rbnd_builtin_'];
const BUILTIN_ACCESS_GRANT_PREFIXES = ['agrant_builtin_'];
const TENANT_DOCUMENT_NAMESPACES = [
  'security.audit_logs',
  'security.approval_requests',
  'security.execution_grants',
  'security.secrets',
] as const;

export class TenantModeService implements TenantModeReader {
  private tenantContext?: TenantContextInvalidator;

  constructor(
    private readonly db: DatabasePort,
    private readonly states: AsyncRepositoryPort<TenantModeStateEntity>,
    private readonly batches: AsyncRepositoryPort<TenantModeBatchEntity>,
    private readonly audit: AuditPort,
    private readonly tenantHierarchy: TenantHierarchyPort,
    private readonly objectPermissions: ObjectPermissionPort,
  ) {}

  attachTenantContext(tenantContext: TenantContextInvalidator): void {
    this.tenantContext = tenantContext;
  }

  async getCurrentMode(): Promise<TenantMode> {
    return (await this.ensureState()).mode;
  }

  async getSummary(): Promise<TenantModeStateSummary> {
    const state = await this.ensureState();
    const [lastPreflightBatch, lastEnableBatch, lastRollbackBatch] = await Promise.all([
      state.lastPreflightBatchId ? this.batches.get(state.lastPreflightBatchId) : undefined,
      state.lastEnableBatchId ? this.batches.get(state.lastEnableBatchId) : undefined,
      state.lastRollbackBatchId ? this.batches.get(state.lastRollbackBatchId) : undefined,
    ]);
    return { state, lastPreflightBatch, lastEnableBatch, lastRollbackBatch };
  }

  async runPreflight(input: {
    actorId: string;
    context?: RequestContext;
    confirmation?: string;
  }): Promise<{ state: TenantModeStateEntity; batch: TenantModeBatchEntity; report: TenantModeReport }> {
    const state = await this.ensureState();
    if (state.lifecycleState === 'MIGRATING' || state.lifecycleState === 'ROLLING_BACK') {
      throw new AppError('TENANT_MODE_CONFLICT', '当前存在进行中的启用或回滚批次', {
        lifecycleState: state.lifecycleState,
        activeBatchId: state.activeBatchId,
      });
    }

    const runningBatch = await this.createBatch('PREFLIGHT', state, input.actorId, input.context, input.confirmation, 'hierarchical');
    await this.updateState({
      lifecycleState: 'PREFLIGHT',
      activeBatchId: runningBatch.id,
    });

    try {
      const report = await this.buildPreflightReport('hierarchical', state.mode);
      const completedBatch = await this.finishBatch(runningBatch, report.blockers > 0 ? 'FAILED' : 'COMPLETED', {
        lifecycleStateAfter: state.mode === 'hierarchical' ? 'HIERARCHICAL' : 'SINGLE',
        report,
      });
      const nextState = await this.updateState({
        lifecycleState: state.mode === 'hierarchical' ? 'HIERARCHICAL' : 'SINGLE',
        activeBatchId: undefined,
        lastPreflightBatchId: completedBatch.id,
      });
      await this.writeAudit({
        eventType: AUDIT_EVENT_TYPES.TENANT_MODE_PREFLIGHT_COMPLETED,
        actorId: input.actorId,
        action: 'tenant.mode.preflight',
        context: input.context,
        detail: {
          batchId: completedBatch.id,
          blockers: report.blockers,
          warnings: report.warnings,
          status: completedBatch.status,
        },
      });
      return { state: nextState, batch: completedBatch, report };
    } catch (error) {
      await this.finishBatch(runningBatch, 'FAILED', {
        lifecycleStateAfter: state.mode === 'hierarchical' ? 'HIERARCHICAL' : 'SINGLE',
        errorCode: 'TENANT_PREFLIGHT_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await this.updateState({
        lifecycleState: state.mode === 'hierarchical' ? 'HIERARCHICAL' : 'SINGLE',
        activeBatchId: undefined,
      });
      throw error;
    }
  }

  async enableHierarchicalMode(input: {
    actorId: string;
    preflightBatchId: string;
    confirmation: string;
    context?: RequestContext;
    simulateFailureStep?: 'before_publish';
  }): Promise<{ state: TenantModeStateEntity; batch: TenantModeBatchEntity }> {
    const state = await this.ensureState();
    if (state.mode === 'hierarchical') {
      throw new AppError('TENANT_MODE_CONFLICT', '层级多租户已经启用', { mode: state.mode });
    }
    if (state.lifecycleState === 'MIGRATING' || state.lifecycleState === 'ROLLING_BACK') {
      throw new AppError('TENANT_MODE_CONFLICT', '当前存在进行中的启用或回滚批次', {
        lifecycleState: state.lifecycleState,
        activeBatchId: state.activeBatchId,
      });
    }

    const preflight = await this.requirePreflightBatch(input.preflightBatchId);
    const runningBatch = await this.createBatch('ENABLE', state, input.actorId, input.context, input.confirmation, 'hierarchical');
    await this.updateState({
      lifecycleState: 'MIGRATING',
      activeBatchId: runningBatch.id,
    });

    try {
      if (input.simulateFailureStep === 'before_publish') {
        throw new Error('simulated enablement failure');
      }
      const invalidatedContextCount = this.tenantContext ? await this.tenantContext.invalidateAll() : 0;
      const completedBatch = await this.finishBatch(runningBatch, 'COMPLETED', {
        lifecycleStateAfter: 'HIERARCHICAL',
        detail: {
          preflightBatchId: preflight.id,
          invalidatedContextCount,
        },
      });
      const nextState = await this.updateState({
        mode: 'hierarchical',
        lifecycleState: 'HIERARCHICAL',
        activeBatchId: undefined,
        lastEnableBatchId: completedBatch.id,
      });
      await this.writeAudit({
        eventType: AUDIT_EVENT_TYPES.TENANT_MODE_ENABLED,
        actorId: input.actorId,
        action: 'tenant.mode.enable',
        context: input.context,
        detail: {
          batchId: completedBatch.id,
          preflightBatchId: preflight.id,
          invalidatedContextCount,
        },
      });
      return { state: nextState, batch: completedBatch };
    } catch (error) {
      const failedBatch = await this.finishBatch(runningBatch, 'FAILED', {
        lifecycleStateAfter: 'SINGLE',
        errorCode: 'TENANT_MIGRATION_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await this.updateState({
        mode: 'single',
        lifecycleState: 'SINGLE',
        activeBatchId: undefined,
        lastEnableBatchId: failedBatch.id,
      });
      await this.writeAudit({
        eventType: AUDIT_EVENT_TYPES.TENANT_MODE_ENABLE_FAILED,
        actorId: input.actorId,
        action: 'tenant.mode.enable',
        context: input.context,
        detail: {
          batchId: failedBatch.id,
          preflightBatchId: preflight.id,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw new AppError('TENANT_MIGRATION_FAILED', '层级多租户启用失败', {
        batchId: failedBatch.id,
        preflightBatchId: preflight.id,
      });
    }
  }

  async rollbackToSingleMode(input: {
    actorId: string;
    confirmation: string;
    context?: RequestContext;
    simulateFailureStep?: 'before_publish';
  }): Promise<{ state: TenantModeStateEntity; batch: TenantModeBatchEntity }> {
    const state = await this.ensureState();
    if (state.mode !== 'hierarchical' && state.lifecycleState !== 'ROLLING_BACK') {
      throw new AppError('TENANT_ROLLBACK_UNAVAILABLE', '当前没有可回滚的层级多租户状态', {
        mode: state.mode,
        lifecycleState: state.lifecycleState,
      });
    }

    const runningBatch = await this.createBatch('ROLLBACK', state, input.actorId, input.context, input.confirmation, 'single');
    await this.updateState({
      lifecycleState: 'ROLLING_BACK',
      activeBatchId: runningBatch.id,
    });

    try {
      if (input.simulateFailureStep === 'before_publish') {
        throw new Error('simulated rollback failure');
      }
      const invalidatedContextCount = this.tenantContext ? await this.tenantContext.invalidateAll() : 0;
      const completedBatch = await this.finishBatch(runningBatch, 'COMPLETED', {
        lifecycleStateAfter: 'SINGLE',
        detail: {
          invalidatedContextCount,
        },
      });
      const nextState = await this.updateState({
        mode: 'single',
        lifecycleState: 'SINGLE',
        activeBatchId: undefined,
        lastRollbackBatchId: completedBatch.id,
      });
      await this.writeAudit({
        eventType: AUDIT_EVENT_TYPES.TENANT_MODE_ROLLED_BACK,
        actorId: input.actorId,
        action: 'tenant.mode.rollback',
        context: input.context,
        detail: {
          batchId: completedBatch.id,
          invalidatedContextCount,
        },
      });
      return { state: nextState, batch: completedBatch };
    } catch (error) {
      const failedBatch = await this.finishBatch(runningBatch, 'FAILED', {
        lifecycleStateAfter: 'ROLLING_BACK',
        errorCode: 'TENANT_MIGRATION_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await this.updateState({
        mode: 'hierarchical',
        lifecycleState: 'ROLLING_BACK',
        activeBatchId: failedBatch.id,
        lastRollbackBatchId: failedBatch.id,
      });
      await this.writeAudit({
        eventType: AUDIT_EVENT_TYPES.TENANT_MODE_ROLLBACK_FAILED,
        actorId: input.actorId,
        action: 'tenant.mode.rollback',
        context: input.context,
        detail: {
          batchId: failedBatch.id,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw new AppError('TENANT_MIGRATION_FAILED', '层级多租户回滚失败', {
        batchId: failedBatch.id,
      });
    }
  }

  private async requirePreflightBatch(batchId: string): Promise<TenantModeBatchEntity> {
    const batch = await this.batches.get(batchId);
    if (!batch || batch.kind !== 'PREFLIGHT') {
      throw new AppError('TENANT_MODE_CONFLICT', '预检查批次不存在', { batchId });
    }
    if (batch.status !== 'COMPLETED' || (batch.report?.blockers ?? 1) > 0) {
      throw new AppError('TENANT_PREFLIGHT_FAILED', '预检查存在阻断项，不能启用层级多租户', {
        batchId,
        blockers: batch.report?.blockers ?? 0,
      });
    }
    return batch;
  }

  private async buildPreflightReport(requestedMode: TenantMode, modeBefore: TenantMode): Promise<TenantModeReport> {
    const items = await Promise.all([
      this.checkDefaultRootTenant(),
      this.checkUserAdminMembership(),
      this.checkTenantHierarchyShape(),
      this.checkWildcardObjectPermissions(),
      this.checkLegacyTenantOwnership(),
      this.checkSecurityDocumentTenants(),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      requestedMode,
      modeBefore,
      blockers: items.filter((item) => item.status === 'blocked').length,
      warnings: items.filter((item) => item.status === 'warning').length,
      items,
    };
  }

  private async checkDefaultRootTenant(): Promise<TenantModeCheckItem> {
    const tenants = await this.tenantHierarchy.listTenants();
    const defaults = tenants.filter((tenant) => tenant.code === 'default');
    if (defaults.length !== 1) {
      return blockedItem('default-root-tenant', '默认根租户', 'default 根租户不存在或不唯一', defaults.map((tenant) => tenant.id));
    }
    const root = defaults[0]!;
    if (root.type !== 'GROUP' || root.status !== 'ACTIVE' || root.parentId) {
      return blockedItem('default-root-tenant', '默认根租户', 'default 根租户必须是 ACTIVE 的 GROUP 且没有父租户', [root.id]);
    }
    return passedItem('default-root-tenant', '默认根租户', `default 已绑定到有效 GROUP 根租户 ${root.id}`);
  }

  private async checkUserAdminMembership(): Promise<TenantModeCheckItem> {
    const tenants = await this.tenantHierarchy.listTenants();
    const root = tenants.find((tenant) => tenant.code === 'default');
    if (!root) {
      return blockedItem('user-admin-membership', '默认管理员根成员关系', 'default 根租户不存在，无法验证 user_admin 成员关系');
    }
    const memberships = await this.tenantHierarchy.listMemberships({
      subjectType: 'user',
      subjectId: 'user_admin',
      tenantId: root.id,
      status: 'ACTIVE',
      at: new Date().toISOString(),
    });
    if (memberships.length === 0) {
      return blockedItem('user-admin-membership', '默认管理员根成员关系', 'user_admin 缺少默认根租户有效成员关系');
    }
    return passedItem('user-admin-membership', '默认管理员根成员关系', `user_admin 已持有 ${root.id} 的有效成员关系`);
  }

  private async checkTenantHierarchyShape(): Promise<TenantModeCheckItem> {
    const tenants = await this.tenantHierarchy.listTenants();
    const invalid: string[] = [];
    for (const tenant of tenants) {
      if (tenant.type === 'GROUP' && tenant.parentId) {
        invalid.push(tenant.id);
        continue;
      }
      if (tenant.type === 'COMPANY') {
        const parent = tenant.parentId ? tenants.find((item) => item.id === tenant.parentId) : undefined;
        if (!parent || parent.type !== 'GROUP') {
          invalid.push(tenant.id);
          continue;
        }
        const grandParent = parent.parentId ? tenants.find((item) => item.id === parent.parentId) : undefined;
        if (grandParent) {
          invalid.push(tenant.id);
        }
      }
    }
    if (invalid.length > 0) {
      return blockedItem('tenant-hierarchy-shape', '租户层级结构', '发现不满足 GROUP -> COMPANY 两级约束的租户节点', invalid);
    }
    return passedItem('tenant-hierarchy-shape', '租户层级结构', '现有租户层级满足首期两级约束');
  }

  private async checkWildcardObjectPermissions(): Promise<TenantModeCheckItem> {
    const [objectSets, roleBindings, accessGrants] = await Promise.all([
      this.objectPermissions.listObjectSets(),
      this.objectPermissions.listRoleBindings(),
      this.objectPermissions.listAccessGrants(),
    ]);
    const offenders = [
      ...objectSets
        .filter((item) => item.tenantId === '*' && !BUILTIN_OBJECT_SET_PREFIXES.some((prefix) => item.id.startsWith(prefix)))
        .map((item) => `objectSet:${item.id}`),
      ...roleBindings
        .filter((item) => item.tenantId === '*' && !BUILTIN_ROLE_BINDING_PREFIXES.some((prefix) => item.id.startsWith(prefix)))
        .map((item) => `roleBinding:${item.id}`),
      ...accessGrants
        .filter((item) => item.constraints?.tenantId === '*' && !BUILTIN_ACCESS_GRANT_PREFIXES.some((prefix) => item.id.startsWith(prefix)))
        .map((item) => `accessGrant:${item.id}`),
    ];
    if (offenders.length > 0) {
      return blockedItem('legacy-wildcard-permissions', '历史通配权限治理', '仍存在不能自动解释为集团子树的历史 tenantId=* 权限记录', offenders);
    }
    return passedItem('legacy-wildcard-permissions', '历史通配权限治理', '普通租户已不存在未治理的 tenantId=* 对象集合、角色绑定或授权');
  }

  private async checkLegacyTenantOwnership(): Promise<TenantModeCheckItem> {
    const columns = await this.db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'
          and column_name in ('tenant_id', 'owner_tenant_id')
        order by table_name, column_name`,
    );
    const offenders: string[] = [];
    for (const column of columns.rows) {
      const countResult = await this.db.query<{ count: number }>(
        `select count(*)::int as count
           from ${quoteIdent(column.table_name)}
          where ${quoteIdent(column.column_name)} is not null
            and (
              ${quoteIdent(column.column_name)}::text in ('default', 'tenant_default', '00000000-0000-0000-0000-000000000000')
              or not exists (
                select 1
                  from tenants
                 where tenants.id::text = ${quoteIdent(column.table_name)}.${quoteIdent(column.column_name)}::text
              )
            )`,
      );
      if ((countResult.rows[0]?.count ?? 0) > 0) {
        offenders.push(`${column.table_name}.${column.column_name}:${countResult.rows[0]?.count ?? 0}`);
      }
    }
    if (offenders.length > 0) {
      return blockedItem('legacy-tenant-ownership', '历史租户标识归一化', '仍存在 default / tenant_default / 零值 UUID 或无效租户引用', offenders);
    }
    return passedItem('legacy-tenant-ownership', '历史租户标识归一化', '已未发现 legacy tenant 标识或无效租户归属');
  }

  private async checkSecurityDocumentTenants(): Promise<TenantModeCheckItem> {
    const offenders: string[] = [];
    for (const namespace of TENANT_DOCUMENT_NAMESPACES) {
      const result = await this.db.query<{ count: number }>(
        `select count(*)::int as count
           from pg_documents
          where namespace = $1
            and coalesce(payload->>'tenantId', '') = ''`,
        [namespace],
      );
      if ((result.rows[0]?.count ?? 0) > 0) {
        offenders.push(`${namespace}:${result.rows[0]?.count ?? 0}`);
      }
    }
    if (offenders.length > 0) {
      return blockedItem('security-document-tenant', '安全对象租户上下文', 'Approval / ExecutionGrant / Audit / Secret 仍存在缺少 tenantId 的历史记录', offenders);
    }
    return passedItem('security-document-tenant', '安全对象租户上下文', '关键安全对象记录已具备 tenantId');
  }

  private async ensureState(): Promise<TenantModeStateEntity> {
    const existing = await this.states.get(STATE_ID);
    if (existing) {
      return existing;
    }
    const initialMode = readInitialMode();
    return this.states.create({
      id: STATE_ID,
      mode: initialMode,
      lifecycleState: initialMode === 'hierarchical' ? 'HIERARCHICAL' : 'SINGLE',
      updatedAt: new Date().toISOString(),
      version: 1,
    });
  }

  private async updateState(patch: Partial<Omit<TenantModeStateEntity, 'id' | 'version'>>): Promise<TenantModeStateEntity> {
    const current = await this.ensureState();
    const next: TenantModeStateEntity = {
      ...current,
      ...patch,
      id: STATE_ID,
      updatedAt: new Date().toISOString(),
      version: current.version + 1,
    };
    await this.states.upsert(next);
    return next;
  }

  private async createBatch(
    kind: TenantModeBatchKind,
    state: TenantModeStateEntity,
    actorId: string,
    context: RequestContext | undefined,
    confirmation: string | undefined,
    targetMode: TenantMode,
  ): Promise<TenantModeBatchEntity> {
    const now = new Date().toISOString();
    const batch: TenantModeBatchEntity = {
      id: `tenant_mode_batch_${now.replace(/[^0-9]/g, '')}_${Math.random().toString(36).slice(2, 8)}`,
      kind,
      status: 'RUNNING',
      modeBefore: state.mode,
      targetMode,
      lifecycleStateBefore: state.lifecycleState,
      confirmation,
      requestedBy: actorId,
      requestId: context?.requestId,
      startedAt: now,
      version: 1,
    };
    await this.batches.create(batch);
    return batch;
  }

  private async finishBatch(
    batch: TenantModeBatchEntity,
    status: TenantModeBatchStatus,
    patch: Partial<Omit<TenantModeBatchEntity, 'id' | 'kind' | 'modeBefore' | 'targetMode' | 'lifecycleStateBefore' | 'requestedBy' | 'requestId' | 'startedAt'>>,
  ): Promise<TenantModeBatchEntity> {
    const next: TenantModeBatchEntity = {
      ...batch,
      ...patch,
      status,
      finishedAt: new Date().toISOString(),
      version: batch.version + 1,
    };
    await this.batches.upsert(next);
    return next;
  }

  private async writeAudit(input: {
    eventType: string;
    actorId: string;
    action: string;
    context?: RequestContext;
    detail?: Record<string, unknown>;
  }): Promise<void> {
    await this.audit.write({
      eventType: input.eventType,
      actorType: 'user',
      actorId: input.actorId,
      action: input.action,
      resourceType: 'tenantMode',
      resourceId: STATE_ID,
      result: 'success',
      riskLevel: 'high',
      context: input.context,
      detail: input.detail,
      failClosed: true,
    });
  }
}

function passedItem(id: string, title: string, message: string): TenantModeCheckItem {
  return { id, title, severity: 'info', status: 'passed', message };
}

function blockedItem(id: string, title: string, message: string, sampleIds: string[] = []): TenantModeCheckItem {
  return {
    id,
    title,
    severity: 'blocker',
    status: 'blocked',
    message,
    count: sampleIds.length,
    sampleIds: sampleIds.slice(0, 20),
  };
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function readInitialMode(): TenantMode {
  return process.env.GCAC_TENANT_MODE === 'hierarchical' ? 'hierarchical' : 'single';
}

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvFile } from '../config/load-env.js';
import type { DatabasePort } from './database-port.js';
import { bootstrapDatabase } from './database-bootstrap.js';
import { BuiltinPluginRegistry, type BuiltinPluginRegistryEntry } from '../modules/plugins/builtin-plugins/builtin-plugin-registry.js';
import { BuiltinUnifiedPluginLoader } from '../modules/plugins/builtin-plugins/builtin-unified-plugin-loader.js';
import { UnifiedPluginsApplicationService } from '../modules/plugins/application/unified-plugins.application-service.js';
import { PluginWorkflowPublisherService } from '../modules/plugins/application/plugin-workflow-publisher.service.js';
import { PluginWorkflowVersionStore } from '../modules/plugins/application/plugin-workflow-version-store.js';
import { createPluginWorkflowDeclarationResolver } from '../modules/plugins/application/plugin-workflow-declaration-resolver.js';
import { PgUnifiedPluginsRepository } from '../modules/plugins/repository/unified-plugins.repository.js';
import { PluginWorkflowBindingsRepository } from '../modules/plugins/repository/plugin-workflow-bindings.repository.js';
import { WorkflowTemplatesApplicationService } from '../modules/workflow-templates/application/workflow-templates.application-service.js';
import { computeWorkflowContentHash, WorkflowTemplatesDomainService } from '../modules/workflow-templates/domain/workflow-templates.domain-service.js';
import { PgDocumentRepository } from '../persistence/repositories/pg-document-repository.js';

const requiredMigrations = [
  '20260811000100',
  '20260811000200',
  '20260811000300',
  '20260811000400',
] as const;

const snapshotTables = [
  'unified_plugin_versions',
  'unified_plugin_resources',
  'unified_plugin_workflow_bindings',
  'pg_documents',
  'database_forward_cleanup_audits',
] as const;

const retiredTables = [
  'provider_registry',
  'plugin_packages',
  'legacy_plugin_migration_results',
  'pg_provider_operation_ledger',
  'pg_acme_http01_presentations',
  'pg_acme_challenges',
  'pg_acme_authorizations',
  'pg_acme_orders',
  'pg_acme_renewal_policies',
  'pg_acme_accounts',
  'pg_execution_runs',
  'pg_execution_steps',
  'agent_plugin_mounts',
] as const;

const developmentAuditId = 'P2-F-DB-20260811-CUTOVER-DEV';

export interface DevelopmentDatabaseCutoverOptions {
  environment?: NodeJS.ProcessEnv;
  backupPath?: string;
  reportPath?: string;
  loader?: BuiltinUnifiedPluginLoader;
  registry?: BuiltinPluginRegistry;
  publishPlugins?: (
    db: DatabasePort,
    loader: BuiltinUnifiedPluginLoader,
    expected: readonly BuiltinPluginRegistryEntry[],
  ) => Promise<PublishedPluginSummary>;
}

export interface PublishedPluginSummary {
  pluginVersionIds: string[];
  workflowBindingCount: number;
}

export interface DevelopmentDatabaseSnapshot {
  capturedAt: string;
  counts: Record<string, number>;
  tables: Record<string, Array<Record<string, unknown>>>;
}

export interface DevelopmentDatabaseCutoverReport {
  runId: string;
  auditId: string;
  environment: 'development';
  backupPath: string;
  reportPath: string;
  expectedPluginCount: number;
  publishedPluginVersionIds: string[];
  workflowBindingCount: number;
  cleanupAuditCount: number;
  before: DevelopmentDatabaseSnapshot;
  after: DevelopmentDatabaseSnapshot;
}

export async function runDevelopmentDatabaseCutover(
  db: DatabasePort,
  options: DevelopmentDatabaseCutoverOptions = {},
): Promise<DevelopmentDatabaseCutoverReport> {
  const environment = options.environment ?? process.env;
  assertDevelopmentCutoverAllowed(environment);

  const loader = options.loader ?? new BuiltinUnifiedPluginLoader();
  const registry = options.registry ?? new BuiltinPluginRegistry(loader);
  const expected = await registry.refresh();
  assertExpectedPluginSet(expected);
  await assertDatabasePreflight(db, expected);

  const runId = `p2_dev_cutover_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const backupPath = resolveBackupPath(options.backupPath, runId);
  const reportPath = resolveReportPath(options.reportPath, runId);
  const before = await captureSnapshot(db);
  await writeJson(backupPath, {
    apiVersion: 'gcac.p2-development-database-backup/v1',
    runId,
    environment: 'development',
    source: '一次性开发数据库切换',
    snapshot: before,
  });

  const publish = options.publishPlugins ?? publishBuiltinPlugins;
  let published!: PublishedPluginSummary;
  await db.transaction(async (tx) => {
    published = await publish(tx, loader, expected);
    await assertDatabasePostflight(tx, expected, published);
    await writeCutoverAudit(tx, runId, before, published);
  });

  const after = await captureSnapshot(db);
  const cleanupAuditCount = after.counts.database_forward_cleanup_audits ?? 0;
  const report: DevelopmentDatabaseCutoverReport = {
    runId,
    auditId: developmentAuditId,
    environment: 'development',
    backupPath,
    reportPath,
    expectedPluginCount: expected.length,
    publishedPluginVersionIds: published.pluginVersionIds,
    workflowBindingCount: published.workflowBindingCount,
    cleanupAuditCount,
    before,
    after,
  };
  await writeJson(reportPath, {
    apiVersion: 'gcac.p2-development-database-cutover/v1',
    ...report,
  });
  return report;
}

export async function publishBuiltinPlugins(
  db: DatabasePort,
  loader: BuiltinUnifiedPluginLoader,
  expected: readonly BuiltinPluginRegistryEntry[],
): Promise<PublishedPluginSummary> {
  const workflowBindings = new PluginWorkflowBindingsRepository(db);
  const workflows = new WorkflowTemplatesApplicationService(
    new WorkflowTemplatesDomainService(
      new PgDocumentRepository(db, 'workflow.templates'),
      new PgDocumentRepository(db, 'workflow.template_versions'),
    ),
    {},
    workflowBindings,
  );
  const plugins = new UnifiedPluginsApplicationService(
    new PgUnifiedPluginsRepository(db, false),
    undefined,
    undefined,
    workflowBindings,
  );
  const declarationResolver = createPluginWorkflowDeclarationResolver(expected.map((entry) => ({
    pluginId: entry.pluginId,
    version: entry.version,
    workflows: entry.workflows,
  })));
  const publisher = new PluginWorkflowPublisherService(
    workflows,
    workflowBindings,
    new PluginWorkflowVersionStore(db),
    declarationResolver,
  );
  const installed = await loader.installAll(plugins);
  const expectedKeys = new Set(expected.map((entry) => `${entry.pluginId}@${entry.version}`));
  const installedKeys = new Set(installed.map((plugin) => `${plugin.pluginId}@${plugin.version}`));
  if (installed.length !== expected.length || installedKeys.size !== expectedKeys.size
    || [...expectedKeys].some((key) => !installedKeys.has(key))) {
    throw new Error(`开发 PluginVersion 发布不完整：期望 ${expected.length} 个，实际 ${installed.length} 个`);
  }

  let workflowBindingCount = 0;
  for (const plugin of installed) {
    workflowBindingCount += (await publisher.publishPlugin(plugin)).length;
  }
  return {
    pluginVersionIds: installed.map((plugin) => plugin.id).sort(),
    workflowBindingCount,
  };
}

function assertDevelopmentCutoverAllowed(environment: NodeJS.ProcessEnv): void {
  if (environment.NODE_ENV === 'production' || environment.GCAC_PRODUCTION_READY === 'true') {
    throw new Error('生产环境拒绝执行 P2 开发数据库切换');
  }
  if (environment.GCAC_P2_DEV_CUTOVER !== '1') {
    throw new Error('P2 开发数据库切换必须显式设置 GCAC_P2_DEV_CUTOVER=1');
  }
}

async function assertDatabasePreflight(
  db: DatabasePort,
  expected: readonly BuiltinPluginRegistryEntry[],
): Promise<void> {
  const applied = await db.query<{ version: string; status: string }>(
    `select version, status from schema_migrations where version = any($1::text[])`,
    [requiredMigrations],
  );
  const appliedVersions = new Set(applied.rows.filter((row) => row.status === 'APPLIED').map((row) => row.version));
  const missing = requiredMigrations.filter((version) => !appliedVersions.has(version));
  if (missing.length > 0) throw new Error(`开发数据库缺少固定迁移：${missing.join(', ')}`);

  const retiredPresent = await db.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])
      order by table_name`,
    [retiredTables],
  );
  if (retiredPresent.rows.length > 0) {
    throw new Error(`开发数据库仍存在已退役表：${retiredPresent.rows.map((row) => row.table_name).join(', ')}`);
  }

  const legacyResourceCount = await scalarNumber(db, `
    select count(*)::integer as count
      from unified_plugin_resources
     where resource_path like 'agent-recipes/%'
        or resource_path like 'discovery-mappings/%'
        or resource_path in ('workflows/apache-8444-cert-switch.json', 'workflows/synology-dsm-cert-import.json')
  `);
  if (legacyResourceCount !== 0) throw new Error(`开发数据库仍存在旧 Recipe/Mapping/Workflow：${legacyResourceCount}`);

  const invalidOriginCount = await scalarNumber(db, `
    select count(*)::integer as count
      from pg_documents
     where namespace = 'workflow.templates'
       and coalesce(payload->>'origin', '') not in ('user', 'plugin_internal')
  `);
  if (invalidOriginCount !== 0) throw new Error(`开发数据库存在非法 Workflow 来源：${invalidOriginCount}`);

  const orphanCount = await scalarNumber(db, `
    select
      (select count(*) from unified_plugin_resources resource
        left join unified_plugin_versions version on version.id = resource.plugin_version_id
       where version.id is null)
      + (select count(*) from unified_plugin_workflow_bindings binding
        left join unified_plugin_versions version on version.id = binding.plugin_version_id
       where version.id is null)
      + (select count(*) from plugin_capability_assignments assignment
        left join unified_plugin_versions version on version.id = assignment.plugin_version_id
       where version.id is null)
      + (select count(*) from unified_plugin_bindings binding
        left join unified_plugin_versions version on version.id = binding.plugin_version_id
       where version.id is null)
      as count
  `);
  if (orphanCount !== 0) throw new Error(`开发数据库存在孤儿 PluginVersion 引用：${orphanCount}`);

  const invalidExecutionCount = await scalarNumber(db, `
    select count(*)::integer as count
      from workflow_execution_bindings
     where status = 'ACTIVE'
       and (workflow_version_selection <> 'FIXED'
         or plugin_version_id is null
         or capability_key is null
         or workflow_key is null
         or workflow_template_id is null
         or workflow_version_id is null)
  `);
  if (invalidExecutionCount !== 0) throw new Error(`开发数据库存在未固定执行绑定：${invalidExecutionCount}`);

  const builtinIds = new Set(expected.map((entry) => entry.pluginId));
  const builtinVersions = await db.query<{ plugin_id: string; plugin_version: string }>(
    `select plugin_id, plugin_version
       from unified_plugin_versions
      where source = 'BUILTIN'
        and (length(trim(plugin_id)) = 0 or length(trim(plugin_version)) = 0)`,
  );
  if (builtinVersions.rows.length > 0) throw new Error('开发数据库存在空 Plugin ID 或空 PluginVersion');
  const nonCanonical = await db.query<{ plugin_id: string }>(
    `select distinct plugin_id
       from unified_plugin_versions
      where source = 'BUILTIN'
        and plugin_id <> all($1::text[])`,
    [[...builtinIds]],
  );
  if (nonCanonical.rows.length > 0) throw new Error(`开发数据库存在非 Canonical Plugin ID：${nonCanonical.rows.map((row) => row.plugin_id).join(', ')}`);
}

async function assertDatabasePostflight(
  db: DatabasePort,
  expected: readonly BuiltinPluginRegistryEntry[],
  published: PublishedPluginSummary,
): Promise<void> {
  const rows = await db.query<{
    id: string;
    plugin_id: string;
    plugin_version: string;
    package_sha256: string;
    manifest_sha256: string;
    resource_sha256: Record<string, string>;
    status: string;
  }>(`select id, plugin_id, plugin_version, package_sha256, manifest_sha256, resource_sha256, status
       from unified_plugin_versions
      where source = 'BUILTIN'
      order by plugin_id, plugin_version`);
  const expectedByKey = new Map(expected.map((entry) => [`${entry.pluginId}@${entry.version}`, entry]));
  if (rows.rows.length !== expected.length) throw new Error(`开发数据库 PluginVersion 数量不一致：${rows.rows.length}/${expected.length}`);
  for (const row of rows.rows) {
    const entry = expectedByKey.get(`${row.plugin_id}@${row.plugin_version}`);
    if (!entry || row.status !== 'ENABLED') throw new Error(`开发 PluginVersion 未启用或不在发布清单：${row.plugin_id}@${row.plugin_version}`);
    if (row.package_sha256 !== entry.packageSha256) throw new Error(`开发 PluginVersion 包摘要不一致：${row.plugin_id}@${row.plugin_version}`);
    if (row.manifest_sha256 !== entry.manifestSha256) throw new Error(`开发 PluginVersion Manifest 摘要不一致：${row.plugin_id}@${row.plugin_version}`);
    if (!digestMapsEqual(row.resource_sha256, entry.resourceSha256)) throw new Error(`开发 PluginVersion 资源摘要不一致：${row.plugin_id}@${row.plugin_version}`);
  }
  if (published.pluginVersionIds.length !== expected.length) throw new Error('开发 PluginVersion 发布结果缺少固定 ID');

  const publishedIds = new Set(published.pluginVersionIds);
  if (publishedIds.size !== published.pluginVersionIds.length) throw new Error('开发 PluginVersion 发布结果存在重复 ID');
  const bindings = await db.query<{
    plugin_version_id: string;
    plugin_id: string;
    plugin_version: string;
    capability_key: string;
    workflow_key: string;
    workflow_resource_path: string;
    workflow_template_id: string;
    workflow_version_id: string;
    workflow_content_sha256: string;
  }>(`select binding.plugin_version_id, plugin.plugin_id, plugin.plugin_version,
           binding.capability_key, binding.workflow_key, binding.workflow_resource_path,
           binding.workflow_template_id, binding.workflow_version_id, binding.workflow_content_sha256
       from unified_plugin_workflow_bindings binding
       join unified_plugin_versions plugin on plugin.id = binding.plugin_version_id
      order by binding.plugin_version_id, binding.capability_key, binding.workflow_key`);
  if (bindings.rows.length !== published.workflowBindingCount) throw new Error(`开发 Workflow Binding 数量不一致：${bindings.rows.length}/${published.workflowBindingCount}`);
  const expectedBindings = new Map<string, {
    entry: BuiltinPluginRegistryEntry;
    workflow: BuiltinPluginRegistryEntry['workflows'][number];
  }>();
  for (const entry of expected) {
    for (const workflow of entry.workflows) {
      expectedBindings.set(`${entry.pluginId}@${entry.version}:${workflow.key}`, { entry, workflow });
    }
  }
  const seenBindings = new Set<string>();
  const workflowVersionIds = [...new Set(bindings.rows.map((row) => row.workflow_version_id))];
  const workflowTemplateIds = [...new Set(bindings.rows.map((row) => row.workflow_template_id))];
  const versions = workflowVersionIds.length === 0 ? { rows: [] as Array<{ document_id: string; payload: Record<string, unknown> }> } : await db.query<{ document_id: string; payload: Record<string, unknown> }>(
    `select document_id, payload
       from pg_documents
      where namespace = 'workflow.template_versions'
        and document_id = any($1::text[])`,
    [workflowVersionIds],
  );
  const templates = workflowTemplateIds.length === 0 ? { rows: [] as Array<{ document_id: string; payload: Record<string, unknown> }> } : await db.query<{ document_id: string; payload: Record<string, unknown> }>(
    `select document_id, payload
       from pg_documents
      where namespace = 'workflow.templates'
        and document_id = any($1::text[])`,
    [workflowTemplateIds],
  );
  const versionById = new Map(versions.rows.map((row) => [row.document_id, row.payload]));
  const templateById = new Map(templates.rows.map((row) => [row.document_id, row.payload]));
  for (const binding of bindings.rows) {
    if (!publishedIds.has(binding.plugin_version_id)) throw new Error(`Workflow Binding 引用了未发布 PluginVersion：${binding.plugin_version_id}`);
    const bindingKey = `${binding.plugin_id}@${binding.plugin_version}:${binding.workflow_key}`;
    const expectedBinding = expectedBindings.get(bindingKey);
    if (!expectedBinding
      || expectedBinding.workflow.capabilityKey !== binding.capability_key
      || expectedBinding.workflow.path !== binding.workflow_resource_path) {
      throw new Error(`Workflow Binding 未逐项匹配 P2 发布清单：${bindingKey}`);
    }
    seenBindings.add(bindingKey);
    const version = versionById.get(binding.workflow_version_id);
    const template = templateById.get(binding.workflow_template_id);
    if (!version || !template) throw new Error(`Workflow Binding 指向不存在的 Workflow 文档：${binding.workflow_version_id}`);
    if (version.templateId !== binding.workflow_template_id
      || version.status !== 'published'
      || version.executionMode !== 'PLUGIN_RUNNER'
      || version.contentHash !== binding.workflow_content_sha256
      || computeWorkflowContentHash(version.content) !== binding.workflow_content_sha256) {
      throw new Error(`Workflow Binding 版本链或摘要不一致：${binding.workflow_version_id}`);
    }
    if (template.origin !== 'plugin_internal' || template.currentVersionId !== binding.workflow_version_id) {
      throw new Error(`Workflow Template 不是已发布 PluginWorkflow：${binding.workflow_template_id}`);
    }
  }
  if (seenBindings.size !== expectedBindings.size) {
    const missing = [...expectedBindings.keys()].filter((key) => !seenBindings.has(key));
    throw new Error(`开发 Workflow Binding 缺少发布清单声明：${missing.join(', ')}`);
  }

  const auditCount = await scalarNumber(db, `
    select count(*)::integer as count
      from database_forward_cleanup_audits
     where migration_version in ('20260811000100', '20260811000200', '20260811000300', '20260811000400')
  `);
  if (auditCount < 20) throw new Error(`开发数据库清退审计不足 20 条：${auditCount}`);

  await assertDatabasePreflight(db, expected);
}

async function writeCutoverAudit(
  db: DatabasePort,
  runId: string,
  before: DevelopmentDatabaseSnapshot,
  published: PublishedPluginSummary,
): Promise<void> {
  await db.query(`
    insert into database_forward_cleanup_audits (
      audit_id, migration_version, source_table, source_namespace, source_id,
      cleanup_action, reason, metadata
    ) values ($1, 'P2-20260811', 'development_database', '', 'p2-development-cutover',
      'VERIFY', 'P2_DEVELOPMENT_DATABASE_CUTOVER', $2::jsonb)
    on conflict do nothing
  `, [developmentAuditId, JSON.stringify({
    runId,
    backup: 'logical-json-snapshot',
    beforeCounts: before.counts,
    publishedPluginVersionIds: published.pluginVersionIds,
    workflowBindingCount: published.workflowBindingCount,
    productionReady: false,
  })]);
}

async function captureSnapshot(db: DatabasePort): Promise<DevelopmentDatabaseSnapshot> {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  const counts: Record<string, number> = {};
  for (const table of snapshotTables) {
    const rows = (await db.query<Record<string, unknown>>(`select * from ${table}`)).rows;
    tables[table] = rows.map((row) => structuredClone(row));
    counts[table] = rows.length;
  }
  return { capturedAt: new Date().toISOString(), counts, tables };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveBackupPath(configured: string | undefined, runId: string): string {
  return resolve(configured ?? join(process.cwd(), '.gcac-data', '004.5-development-cutover', `${runId}.backup.json`));
}

function resolveReportPath(configured: string | undefined, runId: string): string {
  return resolve(configured ?? join(process.cwd(), '.gcac-data', '004.5-development-cutover', `${runId}.report.json`));
}

async function scalarNumber(db: DatabasePort, sql: string): Promise<number> {
  const row = (await db.query<{ count: number | string }>(sql)).rows[0];
  return Number(row?.count ?? 0);
}

function digestMapsEqual(left: Record<string, string> | undefined, right: Record<string, string>): boolean {
  if (!left) return false;
  const normalize = (value: Record<string, string>) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function assertExpectedPluginSet(entries: readonly BuiltinPluginRegistryEntry[]): void {
  if (entries.length !== 17) throw new Error(`P2 开发发布清单必须包含 17 个插件，实际 ${entries.length} 个`);
  const keys = new Set(entries.map((entry) => `${entry.pluginId}@${entry.version}`));
  if (keys.size !== entries.length) throw new Error('P2 开发发布清单存在重复 PluginVersion');
}

async function closeDatabase(db: DatabasePort): Promise<void> {
  const close = (db as { close?: () => Promise<void> }).close;
  if (typeof close === 'function') await close.call(db);
}

async function runCli(): Promise<void> {
  loadEnvFile();
  if (process.env.GCAC_P2_DEV_CUTOVER !== '1') {
    throw new Error('拒绝隐式执行开发数据库切换，请显式设置 GCAC_P2_DEV_CUTOVER=1');
  }
  const database = await bootstrapDatabase(process.env, { applyMigrations: true });
  try {
    const report = await runDevelopmentDatabaseCutover(database.db, { environment: process.env });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await closeDatabase(database.db);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

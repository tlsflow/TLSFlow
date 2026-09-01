import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { AutomationTargetResolverRegistry } from './application/automation-target-resolver.registry.js';
import { AutomationsApplicationService } from './application/automations.application-service.js';
import { applyAutomationMigrations } from './automation-test-migrations.js';
import { AutomationsRepository } from './repository/automations.repository.js';

test('按需运行固化版本和目标快照，并由幂等键复用同一运行', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const now = '2026-07-21T00:00:00.000Z';
  await repository.createAutomation({ id: 'aut_run', tenantId: 'tenant_1', name: '批量更新', status: 'active', currentVersion: 1, createdBy: 'u1', createdAt: now, updatedAt: now, version: 1 });
  await repository.createVersion({ id: 'autv_run', tenantId: 'tenant_1', automationId: 'aut_run', version: 1, trigger: { type: 'on_demand' }, targetResolver: { type: 'certificate_version_targets' }, actions: [{ type: 'send_notification', position: 1, config: { templateKey: 'result', eventKey: 'done' } }], guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: false, requireApproval: false }, checksum: 'b'.repeat(64), createdBy: 'u1', createdAt: now });
  const resolverRegistry = new AutomationTargetResolverRegistry();
  resolverRegistry.register({ type: 'certificate_version_targets', validate: () => undefined, resolve: async () => [{ target: { certificateId: 'c1', certificateName: 'cert', certificateVersionId: 'v1', bindingId: 'b1', assetId: 's1', assetName: 'a', environment: 'production', tags: [] }, executable: true }] });
  const enqueuedTasks: Array<{ tenantId: string; taskType: string; requestedBy?: string; triggerSource: string; payload?: Record<string, unknown>; resourceSummary?: Record<string, unknown> }> = [];
  const tasks = {
    enqueue: async (input: { tenantId: string; taskType: string; requestedBy?: string; triggerSource: string; payload?: Record<string, unknown>; resourceSummary?: Record<string, unknown> }) => {
      enqueuedTasks.push(input);
      return { id: 'task_1', tenantId: input.tenantId, taskType: input.taskType } as never;
    },
  };
  const service = new AutomationsApplicationService(repository, undefined, () => new Date(now), { resolverRegistry, tasks });
  const first = await service.createOnDemandRun('tenant_1', 'u1', 'aut_run', 'manual-key', 1);
  const second = await service.createOnDemandRun('tenant_1', 'u1', 'aut_run', 'manual-key', 1);
  assert.equal(first.id, second.id);
  assert.equal(first.automationVersion, 1);
  assert.equal((await repository.listRunTargets(first.id, 'tenant_1')).length, 1);
  assert.equal(enqueuedTasks.length, 1);
  assert.equal(enqueuedTasks[0]?.taskType, 'AUTOMATION_RUN');
  assert.equal(enqueuedTasks[0]?.payload?.runId, first.id);
  await repository.updateAutomation('aut_run', 'tenant_1', { name: '新名称', currentVersion: 1, updatedAt: now });
  assert.equal((await repository.getRun(first.id, 'tenant_1'))?.automationNameSnapshot, '批量更新');
});

test('按需运行的证书有效期降级必须经过二次确认', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const now = '2026-08-27T00:00:00.000Z';
  await repository.createAutomation({ id: 'aut_downgrade', tenantId: 'tenant_1', name: '降级更新', status: 'active', currentVersion: 1, createdBy: 'u1', createdAt: now, updatedAt: now, version: 1 });
  await repository.createVersion({
    id: 'autv_downgrade',
    tenantId: 'tenant_1',
    automationId: 'aut_downgrade',
    version: 1,
    trigger: { type: 'on_demand' },
    targetResolver: { type: 'certificate_version_targets' },
    actions: [{ type: 'send_notification', position: 1, config: { templateKey: 'result', eventKey: 'done' } }],
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: false, requireApproval: false },
    checksum: 'g'.repeat(64),
    createdBy: 'u1',
    createdAt: now,
  });
  const resolverRegistry = new AutomationTargetResolverRegistry();
  resolverRegistry.register({
    type: 'certificate_version_targets',
    validate: () => undefined,
    resolve: async (input) => [{
      target: {
        certificateId: 'cert-1',
        certificateName: 'example.com',
        certificateVersionId: 'target',
        currentCertificateNotAfter: '2026-11-04T00:00:00.000Z',
        targetCertificateNotAfter: '2026-10-30T00:00:00.000Z',
        certificateVersionImpact: 'downgrade',
        bindingId: 'binding-1',
        assetId: 'asset-1',
        assetName: '应用资产 1',
        tags: [],
      },
      executable: input.allowCertificateDowngrade === true,
      ...(input.allowCertificateDowngrade ? {} : { excludedReason: 'certificate_version_downgrade' as const }),
    }],
  });
  const service = new AutomationsApplicationService(repository, undefined, () => new Date(now), { resolverRegistry });

  await assert.rejects(
    () => service.createOnDemandRun('tenant_1', 'u1', 'aut_downgrade', 'downgrade-without-confirmation', 1, { allowCertificateDowngrade: true }),
    (error: unknown) => error instanceof AppError
      && error.errorCode === 'VALIDATION_FAILED'
      && error.message.includes('必须二次确认'),
  );

  const run = await service.createOnDemandRun('tenant_1', 'u1', 'aut_downgrade', 'downgrade-confirmed', 1, {
    allowCertificateDowngrade: true,
    confirmCertificateDowngrade: true,
  });
  assert.equal(run.targetSummary.total, 1);
});

test('通过外部 API 创建的统一任务记录独立触发来源', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const now = '2026-08-27T00:00:00.000Z';
  await repository.createAutomation({ id: 'aut_external_source', tenantId: 'tenant_1', name: '外部 API 自动化', status: 'active', currentVersion: 1, createdBy: 'u1', createdAt: now, updatedAt: now, version: 1 });
  await repository.createVersion({
    id: 'autv_external_source',
    tenantId: 'tenant_1',
    automationId: 'aut_external_source',
    version: 1,
    trigger: { type: 'api' },
    externalApi: { executionMode: 'direct' },
    targetResolver: { type: 'certificate_version_targets' },
    actions: [{ type: 'send_notification', position: 1, config: { templateKey: 'result', eventKey: 'done' } }],
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: false, requireApproval: false },
    checksum: 'h'.repeat(64),
    createdBy: 'u1',
    createdAt: now,
  });
  const resolverRegistry = new AutomationTargetResolverRegistry();
  resolverRegistry.register({
    type: 'certificate_version_targets',
    validate: () => undefined,
    resolve: async () => [{
      target: { certificateId: 'cert-1', certificateName: 'example.com', certificateVersionId: 'cert-version-1', assetId: 'asset-1', assetName: 'app.example.com', tags: [] },
      executable: true,
    }],
  });
  const enqueuedTasks: Array<{ triggerSource: string }> = [];
  const tasks = {
    enqueue: async (input: { triggerSource: string }) => {
      enqueuedTasks.push(input);
      return { id: 'task-external-source' } as never;
    },
  };
  const service = new AutomationsApplicationService(repository, undefined, () => new Date(now), { resolverRegistry, tasks });
  await service.createOnDemandRun('tenant_1', 'external:api-key', 'aut_external_source', 'external-source-key', 1, {
    triggerContext: { certificateVersionId: 'cert-version-1', sourceType: 'external_api' },
    externalExecutionMode: 'direct',
  });
  assert.equal(enqueuedTasks[0]?.triggerSource, 'automation.external_api');
});

test('证书新版本事件自动化手动执行时缺少证书版本会被拒绝', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const now = '2026-08-07T00:00:00.000Z';
  await repository.createAutomation({ id: 'aut_event', tenantId: 'tenant_1', name: '证书事件自动化', status: 'active', currentVersion: 1, createdBy: 'u1', createdAt: now, updatedAt: now, version: 1 });
  await repository.createVersion({
    id: 'autv_event',
    tenantId: 'tenant_1',
    automationId: 'aut_event',
    version: 1,
    trigger: { type: 'certificate_version_created', sources: ['external_source'] },
    targetResolver: { type: 'certificate_version_targets' },
    actions: [{ type: 'create_deployment_plan', position: 1, config: { planType: 'UPDATE', selectionMode: 'EXPLICIT' } }],
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: false, requireApproval: false },
    checksum: 'd'.repeat(64),
    createdBy: 'u1',
    createdAt: now,
  });
  const service = new AutomationsApplicationService(repository, undefined, () => new Date(now));
  await assert.rejects(
    () => service.createOnDemandRun('tenant_1', 'u1', 'aut_event', 'manual-event-key', 1),
    (error: unknown) => error instanceof AppError
      && error.errorCode === 'VALIDATION_FAILED'
      && error.message.includes('必须选择证书版本'),
  );
});

test('证书新版本事件自动化支持带证书版本的手动立即执行', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const now = '2026-08-07T00:00:00.000Z';
  await repository.createAutomation({ id: 'aut_event_manual', tenantId: 'tenant_1', name: '证书事件自动化', status: 'active', currentVersion: 1, createdBy: 'u1', createdAt: now, updatedAt: now, version: 1 });
  await repository.createVersion({
    id: 'autv_event_manual',
    tenantId: 'tenant_1',
    automationId: 'aut_event_manual',
    version: 1,
    trigger: { type: 'certificate_version_created', sources: ['external_source'] },
    targetResolver: { type: 'certificate_version_targets' },
    actions: [{ type: 'create_deployment_plan', position: 1, config: { planType: 'UPDATE', selectionMode: 'EXPLICIT' } }],
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: false, requireApproval: false },
    checksum: 'e'.repeat(64),
    createdBy: 'u1',
    createdAt: now,
  });
  const resolverRegistry = new AutomationTargetResolverRegistry();
  resolverRegistry.register({
    type: 'certificate_version_targets',
    validate: () => undefined,
    resolve: async (input) => [{
      target: {
        certificateId: 'cert_asset_1',
        certificateName: 'example.com',
        certificateVersionId: input.triggerContext?.certificateVersionId,
        assetId: 'asset_1',
        assetName: 'Asset 1',
        environment: 'production',
        tags: [],
      },
      executable: true,
    }],
  });
  const service = new AutomationsApplicationService(repository, undefined, () => new Date(now), { resolverRegistry });
  const run = await service.createOnDemandRun('tenant_1', 'u1', 'aut_event_manual', 'manual-event-success-key', 1, {
    triggerContext: {
      certificateVersionId: 'cert_ver_1',
      certificateAssetId: 'cert_asset_1',
      sourceType: 'manual_import',
    },
    executionOptions: { stopOnError: true, dryRun: true },
  });
  assert.equal(run.triggerContext?.certificateVersionId, 'cert_ver_1');
  assert.equal(run.executionOptions?.stopOnError, true);
  assert.equal(run.executionOptions?.dryRun, true);
  assert.equal((await repository.listRunTargets(run.id, 'tenant_1')).length, 1);
});

test('证书新版本事件手动预览按已选资产解析，不受旧事件域名和目标过滤器阻断', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const now = '2026-08-07T00:00:00.000Z';
  await repository.createAutomation({ id: 'aut_event_selected', tenantId: 'tenant_1', name: '指定资产事件自动化', status: 'active', currentVersion: 1, createdBy: 'u1', createdAt: now, updatedAt: now, version: 1 });
  await repository.createVersion({
    id: 'autv_event_selected',
    tenantId: 'tenant_1',
    automationId: 'aut_event_selected',
    version: 1,
    trigger: { type: 'certificate_version_created', sources: ['manual_import'] },
    filters: [
      { field: 'event.domains', operator: 'contains_any', value: ['example.com'] },
      { field: 'target.assetId', operator: 'in', value: ['asset-a', 'asset-b'] },
    ],
    targetResolver: { type: 'certificate_version_targets' },
    actions: [{ type: 'create_deployment_plan', position: 1, config: { planType: 'UPDATE', selectionMode: 'EXPLICIT' } }],
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: false, requireApproval: false },
    checksum: 'f'.repeat(64),
    createdBy: 'u1',
    createdAt: now,
  });
  const resolverRegistry = new AutomationTargetResolverRegistry();
  resolverRegistry.register({
    type: 'certificate_version_targets',
    validate: () => undefined,
    resolve: async (input) => [{
      target: {
        certificateId: 'cert-1',
        certificateName: 'example.com',
        certificateVersionId: input.triggerContext?.certificateVersionId,
        assetId: input.resolver.type === 'certificate_version_targets' ? input.resolver.assetIds?.[0] : undefined,
        tags: [],
      },
      executable: true,
    }],
  });
  const service = new AutomationsApplicationService(repository, undefined, () => new Date(now), { resolverRegistry });

  const preview = await service.preview('tenant_1', 'u1', 'aut_event_selected', 1, 10, {
    certificateVersionId: 'version-1',
    certificateAssetId: 'cert-1',
    sourceType: 'manual_import',
  });

  assert.equal(preview.executableCount, 1);
  assert.equal(preview.items[0]?.target.assetId, 'asset-a');
});

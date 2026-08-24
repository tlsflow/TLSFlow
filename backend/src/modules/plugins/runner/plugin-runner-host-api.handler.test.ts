import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { WriteAuditInput } from '../../audits/audit.service.js';
import { createPluginRunnerHostApiHandler, type PluginRunnerHostApiDependencies } from './plugin-runner-host-api.handler.js';
import type { PluginRunnerHostCallContext } from './plugin-runner-client.js';

const planDigest = 'b'.repeat(64);
const allActions = ['artifact.read', 'secret.resolve', 'execution.progress', 'execution.checkpoint', 'execution.cancel', 'resource.lock', 'audit.append'];

test('Host API 的九个已登记方法均走绑定 Grant、持久化端口和审计', async () => {
  const fixture = createFixture();
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);

  const artifact = await handler({ ...context('artifact.grant.read', ['artifact.read']), input: { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' } });
  assert.equal((artifact.data as Record<string, unknown>).contentBase64, Buffer.from('artifact-data').toString('base64'));

  const secret = await handler({ ...context('secret.grant.resolve', ['secret.resolve']), input: { grantId: 'grant-1', secretRef: 'secret://api_token/secret-1#current', purpose: 'secret.resolve' } });
  assert.equal(JSON.stringify(secret).includes('plain-text-must-not-leak'), false);
  assert.equal((secret.data as Record<string, unknown>).value, '[REDACTED]');

  const progress = await handler({ ...context('execution.progress', ['execution.progress']), input: { executionId: 'run-1', executionStepId: 'step-1', sequence: 3, stage: 'prepare', summary: '已准备' } });
  assert.deepEqual(progress, { ok: true, data: { accepted: true, sequence: 3, stage: 'prepare' } });

  const payload = { snapshot: 'v1' };
  const digest = sha256(payload);
  const checkpoint = await handler({ ...context('execution.checkpoint.save', ['execution.checkpoint']), input: { executionId: 'run-1', executionStepId: 'step-1', payload, digest } });
  assert.equal((checkpoint.data as Record<string, unknown>).checkpointRef, 'checkpoint-1');
  const loaded = await handler({ ...context('execution.checkpoint.load', ['execution.checkpoint']), input: { checkpointRef: 'checkpoint-1' } });
  assert.deepEqual((loaded.data as Record<string, unknown>).payload, payload);

  const cancelled = await handler({ ...context('execution.isCancelled', ['execution.cancel']), input: { executionId: 'run-1', executionStepId: 'step-1' } });
  assert.deepEqual(cancelled, { ok: true, data: { cancelled: false } });

  const acquired = await handler({ ...context('resourceLock.acquire', ['resource.lock']), input: { resourceKey: 'certificate:1', ownerRunId: 'run-1', ownerStepId: 'step-1', ttlSeconds: 30 } });
  assert.equal((acquired.data as Record<string, unknown>).lockId, 'lock-1');
  await handler({ ...context('resourceLock.release', ['resource.lock']), input: { lockId: 'lock-1', ownerRunId: 'run-1', ownerStepId: 'step-1' } });
  await handler({ ...context('audit.append', ['audit.append']), input: { eventType: 'plugin.fixture', action: 'fixture.run', resourceType: 'fixture', resourceId: 'fixture-1', result: 'success', detail: { secret: 'should-be-redacted-by-audit-service' } } });

  assert.equal(fixture.validations.every((input) => input.executorType === 'PLUGIN_RUNNER'), true);
  assert.equal(fixture.validations.every((input) => input.tenantId === 'tenant-1' && input.runId === 'run-1' && input.stepId === 'step-1'), true);
  assert.equal(fixture.validations.every((input) => input.workflowVersionId === 'workflow-1' && input.pluginVersionId === 'plugin-version-1' && input.pluginId === 'test.echo' && input.capability === 'test.echo' && input.planDigest === planDigest), true);
  assert.equal(fixture.progress.length, 1);
  assert.equal(fixture.locks.acquires.length, 1);
  assert.equal(fixture.locks.releases.length, 1);
  assert.equal(fixture.audits.some((event) => event.eventType === 'plugin.host_api.call'), true);
});

test('Host API 对错步骤、未绑定 Grant、权限不足、checkpoint 越权和未知方法失败关闭', async () => {
  const fixture = createFixture();
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);

  await assert.rejects(
    handler({ ...context('execution.progress', ['execution.progress']), input: { executionId: 'run-1', executionStepId: 'other-step', sequence: 1, stage: 'prepare', summary: '错误步骤' } }),
    /绑定不匹配/,
  );
  await assert.rejects(
    handler({ ...context('secret.grant.resolve', ['secret.resolve'], ['other-grant']), input: { grantId: 'grant-1', secretRef: 'secret://api_token/secret-1#current', purpose: 'secret.resolve' } }),
    /未绑定|无权/,
  );
  await assert.rejects(
    handler({ ...context('artifact.grant.read', []), input: { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' } }),
    /权限不足/,
  );

  fixture.checkpoint.ledgerId = 'other-ledger';
  await assert.rejects(handler({ ...context('execution.checkpoint.load', ['execution.checkpoint']), input: { checkpointRef: 'checkpoint-1' } }), /不属于当前/);
  await assert.rejects(
    handler({ ...context('plugin.invoke', [], []), method: 'plugin.invoke', input: {} }),
    /未注册/,
  );
  assert.equal(fixture.audits.some((event) => event.result === 'denied'), true);
});

test('Plugin Runner Grant 缺少完整身份绑定或字段不一致时拒绝创建和校验', async () => {
  const { ExecutionGrantService } = await import('../../executions/execution-grant.service.js');
  const service = new ExecutionGrantService();
  await assert.rejects(service.create({
    tenantId: 'tenant-1', runId: 'run-1', stepId: 'step-1', executorType: 'PLUGIN_RUNNER',
    allowedSecretRefs: [], allowedActions: ['artifact.read'], expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }), (error: unknown) => (error as { errorCode?: string }).errorCode === 'SEC_EXECUTOR_GRANT_DENIED');

  const grant = await service.create({
    tenantId: 'tenant-1', runId: 'run-1', stepId: 'step-1', executorType: 'PLUGIN_RUNNER',
    workflowVersionId: 'workflow-1', pluginVersionId: 'plugin-version-1', pluginId: 'test.echo', capability: 'test.echo', planDigest,
    allowedSecretRefs: [], allowedActions: ['artifact.read'], expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await service.validate({ grantId: grant.id, tenantId: 'tenant-1', runId: 'run-1', stepId: 'step-1', executorType: 'PLUGIN_RUNNER', workflowVersionId: 'workflow-1', pluginVersionId: 'plugin-version-1', pluginId: 'test.echo', capability: 'test.echo', planDigest });
  await assert.rejects(service.validate({ grantId: grant.id, tenantId: 'tenant-1', runId: 'run-1', stepId: 'step-1', executorType: 'PLUGIN_RUNNER', workflowVersionId: 'workflow-1', pluginVersionId: 'other-version', pluginId: 'test.echo', capability: 'test.echo', planDigest }), (error: unknown) => (error as { errorCode?: string }).errorCode === 'SEC_EXECUTOR_GRANT_DENIED');
  await assert.rejects(service.validate({ grantId: grant.id, tenantId: 'other-tenant', runId: 'run-1', stepId: 'step-1', executorType: 'PLUGIN_RUNNER', workflowVersionId: 'workflow-1', pluginVersionId: 'plugin-version-1', pluginId: 'test.echo', capability: 'test.echo', planDigest }), (error: unknown) => (error as { errorCode?: string }).errorCode === 'SEC_EXECUTOR_GRANT_DENIED');
});

function createFixture() {
  const validations: Array<Record<string, unknown>> = [];
  const audits: WriteAuditInput[] = [];
  const progress: unknown[] = [];
  const locks = { acquires: [] as Array<Record<string, unknown>>, releases: [] as Array<Record<string, unknown>> };
  const checkpoint = { ledgerId: 'ledger-1' };
  const dependencies: PluginRunnerHostApiDependencies = {
    security: {
      grants: {
        validate: async (input: Record<string, unknown>) => {
          validations.push(input);
          return { id: String(input.grantId), allowedActions: allActions, allowedArtifactRefs: ['artifact://artifact-1'] };
        },
      },
      secrets: {
        resolveForExecution: async () => ({ secretRef: 'secret://api_token/secret-1#current', versionId: 'secret-version-1', plainText: 'plain-text-must-not-leak', fingerprint: 'a'.repeat(64) }),
      },
      audit: {
        write: async (input: WriteAuditInput) => {
          audits.push(input);
          return {} as never;
        },
      },
    } as unknown as PluginRunnerHostApiDependencies['security'],
    artifacts: {
      get: async (artifactRef: string) => artifactRef === 'artifact://artifact-1'
        ? { tenantId: 'tenant-1', artifactRef, content: Buffer.from('artifact-data'), contentType: 'application/octet-stream', sha256: 'c'.repeat(64), createdBy: 'fixture', createdAt: '2026-08-10T00:00:00.000Z' }
        : undefined,
    },
    resourceLocks: {
      acquire: async (input: Record<string, unknown>) => {
        locks.acquires.push(input);
        return { id: 'lock-1' } as never;
      },
      release: async (input: Record<string, unknown>) => {
        locks.releases.push(input);
      },
    },
    workflowRecovery: {
      begin: async () => ({ id: 'ledger-1' }),
      recordCheckpoint: async () => ({ id: 'checkpoint-1', captureHash: sha256({ snapshot: 'v1' }) }),
      get: async () => ({ ledger: { id: 'ledger-1' }, checkpoints: [] }),
      getCheckpoint: async () => ({ id: 'checkpoint-1', ledgerId: checkpoint.ledgerId, capture: { snapshot: 'v1' }, captureHash: sha256({ snapshot: 'v1' }) }),
    } as unknown as PluginRunnerHostApiDependencies['workflowRecovery'],
    executionDetails: { publishLog: (...input: unknown[]) => { progress.push(input); } } as PluginRunnerHostApiDependencies['executionDetails'],
    executions: {
      getRunOrThrow: async () => ({ status: 'RUNNING' }),
      getStepOrThrow: async () => ({ executionRunId: 'run-1' }),
    } as unknown as PluginRunnerHostApiDependencies['executions'],
  };
  return { dependencies, validations, audits, progress, locks, checkpoint };
}

function context(method: string, hostPermissions: string[], grantRefs = ['grant-1']): PluginRunnerHostCallContext {
  return {
    method,
    input: {},
    grantRefs,
    tenantId: 'tenant-1',
    executionId: 'run-1',
    executionStepId: 'step-1',
    workflowVersionId: 'workflow-1',
    pluginVersionId: 'plugin-version-1',
    pluginId: 'test.echo',
    pluginVersion: '1.0.0',
    capability: 'test.echo',
    planDigest,
    hostPermissions,
  };
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

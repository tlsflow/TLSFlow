import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutionsController } from './controller/executions.controller.js';
import { ExecutionDetailStreamService } from './application/execution-detail-stream.service.js';

test('执行详情 SSE 在读取快照期间缓存事件，避免丢失首个步骤的成功状态', async () => {
  const detailStream = new ExecutionDetailStreamService();
  let releaseSnapshot: (() => void) | undefined;
  const snapshotReady = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });
  const now = '2026-08-03T00:00:00.000Z';
  const run = {
    id: 'run-sse-race',
    tenantId: 'tenant_1',
    deploymentPlanId: 'plan_1',
    runNo: 1,
    type: 'dry_run',
    idempotencyKey: 'idem-sse-race',
    requestHash: 'hash-sse-race',
    status: 'RUNNING',
    summary: {},
    createdAt: now,
    updatedAt: now,
    createdBy: 'tester',
    version: 1,
  };
  const pendingStep = {
    id: 'step-sse-race',
    tenantId: 'tenant_1',
    executionRunId: run.id,
    deploymentPlanTargetId: 'target_1',
    stepNo: 1,
    stepType: 'DISCOVER',
    name: 'DISCOVER target_1',
    dependsOn: [],
    attemptCount: 0,
    maxAttempts: 1,
    inputSnapshot: { dryRun: true },
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
    createdBy: 'tester',
    version: 1,
  };
  const successStep = {
    ...pendingStep,
    attemptCount: 1,
    status: 'SUCCESS',
    startedAt: now,
    finishedAt: now,
    updatedAt: '2026-08-03T00:00:01.000Z',
    version: 3,
  };
  const foreignTenantStep = {
    ...successStep,
    id: 'step-sse-foreign-tenant',
    tenantId: 'tenant_2',
  };

  let routeHandler: ((request: any) => Promise<any>) | undefined;
  const controller = new ExecutionsController({
    getRun: async () => {
      await snapshotReady;
      return run;
    },
    listSteps: async () => [pendingStep],
  } as any, detailStream);
  controller.register({
    get: (path: string, _summary: string, _tags: string[], handler: (request: any) => Promise<any>) => {
      if (path === '/api/v1/execution-runs/stream') routeHandler = handler;
    },
    post: () => undefined,
  } as any);

  const response = {
    chunks: [] as string[],
    writableEnded: false,
    closeListener: undefined as (() => void) | undefined,
    write(chunk: string) {
      this.chunks.push(chunk);
    },
    end() {
      this.writableEnded = true;
    },
    on(event: string, listener: () => void) {
      if (event === 'close') this.closeListener = listener;
      return this;
    },
  };
  const body = await routeHandler!({
    query: { runId: run.id },
    context: { tenantId: 'tenant_1' },
  });
  const streamPromise = body.stream(response as any);
  await new Promise<void>((resolve) => setImmediate(resolve));
  detailStream.publishStep(successStep as any);
  detailStream.publishStep(foreignTenantStep as any);
  releaseSnapshot!();
  await new Promise<void>((resolve) => setImmediate(resolve));

  const output = response.chunks.join('');
  const snapshotIndex = output.indexOf('event: snapshot');
  const stepIndex = output.indexOf('event: step');
  assert.ok(snapshotIndex >= 0);
  assert.ok(stepIndex > snapshotIndex);
  assert.match(output.slice(snapshotIndex, stepIndex), /"status":"PENDING"/);
  assert.match(output.slice(stepIndex), /"status":"SUCCESS"/);
  assert.doesNotMatch(output, /step-sse-foreign-tenant/);

  response.closeListener?.();
  await Promise.race([
    streamPromise,
    new Promise((resolve) => setTimeout(resolve, 20)),
  ]);
});

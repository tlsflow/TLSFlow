import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginFactPipelineService, type PluginFactRunner } from './plugin-fact-pipeline.service.js';

test('Fact Pipeline 不得绕过 DSL 直接调用 Plugin Runner', async () => {
  let runnerCalls = 0;
  const runner: PluginFactRunner = {
    async execute() {
      runnerCalls += 1;
      throw new Error('不应调用 Runner');
    },
  };
  const service = new PluginFactPipelineService(runner);

  await assert.rejects(
    service.execute({
      tenantId: 'tenant-1',
      executionId: 'execution-1',
      executionStepId: 'step-1',
      workflowVersionId: 'workflow-version-1',
      pluginId: 'web.nginx',
      capability: 'application.discover',
    } as never),
    (error: unknown) => (error as { errorCode?: string }).errorCode === 'PLUGIN_RUNNER_SCOPE_FORBIDDEN',
  );
  assert.equal(runnerCalls, 0);
});

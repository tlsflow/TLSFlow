import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginFactRunnerAdapter } from './plugin-fact-runner.adapter.js';

test('Fact Runner 入口失败关闭且不会启动 Runner 子进程', async () => {
  let startCalls = 0;
  const adapter = new PluginFactRunnerAdapter({
    supervisor: {
      async start() {
        startCalls += 1;
        throw new Error('不应启动 Runner');
      },
    } as never,
    runner: {} as never,
    builtinRegistry: {} as never,
  });

  await assert.rejects(
    adapter.execute({
      pluginId: 'web.nginx',
      capability: 'application.discover',
      workflowVersionId: 'workflow-version-1',
    } as never),
    (error: unknown) => (error as { errorCode?: string }).errorCode === 'PLUGIN_RUNNER_SCOPE_FORBIDDEN',
  );
  assert.equal(startCalls, 0);
});

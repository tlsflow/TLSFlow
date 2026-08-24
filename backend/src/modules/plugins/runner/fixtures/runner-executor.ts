import type { PluginRunnerExecutor } from '../plugin-runner-executor.js';

/** 仅用于 Runner 真实子进程合同测试，不属于生产执行器装配。 */
export function createPluginRunnerExecutor(): PluginRunnerExecutor {
  const hash = `sha256:${'a'.repeat(64)}`;
  return {
    descriptor: {
      pluginVersionId: 'test-version-v1',
      pluginId: 'test.echo',
      pluginVersion: '1.0.0',
      capabilities: ['test.echo'],
      permissions: ['artifact.read'],
      packageHash: hash,
      resourceHash: hash,
      manifestHash: hash,
    },
    async execute(context, hostApi) {
      if (typeof context.input.delayMs === 'number') {
        await delayWithSignal(context.input.delayMs, context.signal);
      }
      const hostResult = context.input.hostCall === true
        ? await hostApi.call('artifact.grant.read', { grantId: 'grant-1', artifactRef: 'artifact-1' }, context.grantRefs)
        : undefined;
      return {
        success: true,
        status: 'SUCCESS',
        summary: { value: context.input.value, ...(hostResult ? { hostResult } : {}) },
        normalizedObjects: [],
        warnings: [],
      };
    },
  };
}

function delayWithSignal(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, rejectDelay) => {
    const timer = setTimeout(resolveDelay, milliseconds);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      rejectDelay(new Error('execution cancelled'));
    }, { once: true });
  });
}

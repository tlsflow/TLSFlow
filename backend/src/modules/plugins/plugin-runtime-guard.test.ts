import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginRuntimeGuardService } from './runtime/plugin-runtime-guard.service.js';

test('插件运行 Guard 限制并发并记录指标', async () => {
  const guard = new PluginRuntimeGuardService({ maximumConcurrentPerTenant: 1, maximumConcurrentPerPlugin: 1, maximumConcurrentPerGateway: 1, circuitFailureThreshold: 2, circuitOpenMilliseconds: 60_000 });
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const first = guard.execute(context(), () => waiting);
  await assert.rejects(() => guard.execute(context(), async () => undefined), /并发限制/);
  release();
  await first;
  const [metric] = guard.listMetrics('tenant-1');
  assert.equal(metric?.started, 1);
  assert.equal(metric?.succeeded, 1);
  assert.equal(metric?.rejected, 1);
});

test('插件运行 Guard 按能力熔断且不影响其他能力', async () => {
  const guard = new PluginRuntimeGuardService({ maximumConcurrentPerTenant: 10, maximumConcurrentPerPlugin: 10, maximumConcurrentPerGateway: 10, circuitFailureThreshold: 2, circuitOpenMilliseconds: 60_000 });
  for (let index = 0; index < 2; index += 1) await assert.rejects(() => guard.execute(context(), async () => { throw new Error('boom'); }));
  await assert.rejects(() => guard.execute(context(), async () => undefined), /熔断/);
  assert.equal(await guard.execute({ ...context(), capabilityKey: 'device.discover' }, async () => 'ok'), 'ok');
  assert.equal(guard.listMetrics()[0]?.circuitState, 'OPEN');
});

function context() {
  return { tenantId: 'tenant-1', pluginVersionId: 'version-1', capabilityKey: 'device.connection.test', gatewayId: 'gateway-1' };
}

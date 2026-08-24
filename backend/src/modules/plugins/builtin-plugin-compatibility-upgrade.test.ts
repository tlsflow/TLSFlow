import assert from 'node:assert/strict';
import test from 'node:test';

test('内置插件运行期兼容升级服务已清退', async () => {
  await assertModuleMissing('./application/builtin-plugin-compatibility-upgrade.service.js');
});

async function assertModuleMissing(modulePath: string): Promise<void> {
  await assert.rejects(
    () => import(modulePath),
    (error: unknown) => {
      if (!error || typeof error !== 'object' || !('code' in error)) return false;
      return (error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND';
    },
  );
}

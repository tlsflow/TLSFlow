import assert from 'node:assert/strict';
import test from 'node:test';

test('旧 Compatibility Catalog API 入口已清退', async () => {
  await assertModuleMissing('./index.js');
  await assertModuleMissing('./controller/compatibility-catalog.controller.js');
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

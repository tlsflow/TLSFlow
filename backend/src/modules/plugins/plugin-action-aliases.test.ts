import assert from 'node:assert/strict';
import test from 'node:test';

test('插件历史 Action Alias Schema 已清退', async () => {
  await assertModuleMissing('./schema/plugin-action-aliases.schema.js');
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

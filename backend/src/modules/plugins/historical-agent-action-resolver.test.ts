import assert from 'node:assert/strict';
import test from 'node:test';

test('历史 Agent Action Resolver 已清退', async () => {
  await assertModuleMissing('./application/historical-agent-action-resolver.js');
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

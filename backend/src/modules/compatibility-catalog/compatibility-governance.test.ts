import assert from 'node:assert/strict';
import test from 'node:test';

test('旧 Compatibility Governance、Certification 和 Runtime Baseline 入口已清退', async () => {
  for (const modulePath of [
    './domain/compatibility-governance-registry.js',
    './domain/certification-record.schema.js',
    './domain/runtime-baseline.schema.js',
    './domain/compatibility-profile-v2.schema.js',
  ]) {
    await assertModuleMissing(modulePath);
  }
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

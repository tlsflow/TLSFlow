import assert from 'node:assert/strict';
import test from 'node:test';

test('旧 Compatibility Catalog Loader、Profile 和 Recipe 入口已清退', async () => {
  for (const modulePath of [
    './infrastructure/compatibility-catalog.loader.js',
    './domain/compatibility-profile.schema.js',
    './domain/execution-recipe.schema.js',
    './domain/compatibility-matrix.js',
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

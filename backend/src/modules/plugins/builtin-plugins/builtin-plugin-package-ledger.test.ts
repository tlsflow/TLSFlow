import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendBuiltinPluginPackageSnapshots,
  validateBuiltinPluginPackageLedger,
  type BuiltinPluginPackageLedger,
  type BuiltinPluginPackageSnapshot,
} from './builtin-plugin-package-ledger.js';

const registered: BuiltinPluginPackageSnapshot = {
  pluginId: 'builtin.example',
  version: '1.0.0',
  packageSha256: 'sha256:old',
};

test('最终包内容不变时通过指纹检查', () => {
  assert.deepEqual(validateBuiltinPluginPackageLedger(ledger([registered]), [registered]), []);
});

test('同一插件版本最终包内容变化时拒绝覆盖', () => {
  const violations = validateBuiltinPluginPackageLedger(ledger([registered]), [{
    ...registered,
    packageSha256: 'sha256:new',
  }]);
  assert.deepEqual(violations, ['builtin.example@1.0.0 的最终包内容已变化，但版本号未递进']);
});

test('新版本必须先登记到指纹台账', () => {
  const violations = validateBuiltinPluginPackageLedger(ledger([registered]), [{
    ...registered,
    version: '1.0.1',
    packageSha256: 'sha256:new',
  }]);
  assert.deepEqual(violations, ['builtin.example@1.0.1 尚未登记，请确认版本递进后更新指纹台账']);
});

test('更新台账只追加新版本且保留不可变历史', () => {
  const next = { ...registered, version: '1.0.1', packageSha256: 'sha256:new' };
  assert.deepEqual(appendBuiltinPluginPackageSnapshots(ledger([registered]), [next]), ledger([registered, next]));
  assert.throws(() => appendBuiltinPluginPackageSnapshots(ledger([registered]), [{ ...registered, packageSha256: 'sha256:new' }]), /最终包内容已变化/);
});

function ledger(packages: BuiltinPluginPackageSnapshot[]): BuiltinPluginPackageLedger {
  return { version: 1, packages };
}

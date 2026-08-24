import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkDeploymentInputArchitecture } from './check-deployment-input-architecture.mjs';

test('部署输入守卫拒绝旧 Source、旧字段、变量名猜测和第二 Resolver', () => {
  const root = fixtureRoot(`
    const source = 'asset_ssl';
    request.variableBindings;
    if (name === 'deviceHost') return value;
    const resolver = new UnifiedDeploymentInputResolver();
  `);
  const findings = checkDeploymentInputArchitecture(root, ['backend/src/modules/deployment-inputs']);
  assert.ok(findings.some((item) => item.startsWith('LEGACY_INPUT_SOURCE')));
  assert.ok(findings.some((item) => item.startsWith('LEGACY_BINDING_FIELD')));
  assert.ok(findings.some((item) => item.startsWith('INPUT_NAME_GUESS')));
  assert.ok(findings.some((item) => item.startsWith('SECOND_INPUT_RESOLVER')));
});

test('部署输入守卫允许唯一生产 Resolver 和通用命名空间', () => {
  const root = fixtureRoot('const values = resolvedInput.variables; registry.resolve(capabilityKey);');
  const productionDirectory = join(root, 'backend/src/modules/deployment-inputs/application');
  mkdirSync(productionDirectory, { recursive: true });
  writeFileSync(join(productionDirectory, 'production-deployment-input-resolver.service.ts'), 'const resolver = new UnifiedDeploymentInputResolver();', 'utf8');
  assert.deepEqual(checkDeploymentInputArchitecture(root, ['backend/src/modules/deployment-inputs']), []);
});

test('部署输入守卫覆盖设备能力执行路径中的第二个底层 Resolver', () => {
  const root = fixtureRoot('export const valid = true;');
  const devicesDirectory = join(root, 'backend/src/modules/devices/application');
  mkdirSync(devicesDirectory, { recursive: true });
  writeFileSync(
    join(devicesDirectory, 'devices.application-service.ts'),
    'const resolver = new UnifiedDeploymentInputResolver();',
    'utf8',
  );
  const findings = checkDeploymentInputArchitecture(root);
  assert.ok(findings.some((item) => item.startsWith('SECOND_INPUT_RESOLVER backend/src/modules/devices/')));
});

function fixtureRoot(source) {
  const root = mkdtempSync(join(tmpdir(), 'gcac-deployment-input-guard-'));
  const directory = join(root, 'backend/src/modules/deployment-inputs');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'fixture.ts'), source, 'utf8');
  return root;
}

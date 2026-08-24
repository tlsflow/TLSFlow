import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { compareWithDebt, filterFindings, scanPluginArchitecture, scanPluginArchitectureSource } from './check-plugin-architecture.mjs';

test('宿主厂商专用 Provider 构造必须被识别', () => {
  const findings = scanPluginArchitectureSource('backend/src/app.ts', 'registry.register(new NginxProvider());');
  assert.equal(findings[0]?.rule, 'HOST_VENDOR_DISPATCH');
});

test('Framework 产品数组必须被识别', () => {
  const findings = scanPluginArchitectureSource(
    'backend/src/registry.ts',
    "const frameworkTypes = ['web.iis', 'web.nginx', 'web.apache']; frameworkTypes.includes(context.frameworkType);",
  );
  assert.ok(findings.some((finding) => finding.rule === 'FRAMEWORK_DEPLOYMENT_ALLOWLIST'));
});

test('Framework Set、Map 和 Union 必须被识别', () => {
  const source = `
    type FrameworkType = 'web.iis' | 'web.nginx';
    const frameworkTypes = new Set(['web.iis', 'web.nginx']);
    const frameworkTypeMap = new Map([['web.iis', 1], ['web.nginx', 2]]);
    frameworkTypes.has(context.frameworkType);
    frameworkTypeMap.get(context.frameworkType);
  `;
  const findings = scanPluginArchitectureSource('backend/src/registry.ts', source);
  assert.ok(findings.filter((finding) => finding.rule === 'FRAMEWORK_DEPLOYMENT_ALLOWLIST').length >= 3);
});

test('宿主厂商映射表和 Action Map 必须被识别', () => {
  const source = `
    const providerAdapters = { iis: genericIis, nginx: genericNginx };
    const actionAliases = new Map([['windows.iis.deploy_certificate', 'agent.atomic_plan.execute']]);
  `;
  const findings = scanPluginArchitectureSource('backend/src/registry.ts', source);
  assert.ok(findings.some((finding) => finding.rule === 'HOST_VENDOR_DISPATCH'));
  assert.ok(findings.some((finding) => finding.rule === 'HOST_PRODUCT_ACTION_ALIAS'));
});

test('宿主产品模板、能力目录和 Operation 契约必须被识别', () => {
  const source = `
    type RuntimePlatform = 'iis' | 'nginx' | 'apache';
    const TEMPLATE_PRESETS = { windows: { iis: {}, nginx: {}, apache: {} } };
    const operationTypes = ['file.write', 'windows.iis.binding.update_certificate'];
    const builtInCapabilityDefinitions = [definition('iis.binding.update'), definition('file.write')];
  `;
  const findings = scanPluginArchitectureSource('backend/src/catalog.ts', source);
  assert.ok(findings.some((finding) => finding.rule === 'HOST_VENDOR_DISPATCH'));
  assert.ok(findings.some((finding) => finding.rule === 'HOST_PRODUCT_OPERATION_CONTRACT'));
  assert.ok(findings.some((finding) => finding.rule === 'HOST_PRODUCT_CAPABILITY_CATALOG'));
});

test('Go Agent 产品 Action 和产品 Registry 必须被识别，Atomic Operation 不误报', () => {
  const source = `
    registry.add(windowsIISActionHandler())
    const alias = "windows.iis.deploy_certificate"
    handler := HandlerFunc{AdapterID: compatibility.ProductNginx}
    const operation = "windows.iis.binding.update_certificate"
  `;
  const findings = scanPluginArchitectureSource('agents/windows-go-full-agent/action_registry.go', source);
  assert.ok(findings.some((finding) => finding.rule === 'HOST_VENDOR_DISPATCH'));
  assert.ok(findings.some((finding) => finding.rule === 'HOST_PRODUCT_ACTION_ALIAS'));
  assert.equal(findings.some((finding) => finding.excerpt.includes('binding.update_certificate')), false);
});

test('Go Agent 产品 Registry 跨行书写仍必须被识别', () => {
  const source = `package main
    var handler = HandlerFunc{
      AdapterID:
        compatibility.ProductNginx,
    }
  `;
  const findings = scanPluginArchitectureSource('agents/linux-go-full-agent/main.go', source);
  assert.ok(findings.some((finding) => finding.rule === 'HOST_VENDOR_DISPATCH' && finding.line === 3));
});

test('Go Agent 产品 Capability 目录必须被识别，原始发现详情键不误报', () => {
  const source = `
    const CapabilityNginxInstall = "nginx.cert.install"
    const detailKey = "linux.nginx.detail"
  `;
  const findings = scanPluginArchitectureSource('agents/linux-go-full-agent/internal/compatibility/catalog.go', source);
  assert.equal(findings.filter((finding) => finding.rule === 'HOST_PRODUCT_CAPABILITY_CATALOG').length, 1);
  assert.equal(findings.some((finding) => finding.excerpt.includes('linux.nginx.detail')), false);
});

test('C# Compatibility Agent 产品 Action 与直连 Handler 必须被识别', () => {
  const source = `
    IisCertificateDeploymentHandler handler = new IisCertificateDeploymentHandler(dataDirectory);
    Aliases = new string[] { "windows.iis.deploy_certificate" };
  `;
  const findings = scanPluginArchitectureSource('agents/windows-compat-full-agent/src/AgentRuntime.cs', source);
  assert.ok(findings.some((finding) => finding.rule === 'HOST_VENDOR_DISPATCH'));
  assert.ok(findings.some((finding) => finding.rule === 'HOST_PRODUCT_ACTION_ALIAS'));
});

test('所有者 Driver 选择必须被识别', () => {
  const findings = scanPluginArchitectureSource('backend/src/context.ts', "if (deviceAsset) return { driverKind: 'DEVICE_PLUGIN' }; ");
  assert.equal(findings[0]?.rule, 'OWNER_DRIVER_SELECTION');
});

test('未知 Action 原样转发必须被识别', () => {
  const findings = scanPluginArchitectureSource(
    'backend/src/executor.ts',
    "if (snapshot.actionType !== 'agent.atomic_plan.execute') { return { payload: { ...snapshot } }; }",
  );
  assert.equal(findings[0]?.rule, 'RAW_AGENT_ACTION_FORWARD');
});

test('普通 Snapshot 展开不得误报', () => {
  const findings = scanPluginArchitectureSource(
    'backend/src/executor.ts',
    "return enqueueDirectTask({ actionType: 'agent.atomic_plan.execute', payload: { ...snapshot } });",
  );
  assert.deepEqual(findings, []);
});

test('Legacy Executor 默认注册必须被识别', () => {
  const findings = scanPluginArchitectureSource('backend/src/executor.ts', 'registry.register(new LegacyAgentExecutorAdapter());');
  assert.equal(findings[0]?.rule, 'LEGACY_EXECUTOR_REGISTRATION');
});

test('旧 API 新消费者必须被识别', () => {
  const findings = scanPluginArchitectureSource('web/src/api.ts', "client.post('/api/v1/plugins/execute');");
  assert.equal(findings[0]?.rule, 'LEGACY_API_NEW_DEPENDENCY');
});

test('厂商中立预设只保留相关规则', () => {
  const findings = [
    { rule: 'HOST_VENDOR_DISPATCH' },
    { rule: 'OWNER_DRIVER_SELECTION' },
    { rule: 'HOST_PRODUCT_ACTION_ALIAS' },
  ];
  assert.deepEqual(
    filterFindings(findings, { preset: 'vendor-neutrality' }).map((finding) => finding.rule),
    ['HOST_VENDOR_DISPATCH', 'HOST_PRODUCT_ACTION_ALIAS'],
  );
});

test('厂商中立原始扫描覆盖 TypeScript 与 Go 违规', () => {
  const root = mkdtempSync(join(tmpdir(), 'gcac-vendor-neutrality-'));
  mkdirSync(join(root, 'backend/src/modules/devices'), { recursive: true });
  mkdirSync(join(root, 'agents/windows-go-full-agent'), { recursive: true });
  writeFileSync(join(root, 'backend/src/modules/devices/bad.ts'), "if (deviceFamily === 'CITRIX') new CitrixDeviceTester();", 'utf8');
  writeFileSync(join(root, 'agents/windows-go-full-agent/bad.go'), 'package main\nvar action = "windows.iis.deploy_certificate"\n', 'utf8');
  const findings = filterFindings(
    scanPluginArchitecture(root, ['backend/src/modules/devices', 'agents/windows-go-full-agent']),
    { preset: 'vendor-neutrality' },
  );
  assert.ok(findings.some((finding) => finding.rule === 'HOST_VENDOR_DISPATCH'));
  assert.ok(findings.some((finding) => finding.rule === 'HOST_PRODUCT_ACTION_ALIAS'));
});

test('标准 Capability 与 Runtime 分派不得误报', () => {
  const findings = scanPluginArchitectureSource(
    'backend/src/runtime.ts',
    "return registry.resolve(plugin.runtime).compile({ capabilityAssignmentId });",
  );
  assert.deepEqual(findings, []);
});

test('债务清单只允许既有数量且禁止新路径', () => {
  const known = { rule: 'OWNER_DRIVER_SELECTION', path: 'backend/src/context.ts', line: 1, column: 1, anchor: 'resolve', fingerprint: 'abc', excerpt: 'known' };
  const debt = {
    version: 1,
    entries: [{ rule: known.rule, path: known.path, anchor: known.anchor, fingerprint: known.fingerprint, reason: 'known', ownerTask: '034.1-T09', removeWhen: 'T09 完成' }],
  };
  assert.deepEqual(compareWithDebt([known], debt), []);
  assert.deepEqual(compareWithDebt([known, { ...known, line: 2, fingerprint: 'def' }], debt), [{ ...known, line: 2, fingerprint: 'def' }]);
  assert.deepEqual(compareWithDebt([{ ...known, path: 'backend/src/copied.ts' }], debt), [{ ...known, path: 'backend/src/copied.ts' }]);
});

test('债务条目缺少删除条件必须失败', () => {
  assert.throws(() => compareWithDebt([], { version: 1, entries: [{ rule: 'X' }] }), /缺少 path/);
});

test('CLI 对未登记违规返回非零并输出精确位置', () => {
  const root = mkdtempSync(join(tmpdir(), 'gcac-plugin-architecture-'));
  mkdirSync(join(root, 'backend/src'), { recursive: true });
  writeFileSync(join(root, 'backend/src/bad.ts'), 'registry.register(new NginxProvider());\n', 'utf8');
  writeFileSync(join(root, 'debt.json'), '{"version":1,"entries":[]}', 'utf8');
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('./check-plugin-architecture.mjs', import.meta.url)),
    '--root', root,
    '--scan-root', 'backend/src',
    '--debt', join(root, 'debt.json'),
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HOST_VENDOR_DISPATCH backend\/src\/bad\.ts:1:19/);
});

test('CLI 厂商中立原始扫描对历史别名模式返回非零', () => {
  const root = mkdtempSync(join(tmpdir(), 'gcac-plugin-architecture-'));
  mkdirSync(join(root, 'backend/src/modules/devices'), { recursive: true });
  writeFileSync(join(root, 'backend/src/modules/devices/bad.ts'), "if (deviceFamily === 'CITRIX') new CitrixDeviceTester();\n", 'utf8');
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('./check-plugin-architecture.mjs', import.meta.url)),
    '--root', root,
    '--scan-root', 'backend/src/modules/devices',
    '--preset', 'vendor-neutrality',
    '--raw',
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /统一插件架构原始扫描失败/);
  assert.match(result.stderr, /HOST_VENDOR_DISPATCH backend\/src\/modules\/devices\/bad\.ts:1:1/);
  assert.match(result.stderr, /CitrixDeviceTester/);
});

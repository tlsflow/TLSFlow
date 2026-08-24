import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { architectureScanRoots, compareWithDebt, filterFindings, scanPluginArchitecture, scanPluginArchitectureSource } from './check-plugin-architecture.mjs';

test('生产架构扫描范围必须包含宿主、插件、Runner、资源、Compatibility 与全部 Agent 根', () => {
  assert.deepEqual([...architectureScanRoots], [
    'backend/src',
    'web/src',
    'backend/src/modules/plugins/builtin-plugins',
    'backend/src/modules/workflow-templates/builtin-workflows',
    'backend/src/modules/plugins/runner',
    'backend/src/modules/licensing/resources',
    'backend/src/modules/legacy-agents',
    'compatibility',
    'data/workflows',
    'agents/linux-go-full-agent',
    'agents/windows-go-full-agent',
    'agents/windows-compat-full-agent',
    'agents/go-ca-node',
    'agents/windows-go-ca-node',
    'agents/linux-go-ca-node',
    'agents/windows-adcs-agent',
  ]);
});

test('宿主厂商专用 Provider 构造必须被识别', () => {
  const findings = scanPluginArchitectureSource('backend/src/app.ts', 'registry.register(new NginxProvider());');
  assert.equal(findings[0]?.rule, 'HOST_VENDOR_DISPATCH');
});

test('手动 Web 重新发现的窄直连允许通过，其他直连仍然失败', () => {
  const approved = scanPluginArchitectureSource(
    'backend/src/modules/agents/application/agents.application-service.ts',
    [
      "import { AgentDirectClient } from './agent-direct-client.js';",
      'private readonly directAgentClient = new AgentDirectClient(),',
      'const response = await this.directAgentClient.refreshWebInventory(agent, request);',
    ].join('\n'),
  );
  assert.equal(approved.some((finding) => finding.rule === 'AGENT_DIRECT_BYPASS'), false);

  const rejected = scanPluginArchitectureSource(
    'backend/src/modules/agents/application/agents.application-service.ts',
    'const response = await this.directAgentClient.execute(request);',
  );
  assert.ok(rejected.some((finding) => finding.rule === 'AGENT_DIRECT_BYPASS'));
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
  assert.equal(findings.every((finding) => finding.classification === 'PRODUCTION'), true);
});

test('生产残留的已删除插件 Schema 和旧运行时必须显式失败', () => {
  const schemaFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/index.ts',
    "export * from './schema/agent-deployment-plugins.schema.js';",
  );
  assert.equal(schemaFindings.some((finding) => finding.rule === 'REMOVED_PLUGIN_SCHEMA_REFERENCE'), true);
  assert.equal(schemaFindings.find((finding) => finding.rule === 'REMOVED_PLUGIN_SCHEMA_REFERENCE')?.classification, 'PRODUCTION');

  const runtimeFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/dto/unified-plugins.dto.ts',
    "export type UnifiedPluginRuntime = 'AGENT_ATOMIC';",
  );
  assert.equal(runtimeFindings.some((finding) => finding.rule === 'REMOVED_PLUGIN_RUNTIME_REFERENCE'), true);
  assert.equal(runtimeFindings.find((finding) => finding.rule === 'REMOVED_PLUGIN_RUNTIME_REFERENCE')?.classification, 'PRODUCTION');

  const compatibilitySchemaFindings = scanPluginArchitectureSource(
    'compatibility/schemas/unified-plugin-manifest.v1.schema.json',
    '{"runtime":{"enum":["AGENT_ATOMIC","WORKFLOW_DSL"]}}',
  );
  assert.equal(compatibilitySchemaFindings.some((finding) => finding.rule === 'REMOVED_PLUGIN_RUNTIME_REFERENCE'), true);
  assert.equal(compatibilitySchemaFindings.find((finding) => finding.rule === 'REMOVED_PLUGIN_RUNTIME_REFERENCE')?.classification, 'PRODUCTION');

  const fixtureFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/runner/fixtures/action-aliases.ts',
    "const actionAliases = new Map([['windows.iis.deploy_certificate', 'agent.plan.execute']]);",
  );
  assert.equal(fixtureFindings.some((finding) => finding.rule === 'HOST_PRODUCT_ACTION_ALIAS'), true);
  assert.equal(fixtureFindings.find((finding) => finding.rule === 'HOST_PRODUCT_ACTION_ALIAS')?.classification, 'PRODUCTION');
});

test('测试文件中的拒绝断言不得被误判为生产违规', () => {
  const source = `
    assert.throws(() => runAction('command.execute'));
    expect(() => runAction('agent.atomic_plan.execute')).toThrow();
  `;
  for (const path of [
    'backend/src/modules/agents/application/agents.application-service.test.ts',
    'backend/src/modules/agents/application/agents_application_test.go',
    'backend/src/tests/architecture-guard.ts',
  ]) {
    assert.deepEqual(scanPluginArchitectureSource(path, source), [], `测试拒绝断言被误报：${path}`);
  }

  const fixtureFindings = scanPluginArchitectureSource(
    'agents/linux-go-full-agent/fixtures/negative-agent.go',
    'package main\nvar action = "command.execute"\n',
  );
  assert.ok(fixtureFindings.some((finding) => finding.rule === 'AGENT_LEGACY_COMMAND_CONTRACT'));
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

test('IIS Agent-side Plugin 可以承载 IIS 实现，但仍受 Agent 进程执行规则约束', () => {
  const sidePluginFindings = scanPluginArchitectureSource(
    'agents/windows-compat-full-agent/agent-side-plugins/web-iis/src/IisAgentSidePlugin.cs',
    'internal static class IisAgentSidePlugin { }',
  );
  assert.equal(sidePluginFindings.some((finding) => finding.rule === 'AGENT_PRODUCT_IMPLEMENTATION'), false);

  const sidePluginExecutionFindings = scanPluginArchitectureSource(
    'agents/windows-compat-full-agent/agent-side-plugins/web-iis/src/IisAgentSidePlugin.cs',
    'var process = new ProcessStartInfo(command);',
  );
  assert.ok(sidePluginExecutionFindings.some((finding) => finding.rule === 'AGENT_FREE_COMMAND_EXECUTION'));
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

test('宿主普通 require 方法和内置加载器不得误报动态加载或插件直连', () => {
  const methodFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/application/plugin-workflow-publisher.service.ts',
    'class WorkflowRegistry { require(pluginVersionId: string) { return pluginVersionId; } }',
  );
  assert.equal(methodFindings.some((finding) => finding.rule === 'HOST_PLUGIN_DYNAMIC_LOAD'), false);

  const loaderFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/builtin-plugins/builtin-unified-plugin-loader.ts',
    'import { readFile } from "node:fs/promises"; class Loader { installAll(service: UnifiedPluginsApplicationService) { return service; } }',
  );
  assert.equal(loaderFindings.some((finding) => finding.rule === 'PLUGIN_DIRECT_HOST_ACCESS'), false);
  assert.equal(loaderFindings.some((finding) => finding.rule === 'PLUGIN_DIRECT_HOST_SERVICE'), false);
});

test('宿主可以静态读取 Registry 元数据，但不得静态装载插件 Runtime', () => {
  const registryFindings = scanPluginArchitectureSource(
    'backend/src/app.module.ts',
    "import { BuiltinPluginRegistry } from './modules/plugins/builtin-plugins/builtin-plugin-registry.js';",
  );
  assert.equal(registryFindings.some((finding) => finding.rule === 'HOST_PLUGIN_DYNAMIC_LOAD'), false);

  const runtimeFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/application/plugin-loader.ts',
    "import { createPluginRunnerExecutor } from '../builtin-plugins/cloud-aliyun/runtime/index.js';",
  );
  assert.ok(runtimeFindings.some((finding) => finding.rule === 'HOST_PLUGIN_DYNAMIC_LOAD'));
});

test('只有 Runner 固定执行器装载器允许动态 import，宿主和其他 Runner 文件仍必须拒绝', () => {
  const loaderFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/runner/plugin-runner-executor.ts',
    'export async function loadPluginRunnerExecutor(path: string) { return import(path); }',
  );
  assert.equal(loaderFindings.some((finding) => finding.rule === 'HOST_PLUGIN_DYNAMIC_LOAD'), false);

  const runnerBypassFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/runner/runner-server.ts',
    'export async function bypass(path: string) { return import(path); }',
  );
  assert.equal(runnerBypassFindings.some((finding) => finding.rule === 'HOST_PLUGIN_DYNAMIC_LOAD'), true);
});

test('宿主不得通过静态插件路径、require.resolve 或 createRequire 旁路加载插件', () => {
  const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/plugin-architecture/negative-plugin-load.ts');
  const findings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/application/plugin-loader.ts',
    readFileSync(fixturePath, 'utf8'),
  );
  assert.ok(findings.filter((finding) => finding.rule === 'HOST_PLUGIN_DYNAMIC_LOAD').length >= 10);

  const staticAndElementFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/application/plugin-loader.ts',
    [
      "import('./builtin-plugins/cloud-aliyun/runtime/index.js');",
      "Module._load('./builtin-plugins/cloud-aliyun/runtime/index.js', module);",
      "module['require'](pluginPath);",
    ].join('\n'),
  );
  assert.ok(staticAndElementFindings.filter((finding) => finding.rule === 'HOST_PLUGIN_DYNAMIC_LOAD').length >= 3);

  const hostLoaderFindings = scanPluginArchitectureSource(
    'backend/src/app.module.ts',
    "import { BuiltinUnifiedPluginLoader } from './modules/plugins/builtin-plugins/builtin-unified-plugin-loader.js';",
  );
  assert.equal(hostLoaderFindings.some((finding) => finding.rule === 'HOST_PLUGIN_DYNAMIC_LOAD'), false);
});

test('Agent 必须拒绝 PowerShell 变体和下载后执行', () => {
  const powershellPath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/plugin-architecture/negative-execution.ps1');
  const powershellFindings = scanPluginArchitectureSource(
    'agents/windows-go-full-agent/scripts/negative-execution.ps1',
    readFileSync(powershellPath, 'utf8'),
  );
  assert.ok(powershellFindings.some((finding) => finding.rule === 'AGENT_SHELL_EXECUTION'));
  assert.ok(powershellFindings.some((finding) => finding.rule === 'AGENT_DOWNLOAD_EXECUTION'));

  const callOperatorFindings = scanPluginArchitectureSource(
    'agents/windows-go-full-agent/scripts/negative-execution.ps1',
    '& $commandPath $payload\n. .\\payload.ps1',
  );
  assert.ok(callOperatorFindings.some((finding) => finding.rule === 'AGENT_SHELL_EXECUTION'));

  const downloadPath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/plugin-architecture/negative-download-execution.ts');
  const downloadFindings = scanPluginArchitectureSource(
    'agents/linux-go-full-agent/internal/download.go',
    readFileSync(downloadPath, 'utf8'),
  );
  assert.ok(downloadFindings.some((finding) => finding.rule === 'AGENT_DOWNLOAD_EXECUTION'));
});

test('固定 Compatibility Agent 编译器调用不得被误报为下载后执行', () => {
  const buildPath = resolve(dirname(fileURLToPath(import.meta.url)), '../..', 'agents/windows-compat-full-agent/build.ps1');
  const buildFindings = scanPluginArchitectureSource('agents/windows-compat-full-agent/build.ps1', readFileSync(buildPath, 'utf8'));
  assert.equal(buildFindings.some((finding) => finding.rule === 'AGENT_DOWNLOAD_EXECUTION'), false);

  const unrelatedCompilerFindings = scanPluginArchitectureSource(
    'agents/windows-compat-full-agent/build.ps1',
    'Invoke-WebRequest -Uri $metadataUrl -OutFile $metadata; & $compiler /nologo /out:$agentOutput',
  );
  assert.equal(unrelatedCompilerFindings.some((finding) => finding.rule === 'AGENT_DOWNLOAD_EXECUTION'), false);

  const downloadedExecutorFindings = scanPluginArchitectureSource(
    'agents/windows-compat-full-agent/build.ps1',
    'Invoke-WebRequest -Uri $payloadUrl -OutFile $payload; & $payload',
  );
  assert.equal(downloadedExecutorFindings.some((finding) => finding.rule === 'AGENT_DOWNLOAD_EXECUTION'), true);
});

test('通用 HTTP 探测和固定事实采集不得被误判为下载后执行', () => {
  const findings = scanPluginArchitectureSource(
    'agents/linux-go-full-agent/internal/facts.go',
    [
      'request, err := http.NewRequestWithContext(ctx, http.MethodHead, targetURL, nil)',
      'exec.Command("sh", request.URL.String())',
      'response, err := (&http.Client{}).Do(request)',
      'cmd := exec.Command("uname", "-r")',
      'output, err := cmd.Output()',
      '_ = response; _ = output; _ = err',
    ].join('\n'),
  );
  assert.equal(findings.some((finding) => finding.rule === 'AGENT_DOWNLOAD_EXECUTION'), false);
});

test('扩展产品族必须覆盖云、CA、DNS、RabbitMQ 和 Java Keystore', () => {
  const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/plugin-architecture/negative-products.go');
  const findings = scanPluginArchitectureSource(
    'agents/linux-go-full-agent/internal/product.go',
    readFileSync(fixturePath, 'utf8'),
  );
  assert.ok(findings.some((finding) => finding.rule === 'AGENT_PRODUCT_IMPLEMENTATION'));
  assert.ok(findings.some((finding) => finding.rule === 'AGENT_PRODUCT_IDENTIFICATION'));
  assert.ok(findings.some((finding) => finding.rule === 'HOST_PRODUCT_ACTION_ALIAS'));
  assert.ok(findings.some((finding) => finding.rule === 'HOST_PRODUCT_CAPABILITY_CATALOG'));

  const hostFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/catalog.ts',
    "const adapters = { aliyun: aliyunAdapter, rabbitmq: rabbitMqAdapter }; const operationTypes = ['ca.acme.issue', 'app.java-keystore.install'];",
  );
  assert.ok(hostFindings.some((finding) => finding.rule === 'HOST_VENDOR_DISPATCH'));
  assert.ok(hostFindings.some((finding) => finding.rule === 'HOST_PRODUCT_OPERATION_CONTRACT'));
});

test('固定 SSH 命令模板表不得被误报为厂商实现映射表', () => {
  const source = `
    const SSH_ARGUMENT_TEMPLATES = {
      'nginx.config_test': { program: 'nginx', fixedArgs: ['-t'], valueCount: 0 },
      'apache.config_test': { program: 'apachectl', fixedArgs: ['-t'], valueCount: 0 },
    } as const;
  `;
  const findings = scanPluginArchitectureSource('backend/src/modules/executors/ssh/ssh.types.ts', source);
  assert.equal(findings.some((finding) => finding.rule === 'HOST_VENDOR_DISPATCH'), false);

  const productionFindings = scanPluginArchitectureSource(
    'backend/src/modules/executors/ssh/ssh.types.ts',
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..', 'backend/src/modules/executors/ssh/ssh.types.ts'), 'utf8'),
  );
  assert.equal(productionFindings.some((finding) => finding.rule === 'HOST_VENDOR_DISPATCH'), false);
});

test('国际化资源和后端旧 API 路由声明不得被误判为架构旁路', () => {
  const localeFindings = scanPluginArchitectureSource(
    'web/src/i18n/en-US.ts',
    "export const labels = { web_iis: 'IIS', pluginId: 'Plugin ID' };",
  );
  assert.deepEqual(localeFindings, []);

  const controllerFindings = scanPluginArchitectureSource(
    'backend/src/modules/providers/controller/providers.controller.ts',
    "router.get('/api/v1/providers', handler);",
  );
  assert.equal(controllerFindings.some((finding) => finding.rule === 'LEGACY_API_NEW_DEPENDENCY'), false);

  const consumerFindings = scanPluginArchitectureSource('web/src/api.ts', "client.post('/api/v1/providers');");
  assert.equal(consumerFindings.some((finding) => finding.rule === 'LEGACY_API_NEW_DEPENDENCY'), true);
});

test('插件运行时变量和插件自带 Workflow 不得误报宿主边界', () => {
  const pluginFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/builtin-plugins/cloud-aliyun/runtime/shared.js',
    'const secretService = hmac(secretDate, input.service);',
  );
  assert.equal(pluginFindings.some((finding) => finding.rule === 'PLUGIN_DIRECT_HOST_SERVICE'), false);

  const workflowFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/builtin-plugins/citrix-adc/workflows/discover.json',
    '{"steps":[{"name":"readCitrixVirtualServers","type":"citrix.discovery","mode":"script","script":"show ns config"}],"frameworkType":"CITRIX"}',
  );
  assert.deepEqual(workflowFindings, []);
});

test('插件只允许 Runner 固定环境和包内资源边界，普通宿主访问仍必须拒绝', () => {
  const runtimePath = resolve(dirname(fileURLToPath(import.meta.url)), '../..', 'backend/src/modules/plugins/builtin-plugins/app-java-keystore/runtime/index.js');
  const runtimeFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/builtin-plugins/app-java-keystore/runtime/index.js',
    readFileSync(runtimePath, 'utf8'),
  );
  assert.equal(runtimeFindings.some((finding) => finding.rule === 'PLUGIN_DIRECT_HOST_ACCESS'), false);

  const environmentFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/builtin-plugins/sample/runtime/index.js',
    'const value = process.env.SECRET;',
  );
  assert.ok(environmentFindings.some((finding) => finding.rule === 'PLUGIN_DIRECT_HOST_ACCESS'));

  const fileFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/builtin-plugins/sample/runtime/index.js',
    "import { readFileSync } from 'node:fs';\nconst value = readFileSync('/etc/passwd', 'utf8');",
  );
  assert.ok(fileFindings.some((finding) => finding.rule === 'PLUGIN_DIRECT_HOST_ACCESS'));
});

test('Runner 资源拒绝清单中的字符串不等于实际命令合同或插件对象调用', () => {
  const rejectionFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/schema/plugin-workflow.schema.ts',
    "function rejectUnsafeRunnerKeys(input) { if (['command.execute', 'plugin.invoke'].includes(key)) fail(); }",
  );
  assert.equal(rejectionFindings.some((finding) => finding.rule === 'FORBIDDEN_COMMAND_CONTRACT'), false);
  assert.equal(rejectionFindings.some((finding) => finding.rule === 'HOST_PLUGIN_OBJECT_CALL'), false);

  const invocationFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/application/plugin-loader.ts',
    'return plugin.invoke(input);',
  );
  assert.ok(invocationFindings.some((finding) => finding.rule === 'HOST_PLUGIN_OBJECT_CALL'));
});

test('安全合同和生产插件身份必须按终态规则扫描', () => {
  const securityFindings = scanPluginArchitectureSource(
    'backend/src/modules/agents/security/agent-security.contract.ts',
    "export const forbiddenAgentOperationTypes = ['command.execute'];",
  );
  assert.equal(securityFindings.some((finding) => finding.rule === 'FORBIDDEN_COMMAND_CONTRACT'), false);

  const historicalFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/builtin-plugins/agent-recipes.ts',
    "export const recipe = { pluginId: 'builtin.windows.iis.pfx' };",
  );
  assert.equal(historicalFindings.some((finding) => finding.rule === 'NON_CANONICAL_PLUGIN_BINDING'), true);
  const trustedJsFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/runtime/trusted-js-plugin-execution.service.ts',
    'const providerBaselines = new Map();',
  );
  assert.equal(trustedJsFindings.some((finding) => finding.rule === 'HOST_PROVIDER_BASELINE'), true);
  assert.equal(trustedJsFindings.every((finding) => finding.classification === 'PRODUCTION'), true);
});

test('唯一插件 Catalog、真实 Manifest 和未知 Plugin ID 都必须使用 Canonical ID', () => {
  const catalogFindings = scanPluginArchitectureSource(
    'scripts/architecture/p2-plugin-release-manifest.json',
    '{"pluginId":"builtin.windows.iis.pfx","version":"1.0.0","packageSha256":"sha256:test"}',
  );
  assert.equal(catalogFindings.some((finding) => finding.rule === 'NON_CANONICAL_PLUGIN_BINDING'), true);

  const manifestFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/builtin-plugins/windows-iis/manifest.json',
    '{"pluginId":"builtin.windows.iis.pfx"}',
  );
  assert.equal(manifestFindings.some((finding) => finding.rule === 'NON_CANONICAL_PLUGIN_BINDING'), true);

  const unknownCanonicalFindings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/application/plugin-binding.ts',
    "const binding = { pluginId: 'cloud.unknown' };",
  );
  assert.equal(unknownCanonicalFindings.some((finding) => finding.rule === 'NON_CANONICAL_PLUGIN_BINDING'), true);
});

test('Host API 禁止方法清单只在合同定义文件中声明，不应被业务动作守卫误报', () => {
  const registryPath = resolve(dirname(fileURLToPath(import.meta.url)), '../..', 'backend/src/modules/plugins/runner/protocol/host-api.registry.ts');
  const findings = scanPluginArchitectureSource(
    'backend/src/modules/plugins/runner/protocol/host-api.registry.ts',
    readFileSync(registryPath, 'utf8'),
  );
  assert.equal(findings.some((finding) => finding.rule === 'FORBIDDEN_COMMAND_CONTRACT'), false);
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

test('扫描不会跳过非测试 Fixture 和生产 JSON 资源', () => {
  const root = mkdtempSync(join(tmpdir(), 'gcac-plugin-architecture-'));
  mkdirSync(join(root, 'backend/src/modules/plugins/runner/fixtures'), { recursive: true });
  mkdirSync(join(root, 'backend/src/modules/licensing/resources'), { recursive: true });
  writeFileSync(join(root, 'backend/src/modules/plugins/runner/fixtures/runtime.ts'), 'plugin.instance.execute();\n', 'utf8');
  writeFileSync(join(root, 'backend/src/modules/licensing/resources/bad.json'), '{not-json', 'utf8');
  const findings = scanPluginArchitecture(root, ['backend/src']);
  assert.ok(findings.some((finding) => finding.rule === 'HOST_PLUGIN_OBJECT_CALL'));
  assert.ok(findings.some((finding) => finding.rule === 'JSON_CONTRACT_INVALID'));
  assert.equal(findings.find((finding) => finding.rule === 'HOST_PLUGIN_OBJECT_CALL')?.classification, 'PRODUCTION');
});

test('完整扫描根会遍历 Compatibility、legacy 目录、全部 Agent 根、脚本扩展和非测试 Fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'gcac-plugin-architecture-scope-'));
  const createFile = (path, content) => {
    const absolutePath = join(root, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf8');
  };
  mkdirSync(join(root, 'data/workflows'), { recursive: true });
  createFile('backend/src/host.ts', 'registry.register(new NginxProvider());\n');
  createFile('web/src/consumer.ts', "client.post('/api/v1/plugins/execute');\n");
  createFile('backend/src/modules/plugins/builtin-plugins/sample/runtime/index.js', 'process.env.SECRET;\n');
  createFile('backend/src/modules/workflow-templates/builtin-workflows/bad.json', '{not-json');
  createFile('backend/src/modules/plugins/runner/fixtures/runtime.ts', 'plugin.instance.execute();\n');
  createFile('backend/src/modules/licensing/resources/bad.json', '{not-json');
  createFile('backend/src/modules/legacy-agents/legacy.ts', "const oldContract = 'agent.atomic_plan.execute';\n");
  createFile('compatibility/legacy.json', '{"oldContract":"agent.atomic_plan.execute"}');
  createFile('agents/linux-go-full-agent/scripts/guard.sh', 'sh -c "$COMMAND"\n');
  createFile('agents/windows-go-full-agent/scripts/guard.ps1', '"command.execute"\n');
  createFile('agents/windows-go-full-agent/scripts/guard.cmd', '"command.execute"\r\n');
  createFile('agents/windows-go-full-agent/scripts/guard.bat', '"command.execute"\r\n');
  createFile('agents/windows-compat-full-agent/src/Guard.cs', 'class IisDeploymentHandler {}\n');
  createFile('agents/go-ca-node/main.go', 'package main\nimport "os/exec"\nvar command = exec.Command("openssl", "version")\n');
  createFile('agents/windows-go-ca-node/scripts/guard.ps1', 'powershell -Command "$COMMAND"\n');
  createFile('agents/linux-go-ca-node/main.go', 'package main\nimport "os/exec"\nvar command = exec.Command("openssl", "version")\n');
  createFile('agents/windows-adcs-agent/src/Guard.cs', 'class IisDeploymentHandler {}\n');

  const findings = scanPluginArchitecture(root, architectureScanRoots);
  const paths = new Set(findings.map((finding) => finding.path));
  for (const path of [
    'backend/src/host.ts',
    'web/src/consumer.ts',
    'backend/src/modules/plugins/builtin-plugins/sample/runtime/index.js',
    'backend/src/modules/workflow-templates/builtin-workflows/bad.json',
    'backend/src/modules/plugins/runner/fixtures/runtime.ts',
    'backend/src/modules/licensing/resources/bad.json',
    'backend/src/modules/legacy-agents/legacy.ts',
    'compatibility/legacy.json',
    'agents/linux-go-full-agent/scripts/guard.sh',
    'agents/windows-go-full-agent/scripts/guard.ps1',
    'agents/windows-go-full-agent/scripts/guard.cmd',
    'agents/windows-go-full-agent/scripts/guard.bat',
    'agents/windows-compat-full-agent/src/Guard.cs',
    'agents/go-ca-node/main.go',
    'agents/windows-go-ca-node/scripts/guard.ps1',
    'agents/linux-go-ca-node/main.go',
    'agents/windows-adcs-agent/src/Guard.cs',
  ]) assert.equal(paths.has(path), true, `未扫描文件：${path}`);
  assert.equal(findings.find((finding) => finding.path === 'backend/src/modules/plugins/runner/fixtures/runtime.ts')?.classification, 'PRODUCTION');
  assert.equal(findings.find((finding) => finding.path === 'backend/src/modules/legacy-agents/legacy.ts')?.classification, 'PRODUCTION');
  assert.equal(findings.find((finding) => finding.path === 'compatibility/legacy.json')?.classification, 'PRODUCTION');
  assert.equal(findings.find((finding) => finding.path === 'agents/go-ca-node/main.go')?.classification, 'PRODUCTION');
  assert.equal(findings.some((finding) => finding.path === 'compatibility/legacy.json' && finding.rule === 'AGENT_LEGACY_CONTRACT'), true);
  assert.equal(findings.some((finding) => finding.path === 'agents/go-ca-node/main.go' && finding.rule === 'AGENT_OPENSSL_USAGE'), true);
  assert.equal(findings.some((finding) => finding.path === 'agents/go-ca-node/main.go' && finding.rule === 'AGENT_PROCESS_EXECUTION'), true);
});

test('生产源码引用不存在的相对模块时必须报告，不能借测试路径放行', () => {
  const root = mkdtempSync(join(tmpdir(), 'gcac-plugin-architecture-missing-module-'));
  mkdirSync(join(root, 'backend/src'), { recursive: true });
  writeFileSync(join(root, 'backend/src/index.ts'), "export * from './schema/agent-deployment-plugins.schema.js';\n", 'utf8');
  const findings = scanPluginArchitecture(root, ['backend/src']);
  const missing = findings.find((finding) => finding.rule === 'MISSING_PRODUCTION_MODULE_REFERENCE');
  assert.ok(missing);
  assert.equal(missing.classification, 'PRODUCTION');
});

test('相对模块解析支持带点的无扩展模块名', () => {
  const root = mkdtempSync(join(tmpdir(), 'gcac-plugin-architecture-module-name-'));
  mkdirSync(join(root, 'backend/src/stores'), { recursive: true });
  mkdirSync(join(root, 'backend/src/components'), { recursive: true });
  writeFileSync(join(root, 'backend/src/stores/app.store.ts'), 'export const appStore = {};\n', 'utf8');
  writeFileSync(join(root, 'backend/src/components/GcPluginForm.types.ts'), 'export type PluginFormSchema = Record<string, unknown>;\n', 'utf8');
  writeFileSync(join(root, 'backend/src/components/GcPluginForm.vue'), '<script setup lang="ts">\nimport type { PluginFormSchema } from \'./GcPluginForm.types\';\nconst schema = {} as PluginFormSchema;\n</script>\n', 'utf8');
  writeFileSync(join(root, 'backend/src/components/Missing.vue'), '<script setup lang="ts">\nimport \'./missing.component\';\n</script>\n', 'utf8');
  writeFileSync(join(root, 'backend/src/index.ts'), "import './stores/app.store';\n", 'utf8');
  const findings = scanPluginArchitecture(root, ['backend/src']);
  assert.deepEqual(
    findings.filter((finding) => finding.rule === 'MISSING_PRODUCTION_MODULE_REFERENCE').map((finding) => finding.path),
    ['backend/src/components/Missing.vue'],
  );
});

test('零债务门禁拒绝任何临时债务条目', () => {
  assert.throws(
    () => compareWithDebt([], { version: 1, entries: [{ rule: 'X', path: 'a.ts', anchor: 'a', fingerprint: 'b', reason: '历史债务', ownerTask: 'T', removeWhen: '删除' }] }, true),
    /零债务检查失败/,
  );
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

test('默认仓库扫描不得通过 --scan-root 缩小范围，且 CLI 不输出堆栈', () => {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  assert.throws(() => scanPluginArchitecture(repositoryRoot, ['backend/src'], { enforceComplete: true }), /默认架构扫描不得缩小范围/);
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('./check-plugin-architecture.mjs', import.meta.url)),
    '--root', repositoryRoot,
    '--scan-root', 'backend/src',
    '--json',
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /默认架构扫描不得缩小范围/);
  assert.doesNotMatch(result.stderr, /^\s*at /m);
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

test('004.5 负 Fixture 覆盖宿主 Runner 边界、Provider signer 和直接插件调用', () => {
  const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/plugin-architecture/negative-host.ts');
  const source = readFileSync(fixturePath, 'utf8');
  const findings = scanPluginArchitectureSource('backend/src/modules/plugins/runtime/trusted-js-plugin-execution.service.ts', source);
  assert.deepEqual(
    [...new Set(findings.map((finding) => finding.rule))].sort(),
    ['HOST_PLUGIN_DYNAMIC_LOAD', 'HOST_PLUGIN_OBJECT_CALL', 'HOST_PROVIDER_BASELINE', 'HOST_PROVIDER_SIGNER', 'HOST_TRUSTED_JS_RUNTIME', 'HOST_VENDOR_DISPATCH'].sort(),
  );
});

test('004.5 负 Fixture 覆盖 Agent 旧合同、Shell、产品类名和开发密钥', () => {
  const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/plugin-architecture/negative-agent.go');
  const source = readFileSync(fixturePath, 'utf8');
  const findings = scanPluginArchitectureSource('agents/linux-go-full-agent/negative-agent.go', source);
  assert.deepEqual(
    [...new Set(findings.map((finding) => finding.rule))].sort(),
    ['AGENT_LEGACY_COMMAND_CONTRACT', 'AGENT_LEGACY_CONTRACT', 'AGENT_PRODUCT_IMPLEMENTATION', 'AGENT_SHELL_EXECUTION', 'DEFAULT_DEVELOPMENT_KEY', 'FORBIDDEN_COMMAND_CONTRACT'].sort(),
  );

  const caNodeFindings = scanPluginArchitectureSource(
    'agents/go-ca-node/main.go',
    'package main\nimport "os/exec"\nvar command = exec.Command("openssl", "version")\n',
  );
  assert.ok(caNodeFindings.some((finding) => finding.rule === 'AGENT_OPENSSL_USAGE'));
  assert.ok(caNodeFindings.some((finding) => finding.rule === 'AGENT_PROCESS_EXECUTION'));
  assert.equal(caNodeFindings.every((finding) => finding.classification === 'PRODUCTION'), true);
});

test('许可证生产源码不得包含开发信任根或 issuer 私钥', () => {
  const builtinDevFindings = scanPluginArchitectureSource(
    'backend/src/modules/licensing/resources/trust-key-bundle.json',
    '{"keys":[{"keyId":"builtin-dev-2026-08","publicKey":"MCowBQYDK2VwAyEAtest"}]}',
  );
  assert.ok(builtinDevFindings.some((finding) => finding.rule === 'DEFAULT_DEVELOPMENT_KEY'));
  assert.equal(builtinDevFindings.find((finding) => finding.rule === 'DEFAULT_DEVELOPMENT_KEY')?.classification, 'PRODUCTION');

  const legacyDevelopmentFindings = scanPluginArchitectureSource(
    'backend/src/modules/licensing/application/licensing.application-service.ts',
    "const keyId = 'gcac-development-issuer-key';",
  );
  assert.ok(legacyDevelopmentFindings.some((finding) => finding.rule === 'DEFAULT_DEVELOPMENT_KEY'));

  for (const value of ['default-key', 'default-secret', 'change-me', 'dev-key', 'test-key', 'development-key']) {
    const findings = scanPluginArchitectureSource(
      'backend/src/modules/licensing/application/trust-root.ts',
      `const keyId = '${value}';`,
    );
    assert.ok(findings.some((finding) => finding.rule === 'DEFAULT_DEVELOPMENT_KEY'), `未识别默认密钥：${value}`);
  }

  for (const source of [
    "const licenseKey = 'default';",
    "const DEFAULT_LICENSE_KEY = 'change-me';",
    "const trustRoot = 'development-key';",
  ]) {
    const findings = scanPluginArchitectureSource(
      'backend/src/modules/licensing/application/trust-root.ts',
      source,
    );
    assert.ok(findings.some((finding) => finding.rule === 'DEFAULT_DEVELOPMENT_KEY'), `未识别语义密钥字段：${source}`);
  }

  const rejectionFindings = scanPluginArchitectureSource(
    'backend/src/modules/agents/security/policy-authority.service.ts',
    "function reject(value) { return /(?:default|development|dev-key)/i.test(value); }",
  );
  assert.equal(rejectionFindings.some((finding) => finding.rule === 'DEFAULT_DEVELOPMENT_KEY'), false);

  const ordinaryConfigurationFindings = scanPluginArchitectureSource(
    'web/src/views/providers/ProviderEditor.vue',
    [
      "const placeholderKey = 'placeholder';",
      "const field = { key: 'default', label: 'default' };",
      "if (value.includes('CHANGE_ME')) return false;",
    ].join('\n'),
  );
  assert.equal(ordinaryConfigurationFindings.some((finding) => finding.rule === 'DEFAULT_DEVELOPMENT_KEY'), false);

  const privateKeyFindings = scanPluginArchitectureSource(
    'backend/src/modules/licensing/resources/issuer-key.json',
    '{"keyId":"release-2026-08","privateKey":"not-source-material"}',
  );
  assert.ok(privateKeyFindings.some((finding) => finding.rule === 'ISSUER_PRIVATE_KEY_IN_SOURCE'));
  assert.equal(privateKeyFindings.find((finding) => finding.rule === 'ISSUER_PRIVATE_KEY_IN_SOURCE')?.classification, 'PRODUCTION');

  const testFixtureFindings = scanPluginArchitectureSource(
    'backend/src/modules/licensing/licensing.test.ts',
    "const keyId = 'builtin-dev-should-only-exist-in-a-test-fixture';",
  );
  assert.deepEqual(testFixtureFindings, []);

  const applicationPath = resolve(dirname(fileURLToPath(import.meta.url)), '../..', 'backend/src/modules/licensing/application/licensing.application-service.ts');
  const applicationFindings = scanPluginArchitectureSource(
    'backend/src/modules/licensing/application/licensing.application-service.ts',
    readFileSync(applicationPath, 'utf8'),
  );
  assert.equal(applicationFindings.some((finding) => finding.rule === 'DEFAULT_DEVELOPMENT_KEY'), false);
  assert.equal(applicationFindings.some((finding) => finding.rule === 'ISSUER_PRIVATE_KEY_IN_SOURCE'), false);
});

test('安全合同负面 Fixture 中的默认 key 只作为测试输入，不得形成生产债务', () => {
  const fixturePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../..',
    'backend/src/modules/agents/security/fixtures/agent-security.invalid.json',
  );
  const fixtureFindings = scanPluginArchitectureSource(
    'backend/src/modules/agents/security/fixtures/agent-security.invalid.json',
    readFileSync(fixturePath, 'utf8'),
  );
  assert.deepEqual(fixtureFindings, []);

  const productionFindings = scanPluginArchitectureSource(
    'backend/src/modules/agents/security/policy-authority-key.json',
    '{"keyId":"default-development-key"}',
  );
  assert.equal(productionFindings.some((finding) => finding.rule === 'DEFAULT_DEVELOPMENT_KEY'), true);
});

test('issuer 私钥生成文件必须保持 Git 忽略且不属于源码扫描根', () => {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const issuerKeyPath = 'data/license-generator/keys/issuer-key.json';
  const ignored = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd: repositoryRoot,
    input: `${issuerKeyPath}\n`,
    encoding: 'utf8',
  });
  assert.equal(ignored.status, 0, `issuer 私钥未被 .gitignore 忽略：${ignored.stderr}`);
  assert.match(ignored.stdout, /data/);

  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', issuerKeyPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.notEqual(tracked.status, 0, 'issuer 私钥不得进入 Git 索引');
  assert.equal(architectureScanRoots.includes('data/license-generator'), false);
});

test('004.5 负 Fixture 覆盖插件直接访问宿主和裸 Workflow DSL', () => {
  const pluginPath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/plugin-architecture/negative-plugin.js');
  const pluginFindings = scanPluginArchitectureSource('backend/src/modules/plugins/builtin-plugins/test/runtime/index.js', readFileSync(pluginPath, 'utf8'));
  assert.ok(pluginFindings.some((finding) => finding.rule === 'PLUGIN_DIRECT_HOST_ACCESS'));
  assert.ok(pluginFindings.some((finding) => finding.rule === 'PLUGIN_DIRECT_HOST_SERVICE'));

  const workflowPath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/plugin-architecture/negative-workflow.json');
  const workflowFindings = scanPluginArchitectureSource('backend/src/modules/workflow-templates/builtin-workflows/negative.json', readFileSync(workflowPath, 'utf8'));
  assert.ok(workflowFindings.some((finding) => finding.rule === 'WORKFLOW_RAW_SCRIPT'));
  assert.ok(workflowFindings.some((finding) => finding.rule === 'WORKFLOW_PRODUCT_STEP'));
  assert.ok(workflowFindings.some((finding) => finding.rule === 'WORKFLOW_PRODUCT_TEMPLATE'));
});

test('004.5 正 Fixture 允许 IPC Runner、Canonical ID 和受控 allowlisted 合同', () => {
  const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/plugin-architecture/positive-runner.ts');
  const findings = scanPluginArchitectureSource('backend/src/modules/plugins/runner/positive-runner.ts', readFileSync(fixturePath, 'utf8'));
  assert.deepEqual(findings, []);
});

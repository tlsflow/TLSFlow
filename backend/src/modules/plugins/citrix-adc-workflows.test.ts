import assert from 'node:assert/strict';
import test from 'node:test';
import { BuiltinUnifiedPluginLoader as BaseBuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';
import { WorkflowTemplatesApplicationService } from '../workflow-templates/application/workflow-templates.application-service.js';
import { DeviceDiscoverySchemaService } from './discovery/device-discovery-schema.service.js';
import type { WorkflowMockStepOutput } from '../workflow-templates/dto/workflow-templates.dto.js';
import { enrichWorkflowCertificateMaterial } from '../certificates/artifacts/workflow-certificate-material.js';
import { createHash } from 'node:crypto';
import type { ResolvedDeploymentInputV1 } from '../deployment-inputs/dto/resolved-deployment-input.dto.js';
import { workflowTemplatesSchemaRegistry } from '../workflow-templates/schema/workflow-templates.schema.js';
import { ProductionDeploymentInputResolverService } from '../deployment-inputs/application/production-deployment-input-resolver.service.js';
import { emptyInputBindingsV1 } from '../deployment-inputs/dto/input-bindings.dto.js';
import { evaluatePluginCompatibility } from './capabilities/plugin-compatibility.evaluator.js';
import type { UnifiedPluginManifestV1 } from './dto/unified-plugins.dto.js';
import { createWorkflowStepDispatcher } from '../workflow-templates/application/workflow-step-dispatcher.js';
import { CurlExecutor } from '../executors/curl/curl.executor.js';
import type { CurlHttpClient } from '../executors/curl/curl.http-client.js';
import type { CurlSecretResolver, CurlSecretResolverContext } from '../executors/curl/curl.secret-resolver.js';
import type { ExecutionGrantService } from '../executions/execution-grant.service.js';
import type { ExecutionGrantEntity } from '../../persistence/entities/execution-grant.entity.js';

const DERIVED_CERTKEY_NAME = 'gcac-aaaaaaaaaaaaaaaa';
const ACTUAL_EXISTING_CERTKEY_NAME = 'gcac-5579902569';

/** 此文件的全部用例只验证 Citrix 包，不能依赖内置插件目录的排序。 */
class BuiltinUnifiedPluginLoader extends BaseBuiltinUnifiedPluginLoader {
  override async loadPackages() {
    const packages = await super.loadPackages();
    const citrixPackage = packages.find((item) => (item.manifest as UnifiedPluginManifestV1).pluginId === 'device.citrix.netscaler-adc');
    assert.ok(citrixPackage, '未找到 Citrix ADC 内置插件包');
    return [citrixPackage];
  }
}

function resolvedWorkflowInput(
  variables: Record<string, unknown> = {},
  connection: { port?: number; tlsVerify?: boolean } = {},
): ResolvedDeploymentInputV1 {
  const credential = variables.credential ?? fixtureCredential();
  const certificate = variables.certificate;
  const resolvedVariables = { ...variables };
  delete resolvedVariables.credential;
  delete resolvedVariables.certificate;
  return {
    apiVersion: 'gcac.resolved-deployment-input/v1',
    contractVersion: 'gcac.deployment-input/v1',
    assetContext: {
      apiVersion: 'gcac.deployment-asset-context/v1',
      application: { id: 'asset_citrix_test', address: '10.0.0.1', serverName: 'adc.example.com', port: 443, protocol: 'https' },
      deployment: { targets: [], certificateResourceName: 'certificate-adc-example-com' },
    },
    variables: resolvedVariables,
    connections: {
      management: {
        transport: 'http',
        host: '10.0.0.1',
        port: connection.port ?? 443,
        credentialSlot: 'credential',
        tls: { verifyPeer: connection.tlsVerify ?? false },
      },
    },
    credentials: { credential: credential as ResolvedDeploymentInputV1['credentials'][string] },
    artifacts: certificate ? { certificate: { outputs: certificate as Record<string, unknown> } } : {},
    provenance: {},
    sensitivePaths: [],
    issues: [],
    executable: true,
    resolvedSha256: 'citrix-test-resolved-input',
  };
}

function fixtureCredential() {
  return {
    credentialId: 'cred_fixture',
    kind: 'USERNAME_PASSWORD',
    username: 'fixture',
    secretRefs: { password: 'secret://password/fixture-secret#v1' },
  };
}

test('Citrix ADC 所有 Workflow 只声明统一部署输入协议', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const workflowResources = Object.entries(pluginPackage.resources).filter(([resourcePath]) => resourcePath.startsWith('workflows/'));

  for (const [resourcePath, resourceContent] of workflowResources) {
    const workflow = JSON.parse(resourceContent) as Record<string, any>;
    if (resourcePath === 'workflows/certificate-deploy.json') {
      assert.equal(resourceContent.match(/^\s*"rollback"\s*:/gm)?.length ?? 0, 1, `${resourcePath} 只能声明一个顶层 rollback`);
    }
    assert.equal(workflow.variables, undefined, `${resourcePath} 不得保留顶层旧 variables`);
    assert.equal(workflow.inputContract?.apiVersion, 'gcac.deployment-input/v1');
    assert.deepEqual(Object.keys(workflow.inputContract?.connections ?? {}), ['management']);
    assert.deepEqual(Object.keys(workflow.inputContract?.credentials ?? {}), ['credential']);
    assertHttpRequestsUseConnectionRef(workflow.steps ?? [], resourcePath);
    assertHttpRequestsUseConnectionRef(workflow.rollback ?? [], resourcePath);
  }

  const deploy = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  assert.deepEqual(deploy.inputContract.variables.targetVirtualServers.source, { kind: 'asset', path: 'deployment.targets' });
  assert.deepEqual(deploy.inputContract.variables.certificateKeyName.source, { kind: 'derived', resolver: 'certificate_resource_name' });
  assert.equal(deploy.inputContract.variables.allowInsecureTls.type, 'boolean');
  assert.equal(deploy.inputContract.variables.allowInsecureTls.required, true);
  assert.equal(deploy.inputContract.variables.allowInsecureTls.configurationMode, 'required');
  assert.deepEqual(deploy.inputContract.variables.allowInsecureTls.source, { kind: 'binding' });
  assert.equal(deploy.inputContract.variables.allowInsecureTls.lifecycle, 'pre_execution');
  assert.equal(deploy.inputContract.variables.allowInsecureTls.bindingPolicy, 'required_binding');
  assert.equal(deploy.inputContract.variables.allowInsecureTls.descriptionKey, 'deploymentInputs.allowInsecureTls.description');
  assert.deepEqual(deploy.inputContract.variables.allowInsecureTls.ui, {
    labelKey: 'deploymentInputs.allowInsecureTls.label',
    group: 'security',
    order: 10,
    helpKey: 'deploymentInputs.allowInsecureTls.help',
  });
  assert.deepEqual(Object.keys(deploy.inputContract.artifacts), ['certificate']);
  assert.equal(JSON.stringify(deploy).includes('deviceHost'), false);
  assert.equal(JSON.stringify(deploy).includes('managementPort'), false);
});

test('Workflow Schema 拒绝顶层旧 variables 和 connections', () => {
  const content = {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'legacy-inputs', displayName: 'legacy inputs' },
    inputContract: { apiVersion: 'gcac.deployment-input/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} },
    steps: [{ name: 'wait', type: 'wait', stage: 'prepare', seconds: 1 }],
  };
  for (const field of ['variables', 'connections']) {
    let error: any;
    try {
      workflowTemplatesSchemaRegistry.validate({ ...content, [field]: {} });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error);
    assert.equal(error.errorCode, 'VALIDATION_FAILED');
    assert.equal(error.details?.field, field);
  }
});

function assertHttpRequestsUseConnectionRef(steps: Array<Record<string, any>>, resourcePath: string): void {
  for (const step of steps) {
    if (step.type === 'http') assert.equal(step.request?.connectionRef, 'management', `${resourcePath}:${step.name}`);
    if (step.type === 'foreach') assertHttpRequestsUseConnectionRef(step.foreach?.steps ?? [], resourcePath);
  }
}

test('Citrix ADC 展示结构使用统一详情路径且标签页包含列定义', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const presentation = JSON.parse(pluginPackage.resources['presentations/device.json']!) as {
    resourceLabels: { frameworks: Array<{ frameworkType: string }>; sites: Array<{ frameworkType: string; groupKey: string }> };
    overview: Array<{ fields: Array<{ valuePath: string }> }>;
    tabs: Array<{ id: string; columns: unknown[] }>;
    actions: Array<{ capabilityKey: string }>;
  };
  assert.deepEqual(presentation.overview[0]?.fields.map((field) => field.valuePath), [
    'productFamily',
    'softwareVersion',
    'extensionSummary.softwareBuild',
    'extensionSummary.discoveryMetadata.managementProtocol',
    'extensionSummary.pluginVersion',
    'health',
  ]);
  assert.equal(presentation.tabs.some((tab) => tab.id === 'frameworks'), false);
  assert.equal(presentation.tabs.every((tab) => tab.columns.length > 0), true);
  assert.deepEqual(presentation.resourceLabels.frameworks.map((item) => item.frameworkType), [
    'citrix.lb-server', 'citrix.vpn-server', 'citrix.cs-server', 'citrix.gslb-server',
  ]);
  assert.deepEqual(presentation.resourceLabels.sites.map((item) => item.groupKey), [
    'citrix.lb-server', 'citrix.vpn-server', 'citrix.cs-server', 'citrix.gslb-server',
  ]);
  assert.deepEqual(presentation.actions.map((item) => item.capabilityKey), ['device.discover']);
});

test('Citrix ADC Manifest 产品族与 LB Server 发现目标兼容', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())
    .find((item) => (item.manifest as UnifiedPluginManifestV1).pluginId === 'device.citrix.netscaler-adc');
  assert.ok(pluginPackage);
  const manifest = pluginPackage.manifest as UnifiedPluginManifestV1;
  assert.deepEqual(manifest.compatibility?.productFamilies, ['citrix.netscaler-adc']);

  const compatibility = evaluatePluginCompatibility(manifest, {
    productFamily: 'citrix.netscaler-adc',
    frameworkType: 'citrix.lb-server',
    targetType: 'tls.binding',
    managementMethod: 'PLUGIN',
    executionLocation: 'CONTROL_PLANE',
    artifactContract: 'certificate.deploy.v1',
  });
  assert.equal(compatibility.compatible, true, JSON.stringify(compatibility.reasons));
});

test('Citrix ADC 连接测试识别版本且不泄漏认证值', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/connection-test.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(),
    mockResponses: { readVersion: { statusCode: 200, body: { errorcode: 0, nsversion: { version: 'NetScaler NS13.1: Build 55.29.nc' } } } },
  });
  assert.equal(result.status, 'success');
  assert.equal(result.stepResults[0]?.extracted.productVersion, 'NetScaler NS13.1: Build 55.29.nc');
  assert.equal(JSON.stringify(result).includes('fixture-only'), false);
});

test('Citrix ADC 连接测试真实执行：HTTP 200 且 errorcode=0 时成功，请求来自统一部署输入', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/connection-test.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });

  const requests: Array<{ url: string; method: string; headers: Record<string, string>; tlsVerify: boolean }> = [];
  const secretCalls: Array<{ ref: string; purpose: string; tenantId?: string }> = [];
  const httpClient: CurlHttpClient = {
    async send(input) {
      requests.push({
        url: input.url,
        method: input.method,
        headers: input.headers,
        tlsVerify: input.tls?.verify !== false,
      });
      return { statusCode: 200, body: { errorcode: 0, nsversion: { version: 'NetScaler NS13.1: Build 55.29.nc' } } };
    },
  };
  const secretResolver: CurlSecretResolver = {
    async resolveSecret(ref: string, purpose: string, context: CurlSecretResolverContext = {}) {
      secretCalls.push({ ref, purpose, tenantId: context.tenantId });
      return 'fixture-only-password';
    },
  };
  const dispatcher = createWorkflowStepDispatcher({ curlExecutor: new CurlExecutor({ httpClient, secretResolver }) });

  const result = await workflows.runWithDispatcher({
    templateVersionId: version.id,
    mode: 'real_test',
    resolvedInput: resolvedWorkflowInput({}, { port: 8443, tlsVerify: true }),
    tenantId: 'tenant-citrix-real',
  }, dispatcher);

  assert.equal(result.status, 'success');
  assert.equal(result.stepResults[0]?.extracted.productVersion, 'NetScaler NS13.1: Build 55.29.nc');
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'https://10.0.0.1:8443/nitro/v1/config/nsversion');
  assert.equal(requests[0]?.method, 'GET');
  assert.equal(requests[0]?.headers['Accept'], 'application/json');
  assert.equal(requests[0]?.headers['X-NITRO-USER'], 'fixture');
  assert.equal(requests[0]?.headers['X-NITRO-PASS'], 'fixture-only-password');
  assert.equal(requests[0]?.tlsVerify, true);
  assert.deepEqual(secretCalls, [{ ref: 'secret://password/fixture-secret#v1', purpose: 'http.header', tenantId: 'tenant-citrix-real' }]);
  assert.equal(JSON.stringify(result).includes('fixture-only-password'), false);
});

test('Citrix ADC 连接测试真实执行：HTTP 非 200 时失败并报告真实状态错误', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/connection-test.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });

  const httpClient: CurlHttpClient = {
    async send() {
      return { statusCode: 500, body: { errorcode: 0 } };
    },
  };
  const secretResolver: CurlSecretResolver = { async resolveSecret() { return 'fixture-only-password'; } };
  const dispatcher = createWorkflowStepDispatcher({ curlExecutor: new CurlExecutor({ httpClient, secretResolver }) });

  const result = await workflows.runWithDispatcher({
    templateVersionId: version.id,
    mode: 'real_test',
    resolvedInput: resolvedWorkflowInput({}, { tlsVerify: true }),
    tenantId: 'tenant-citrix-real',
  }, dispatcher);

  assert.equal(result.status, 'failed');
  assert.equal(result.stepResults[0]?.status, 'failed');
  assert.equal(result.stepResults[0]?.errorCode, 'HTTP_NON_SUCCESS_STATUS');
  assert.match(result.stepResults[0]?.errorMessage ?? '', /未满足成功策略/);
  assert.match(result.stepResults[0]?.logs.join('\n') ?? '', /response:status:500/);
});

test('Citrix ADC 连接测试真实执行：errorcode != 0 时失败并报告 Citrix 错误', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/connection-test.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });

  const httpClient: CurlHttpClient = {
    async send() {
      return { statusCode: 200, body: { errorcode: 7, message: 'NITRO authentication failed', nsversion: { version: 'NetScaler NS13.1: Build 55.29.nc' } } };
    },
  };
  const secretResolver: CurlSecretResolver = { async resolveSecret() { return 'fixture-only-password'; } };
  const dispatcher = createWorkflowStepDispatcher({ curlExecutor: new CurlExecutor({ httpClient, secretResolver }) });

  const result = await workflows.runWithDispatcher({
    templateVersionId: version.id,
    mode: 'real_test',
    resolvedInput: resolvedWorkflowInput({}, { tlsVerify: true }),
    tenantId: 'tenant-citrix-real',
  }, dispatcher);

  assert.equal(result.status, 'failed');
  assert.equal(result.stepResults[0]?.status, 'failed');
  assert.equal(result.stepResults[0]?.errorCode, 'WORKFLOW_ASSERTION_FAILED');
  assert.match(result.stepResults[0]?.errorMessage ?? '', /errorcode/);
  assert.equal(result.stepResults[0]?.extracted.nitroErrorCode, 7);
  assert.match(result.stepResults[0]?.logs.join('\n') ?? '', /response:nitroErrorCode:7/);
  assert.match(result.stepResults[0]?.logs.join('\n') ?? '', /assertion:jsonPath:failed/);
});

test('Citrix ADC 连接测试真实执行：设备关闭 TLS 校验时按 ExecutionGrant 授权链放行，缺失宿主授权时失败关闭', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/connection-test.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });

  const grantStore = new InMemoryCitrixExecutionGrantService();
  const grants = grantStore as unknown as ExecutionGrantService;
  let tlsVerify = true;
  const httpClient: CurlHttpClient = {
    async send(input) {
      tlsVerify = input.tls?.verify !== false;
      return { statusCode: 200, body: { errorcode: 0, nsversion: { version: 'NetScaler NS13.1: Build 55.29.nc' } } };
    },
  };
  const secretResolver: CurlSecretResolver = { async resolveSecret() { return 'fixture-only-password'; } };

  // 授权条件齐备：宿主签发 Grant 后允许 TLS 例外。
  const authorizedDispatcher = createWorkflowStepDispatcher({ curlExecutor: new CurlExecutor({ httpClient, secretResolver, executionGrantService: grants }), executionGrantService: grants });
  const authorized = await workflows.runWithDispatcher({
    templateVersionId: version.id,
    mode: 'real_test',
    resolvedInput: resolvedWorkflowInput({}, { tlsVerify: false }),
    tenantId: 'tenant-citrix-tls',
  }, authorizedDispatcher);
  assert.equal(authorized.status, 'success');
  assert.equal(tlsVerify, false);
  assert.equal(grantStore.createdCount(), 1);
  assert.equal(grantStore.activeCount(), 0, '执行结束后 Grant 必须立即撤销');

  // 宿主未装配 Grant 服务：失败关闭，不静默放行。
  const deniedDispatcher = createWorkflowStepDispatcher({ curlExecutor: new CurlExecutor({ httpClient, secretResolver }) });
  const denied = await workflows.runWithDispatcher({
    templateVersionId: version.id,
    mode: 'real_test',
    resolvedInput: resolvedWorkflowInput({}, { tlsVerify: false }),
    tenantId: 'tenant-citrix-tls',
  }, deniedDispatcher);
  assert.equal(denied.status, 'failed');
  assert.equal(denied.stepResults[0]?.errorCode, 'VALIDATION_FAILED');
  assert.match(denied.stepResults[0]?.errorMessage ?? '', /allowInsecureTls/);
});

test('Citrix ADC 13.1 脱敏 Fixture 生成标准发现对象', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/discover.json']!);
  const fixture = JSON.parse(pluginPackage.resources['discovery/nitro-13.1.json']!) as { mockResponses: Record<string, WorkflowMockStepOutput> };
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(),
    mockResponses: fixture.mockResponses,
  });
  const discovery = result.stepResults.at(-1)?.extracted.discovery;
  const validated = new DeviceDiscoverySchemaService().validate(discovery);
  assert.equal(validated.device.productFamily, 'citrix.netscaler-adc');
  assert.deepEqual(validated.frameworks, [
    { stableKey: 'framework:lbserver', frameworkType: 'citrix.lb-server', displayName: 'LBServer' },
    { stableKey: 'framework:vpnserver', frameworkType: 'citrix.vpn-server', displayName: 'VPNServer' },
    { stableKey: 'framework:csserver', frameworkType: 'citrix.cs-server', displayName: 'CSServer' },
    { stableKey: 'framework:gslbserver', frameworkType: 'citrix.gslb-server', displayName: 'GSLBServer' },
  ]);
  assert.equal(validated.device.metadata?.managementProtocol, 'NITRO API');
  assert.deepEqual(validated.sites.map((site) => site.stableKey), ['LB:lb-one', 'VPN:vpn-one', 'CS:cs-one', 'GSLB:gslb-one']);
  assert.deepEqual(validated.sites.map((site) => site.frameworkStableKey), [
    'framework:lbserver',
    'framework:vpnserver',
    'framework:csserver',
    'framework:gslbserver',
  ]);
  assert.deepEqual(validated.managedTargets.map((target) => target.frameworkStableKey), [
    'framework:lbserver',
    'framework:vpnserver',
    'framework:csserver',
    'framework:gslbserver',
  ]);
  assert.equal(validated.certificates[0]?.stableKey, 'CERT:leaf-one');
  assert.equal(validated.certificates[0]?.sha256Fingerprint, '7ba6becd05012d4dc445954692203028e5042f2f13949ccf9acd4f7a5b2d293d');
  assert.equal(validated.certificates[0]?.notBefore, '2026-01-01T00:00:00Z');
  assert.equal(validated.certificates[0]?.notAfter, '2027-01-01T00:00:00Z');
  assert.deepEqual(validated.certificateBindings.map((binding) => binding.managedTargetStableKey), ['TARGET:LB:lb-one', 'TARGET:VPN:vpn-one', 'TARGET:CS:cs-one', 'TARGET:GSLB:gslb-one']);
  assert.equal(JSON.stringify(result).includes('fixture-only'), false);
});

test('Citrix ADC 发现对零个和单个站点始终输出数组', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/discover.json']!);
  const fixture = JSON.parse(pluginPackage.resources['discovery/nitro-13.1.json']!) as { mockResponses: Record<string, WorkflowMockStepOutput> };
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const run = async (lbvserver: Array<Record<string, unknown>>) => {
    const mockResponses = structuredClone(fixture.mockResponses);
    mockResponses.readLbVirtualServers = { statusCode: 200, body: { errorcode: 0, lbvserver } };
    mockResponses.readVpnVirtualServers = { statusCode: 200, body: { errorcode: 0, vpnvserver: [] } };
    mockResponses.readCsVirtualServers = { statusCode: 200, body: { errorcode: 0, csvserver: [] } };
    mockResponses.readGslbVirtualServers = { statusCode: 200, body: { errorcode: 0, gslbvserver: [] } };
    mockResponses.readCertificateBindings = { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [] } };
    mockResponses.readCertificates = { statusCode: 200, body: { errorcode: 0, sslcertkey: [] } };
    const result = await workflows.testRun({
      templateVersionId: version.id,
      mode: 'mock',
      resolvedInput: resolvedWorkflowInput(),
      mockResponses,
    });
    return new DeviceDiscoverySchemaService().validate(result.stepResults.at(-1)?.extracted.discovery);
  };

  const empty = await run([]);
  assert.deepEqual(empty.sites, []);
  assert.deepEqual(empty.frameworks, []);
  const single = await run([{ name: 'lb-one', servicetype: 'SSL', ipv46: '10.0.0.41', port: 443 }]);
  assert.equal(Array.isArray(single.sites), true);
  assert.deepEqual(single.sites.map((site) => site.stableKey), ['LB:lb-one']);
  assert.deepEqual(single.frameworks, [
    { stableKey: 'framework:lbserver', frameworkType: 'citrix.lb-server', displayName: 'LBServer' },
  ]);
});

test('Citrix ADC 发现为包含特殊字符的厂商名称生成合法稳定键', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/discover.json']!);
  const fixture = JSON.parse(pluginPackage.resources['discovery/nitro-13.1.json']!) as { mockResponses: Record<string, WorkflowMockStepOutput> };
  const mockResponses = structuredClone(fixture.mockResponses);
  mockResponses.readLbVirtualServers = { statusCode: 200, body: { errorcode: 0, lbvserver: [{ name: '门户 站点(*)', servicetype: 'SSL', ipv46: '10.0.0.41', port: 443 }] } };
  mockResponses.readVpnVirtualServers = { statusCode: 200, body: { errorcode: 0, vpnvserver: [] } };
  mockResponses.readCsVirtualServers = { statusCode: 200, body: { errorcode: 0, csvserver: [] } };
  mockResponses.readGslbVirtualServers = { statusCode: 200, body: { errorcode: 0, gslbvserver: [] } };
  mockResponses.readCertificates = { statusCode: 200, body: { errorcode: 0, sslcertkey: [{ certkey: '新证书 2026(*).pem', subject: 'CN=example.invalid', issuer: 'CN=Fixture Issuer', clientcertnotbefore: '2026-01-01T00:00:00Z', clientcertnotafter: '2027-01-01T00:00:00Z' }] } };
  mockResponses.readCertificateBindings = { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [{ vservername: '门户 站点(*)', certkeyname: '新证书 2026(*).pem', snicert: false }] } };
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(),
    mockResponses,
  });
  const validated = new DeviceDiscoverySchemaService().validate(result.stepResults.at(-1)?.extracted.discovery);
  const stableKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
  assert.match(validated.sites[0]!.stableKey, stableKeyPattern);
  assert.match(validated.certificates[0]!.stableKey, stableKeyPattern);
  assert.match(validated.certificateBindings[0]!.stableKey, stableKeyPattern);
  assert.equal(validated.certificateBindings[0]!.managedTargetStableKey, validated.managedTargets[0]!.stableKey);
  assert.equal(validated.certificateBindings[0]!.certificateStableKey, validated.certificates[0]!.stableKey);
});

test('统一证书材料生成 Base64 和有序中间证书数组', () => {
  const material = enrichWorkflowCertificateMaterial({
    certificateVersionId: 'cert-version-1',
    certificateFormatId: 'format-1',
    fingerprintSha256: 'AA:BB',
    files: [
      { key: 'public', role: 'public_certificate', content: 'LEAF\n' },
      { key: 'private', role: 'private_key', content: 'PRIVATE\n' },
      { key: 'chain', role: 'certificate_chain', content: '-----BEGIN CERTIFICATE-----\nONE\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\nTWO\n-----END CERTIFICATE-----\n' },
    ],
  });
  assert.equal(material.leafPemBase64, Buffer.from('LEAF\n').toString('base64'));
  assert.equal(material.privateKeyPemBase64, Buffer.from('PRIVATE\n').toString('base64'));
  assert.deepEqual((material.orderedIntermediates as Array<Record<string, unknown>>).map((item) => ({ sequence: item.sequence, nextSequence: item.nextSequence, hasNext: item.hasNext })), [
    { sequence: 1, nextSequence: 2, hasNext: true },
    { sequence: 2, nextSequence: undefined, hasNext: false },
  ]);
  assert.equal(material.fingerprintSha256, 'aabb');
  assert.equal(Object.hasOwn(material.deploymentMetadata as object, 'password'), false);
});

test('统一证书材料可从 fullchain 派生叶子证书和有序中间链', () => {
  const leaf = '-----BEGIN CERTIFICATE-----\nLEAF\n-----END CERTIFICATE-----\n';
  const intermediate = '-----BEGIN CERTIFICATE-----\nINTERMEDIATE\n-----END CERTIFICATE-----\n';
  const material = enrichWorkflowCertificateMaterial({
    certificateVersionId: 'cert-version-fullchain',
    certificateFormatId: 'format-fullchain',
    files: [
      { key: 'fullchain', role: 'public_certificate', content: `${leaf}${intermediate}` },
      { key: 'private', role: 'private_key', content: 'PRIVATE\n' },
    ],
  });

  assert.equal(material.leafPem, leaf);
  assert.equal(material.certificatePem, `${leaf}${intermediate}`);
  assert.equal(material.pem, `${leaf}${intermediate}`);
  assert.equal(material.orderedChainPem, intermediate);
  assert.deepEqual((material.orderedIntermediates as Array<Record<string, unknown>>).map((item) => item.pem), [intermediate]);
});

test('统一证书材料保留显式 fullchain，不能被 public 叶子证书覆盖', () => {
  const leaf = '-----BEGIN CERTIFICATE-----\nLEAF\n-----END CERTIFICATE-----\n';
  const intermediate = '-----BEGIN CERTIFICATE-----\nINTERMEDIATE\n-----END CERTIFICATE-----\n';
  const fullchain = `${leaf}${intermediate}`;
  const material = enrichWorkflowCertificateMaterial({
    certificateVersionId: 'cert-version-nginx',
    certificateFormatId: 'format-nginx',
    certificatePem: fullchain,
    files: [
      { key: 'public', role: 'public_certificate', content: leaf },
      { key: 'fullchain', role: 'public_certificate', content: fullchain },
      { key: 'chain', role: 'certificate_chain', content: intermediate },
    ],
  });

  assert.equal(material.leafPem, leaf);
  assert.equal(material.certificatePem, fullchain);
  assert.equal(material.pem, fullchain);
  assert.equal(material.pemBase64, Buffer.from(fullchain).toString('base64'));
  assert.equal(material.orderedChainPem, intermediate);
});

test('Citrix ADC 部署先验证新绑定再解绑旧证书，全部写操作后才保存', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(deploymentVariables()),
    mockResponses: deploymentResponses(),
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(result.stepResults.map((item) => item.name).slice(-6), [
    'bindTargets', 'prepareOldBindingRemoval', 'selectOldBindingsToRemove', 'removeOldBindings', 'saveConfiguration', 'verifyCertificateControlPlane',
  ]);
  const remove = result.stepResults.find((item) => item.name === 'removeOldBindings')?.children?.[0];
  assert.match(JSON.stringify(remove?.plan), /args=certkeyname:old-cert/);
  assert.equal(JSON.stringify(result).includes('fixture-only'), false);
});

test('Citrix ADC Dry-run 对运行时发现结果延迟展开 foreach', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'render_only',
    resolvedInput: resolvedWorkflowInput(deploymentVariables()),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.plannedOnly, true);
  assert.match(result.stepResults.find((item) => item.name === 'readOldCertKeys')?.logs[0] ?? '', /:deferred:/);
  assert.equal((result.stepResults.find((item) => item.name === 'deploymentCheckpoint')?.plan as { deferred?: boolean }).deferred, true);
  assert.match(result.stepResults.find((item) => item.name === 'removeOldBindings')?.logs[0] ?? '', /:deferred:/);
  assert.equal((result.stepResults.find((item) => item.name === 'installIntermediates')?.plan as { itemCount?: number }).itemCount, 2);
});

test('Citrix ADC 部署目标缺少 SNI 元数据时默认 false，并继承已有 SNI 绑定', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const variables = deploymentVariables();
  variables.targetVirtualServers = [
    { name: 'lb-default', metadata: {} },
    { name: 'lb-sni', metadata: {} },
  ];
  const responses = deploymentResponses();
  responses.readOldBindings = {
    statusCode: 200,
    body: {
      errorcode: 0,
      sslvserver_sslcertkey_binding: [
        { vservername: 'lb-default', certkeyname: 'old-default', snicert: false },
        { vservername: 'lb-sni', certkeyname: 'old-sni', snicert: true },
      ],
    },
  };

  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(variables),
    mockResponses: responses,
  });

  const targets = result.stepResults.find((item) => item.name === 'selectLiveBindings')?.extracted.deploymentTargets as Array<{ name: string; metadata: { sniCertificate: boolean } }>;
  assert.deepEqual(targets.map((target) => ({ name: target.name, sniCertificate: target.metadata.sniCertificate })), [
    { name: 'lb-default', sniCertificate: false },
    { name: 'lb-sni', sniCertificate: true },
  ]);
});

test('Citrix ADC 长业务资源名会派生为短 Citrix certkey 并用于多级链路', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const createLeafCertKey = content.steps.find((item: { name?: string }) => item.name === 'createLeafCertKey');
  const resolveLeafCertKeyName = content.steps.find((item: { name?: string }) => item.name === 'resolveLeafCertKeyName');
  const readLeafCertKey = content.steps.find((item: { name?: string }) => item.name === 'readLeafCertKey');
  const inspectLeafChainState = content.steps.find((item: { name?: string }) => item.name === 'inspectLeafChainState');
  const linkLeafCertKey = content.steps.find((item: { name?: string }) => item.name === 'linkLeafCertKey');
  const verifyIntermediateLink = content.steps
    .find((item: { name?: string }) => item.name === 'linkIntermediates')
    ?.foreach?.steps?.find((item: { name?: string }) => item.name === 'verifyIntermediateLink');
  const verifyLeafChainLink = content.steps.find((item: { name?: string }) => item.name === 'verifyLeafChainLink');
  assert.equal(content.steps.some((item: { name?: string }) => item.name === 'verifyLeafCertKey'), false);
  assert.deepEqual(content.steps.find((item: { name?: string }) => item.name === 'deriveCitrixNames')?.transform.input, {
    certificateFingerprint: '{{artifacts.certificate.outputs.fingerprintSha256}}',
  });
  assert.deepEqual(createLeafCertKey.extract, {
    statusCode: { type: 'statusCode', optional: true },
    nitroErrorCode: { type: 'jsonPath', path: '$.errorcode', optional: true },
    nitroMessage: { type: 'jsonPath', path: '$.message', optional: true },
  });
  assert.equal(createLeafCertKey.assert, undefined);
  assert.deepEqual(createLeafCertKey.request.successStatusCodes, [200, 201, 209, 409]);
  assert.equal(createLeafCertKey.when, undefined);
  assert.equal(resolveLeafCertKeyName.type, 'transform');
  assert.equal(readLeafCertKey.request.url.includes('steps.resolveLeafCertKeyName.extracted.effectiveLeafCertKeyName'), true);
  assert.deepEqual(readLeafCertKey.assert, [
    { type: 'jsonPath', path: '$.errorcode', equals: 0 },
    { type: 'contains', value: 'Valid' },
  ]);
  assert.equal(inspectLeafChainState.type, 'transform');
  assert.equal(inspectLeafChainState.transform.outputs.shouldLinkLeafCertKey.expression.includes('linkcertkeyname'), true);
  assert.equal(linkLeafCertKey.when, undefined);
  assert.equal(linkLeafCertKey.assert, undefined);
  assert.deepEqual(linkLeafCertKey.request.successStatusCodes, [200, 201, 209, 409]);
  assert.match(verifyIntermediateLink.request.url, /sslcertchain_sslcertkey_binding/);
  assert.match(verifyLeafChainLink.request.url, /sslcertchain_sslcertkey_binding/);
  assert.deepEqual(verifyLeafChainLink.retry, {
    count: 4,
    intervalSeconds: 1,
    retryOnStatus: [404, 409, 429, 500, 502, 503, 504, 599],
  });
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const variables = deploymentVariables();
  variables.certificateKeyName = 'certificate-lb-test01-jacksonz-cn-5579902569';
  const responses = deploymentResponses();
  responses.verifyIntermediateLink = { statusCode: 200, body: { errorcode: 0, sslcertkey: [{ certkey: `${DERIVED_CERTKEY_NAME}-ca-1`, linkcertkeyname: `${DERIVED_CERTKEY_NAME}-ca-2` }] } };
  responses.verifyLeafChainLink = { statusCode: 200, body: { errorcode: 0, sslcertkey: [{ certkey: DERIVED_CERTKEY_NAME, linkcertkeyname: `${DERIVED_CERTKEY_NAME}-ca-1` }] } };
  responses.verifyNewBinding = { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [{ vservername: 'lb-one', certkeyname: DERIVED_CERTKEY_NAME }] } };
  responses.verifyCertificateControlPlane = { statusCode: 200, body: { errorcode: 0, sslcertkey: [{ certkey: DERIVED_CERTKEY_NAME, status: 'Valid', linkcertkeyname: `${DERIVED_CERTKEY_NAME}-ca-1` }] } };

  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(variables),
    mockResponses: responses,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.stepResults.find((item) => item.name === 'deriveCitrixNames')?.extracted.citrixCertificateKeyName, DERIVED_CERTKEY_NAME);
  assert.match(JSON.stringify(result.stepResults.find((item) => item.name === 'linkIntermediates')?.children), new RegExp(`${DERIVED_CERTKEY_NAME}-ca-1`));
  assert.equal(JSON.stringify(result).includes('certificate-lb-test01-jacksonz-cn-5579902569-ca-1'), false);
});

test('Citrix ADC 叶子 certkey 创建冲突时复用 ADC 返回的实际名称', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const responses = deploymentResponses();
  responses.createLeafCertKey = {
    statusCode: 409,
    body: { errorcode: 273, message: `Resource already exists [certkeyName Contents, ${ACTUAL_EXISTING_CERTKEY_NAME}]`, severity: 'ERROR' },
  };
  responses.readLeafCertKey = {
    statusCode: 200,
    body: { errorcode: 0, sslcertkey: [{ certkey: ACTUAL_EXISTING_CERTKEY_NAME, status: 'Valid', linkcertkeyname: `${DERIVED_CERTKEY_NAME}-ca-1` }] },
  };
  responses.verifyLeafChainLink = {
    statusCode: 200,
    body: { errorcode: 0, sslcertkey: [{ certkey: ACTUAL_EXISTING_CERTKEY_NAME, linkcertkeyname: `${DERIVED_CERTKEY_NAME}-ca-1` }] },
  };
  responses.verifyNewBinding = {
    statusCode: 200,
    body: { errorcode: 0, sslvserver_sslcertkey_binding: [{ vservername: 'lb-one', certkeyname: ACTUAL_EXISTING_CERTKEY_NAME }] },
  };
  responses.prepareOldBindingRemoval = {
    statusCode: 200,
    body: {
      errorcode: 0,
      sslvserver_sslcertkey_binding: [
        { vservername: 'lb-one', certkeyname: 'old-cert', snicert: false, priority: 1 },
        { vservername: 'lb-one', certkeyname: ACTUAL_EXISTING_CERTKEY_NAME, snicert: false, priority: 2 },
      ],
    },
  };
  responses.verifyCertificateControlPlane = {
    statusCode: 200,
    body: { errorcode: 0, sslcertkey: [{ certkey: ACTUAL_EXISTING_CERTKEY_NAME, status: 'Valid' }] },
  };

  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(deploymentVariables()),
    mockResponses: responses,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.stepResults.find((item) => item.name === 'createLeafCertKey')?.status, 'success');
  assert.equal(result.stepResults.find((item) => item.name === 'resolveLeafCertKeyName')?.extracted.effectiveLeafCertKeyName, ACTUAL_EXISTING_CERTKEY_NAME);
  assert.equal(result.stepResults.find((item) => item.name === 'inspectLeafChainState')?.extracted.leafAlreadyLinkedToTargetIntermediate, true);
  assert.equal(result.stepResults.find((item) => item.name === 'linkLeafCertKey')?.status, 'success');
  assert.match(JSON.stringify(result.stepResults.find((item) => item.name === 'readLeafCertKey')?.plan), new RegExp(ACTUAL_EXISTING_CERTKEY_NAME));
});

test('Citrix ADC 预先导入叶子 certkey 时跳过重复导入并继续部署', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const responses = deploymentResponses();
  responses.readExistingCertKeys = {
    statusCode: 200,
    body: {
      errorcode: 0,
      sslcertkey: [{ certkey: DERIVED_CERTKEY_NAME, cert: `/nsconfig/ssl/${DERIVED_CERTKEY_NAME}.pem`, status: 'Valid' }],
    },
  };
  responses.uploadLeafCertificate = { statusCode: 500, body: { errorcode: 999, message: 'should be skipped' } };
  responses.uploadPrivateKey = { statusCode: 500, body: { errorcode: 999, message: 'should be skipped' } };
  responses.createLeafCertKey = {
    statusCode: 409,
    body: { errorcode: 273, message: `Resource already exists [certkeyName Contents, ${DERIVED_CERTKEY_NAME}]` },
  };
  responses.readLeafCertKey = {
    statusCode: 200,
    body: { errorcode: 0, sslcertkey: [{ certkey: DERIVED_CERTKEY_NAME, status: 'Valid' }] },
  };

  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(deploymentVariables()),
    mockResponses: responses,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.stepResults.find((item) => item.name === 'uploadLeafCertificate')?.status, 'skipped');
  assert.equal(result.stepResults.find((item) => item.name === 'uploadPrivateKey')?.status, 'skipped');
  assert.equal(result.stepResults.find((item) => item.name === 'createLeafCertKey')?.status, 'success');
  assert.equal(result.stepResults.find((item) => item.name === 'resolveLeafCertKeyName')?.extracted.effectiveLeafCertKeyName, DERIVED_CERTKEY_NAME);
  assert.equal(result.stepResults.find((item) => item.name === 'verifyLeafChainLink')?.status, 'success');
});

test('Citrix ADC 叶子 certkey 冲突后实际资源校验失败时停止并避免 link', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const responses = deploymentResponses();
  Object.assign(responses, recoveryResponses());
  responses.createLeafCertKey = {
    statusCode: 409,
    body: { errorcode: 273, message: `Resource already exists [certkeyName Contents, ${ACTUAL_EXISTING_CERTKEY_NAME}]` },
  };
  responses.readLeafCertKey = { statusCode: 404, body: { errorcode: 1540, message: 'Certificate does not exist' } };

  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(deploymentVariables()),
    mockResponses: responses,
  });

  assert.equal(result.status, 'rolled_back');
  assert.equal(result.stepResults.find((item) => item.name === 'createLeafCertKey')?.status, 'success');
  assert.equal(result.stepResults.find((item) => item.name === 'readLeafCertKey')?.status, 'failed');
  assert.equal(result.stepResults.find((item) => item.name === 'linkLeafCertKey'), undefined);
});

test('Citrix ADC 旧证书键在零条和单条绑定时始终为数组', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });

  for (const bindings of [[], [{ vservername: 'lb-one', certkeyname: 'old-cert', snicert: false, priority: 1 }]]) {
    const responses = deploymentResponses();
    responses.readOldBindings = { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: bindings } };
    const result = await workflows.testRun({
      templateVersionId: version.id,
      mode: 'mock',
      resolvedInput: resolvedWorkflowInput(deploymentVariables()),
      mockResponses: responses,
    });
    const oldCertificateKeys = result.stepResults.find((item) => item.name === 'selectLiveBindings')?.extracted.oldCertificateKeys;
    assert.ok(Array.isArray(oldCertificateKeys));
    assert.equal(oldCertificateKeys.length, bindings.length);
  }
});

test('Citrix ADC 仅凭标准 Asset Context 和分层 Binding 解析后可直接 Dry-run', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const deviceBinding = emptyInputBindingsV1();
  deviceBinding.connections.management = { host: '10.0.0.1', port: 443, tls: { verifyPeer: false } };
  deviceBinding.credentials.credential = { credentialId: 'cred_fixture' };
  const assetBinding = emptyInputBindingsV1();
  assetBinding.variables.allowInsecureTls = true;
  assetBinding.artifacts.certificate = {
    certificateFormatId: 'format_citrix_pem',
    outputBindings: {
      leafPemBase64: 'leafPemBase64',
      privateKeyPemBase64: 'privateKeyPemBase64',
      orderedIntermediates: 'orderedIntermediates',
      fingerprintSha256: 'fingerprintSha256',
    },
  };
  const certificate = deploymentVariables().certificate as Record<string, unknown>;
  const resolvedInput = new ProductionDeploymentInputResolverService().resolve({
    phase: 'preflight',
    contract: content.inputContract,
    assetContext: {
      apiVersion: 'gcac.deployment-asset-context/v1',
      application: { id: 'asset_citrix_plan', address: 'adc.example.com', serverName: 'adc.example.com', port: 443, protocol: 'HTTPS' },
      deployment: {
        targets: [{ name: 'lb-one', serverName: 'lb.example.com', metadata: { sniCertificate: false, previousFingerprintSha256: 'bb'.repeat(32) } }],
        certificateResourceName: 'gcac-leaf-20260724',
      },
    },
    bindingLayers: {
      deviceDefault: { pluginVersionId: 'citrix.netscaler-adc:1.1.21', inputBindings: deviceBinding },
      assetOverride: { pluginVersionId: 'citrix.netscaler-adc:1.1.21', inputBindings: assetBinding },
    },
    credentialSnapshots: {
      credential: {
        credentialId: 'cred_fixture',
        credentialVersionId: '1',
        kind: 'USERNAME_PASSWORD',
        username: 'fixture',
        secretRefs: { password: 'secret://password/fixture-secret#v1' },
      },
    },
    artifactSnapshots: {
      certificate: { artifactId: 'certver_fixture:format_citrix_pem', outputs: certificate },
    },
  });

  assert.equal(resolvedInput.executable, true);
  assert.deepEqual(resolvedInput.variables.targetVirtualServers, resolvedInput.assetContext.deployment?.targets);
  assert.equal(resolvedInput.variables.certificateKeyName, 'gcac-leaf-20260724');
  assert.equal(resolvedInput.variables.allowInsecureTls, true);
  assert.equal(resolvedInput.connections.management.host, '10.0.0.1');
  assert.equal(resolvedInput.credentials.credential?.credentialId, 'cred_fixture');

  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const result = await workflows.testRun({ templateVersionId: version.id, mode: 'mock', resolvedInput, mockResponses: deploymentResponses() });
  assert.equal(result.status, 'success');
  assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
});

test('Citrix ADC systemfile 接受 200 且绑定失败时不执行保存', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const responses = deploymentResponses();
  responses.uploadLeafCertificate = { statusCode: 200, body: {} };
  responses.uploadPrivateKey = { statusCode: 200, body: {} };
  responses.bindNewCertificate = { statusCode: 500, body: { errorcode: 999, message: 'fixture failure' } };
  responses.readCurrentVersion = responses.preflight;
  responses.readBindingsBeforeRestore = responses.readOldBindings;
  responses.restoreOldBinding = { statusCode: 201, body: { errorcode: 0 } };
  responses.readBindingsAfterRestore = { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [{ vservername: 'lb-one', certkeyname: 'old-cert', snicert: false, priority: 1 }] } };
  responses.removeNewBinding = { statusCode: 200, body: { errorcode: 0 } };
  responses.readFinalBindings = responses.readBindingsAfterRestore;
  responses.saveConfiguration = { statusCode: 200, body: { errorcode: 0 } };
  responses.verifyPreviousTlsHandshake = { statusCode: 200, body: { remoteCertificateSha256: 'bb'.repeat(32) } };
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(deploymentVariables()),
    mockResponses: responses,
  });
  assert.equal(result.status, 'rolled_back');
  assert.equal(result.stepResults.some((item) => item.name === 'saveConfiguration'), false);
  assert.equal(result.stepResults.find((item) => item.name === 'uploadLeafCertificate')?.status, 'success');
  assert.equal(result.stepResults.find((item) => item.name === 'uploadPrivateKey')?.status, 'success');
  assert.equal(result.rollbackResults.every((item) => item.status !== 'failed'), true);
  assert.equal(result.rollbackResults.find((item) => item.name === 'decideRollbackPersistence')?.extracted.bindingMutationCount, 0);
  assert.equal(result.rollbackResults.find((item) => item.name === 'saveConfiguration')?.status, 'skipped');
});

test('Citrix ADC 中间证书 certkey 已存在时继续逐级 link 并验证收敛', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const responses = deploymentResponses();
  responses.createIntermediateCertKey = { statusCode: 500, body: { errorcode: 273, message: 'Resource already exists' } };
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(deploymentVariables()),
    mockResponses: responses,
  });

  assert.equal(result.status, 'success');
  const install = result.stepResults.find((item) => item.name === 'installIntermediates');
  assert.equal(install?.status, 'success');
  const link = result.stepResults.find((item) => item.name === 'linkIntermediates');
  assert.equal(link?.status, 'success');
  assert.equal(link?.children?.some((item) => item.name.includes('verifyIntermediateLink') && item.status === 'success'), true);
});

test('Citrix ADC 中间证书 NITRO 599 已存在响应后继续逐级 link 并验证收敛', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const responses = deploymentResponses();
  responses.createIntermediateCertKey = { statusCode: 599, body: { errorcode: 273, message: 'Resource already exists' } };
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(deploymentVariables()),
    mockResponses: responses,
  });

  assert.equal(result.status, 'success');
  const installIndex = result.stepResults.findIndex((item) => item.name === 'installIntermediates');
  const linkIndex = result.stepResults.findIndex((item) => item.name === 'linkIntermediates');
  assert.equal(installIndex >= 0 && linkIndex > installIndex, true);
  const link = result.stepResults[linkIndex];
  assert.equal(link?.children?.some((item) => item.name.includes('verifyIntermediateLink') && item.status === 'success'), true);
});

test('Citrix ADC 中间证书同内容已存在时复用设备返回的 certkey 名', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const variables = deploymentVariables();
  const certificate = variables.certificate as Record<string, unknown>;
  certificate.orderedIntermediates = [
    { sequence: 1, hasNext: false, pemBase64: Buffer.from('ca-1').toString('base64') },
  ];
  const responses = deploymentResponses();
  responses.createIntermediateCertKey = {
    statusCode: 409,
    body: { errorcode: 273, message: 'Resource already exists [certkeyName Contents, ca1]', severity: 'ERROR' },
  };
  responses.verifyLeafChainLink = {
    statusCode: 200,
    body: { errorcode: 0, sslcertkey: [{ certkey: DERIVED_CERTKEY_NAME, linkcertkeyname: 'ca1' }] },
  };

  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(variables),
    mockResponses: responses,
  });

  assert.equal(result.status, 'success');
  const resolved = result.stepResults.find((item) => item.name === 'resolveIntermediateCertKeyNames');
  assert.equal((resolved?.extracted.effectiveIntermediates as Array<{ certkeyName: string }>)[0]?.certkeyName, 'ca1');
  const leafLink = result.stepResults.find((item) => item.name === 'linkLeafCertKey');
  assert.equal(leafLink?.status, 'success');
});

test('Citrix ADC 删除旧绑定时只编码 certkey 参数值', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const responses = deploymentResponses();
  responses.readOldBindings = {
    statusCode: 200,
    body: { errorcode: 0, sslvserver_sslcertkey_binding: [{ vservername: 'lb-one', certkeyname: '*,weichai.com-2026', snicert: false }] },
  };
  responses.prepareOldBindingRemoval = responses.readOldBindings;
  responses.readOldCertKey = {
    statusCode: 200,
    body: { errorcode: 0, sslcertkey: [{ certkey: '*,weichai.com-2026', cert: '/nsconfig/ssl/old.pem', key: '/nsconfig/ssl/old.key', status: 'Valid' }] },
  };

  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(deploymentVariables()),
    mockResponses: responses,
  });

  assert.equal(result.status, 'success');
  const remove = result.stepResults.find((item) => item.name === 'removeOldBindings')?.children?.[0];
  assert.match(JSON.stringify(remove?.plan), /args=certkeyname:%2A%2Cweichai.com-2026/);
});

test('Citrix ADC 绑定新证书后旧绑定已消失时不再执行删除', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const responses = deploymentResponses();
  responses.prepareOldBindingRemoval = {
    statusCode: 200,
    body: { errorcode: 0, sslvserver_sslcertkey_binding: [{ vservername: 'lb-one', certkeyname: DERIVED_CERTKEY_NAME, snicert: false }] },
  };

  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(deploymentVariables()),
    mockResponses: responses,
  });

  assert.equal(result.status, 'success');
  const remove = result.stepResults.find((item) => item.name === 'removeOldBindings');
  assert.equal((remove?.plan as { itemCount?: number }).itemCount, 0);
  assert.equal(remove?.children?.length, 0);
});

test('Citrix ADC 自动补偿失败时不得伪装为已回滚', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const responses = deploymentResponses();
  responses.bindNewCertificate = { statusCode: 500, body: { errorcode: 999 } };
  responses.readCurrentVersion = responses.preflight;
  responses.readBindingsBeforeRestore = { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [] } };
  responses.restoreOldBinding = { statusCode: 500, body: { errorcode: 998 } };
  const result = await workflows.testRun({ templateVersionId: version.id, mode: 'mock', resolvedInput: resolvedWorkflowInput(deploymentVariables()), mockResponses: responses });
  assert.equal(result.status, 'failed');
  assert.equal(result.rollbackResults.some((item) => item.status === 'failed'), true);
});

test('Citrix ADC 回滚恢复旧绑定、移除新绑定并验证集合语义等价', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const snapshot = recoverySnapshot();
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    executionBranch: 'rollback',
    resolvedInput: resolvedWorkflowInput({ ...deploymentVariables(), ...recoveryVariables(snapshot) }),
    stepOutputs: rollbackStepOutputs(snapshot),
    mockResponses: recoveryResponses(),
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(result.rollbackResults.map((item) => item.name).slice(-4), [
    'compareFinalBindings', 'requireFinalBindingsEquivalent', 'decideRollbackPersistence', 'saveConfiguration',
  ]);
  const remove = result.rollbackResults.find((item) => item.name === 'removeNewBindings')?.children?.[0];
  assert.match(JSON.stringify(remove?.plan), new RegExp(`args=certkeyname:${DERIVED_CERTKEY_NAME}`));
  assert.equal(JSON.stringify(result).includes('fixture-only'), false);
});

test('Citrix ADC 回滚校验允许 NITRO 旧绑定响应缺少 priority', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const snapshot = recoverySnapshot();
  const responses = recoveryResponses();
  responses.readBindingsAfterRestore = {
    statusCode: 200,
    body: {
      errorcode: 0,
      sslvserver_sslcertkey_binding: [
        { vservername: 'lb-one', certkeyname: 'old-cert', snicert: false },
        { vservername: 'lb-one', certkeyname: DERIVED_CERTKEY_NAME, snicert: false },
      ],
    },
  };
  responses.readFinalBindings = { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [{ vservername: 'lb-one', certkeyname: 'old-cert', snicert: false }] } };
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    executionBranch: 'rollback',
    resolvedInput: resolvedWorkflowInput({ ...deploymentVariables(), ...recoveryVariables(snapshot) }),
    stepOutputs: rollbackStepOutputs(snapshot),
    mockResponses: responses,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.rollbackResults.find((item) => item.name === 'requireOldBindingsRestored')?.status, 'success');
});

test('Citrix ADC 回滚快照哈希损坏时在首个写操作前停止', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const snapshot = recoverySnapshot();
  const variables = recoveryVariables(snapshot);
  variables.recoverySnapshotHash = '00'.repeat(32);
  const result = await workflows.testRun({ templateVersionId: version.id, mode: 'mock', executionBranch: 'rollback', resolvedInput: resolvedWorkflowInput({ ...deploymentVariables(), ...variables }), mockResponses: recoveryResponses() });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.rollbackResults.map((item) => item.name), ['verifyRecoverySnapshot']);
  assert.equal(result.rollbackResults.some((item) => item.name === 'restoreOldBindings'), false);
});

test('Citrix ADC 回滚设备版本漂移时在首个写操作前停止', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const responses = recoveryResponses();
  responses.readCurrentVersion = { statusCode: 200, body: { errorcode: 0, nsversion: { version: 'NetScaler NS14.1: Build 1.0.nc' } } };
  const snapshot = recoverySnapshot();
  const result = await workflows.testRun({ templateVersionId: version.id, mode: 'mock', executionBranch: 'rollback', resolvedInput: resolvedWorkflowInput({ ...deploymentVariables(), ...recoveryVariables(snapshot) }), stepOutputs: rollbackStepOutputs(snapshot), mockResponses: responses });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.rollbackResults.map((item) => item.name), ['verifyRecoverySnapshot', 'readCurrentVersion', 'verifyDeviceVersion']);
  assert.equal(result.rollbackResults.some((item) => item.name === 'restoreOldBindings'), false);
});

function deploymentVariables(): Record<string, unknown> {
  return {
    allowInsecureTls: true,
    certificateKeyName: 'gcac-leaf-20260724',
    certificate: {
      leafPemBase64: Buffer.from('leaf').toString('base64'),
      privateKeyPemBase64: Buffer.from('private').toString('base64'),
      fingerprintSha256: 'aa'.repeat(32),
      orderedIntermediates: [
        { sequence: 1, nextSequence: 2, hasNext: true, pemBase64: Buffer.from('ca-1').toString('base64') },
        { sequence: 2, hasNext: false, pemBase64: Buffer.from('ca-2').toString('base64') },
      ],
    },
    targetVirtualServers: [{ name: 'lb-one', serverName: 'lb.example.com', metadata: { sniCertificate: false, previousFingerprintSha256: 'bb'.repeat(32) } }],
  };
}

function deploymentResponses(): Record<string, WorkflowMockStepOutput> {
  return {
    preflight: { statusCode: 200, body: { errorcode: 0, nsversion: { version: 'NetScaler NS13.1: Build 55.29.nc' } } },
    readOldBindings: { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [{ vservername: 'lb-one', certkeyname: 'old-cert', snicert: false, priority: 1 }] } },
    readOldCertKey: { statusCode: 200, body: { errorcode: 0, sslcertkey: [{ certkey: 'old-cert', cert: '/nsconfig/ssl/old.pem', key: '/nsconfig/ssl/old.key', linkcertkeyname: 'old-ca', status: 'Valid' }] } },
    readExistingCertKeys: { statusCode: 200, body: { errorcode: 0, sslcertkey: [] } },
    readLeafCertKey: { statusCode: 200, body: { errorcode: 0, sslcertkey: [{ certkey: DERIVED_CERTKEY_NAME, status: 'Valid' }] } },
    uploadLeafCertificate: { statusCode: 201, body: {} },
    uploadPrivateKey: { statusCode: 201, body: {} },
    uploadIntermediate: { statusCode: 201, body: {} },
    createIntermediateCertKey: { statusCode: 201, body: { errorcode: 0 } },
    linkIntermediateCertKey: { statusCode: 200, body: { errorcode: 0 } },
    verifyIntermediateLink: { statusCode: 200, body: { errorcode: 0, sslcertkey: [{ certkey: `${DERIVED_CERTKEY_NAME}-ca-1`, linkcertkeyname: `${DERIVED_CERTKEY_NAME}-ca-2` }] } },
    createLeafCertKey: { statusCode: 201, body: { errorcode: 0 } },
    linkLeafCertKey: { statusCode: 200, body: { errorcode: 0 } },
    verifyLeafChainLink: { statusCode: 200, body: { errorcode: 0, sslcertkey: [{ certkey: DERIVED_CERTKEY_NAME, linkcertkeyname: `${DERIVED_CERTKEY_NAME}-ca-1` }] } },
    bindNewCertificate: { statusCode: 201, body: { errorcode: 0 } },
    verifyNewBinding: { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [{ vservername: 'lb-one', certkeyname: DERIVED_CERTKEY_NAME }] } },
    prepareOldBindingRemoval: { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [{ vservername: 'lb-one', certkeyname: 'old-cert', snicert: false, priority: 1 }, { vservername: 'lb-one', certkeyname: DERIVED_CERTKEY_NAME, snicert: false, priority: 2 }] } },
    removeOldBinding: { statusCode: 200, body: { errorcode: 0 } },
    saveConfiguration: { statusCode: 200, body: { errorcode: 0 } },
    verifyCertificateControlPlane: { statusCode: 200, body: { errorcode: 0, sslcertkey: [{ certkey: DERIVED_CERTKEY_NAME, status: 'Valid', linkcertkeyname: `${DERIVED_CERTKEY_NAME}-ca-1` }] } },
  };
}

function recoverySnapshot(): Record<string, unknown> {
  return {
    deviceVersion: 'NetScaler NS13.1: Build 55.29.nc',
    versionResponse: { errorcode: 0, nsversion: { version: 'NetScaler NS13.1: Build 55.29.nc' } },
    bindings: [{ vservername: 'lb-one', certkeyname: 'old-cert', snicert: false, priority: 1 }],
    certkeys: [{ resource: [{ certkey: 'old-cert', cert: '/nsconfig/ssl/old.pem', key: '/nsconfig/ssl/old.key', linkcertkeyname: 'old-ca', status: 'Valid' }], sharedBindings: [{ vservername: 'lb-one', certkeyname: 'old-cert' }] }],
    targets: [{ name: 'lb-one', serverName: 'lb.example.com', metadata: { previousFingerprintSha256: 'bb'.repeat(32) } }],
    newCertificateKeyName: DERIVED_CERTKEY_NAME,
    targetFingerprintSha256: 'aa'.repeat(32),
  };
}

function recoveryVariables(snapshot: Record<string, unknown>): Record<string, unknown> {
  const wrapped = { snapshot };
  return {
    recoverySnapshot: wrapped,
    recoverySnapshotHash: createHash('sha256').update(stableJson(wrapped)).digest('hex'),
  };
}

function rollbackStepOutputs(snapshot: Record<string, unknown>): Record<string, unknown> {
  return {
    buildDeploymentSnapshot: {
      extracted: {
        deploymentSnapshot: snapshot,
      },
    },
  };
}

function recoveryResponses(): Record<string, WorkflowMockStepOutput> {
  const oldBinding = { vservername: 'lb-one', certkeyname: 'old-cert', snicert: false, priority: 1 };
  return {
    readCurrentVersion: { statusCode: 200, body: { errorcode: 0, nsversion: { version: 'NetScaler NS13.1: Build 55.29.nc' } } },
    readBindingsBeforeRestore: { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [] } },
    restoreOldBinding: { statusCode: 201, body: { errorcode: 0 } },
    readBindingsAfterRestore: { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [oldBinding, { vservername: 'lb-one', certkeyname: DERIVED_CERTKEY_NAME, snicert: false, priority: 2 }] } },
    removeNewBinding: { statusCode: 200, body: { errorcode: 0 } },
    readFinalBindings: { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [oldBinding] } },
    saveConfiguration: { statusCode: 200, body: { errorcode: 0 } },
    verifyPreviousTlsHandshake: { statusCode: 200, body: { remoteCertificateSha256: 'bb'.repeat(32) } },
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

class InMemoryCitrixExecutionGrantService {
  private readonly grants = new Map<string, ExecutionGrantEntity>();
  private created = 0;

  async create(input: {
    tenantId: string;
    runId: string;
    stepId: string;
    workflowVersionId?: string;
    executorType: string;
    allowedSecretRefs: string[];
    allowedActions: string[];
    expiresAt: string;
  }): Promise<ExecutionGrantEntity> {
    this.created += 1;
    const grant: ExecutionGrantEntity = {
      id: `grant-citrix-${this.created}`,
      tenantId: input.tenantId,
      runId: input.runId,
      stepId: input.stepId,
      workflowVersionId: input.workflowVersionId,
      executorType: input.executorType,
      allowedSecretRefs: input.allowedSecretRefs,
      allowedActions: input.allowedActions,
      expiresAt: input.expiresAt,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.grants.set(grant.id, grant);
    return grant;
  }

  async validate(input: { grantId: string; tenantId?: string; runId: string; stepId: string; workflowVersionId?: string; executorType: string; action?: string }): Promise<ExecutionGrantEntity> {
    const grant = this.grants.get(input.grantId);
    if (!grant || grant.status !== 'active') throw new Error('grant invalid');
    if (grant.runId !== input.runId || grant.stepId !== input.stepId || grant.executorType !== input.executorType) {
      throw new Error('grant context mismatch');
    }
    if (input.tenantId !== undefined && grant.tenantId !== input.tenantId) throw new Error('grant tenant mismatch');
    if (input.workflowVersionId !== undefined && grant.workflowVersionId !== input.workflowVersionId) throw new Error('grant workflow version mismatch');
    if (input.action && !grant.allowedActions.includes(input.action)) throw new Error('action not allowed');
    return grant;
  }

  async get(id: string): Promise<ExecutionGrantEntity | undefined> {
    return this.grants.get(id);
  }

  async revoke(id: string): Promise<ExecutionGrantEntity> {
    const grant = this.grants.get(id);
    if (grant) {
      const updated = { ...grant, status: 'revoked' as const, updatedAt: new Date().toISOString() };
      this.grants.set(id, updated);
      return updated;
    }
    throw new Error('grant not found');
  }

  createdCount(): number {
    return this.created;
  }

  activeCount(): number {
    return [...this.grants.values()].filter((grant) => grant.status === 'active').length;
  }
}

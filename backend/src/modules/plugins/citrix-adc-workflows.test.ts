import assert from 'node:assert/strict';
import test from 'node:test';
import { BuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';
import { WorkflowTemplatesApplicationService } from '../workflow-templates/application/workflow-templates.application-service.js';
import { DeviceDiscoverySchemaService } from './discovery/device-discovery-schema.service.js';
import type { WorkflowMockStepOutput } from '../workflow-templates/dto/workflow-templates.dto.js';

test('Citrix ADC 连接测试识别版本且不泄漏认证值', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/connection-test.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    userVariables: {
      deviceHost: '10.0.0.1', managementPort: 443, tlsVerify: false,
      credential: { id: 'fixture-secret', kind: 'username_password', type: 'password', username: 'fixture', password: 'fixture-only' },
    },
    mockResponses: { readVersion: { statusCode: 200, body: { errorcode: 0, nsversion: { version: 'NetScaler NS13.1: Build 55.29.nc' } } } },
  });
  assert.equal(result.status, 'success');
  assert.equal(result.stepResults[0]?.extracted.productVersion, 'NetScaler NS13.1: Build 55.29.nc');
  assert.equal(JSON.stringify(result).includes('fixture-only'), false);
});

test('Citrix ADC 13.1 脱敏 Fixture 生成标准发现对象', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/discover.json']!);
  const fixture = JSON.parse(pluginPackage.resources['discovery-mappings/nitro-13.1.json']!) as { mockResponses: Record<string, WorkflowMockStepOutput> };
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    userVariables: {
      deviceHost: '10.0.0.1',
      managementPort: 443,
      tlsVerify: true,
      credential: { id: 'fixture-secret', kind: 'username_password', type: 'password', username: 'fixture', password: 'fixture-only' },
    },
    mockResponses: fixture.mockResponses,
  });
  const discovery = result.stepResults.at(-1)?.extracted.discovery;
  const validated = new DeviceDiscoverySchemaService().validate(discovery);
  assert.deepEqual(validated.sites.map((site) => site.stableKey), ['LB:lb-one', 'VPN:vpn-one', 'CS:cs-one', 'GSLB:gslb-one']);
  assert.equal(validated.certificates[0]?.stableKey, 'CERT:leaf-one');
  assert.deepEqual(validated.certificateBindings.map((binding) => binding.siteStableKey), ['LB:lb-one', 'VPN:vpn-one', 'CS:cs-one', 'GSLB:gslb-one']);
  assert.equal(JSON.stringify(result).includes('fixture-only'), false);
});

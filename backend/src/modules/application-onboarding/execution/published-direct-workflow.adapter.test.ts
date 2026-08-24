import assert from 'node:assert/strict';
import test from 'node:test';
import { PublishedDirectWorkflowOnboardingAdapter } from './published-direct-workflow.adapter.js';
import type { LoadedApplicationOnboardingRecipe } from '../recipe/index.js';

test('DIRECT_WORKFLOW 只接收同一固定插件版本已发布工作流投影出的活动目标', async () => {
  const calls: string[] = [];
  const adapter = new PublishedDirectWorkflowOnboardingAdapter({
    async listManagedTargets() {
      return {
        items: [{
          id: 'target-1', tenantId: 'tenant-1', deviceId: 'host-1', siteId: 'site-1',
          discoveryProviderKey: 'plugin:plugin-version-1', targetType: 'tls.binding', targetKey: 'nginx:example.test',
          supportedCapabilities: ['certificate.deploy'], executionLocations: ['AGENT'], status: 'ACTIVE', metadata: {},
          createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', version: 1,
        }], page: 1, pageSize: 200, total: 1,
      };
    },
    async getSiteAsset() {
      return {
        id: 'site-1', tenantId: 'tenant-1', frameworkInstanceId: 'framework-1', deviceId: 'host-1', discoveryProviderKey: 'plugin:plugin-version-1',
        siteType: 'web.site', siteName: 'example.test', siteKey: 'example.test', port: 443, protocol: 'HTTPS',
        discoverySource: 'AGENT', status: 'ACTIVE', metadata: {}, createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', version: 1,
      };
    },
    async getHost() { return { id: 'host-1', hostname: 'host-1', tenantId: 'tenant-1' }; },
  } as never, {
    async require(pluginVersionId, capabilityKey) {
      calls.push(`${pluginVersionId}:${capabilityKey}`);
      return {
        pluginVersionId, capabilityKey, workflowKey: capabilityKey, workflowResourcePath: 'workflows/fixed.json',
        workflowTemplateId: `template-${capabilityKey}`, workflowVersionId: `version-${capabilityKey}`,
        workflowContentSha256: 'sha256:fixed', createdAt: '2026-08-14T00:00:00.000Z',
      };
    },
  });

  assert.equal(await adapter.supports(recipe()), true);
  await adapter.test('tenant-1', { deviceId: 'host-1' } as never, recipe());
  const [target] = await adapter.discover('tenant-1', { deviceId: 'host-1' } as never, recipe());

  assert.equal(target?.displayName, 'example.test');
  assert.deepEqual(target?.endpoint, { host: 'host-1', port: 443, protocol: 'HTTPS' });
  assert.equal(target?.selectable, true);
  assert.equal((await adapter.requireExecutionWorkflow(recipe())).workflowVersionId, 'version-certificate.deploy');
  assert.ok(calls.every((call) => call.startsWith('plugin-version-1:')));
});

test('DIRECT_WORKFLOW 没有已投影的活动目标时失败关闭', async () => {
  const adapter = new PublishedDirectWorkflowOnboardingAdapter({
    async listManagedTargets() { return { items: [], page: 1, pageSize: 200, total: 0 }; },
    async getSiteAsset() { return undefined; },
    async getHost() { return undefined; },
  } as never, {
    async require(pluginVersionId, capabilityKey) {
      return { pluginVersionId, capabilityKey, workflowKey: capabilityKey, workflowResourcePath: 'workflows/fixed.json', workflowTemplateId: 'template', workflowVersionId: 'version', workflowContentSha256: 'sha256:fixed', createdAt: '2026-08-14T00:00:00.000Z' };
    },
  });
  await assert.rejects(adapter.test('tenant-1', { deviceId: 'host-1' } as never, recipe()), /可用目标站点/);
});

test('DIRECT_WORKFLOW 只列出所选真实设备上与插件平台匹配的 Agent 发现目标', async () => {
  const adapter = new PublishedDirectWorkflowOnboardingAdapter({
    async listManagedTargets() {
      return {
        items: [
          {
            id: 'target-nginx', tenantId: 'tenant-1', deviceId: 'host-nginx', frameworkInstanceId: 'framework-nginx', siteId: 'site-nginx',
            discoveryProviderKey: 'agent:agent-nginx', targetType: 'tls.binding', targetKey: 'nginx:portal.test',
            supportedCapabilities: ['certificate.deploy'], executionLocations: ['AGENT'], status: 'ACTIVE', metadata: {},
            createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', version: 1,
          },
          {
            id: 'target-apache', tenantId: 'tenant-1', deviceId: 'host-apache', frameworkInstanceId: 'framework-apache', siteId: 'site-apache',
            discoveryProviderKey: 'agent:agent-apache', targetType: 'tls.binding', targetKey: 'apache:portal.test',
            supportedCapabilities: ['certificate.deploy'], executionLocations: ['AGENT'], status: 'ACTIVE', metadata: {},
            createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', version: 1,
          },
        ], page: 1, pageSize: 200, total: 2,
      };
    },
    async getFrameworkInstance(_tenantId: string, id: string) {
      return { id, tenantId: 'tenant-1', deviceId: id === 'framework-nginx' ? 'host-nginx' : 'host-apache', frameworkType: id === 'framework-nginx' ? 'web.nginx' : 'web.apache' };
    },
    async getSiteAsset(_tenantId: string, id: string) {
      return { id, tenantId: 'tenant-1', deviceId: id === 'site-nginx' ? 'host-nginx' : 'host-apache', frameworkInstanceId: id === 'site-nginx' ? 'framework-nginx' : 'framework-apache', siteName: id === 'site-nginx' ? 'portal.nginx.test' : 'portal.apache.test', port: 443, protocol: 'HTTPS' };
    },
    async getHost(_tenantId: string, id: string) { return { id, hostname: id, tenantId: 'tenant-1' }; },
  } as never, {
    async require(pluginVersionId, capabilityKey) {
      return { pluginVersionId, capabilityKey, workflowKey: capabilityKey, workflowResourcePath: 'workflows/fixed.json', workflowTemplateId: 'template', workflowVersionId: 'version', workflowContentSha256: 'sha256:fixed', createdAt: '2026-08-14T00:00:00.000Z' };
    },
  });

  assert.deepEqual([...await adapter.listCompatibleDeviceIds('tenant-1', recipe())], ['host-nginx']);
  const targets = await adapter.discover('tenant-1', { deviceId: 'host-nginx' } as never, recipe());
  assert.equal(targets[0]?.managedTargetId, 'target-nginx');
  await assert.rejects(adapter.test('tenant-1', { deviceId: 'host-apache' } as never, recipe()), /可用目标站点/);
});

function recipe(): LoadedApplicationOnboardingRecipe {
  return {
    pluginVersionId: 'plugin-version-1', pluginId: 'web.nginx', pluginVersion: '1.0.3',
    resourcePath: 'onboarding/application-asset.json', recipeHash: 'sha256:recipe',
    recipe: {
      protocol: 'gcac.application-onboarding/v1', platformKey: 'nginx', displayNameKey: 'plugin.webNginx.name', supportStatus: 'SUPPORTED',
      deploymentMode: 'DIRECT_WORKFLOW', deviceSelection: 'EXISTING_OR_NEW', forms: {},
      capabilities: { connectionTest: 'application.discover', discovery: 'application.discover', workflowExecution: 'certificate.deploy' },
      targetProjection: { targetType: 'tls.binding', displayFields: ['displayName'], identityFields: ['managedTargetId', 'configFingerprint'], selectableWhen: 'selectable' },
      certificate: { acceptedFormats: ['PEM'], requiredArtifacts: ['leaf', 'privateKey'], defaultVersion: 'LATEST_VALID' },
      commit: { executionSource: 'WORKFLOW', inputContract: 'certificate.deploy.v1' },
    },
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginPackageResourcesService } from './application/plugin-package-resources.service.js';
import type { UnifiedPluginManifestV1 } from './dto/unified-plugins.dto.js';

test('Agent 发现映射归属与 Manifest pluginId 不一致时失败关闭', () => {
  const manifest = {
    pluginId: 'fixture.plugin',
    capabilities: [],
    resources: { agentDiscoveryMappings: { agentCapability: 'discovery-mappings/agent.json' } },
  } as unknown as UnifiedPluginManifestV1;
  const resources = {
    'discovery-mappings/agent.json': JSON.stringify({
      apiVersion: 'gcac.agent-discovery-mapping/v1',
      kind: 'AgentCapabilityDiscoveryMapping',
      pluginId: 'another.plugin',
      capabilityKey: 'linux.nginx.detail',
      projection: {
        shape: 'web_sites',
        frameworkType: 'web.nginx',
        displayName: 'NGINX',
        targetType: 'tls.file',
        deployCapability: 'nginx.cert.install',
      },
    }),
  };

  assert.throws(
    () => new PluginPackageResourcesService().validate(manifest, resources),
    /Agent 发现映射归属与插件 Manifest 不一致/,
  );
});

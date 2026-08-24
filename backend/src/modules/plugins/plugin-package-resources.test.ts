import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginPackageResourcesService } from './application/plugin-package-resources.service.js';
import type { UnifiedPluginManifestV1 } from './dto/unified-plugins.dto.js';

test('已删除的宿主 Agent Discovery Mapping 不再由插件资源加载器解析', () => {
  const manifest = {
    pluginId: 'fixture.plugin',
    capabilities: [],
    resources: { agentDiscoveryMappings: { agentCapability: 'discovery-mappings/agent.json' } },
  } as unknown as UnifiedPluginManifestV1;

  const validated = new PluginPackageResourcesService().validate(manifest, {});

  assert.equal(Object.hasOwn(validated, 'discoveryMappings'), false);
});

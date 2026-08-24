import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(packageDirectory, 'manifest.json'), 'utf8'));
const capabilities = Object.freeze(manifest.capabilities.map((item) => item.key));
const digest = (name) => {
  const value = process.env[name];
  if (!/^sha256:[0-9a-f]{64}$/.test(String(value ?? ''))) throw new Error(`缺少固定摘要 ${name}`);
  return value;
};

export function createPluginRunnerExecutor() {
  const descriptor = Object.freeze({
    pluginId: manifest.pluginId,
    pluginVersion: manifest.version,
    pluginVersionId: process.env.GCAC_PLUGIN_VERSION_ID,
    packageHash: digest('GCAC_PLUGIN_PACKAGE_HASH'),
    manifestHash: digest('GCAC_PLUGIN_MANIFEST_HASH'),
    resourceHash: digest('GCAC_PLUGIN_RESOURCE_HASH'),
    capabilities,
  });
  if (descriptor.pluginVersionId !== `${manifest.pluginId}:${manifest.version}`) throw new Error('固定 PluginVersion 不一致');
  return Object.freeze({
    descriptor,
    async execute(context) {
      if (!context || context.pluginId !== descriptor.pluginId || context.pluginVersionId !== descriptor.pluginVersionId
        || !context.grantRefs?.length) return { success: false, status: 'FAILED', error: { code: 'CLOUD_CONTRACT_DENIED', secretRedacted: true, mayBeUnknown: false } };
      const normalizedObjects = context.capability === 'cloud.service.discover' ? [{
        apiVersion: 'gcac.cloud-service/v1', kind: 'CloudServiceResource', stableKey: `${manifest.pluginId}:fixture.resource:resource-1`,
        pluginId: manifest.pluginId, pluginVersionId: descriptor.pluginVersionId, provider: manifest.pluginId,
        resourceId: 'resource-1', resourceType: 'fixture.resource', region: 'fixture-region',
      }] : [];
      return { success: true, status: 'SUCCESS', summary: { provider: manifest.pluginId }, normalizedObjects };
    },
  });
}

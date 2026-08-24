import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const HASH = `sha256:${'0'.repeat(64)}`;

export function createPluginRunnerExecutor() {
  const descriptor = Object.freeze({
    pluginVersionId: requiredEnvironment('GCAC_PLUGIN_VERSION_ID'),
    pluginId: manifest.pluginId,
    pluginVersion: manifest.version,
    capabilities: Object.freeze(manifest.capabilities.map((item) => item.key)),
    actions: Object.freeze(manifest.capabilities.map((item) => Object.freeze({
      actionId: item.actionContractId,
      capability: item.key,
      actionContractVersion: item.contractVersion,
      inputSchemaSha256: HASH,
      outputSchemaSha256: HASH,
      resourceHash: requiredEnvironment('GCAC_PLUGIN_RESOURCE_HASH', /^sha256:[a-f0-9]{64}$/),
    }))),
    permissions: Object.freeze([...manifest.permissions]),
    packageHash: requiredEnvironment('GCAC_PLUGIN_PACKAGE_HASH', /^sha256:[a-f0-9]{64}$/),
    resourceHash: requiredEnvironment('GCAC_PLUGIN_RESOURCE_HASH', /^sha256:[a-f0-9]{64}$/),
    manifestHash: requiredEnvironment('GCAC_PLUGIN_MANIFEST_HASH', /^sha256:[a-f0-9]{64}$/),
  });
  return Object.freeze({
    descriptor,
    execute: async () => ({
      success: false,
      status: 'FAILED',
      output: {},
      warnings: [],
      error: {
        code: 'PLUGIN_RUNNER_SCOPE_FORBIDDEN',
        message: 'Nginx Proxy Manager 仅通过 Workflow DSL 执行',
        retryable: false,
        mayBeUnknown: false,
        secretRedacted: true,
      },
    }),
  });
}

function requiredEnvironment(name, pattern = /^[A-Za-z0-9._:-]{1,256}$/) {
  const value = process.env[name]?.trim();
  if (!value || !pattern.test(value)) throw new Error(`缺少或无效的 ${name}`);
  return value;
}

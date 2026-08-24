import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyInputBindingsV1 } from '../deployment-inputs/dto/input-bindings.dto.js';
import { validateDeploymentInputContractV1 } from '../deployment-inputs/schema/deployment-input-contract.schema.js';
import { UnifiedDeploymentInputResolver } from '../deployment-inputs/domain/unified-deployment-input.resolver.js';
import type { DeploymentAssetContextV1 } from '../deployment-inputs/dto/deployment-asset-context.dto.js';
import type { ResolveDeploymentInputRequest } from '../deployment-inputs/dto/resolved-deployment-input.dto.js';
import type { EffectiveInputBindingV1 } from '../deployment-inputs/domain/deployment-input-provenance.js';
import { BuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';

test('web.iis 证书工作流从 IIS Asset Context 派生站点和绑定输入', async () => {
  const plugin = (await new BuiltinUnifiedPluginLoader().loadPackages()).find((item) => (
    (item.manifest as { pluginId?: string }).pluginId === 'web.iis'
  ));
  assert.ok(plugin, 'web.iis 内置插件包缺失');

  const onboarding = JSON.parse(plugin.resources['onboarding/application-asset.json']!) as {
    deploymentDefaults?: { capabilityKey?: string; certificateFormat?: { format?: string; configName?: string } };
  };
  assert.deepEqual(onboarding.deploymentDefaults, {
    capabilityKey: 'certificate.deploy',
    certificateFormat: { format: 'PFX', configName: '宿主默认 PFX 容器' },
  });

  const resolver = new UnifiedDeploymentInputResolver();
  const assetContext = iisAssetContext();
  const workflowPaths = [
    'workflows/deploy.json',
    'workflows/verify.json',
    'workflows/rollback.json',
  ];

  for (const workflowPath of workflowPaths) {
    const workflow = JSON.parse(plugin.resources[workflowPath]!) as {
      inputContract: unknown;
    };
    const contract = validateDeploymentInputContractV1(workflow.inputContract);
    const inputBindings = emptyInputBindingsV1();
    const effectiveBinding: EffectiveInputBindingV1 = {
      inputBindings,
      provenance: {},
    };
    const request: ResolveDeploymentInputRequest = {
      phase: 'preflight',
      contract,
      assetContext,
      effectiveBinding,
      artifactSnapshots: {},
    };

    if (workflowPath === 'workflows/deploy.json') {
      inputBindings.artifacts.certificate = {
        certificateFormatId: 'format_pfx',
        outputBindings: { pfxBase64: 'pfxBase64', fingerprintSha256: 'fingerprintSha256' },
      };
      effectiveBinding.provenance['artifacts.certificate'] = 'APPLICATION_ASSET';
      request.artifactSnapshots = {
        certificate: {
          artifactId: 'certificate-version:format_pfx',
          outputs: { pfxBase64: 'opaque-pfx', fingerprintSha256: 'a'.repeat(64) },
        },
      };
    }

    const resolved = resolver.resolve(request);
    assert.equal(resolved.executable, true, `${workflowPath}: ${JSON.stringify(resolved.issues)}`);
    assert.equal(resolved.variables.siteName, 'Default Web Site');
    assert.equal(resolved.variables.bindingInformation, '*:443:iis.example.test');
    assert.equal(resolved.provenance['variables.siteName']?.source, 'derived');
    assert.equal(resolved.provenance['variables.bindingInformation']?.source, 'derived');
    assert.equal(resolved.issues.some((issue) => issue.path === 'variables.siteName'), false);
    assert.equal(resolved.issues.some((issue) => issue.path === 'variables.bindingInformation'), false);
  }
});

function iisAssetContext(): DeploymentAssetContextV1 {
  return {
    apiVersion: 'gcac.deployment-asset-context/v1',
    application: {
      id: 'asset-iis',
      address: 'iis.example.test',
      serverName: 'iis.example.test',
      port: 443,
      protocol: 'HTTPS',
    },
    site: {
      id: 'site-iis',
      type: 'web.site',
      name: 'Default Web Site',
      key: 'default-web-site',
      bindingInformation: '*:443:iis.example.test',
      hostHeader: 'iis.example.test',
      listenIp: '*',
      port: 443,
      protocol: 'HTTPS',
      metadata: {},
    },
    target: {
      id: 'target-iis',
      type: 'tls.binding',
      key: '*:443:iis.example.test',
      bindingKey: '*:443:iis.example.test',
      metadata: {},
    },
    deployment: {
      targets: [{
        id: 'target-iis',
        name: 'Default Web Site',
        serverName: 'iis.example.test',
        port: 443,
        sni: true,
        metadata: {},
      }],
      certificateResourceName: 'certificate-iis-example',
    },
  };
}

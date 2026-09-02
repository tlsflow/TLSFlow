import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPluginCertificateArtifactBindings, mergePluginCertificateArtifactBindings } from './artifacts/plugin-certificate-artifact-binding.js';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';

test('根据 Workflow artifactContract 生成 Citrix 证书产物绑定', () => {
  const plugin = {
    id: 'plugin-version-citrix',
    runtime: 'WORKFLOW_DSL',
    manifest: {
      resources: { workflows: { 'certificate.deploy': 'workflows/certificate-deploy.json' } },
    },
    resources: {
      'workflows/certificate-deploy.json': JSON.stringify({
        inputContract: {
          apiVersion: 'gcac.deployment-input/v1',
          variables: {},
          connections: {},
          credentials: {},
          artifacts: {
            certificate: {
              kind: 'certificate',
              required: true,
              configurationMode: 'required',
              lifecycle: 'pre_execution',
            artifactContract: {
              outputs: {
                leafPem: { role: 'public_certificate', required: true },
                privateKeyPem: { role: 'private_key', required: true },
                orderedChainPem: { role: 'certificate_chain', required: false },
                fingerprintSha256: { role: 'fingerprint_sha256', required: true },
              },
            },
          },
          },
        },
      }),
    },
  } as unknown as UnifiedPluginVersionRecord;

  assert.deepEqual(buildPluginCertificateArtifactBindings(plugin, 'certificate.deploy', 'certfmt-pem'), {
    certificate: {
      certificateFormatId: 'certfmt-pem',
      outputBindings: {
        leafPem: 'leafPem',
        privateKeyPem: 'privateKeyPem',
        orderedChainPem: 'orderedChainPem',
        fingerprintSha256: 'fingerprintSha256',
      },
    },
  });
});

test('PFX Artifact Contract 通过标准角色映射包和密码输出', () => {
  const plugin = {
    id: 'plugin-version-pfx',
    runtime: 'WORKFLOW_DSL',
    manifest: {
      resources: { workflows: { 'certificate.deploy': 'workflows/pfx-deploy.json' } },
    },
    resources: {
      'workflows/pfx-deploy.json': JSON.stringify({
        inputContract: {
          apiVersion: 'gcac.deployment-input/v1',
          variables: {},
          connections: {},
          credentials: {},
          artifacts: {
            certificate: {
              kind: 'certificate',
              required: true,
              configurationMode: 'required',
              lifecycle: 'pre_execution',
              artifactContract: {
                outputs: {
                  bundle: { role: 'pkcs12_bundle', required: true, sensitive: true },
                  password: { role: 'pkcs12_password', required: true, sensitive: true },
                },
              },
            },
          },
        },
      }),
    },
  } as unknown as UnifiedPluginVersionRecord;

  assert.deepEqual(buildPluginCertificateArtifactBindings(plugin, 'certificate.deploy', 'certfmt-pfx'), {
    certificate: {
      certificateFormatId: 'certfmt-pfx',
      outputBindings: { bundle: 'pfxBase64', password: 'pfxPassword' },
    },
  });
});

test('应用资产证书绑定缺少输出时由宿主补齐标准映射', () => {
  const plugin = {
    id: 'plugin-version-partial',
    runtime: 'WORKFLOW_DSL',
    manifest: {
      resources: { workflows: { 'certificate.deploy': 'workflows/deploy.json' } },
    },
    resources: {
      'workflows/deploy.json': JSON.stringify({
        inputContract: {
          apiVersion: 'gcac.deployment-input/v1',
          variables: {}, connections: {}, credentials: {},
          artifacts: {
            certificate: {
              kind: 'certificate', required: true, configurationMode: 'required', lifecycle: 'pre_execution',
              artifactContract: { outputs: {
                leafPem: { role: 'public_certificate', required: true },
                privateKeyPem: { role: 'private_key', required: true },
                orderedChainPem: { role: 'certificate_chain', required: false },
              } },
            },
          },
        },
      }),
    },
  } as unknown as UnifiedPluginVersionRecord;

  assert.deepEqual(mergePluginCertificateArtifactBindings(plugin, 'certificate.deploy', 'format-pem', {
    certificate: { certificateFormatId: 'stale-format', outputBindings: { leafPem: 'customLeaf' } },
  }), {
    certificate: {
      certificateFormatId: 'format-pem',
      outputBindings: { leafPem: 'customLeaf', privateKeyPem: 'privateKeyPem', orderedChainPem: 'orderedChainPem' },
    },
  });
});

test('Workflow DSL 通过统一 Contract Loader 拒绝缺失能力资源', () => {
  const workflowPlugin = {
    id: 'plugin-version-workflow-missing',
    runtime: 'WORKFLOW_DSL',
    manifest: { resources: { workflows: { 'certificate.deploy': 'workflows/deploy.json' } } },
    resources: {},
  } as unknown as UnifiedPluginVersionRecord;
  assert.throws(
    () => buildPluginCertificateArtifactBindings(workflowPlugin, 'certificate.deploy', 'certfmt-generic'),
    /缺少部署输入契约资源/,
  );
});

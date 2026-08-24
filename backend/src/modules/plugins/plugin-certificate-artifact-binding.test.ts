import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPluginCertificateArtifactBindings } from './artifacts/plugin-certificate-artifact-binding.js';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';

test('根据 Workflow artifactContract 生成 Citrix 证书产物绑定', () => {
  const plugin = {
    id: 'plugin-version-citrix',
    manifest: {
      resources: { workflows: { 'certificate.deploy': 'workflows/certificate-deploy.json' } },
    },
    resources: {
      'workflows/certificate-deploy.json': JSON.stringify({
        variables: {
          certificate: {
            type: 'certificate',
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import type { ResolvedDeploymentInputV1 } from './dto/resolved-deployment-input.dto.js';
import type { DeploymentInputContractV1 } from './dto/deployment-input-contract.dto.js';
import { validateDiscoveredLocationConsistency } from './domain/deployment-input-consistency.js';

const location = {
  apiVersion: 'gcac.certificate-location/v1',
  storageKind: 'PEM_FILES',
  certificatePath: '/etc/gcac-test/certs/test.crt',
  privateKeyPath: '/etc/gcac-test/certs/test.key',
  confidence: 'EXACT',
  observedAt: '2026-08-01T00:00:00.000Z',
} as const;

test('精确发现位置拒绝不同的插件默认路径', () => {
  assert.throws(() => validateDiscoveredLocationConsistency(location, contract(), resolvedInput('default', '/etc/nginx/tls/server.crt')), (error: unknown) => (
    error instanceof AppError
      && error.errorCode === 'VALIDATION_FAILED'
      && (error.details as Record<string, unknown> | undefined)?.code === 'DEPLOYMENT_INPUT_DEFAULT_OVERRIDES_DISCOVERED_LOCATION'
  ));
});

test('显式绑定允许覆盖精确发现位置', () => {
  assert.doesNotThrow(() => validateDiscoveredLocationConsistency(location, contract(), resolvedInput('binding', '/srv/custom/server.crt')));
});

function contract(): DeploymentInputContractV1 {
  return {
    apiVersion: 'gcac.deployment-input/v1',
    variables: {
      certificatePath: {
        type: 'file', required: true, configurationMode: 'advanced',
        source: { kind: 'asset', path: 'target.certificateLocation.certificatePath' },
        lifecycle: 'pre_execution', bindingPolicy: 'default_overridable', default: '/etc/nginx/tls/server.crt',
      },
    },
    connections: {}, credentials: {}, artifacts: {},
  };
}

function resolvedInput(source: 'default' | 'binding', certificatePath: string): ResolvedDeploymentInputV1 {
  return {
    apiVersion: 'gcac.resolved-deployment-input/v1',
    contractVersion: 'gcac.deployment-input/v1',
    assetContext: {
      apiVersion: 'gcac.deployment-asset-context/v1',
      application: { id: 'asset-1', address: 'example.com', serverName: 'example.com', port: 443, protocol: 'HTTPS' },
      deployment: { targets: [{ name: 'example', metadata: {} }], certificateResourceName: 'certificate-example' },
    },
    variables: { certificatePath },
    connections: {},
    credentials: {},
    artifacts: {},
    provenance: { 'variables.certificatePath': { source } },
    sensitivePaths: [],
    issues: [],
    executable: true,
    resolvedSha256: 'fixture',
  };
}

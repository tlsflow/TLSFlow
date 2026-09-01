import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateInputBindingsToContract } from './input-binding-contract-migrator.js';

test('跨插件版本迁移保留 tls.enabled=false，避免明文端口被升级为 HTTPS', () => {
  const contract = {
    apiVersion: 'gcac.deployment-input/v1',
    variables: {},
    connections: {
      management: {
        transport: 'http',
        allowedProtocols: ['http', 'https'],
        host: { type: 'string', required: true, bindingPolicy: 'required_binding', source: { kind: 'binding' } },
        port: { type: 'number', required: true, bindingPolicy: 'default_overridable', source: { kind: 'default' }, default: 5001 },
        tls: {
          enabled: { type: 'boolean', required: true, bindingPolicy: 'default_overridable', source: { kind: 'default' }, default: true },
          verifyPeer: { type: 'boolean', required: true, bindingPolicy: 'default_overridable', source: { kind: 'default' }, default: true },
        },
      },
    },
    credentials: {},
    artifacts: {},
  } as never;
  const input = {
    apiVersion: 'gcac.input-bindings/v1',
    variables: {},
    connections: { management: { host: '10.255.0.77', port: 5000, tls: { enabled: false, verifyPeer: true } } },
    credentials: {},
    artifacts: {},
  } as never;

  const migrated = migrateInputBindingsToContract(contract, input);
  assert.equal(migrated.connections.management?.tls?.enabled, false);
  assert.equal(migrated.connections.management?.tls?.verifyPeer, true);
});

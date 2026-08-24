import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { PgliteDatabase } from '../../../database/pglite-database.js';
import { runMigrations } from '../../../database/migration-runner.js';
import { StandardDeviceDiscoveryProjector } from '../../plugins/discovery/standard-device-discovery.projector.js';
import type { AgentCapabilitySnapshot, AgentRegistration } from '../schema/agents.schema.js';
import { AgentCapabilityDiscoveryProjector } from './agent-capability-discovery.projector.js';

test('Agent web.inventory 投影会淘汰旧插件 Web 资产，但不影响非 Web 插件资产', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, {
    appliedBy: 'test',
    checksum: (content) => createHash('sha256').update(content).digest('hex'),
  });
  await db.query(`insert into pg_hosts (id, tenant_id, agent_id, hostname, os_type, discovery_source, compatibility_level, management_mode, status)
    values ('host-1','tenant-1','agent-1','agent.example.test','LINUX','AGENT','L1','AGENT','ACTIVE')`);

  const standardProjector = new StandardDeviceDiscoveryProjector(db);
  await standardProjector.project({
    tenantId: 'tenant-1', hostId: 'host-1', discoveryProviderKey: 'plugin:web-nginx-v1', discoverySource: 'AGENT',
  }, legacyDiscovery('web.nginx', 'nginx', 'legacy-web', true));
  await standardProjector.project({
    tenantId: 'tenant-1', hostId: 'host-1', discoveryProviderKey: 'plugin:custom-v1', discoverySource: 'AGENT',
  }, legacyDiscovery('custom.broker', 'broker', 'legacy-nonweb', false));

  const service = new AgentCapabilityDiscoveryProjector(db, standardProjector);
  await service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory',
    confidence: 0.95,
    value: {
      configFiles: [{
        path: '/etc/nginx/conf.d/current.conf',
        content: 'server { listen 443 ssl; server_name current.example.test; ssl_certificate /etc/nginx/certs/current.pem; }',
      }],
      certificateFiles: [{
        path: '/etc/nginx/certs/current.pem',
        sha256Fingerprint: 'b'.repeat(64),
        subject: 'CN=current.example.test',
        issuer: 'CN=GCAC Test CA',
      }],
    },
  }]));

  assert.equal(await status(db, 'pg_framework_instances', 'plugin:web-nginx-v1'), 'STALE');
  assert.equal(await status(db, 'pg_site_assets', 'plugin:web-nginx-v1'), 'STALE');
  assert.equal(await status(db, 'pg_managed_targets', 'plugin:web-nginx-v1'), 'STALE');
  assert.equal((await db.query<{ status: string }>(
    "select metadata->>'discoveryStatus' as status from pg_certificate_bindings where tenant_id='tenant-1' and metadata->>'discoveryProviderKey'='plugin:web-nginx-v1'",
  )).rows[0]?.status, 'STALE');

  assert.equal(await status(db, 'pg_framework_instances', 'plugin:custom-v1'), 'ACTIVE');
  assert.equal(await status(db, 'pg_site_assets', 'plugin:custom-v1'), 'ACTIVE');
  assert.equal(await status(db, 'pg_managed_targets', 'plugin:custom-v1'), 'ACTIVE');
});

test('Agent Web 空快照不会把历史 Web 资产立即标记为 STALE', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, {
    appliedBy: 'test',
    checksum: (content) => createHash('sha256').update(content).digest('hex'),
  });
  await db.query(`insert into pg_hosts (id, tenant_id, agent_id, hostname, os_type, discovery_source, compatibility_level, management_mode, status)
    values ('host-1','tenant-1','agent-1','agent.example.test','LINUX','AGENT','L1','AGENT','ACTIVE')`);

  const standardProjector = new StandardDeviceDiscoveryProjector(db);
  await standardProjector.project({
    tenantId: 'tenant-1', hostId: 'host-1', discoveryProviderKey: 'plugin:web-nginx-v1', discoverySource: 'AGENT',
  }, legacyDiscovery('web.nginx', 'nginx', 'legacy-web', true));

  const service = new AgentCapabilityDiscoveryProjector(db, standardProjector);
  await service.project(agent(), snapshot([{ capabilityKey: 'web.inventory', confidence: 0.9, value: { configFiles: [], frameworks: [], sites: [] } }]));

  assert.equal(await status(db, 'pg_framework_instances', 'plugin:web-nginx-v1'), 'ACTIVE');
  assert.equal(await status(db, 'pg_site_assets', 'plugin:web-nginx-v1'), 'ACTIVE');
  assert.equal(await status(db, 'pg_managed_targets', 'plugin:web-nginx-v1'), 'ACTIVE');
});

function legacyDiscovery(frameworkType: string, frameworkKey: string, suffix: string, includeCertificate: boolean) {
  const certificate = includeCertificate ? [{
    stableKey: `certificate:${suffix}`,
    sha256Fingerprint: 'a'.repeat(64),
    subject: 'CN=legacy.example.test',
    issuer: 'CN=Legacy Test CA',
  }] : [];
  return {
    apiVersion: 'gcac.device-discovery/v2',
    device: { stableKey: `device:${suffix}`, displayName: suffix, productFamily: 'AGENT_HOST' },
    capabilities: [],
    frameworks: [{ stableKey: `framework:${suffix}`, frameworkType, displayName: suffix }],
    sites: [{
      stableKey: `site:${suffix}`,
      frameworkStableKey: `framework:${suffix}`,
      siteType: 'web.site',
      displayName: `${suffix}.example.test`,
      addresses: [`${suffix}.example.test`],
      port: 443,
      protocol: 'HTTPS',
    }],
    managedTargets: [{
      stableKey: `target:${suffix}`,
      frameworkStableKey: `framework:${suffix}`,
      siteStableKey: `site:${suffix}`,
      targetType: 'tls.binding',
      targetKey: `target:${suffix}`,
      supportedCapabilities: ['certificate.verify'],
      executionLocations: ['AGENT'],
    }],
    certificates: certificate,
    certificateBindings: includeCertificate ? [{
      stableKey: `binding:${suffix}`,
      managedTargetStableKey: `target:${suffix}`,
      certificateStableKey: `certificate:${suffix}`,
    }] : [],
    warnings: [],
  };
}

async function status(db: PgliteDatabase, table: 'pg_framework_instances' | 'pg_site_assets' | 'pg_managed_targets', provider: string) {
  const result = await db.query<{ status: string }>(
    `select status from ${table} where tenant_id=$1 and discovery_provider_key=$2`,
    ['tenant-1', provider],
  );
  return result.rows[0]?.status;
}

function agent(): AgentRegistration {
  return { id: 'agent-1', descriptor: { hostname: 'agent.example.test', ipAddress: '10.0.0.10', osVersion: 'Linux' } } as AgentRegistration;
}

function snapshot(capabilities: AgentCapabilitySnapshot['capabilities']): AgentCapabilitySnapshot {
  return {
    id: 'snapshot-1', tenantId: 'tenant-1', agentId: 'agent-1', reportedAt: '2026-08-13T00:00:00.000Z', capabilities,
  } as AgentCapabilitySnapshot;
}

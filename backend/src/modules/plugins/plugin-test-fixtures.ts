import { createHash } from 'node:crypto';
import type { DatabasePort } from '../../database/database-port.js';
import type { UnifiedPluginManifestV1 } from './dto/unified-plugins.dto.js';

export const canonicalPluginId = 'web.nginx' as const;
export const pluginVersion = '1.0.0' as const;

export function canonicalWorkflowPluginManifest(): UnifiedPluginManifestV1 {
  return {
    apiVersion: 'gcac.plugin-manifest/v1',
    kind: 'GcacPlugin',
    pluginId: canonicalPluginId,
    version: pluginVersion,
    displayNameKey: 'plugins.test.webNginx',
    publisher: 'test',
    runtime: 'WORKFLOW_DSL',
    source: 'USER',
    scope: 'BOTH',
    trust: 'UNSIGNED',
    support: 'SELF_MANAGED',
    permissions: [],
    resources: {
      workflows: {
        'device.discover': 'workflows/discover.json',
        'certificate.deploy': 'workflows/deploy.json',
      },
    },
    capabilities: [
      { key: 'device.discover', contractVersion: 'v1', actionContractId: 'device.discover.v1', riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'] },
      { key: 'certificate.deploy', contractVersion: 'v1', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations: ['CONTROL_PLANE'] },
    ],
  };
}

export function canonicalWorkflowPluginResources(): Record<string, string> {
  return { 'workflows/discover.json': '{}', 'workflows/deploy.json': '{}' };
}

export async function insertCanonicalPluginVersion(db: DatabasePort, id: string, tenantId: string): Promise<void> {
  const manifest = canonicalWorkflowPluginManifest();
  const resources = canonicalWorkflowPluginResources();
  const manifestSha256 = sha256(JSON.stringify(manifest));
  const resourceSha256 = Object.fromEntries(Object.entries(resources).map(([path, content]) => [path, sha256(content)]));
  const packageSha256 = sha256(JSON.stringify({ manifest, resources: resourceSha256 }));
  await db.query(`insert into unified_plugin_versions
    (id,tenant_id,plugin_id,plugin_version,source,runtime,scope,trust,support,manifest,package_sha256,manifest_sha256,resource_sha256,status,permission_approval_status,approved_permissions,validation_report,created_at,updated_at)
    values ($1,$2,$3,$4,'USER','WORKFLOW_DSL','BOTH','UNSIGNED','SELF_MANAGED',$5::jsonb,$6,$7,$8::jsonb,'ENABLED','NOT_REQUIRED','[]'::jsonb,$9::jsonb,now(),now())`, [
    id,
    tenantId,
    canonicalPluginId,
    pluginVersion,
    JSON.stringify(manifest),
    packageSha256,
    manifestSha256,
    JSON.stringify(resourceSha256),
    JSON.stringify({ valid: true, errors: [], warnings: [], manifestSha256, resourceSha256 }),
  ]);
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

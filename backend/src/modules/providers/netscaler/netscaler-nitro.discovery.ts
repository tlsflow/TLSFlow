import { buildNetscalerCertKeyUsage, normalizeNetscalerBindings } from './netscaler-nitro.bindings.js';
import { getNetscalerCapabilityProfile } from './netscaler-nitro.capabilities.js';
import type { NetscalerNitroClient } from './netscaler-nitro.client.js';
import { enrichNetscalerCertificateFingerprints, normalizeNetscalerCertificates } from './netscaler-nitro.certificates.js';
import { parseNetscalerVersion } from './netscaler-nitro.version.js';
import type { NetscalerCapabilityProfile, NetscalerCertificateBinding, NetscalerCertificateResource, NetscalerDeviceFacts, NetscalerVersion, NetscalerVirtualServer, NetscalerVirtualServerType } from './netscaler.types.js';

export interface NetscalerDiscoveryResult {
  version: NetscalerVersion;
  capabilityProfile: NetscalerCapabilityProfile;
  device: NetscalerDeviceFacts;
  virtualServers: NetscalerVirtualServer[];
  certificates: NetscalerCertificateResource[];
  bindings: NetscalerCertificateBinding[];
  certKeyUsage: ReturnType<typeof buildNetscalerCertKeyUsage>;
  warnings: string[];
}

const virtualServerResources = [
  ['lbVirtualServer', 'lbvserver', 'LB'],
  ['csVirtualServer', 'csvserver', 'CS'],
  ['vpnVirtualServer', 'vpnvserver', 'VPN'],
  ['gslbVirtualServer', 'gslbvserver', 'GSLB'],
] as const;

export async function discoverNetscaler(client: NetscalerNitroClient): Promise<NetscalerDiscoveryResult> {
  const warnings: string[] = [];
  const versionResponse = await client.request({ path: '/nitro/v1/config/nsversion' });
  const versionRow = firstRecord(versionResponse.nsversion);
  const rawVersion = text(versionRow.version) ?? text(versionRow.versionstring) ?? 'unknown';
  const version = parseNetscalerVersion(rawVersion);
  const capabilityProfile = getNetscalerCapabilityProfile(version);
  const sourceVersion = version.normalized ?? `${version.major}.${version.minor}`;

  const virtualServers: NetscalerVirtualServer[] = [];
  for (const [capability, resource, type] of virtualServerResources) {
    if (!capabilityProfile.discovery[capability]) continue;
    const rows = await readRows(client, resource, warnings);
    virtualServers.push(...normalizeVirtualServers(rows, type, sourceVersion));
  }
  const certificateResources = capabilityProfile.discovery.sslCertKey
    ? normalizeNetscalerCertificates(await readRows(client, 'sslcertkey', warnings), sourceVersion)
    : [];
  const certificates = await enrichNetscalerCertificateFingerprints(client, certificateResources, warnings);
  const bindings = capabilityProfile.discovery.sslBindings
    ? normalizeNetscalerBindings(
      await readRows(client, 'sslvserver_sslcertkey_binding', warnings, { bulkbindings: 'yes' }),
      sourceVersion,
      virtualServers,
    )
    : [];

  return {
    version,
    capabilityProfile,
    device: {
      productName: text(versionRow.productname) ?? 'NetScaler ADC',
      softwareVersion: version.major > 0 ? `${version.major}.${version.minor}` : 'unknown',
      softwareBuild: version.build,
      runtimeMode: text(versionRow.mode),
      haMode: text(versionRow.hamode),
      rawSummary: safeSummary(versionRow),
    },
    virtualServers,
    certificates,
    bindings,
    certKeyUsage: buildNetscalerCertKeyUsage(bindings),
    warnings,
  };
}

async function readRows(client: NetscalerNitroClient, resource: string, warnings: string[], query?: Record<string, string>): Promise<unknown[]> {
  try {
    const response = await client.request({ path: `/nitro/v1/config/${resource}`, query });
    return Array.isArray(response[resource]) ? response[resource] as unknown[] : [];
  } catch (error) {
    warnings.push(`${resource}:${error instanceof Error ? error.name : 'UNKNOWN_ERROR'}`);
    return [];
  }
}

function normalizeVirtualServers(rows: unknown[], type: NetscalerVirtualServerType, sourceVersion: string): NetscalerVirtualServer[] {
  return rows.flatMap((item) => {
    const row = asRecord(item);
    const name = text(row.name);
    if (!name) return [];
    return [{
      type,
      name,
      address: text(row.ipv46) ?? text(row.ipaddress),
      port: number(row.port),
      protocol: text(row.servicetype),
      state: text(row.curstate) ?? text(row.state),
      sniNames: stringArray(row.domainname),
      sourceVersion,
      rawSummary: safeSummary(row),
    }];
  });
}

function firstRecord(value: unknown): Record<string, unknown> { return asRecord(Array.isArray(value) ? value[0] : value); }
function safeSummary(row: Record<string, unknown>): Record<string, unknown> { return Object.fromEntries(Object.entries(row).filter(([key]) => !/(password|cookie|secret)/i.test(key))); }
function asRecord(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function number(value: unknown): number | undefined { const result = Number(value); return Number.isFinite(result) ? result : undefined; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : typeof value === 'string' && value ? value.split(',').map((item) => item.trim()).filter(Boolean) : []; }

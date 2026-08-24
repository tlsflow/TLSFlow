import type { NetscalerCertificateBinding, NetscalerCertKeyUsage, NetscalerVirtualServer, NetscalerVirtualServerType } from './netscaler.types.js';

export function normalizeNetscalerBindings(
  value: unknown,
  sourceVersion: string,
  virtualServers: readonly NetscalerVirtualServer[] = [],
): NetscalerCertificateBinding[] {
  const virtualServerTypes = buildVirtualServerTypeIndex(virtualServers);
  return asArray(value).flatMap((item) => {
    const row = asRecord(item);
    const virtualServerName = text(row.vservername) ?? text(row.name);
    const certKeyName = text(row.certkeyname) ?? text(row.certkey);
    if (!virtualServerName || !certKeyName) return [];
    const virtualServerType = normalizeType(text(row.vservertype) ?? text(row.type))
      ?? inferVirtualServerType(virtualServerTypes, virtualServerName);
    if (!virtualServerType) return [];
    return [{
      virtualServerType,
      virtualServerName,
      certKeyName,
      sniCertificate: boolean(row.snicert),
      priority: number(row.priority),
      sourceVersion,
      rawSummary: safeSummary(row),
    }];
  });
}

export function buildNetscalerCertKeyUsage(bindings: NetscalerCertificateBinding[]): Record<string, NetscalerCertKeyUsage[]> {
  const output: Record<string, NetscalerCertKeyUsage[]> = {};
  for (const binding of [...bindings].sort(compareBinding)) {
    (output[binding.certKeyName] ??= []).push({
      certKeyName: binding.certKeyName,
      virtualServerType: binding.virtualServerType,
      virtualServerName: binding.virtualServerName,
    });
  }
  return output;
}

function compareBinding(left: NetscalerCertificateBinding, right: NetscalerCertificateBinding): number {
  return left.certKeyName.localeCompare(right.certKeyName) || left.virtualServerType.localeCompare(right.virtualServerType) || left.virtualServerName.localeCompare(right.virtualServerName);
}

function buildVirtualServerTypeIndex(virtualServers: readonly NetscalerVirtualServer[]): Map<string, Set<NetscalerVirtualServerType>> {
  const output = new Map<string, Set<NetscalerVirtualServerType>>();
  for (const virtualServer of virtualServers) {
    const types = output.get(virtualServer.name) ?? new Set<NetscalerVirtualServerType>();
    types.add(virtualServer.type);
    output.set(virtualServer.name, types);
  }
  return output;
}

function inferVirtualServerType(
  virtualServerTypes: Map<string, Set<NetscalerVirtualServerType>>,
  virtualServerName: string,
): NetscalerVirtualServerType | undefined {
  const types = virtualServerTypes.get(virtualServerName);
  return types?.size === 1 ? [...types][0] : undefined;
}

function normalizeType(value: string | undefined): NetscalerVirtualServerType | undefined {
  const upper = value?.trim().toUpperCase();
  if (upper === 'LB' || upper === 'LOADBALANCING') return 'LB';
  if (upper === 'CS' || upper === 'CONTENTSWITCHING') return 'CS';
  if (upper === 'VPN' || upper === 'SSLVPN') return 'VPN';
  if (upper === 'GSLB') return 'GSLB';
  return undefined;
}

function safeSummary(row: Record<string, unknown>): Record<string, unknown> { return Object.fromEntries(Object.entries(row).filter(([key]) => !/(password|cookie|secret)/i.test(key))); }
function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function asRecord(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function number(value: unknown): number | undefined { const result = Number(value); return Number.isFinite(result) ? result : undefined; }
function boolean(value: unknown): boolean { return value === true || value === 1 || String(value).toUpperCase() === 'YES'; }

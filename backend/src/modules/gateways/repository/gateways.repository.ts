import { AppError } from '../../../common/errors/app-error.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import { newId } from '../../../shared/id.js';
import type { GatewayAgentProfile, GatewayAdapterType, GatewayStatus, ReachabilityRecord, Zone } from '../../gateway-agents/index.js';
import type { GatewayCredentialSessionDto, GatewayDto, GatewayReachabilityDto, GatewayZoneDto, RegisterGatewayInput } from '../dto/gateways.dto.js';

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface GatewaysRepository {
  readonly moduleName: 'gateways';
  ensureDefaultZones(tenantId: string): GatewayZoneDto[];
  upsertZone(tenantId: string, input: Omit<Zone, 'id'> & { id?: string }): GatewayZoneDto;
  listZones(tenantId: string): GatewayZoneDto[];
  registerGateway(tenantId: string, input: RegisterGatewayInput): GatewayDto;
  updateGatewayStatus(tenantId: string, gatewayId: string, input: Partial<GatewayDto>): GatewayDto;
  getGateway(tenantId: string, gatewayId: string): GatewayDto | undefined;
  findGatewayByAgentId(tenantId: string, agentId: string): GatewayDto | undefined;
  listGateways(tenantId: string, query: PageQuery): PageResult<GatewayDto>;
  upsertReachability(tenantId: string, input: Omit<GatewayReachabilityDto, 'id' | 'tenantId' | 'checkedAt' | 'expiresAt' | 'createdAt' | 'updatedAt'> & { ttlSeconds: number; now?: Date }): GatewayReachabilityDto;
  listReachability(tenantId: string, gatewayId?: string, targetId?: string): GatewayReachabilityDto[];
  findReachability(tenantId: string, gatewayId: string, targetId: string, protocol: GatewayAdapterType, now?: Date): ReachabilityRecord | undefined;
  recordCredentialSession(tenantId: string, input: Omit<GatewayCredentialSessionDto, 'tenantId'>): GatewayCredentialSessionDto;
  revokeUnusedCredentialSessions(tenantId: string, gatewayId: string, now?: Date): GatewayCredentialSessionDto[];
  toZoneRouterInputs(tenantId: string): { zones: Zone[]; gateways: GatewayAgentProfile[] };
}

export class InMemoryGatewaysRepository implements GatewaysRepository {
  readonly moduleName = 'gateways' as const;
  private readonly zones = new Map<string, GatewayZoneDto>();
  private readonly gateways = new Map<string, GatewayDto>();
  private readonly reachability = new Map<string, GatewayReachabilityDto>();
  private readonly credentialSessions = new Map<string, GatewayCredentialSessionDto>();

  ensureDefaultZones(tenantId: string): GatewayZoneDto[] {
    const existing = this.listZones(tenantId);
    if (existing.length > 0) return existing;
    return [
      this.upsertZone(tenantId, { id: 'zone_prod', name: '生产区', type: 'production', enabled: true, policy: { priority: 10, allowedAdapters: ['ssh', 'winrm', 'curl'], maxConcurrentTasks: 10 } }),
      this.upsertZone(tenantId, { id: 'zone_dmz', name: 'DMZ', type: 'dmz', enabled: true, policy: { priority: 8, allowedAdapters: ['ssh', 'curl'], maxConcurrentTasks: 5 } }),
    ];
  }

  upsertZone(tenantId: string, input: Omit<Zone, 'id'> & { id?: string }): GatewayZoneDto {
    const id = input.id ?? newId('zone');
    const current = this.zones.get(key(tenantId, id));
    const now = nowIso();
    const zone: GatewayZoneDto = {
      id,
      tenantId,
      name: input.name,
      type: input.type,
      policy: input.policy,
      enabled: input.enabled,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.zones.set(key(tenantId, id), zone);
    return zone;
  }

  listZones(tenantId: string): GatewayZoneDto[] {
    return [...this.zones.values()].filter((zone) => zone.tenantId === tenantId);
  }

  registerGateway(tenantId: string, input: RegisterGatewayInput): GatewayDto {
    if (input.zoneIds.length === 0) throw new AppError('VALIDATION_FAILED', 'Gateway 必须绑定至少一个 Zone', { field: 'zoneIds' });
    this.ensureDefaultZones(tenantId);
    const missingZone = input.zoneIds.find((zoneId) => !this.zones.has(key(tenantId, zoneId)));
    if (missingZone) throw new AppError('RESOURCE_NOT_FOUND', 'Zone 不存在', { zoneId: missingZone });

    const current = input.id ? this.getGateway(tenantId, input.id) : this.findGatewayByAgentId(tenantId, input.agentId);
    const now = nowIso();
    const gateway: GatewayDto = {
      id: current?.id ?? input.id ?? newId('gw'),
      tenantId,
      agentId: input.agentId,
      zoneIds: dedupe(input.zoneIds),
      version: input.version,
      status: 'online',
      adapters: dedupe(input.adapters),
      capabilities: dedupe(input.capabilities ?? input.adapters.map((adapter) => `adapter.${adapter}`)),
      capabilitySetId: input.capabilitySetId ?? current?.capabilitySetId ?? newId('capset'),
      currentLoad: input.currentLoad ?? current?.currentLoad ?? 0,
      maxConcurrentTasks: input.maxConcurrentTasks ?? current?.maxConcurrentTasks ?? 4,
      successRate: input.successRate ?? current?.successRate ?? 1,
      lastHeartbeatAt: now,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.gateways.set(key(tenantId, gateway.id), gateway);
    return gateway;
  }

  updateGatewayStatus(tenantId: string, gatewayId: string, input: Partial<GatewayDto>): GatewayDto {
    const current = this.requireGateway(tenantId, gatewayId);
    const now = nowIso();
    const status = input.status ?? current.status;
    const updated: GatewayDto = {
      ...current,
      ...input,
      zoneIds: input.zoneIds ? dedupe(input.zoneIds) : current.zoneIds,
      adapters: input.adapters ? dedupe(input.adapters) : current.adapters,
      capabilities: input.capabilities ? dedupe(input.capabilities) : current.capabilities,
      status,
      disabledAt: status === 'disabled' ? current.disabledAt ?? now : current.disabledAt,
      revokedAt: status === 'revoked' ? current.revokedAt ?? now : current.revokedAt,
      lastHeartbeatAt: status === 'online' ? now : input.lastHeartbeatAt ?? current.lastHeartbeatAt,
      updatedAt: now,
    };
    if (updated.zoneIds.length === 0) throw new AppError('VALIDATION_FAILED', 'Gateway 必须绑定至少一个 Zone', { field: 'zoneIds' });
    this.gateways.set(key(tenantId, gatewayId), updated);
    if (status === 'disabled' || status === 'revoked') this.revokeUnusedCredentialSessions(tenantId, gatewayId);
    return updated;
  }

  getGateway(tenantId: string, gatewayId: string): GatewayDto | undefined {
    return this.gateways.get(key(tenantId, gatewayId));
  }

  findGatewayByAgentId(tenantId: string, agentId: string): GatewayDto | undefined {
    return [...this.gateways.values()].find((gateway) => gateway.tenantId === tenantId && gateway.agentId === agentId);
  }

  listGateways(tenantId: string, query: PageQuery): PageResult<GatewayDto> {
    const filtered = [...this.gateways.values()].filter((gateway) => {
      if (gateway.tenantId !== tenantId) return false;
      if (query.filter.zoneId && !gateway.zoneIds.includes(query.filter.zoneId)) return false;
      if (query.filter.status && gateway.status !== query.filter.status) return false;
      return true;
    });
    return page(filtered, query);
  }

  upsertReachability(tenantId: string, input: Omit<GatewayReachabilityDto, 'id' | 'tenantId' | 'checkedAt' | 'expiresAt' | 'createdAt' | 'updatedAt'> & { ttlSeconds: number; now?: Date }): GatewayReachabilityDto {
    this.requireGateway(tenantId, input.gatewayId);
    const now = input.now ?? new Date();
    const reachKey = reachabilityKey(tenantId, input.gatewayId, input.targetId, input.protocol);
    const current = this.reachability.get(reachKey);
    const record: GatewayReachabilityDto = {
      id: current?.id ?? newId('reach'),
      tenantId,
      gatewayId: input.gatewayId,
      targetId: input.targetId,
      protocol: input.protocol,
      port: input.port,
      status: input.status,
      latencyMs: input.latencyMs,
      checkedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.ttlSeconds * 1000).toISOString(),
      createdAt: current?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.reachability.set(reachKey, record);
    return record;
  }

  listReachability(tenantId: string, gatewayId?: string, targetId?: string): GatewayReachabilityDto[] {
    return [...this.reachability.values()].filter((record) => record.tenantId === tenantId && (!gatewayId || record.gatewayId === gatewayId) && (!targetId || record.targetId === targetId));
  }

  findReachability(tenantId: string, gatewayId: string, targetId: string, protocol: GatewayAdapterType, now = new Date()): ReachabilityRecord | undefined {
    const record = this.reachability.get(reachabilityKey(tenantId, gatewayId, targetId, protocol));
    if (!record) return undefined;
    const status = new Date(record.expiresAt).getTime() <= now.getTime() ? 'expired' : record.status;
    return { id: record.id, gatewayId, targetId, protocol, port: record.port, status, latencyMs: record.latencyMs, checkedAt: record.checkedAt, expiresAt: record.expiresAt };
  }

  recordCredentialSession(tenantId: string, input: Omit<GatewayCredentialSessionDto, 'tenantId'>): GatewayCredentialSessionDto {
    const session = { ...input, tenantId };
    this.credentialSessions.set(key(tenantId, session.id), session);
    return session;
  }

  revokeUnusedCredentialSessions(tenantId: string, gatewayId: string, now = new Date()): GatewayCredentialSessionDto[] {
    const revoked: GatewayCredentialSessionDto[] = [];
    for (const session of this.credentialSessions.values()) {
      if (session.tenantId !== tenantId || session.gatewayId !== gatewayId || session.status !== 'active') continue;
      const updated = { ...session, status: 'revoked' as const, revokedAt: now.toISOString() };
      this.credentialSessions.set(key(tenantId, session.id), updated);
      revoked.push(updated);
    }
    return revoked;
  }

  toZoneRouterInputs(tenantId: string): { zones: Zone[]; gateways: GatewayAgentProfile[] } {
    this.ensureDefaultZones(tenantId);
    return {
      zones: this.listZones(tenantId).map(({ id, name, type, policy, enabled }) => ({ id, name, type, policy, enabled })),
      gateways: [...this.gateways.values()].filter((gateway) => gateway.tenantId === tenantId).map(toGatewayProfile),
    };
  }

  private requireGateway(tenantId: string, gatewayId: string): GatewayDto {
    const gateway = this.getGateway(tenantId, gatewayId);
    if (!gateway) throw new AppError('RESOURCE_NOT_FOUND', 'Gateway 不存在', { gatewayId });
    return gateway;
  }
}

function toGatewayProfile(gateway: GatewayDto): GatewayAgentProfile {
  return {
    id: gateway.id,
    agentId: gateway.agentId,
    zoneIds: gateway.zoneIds,
    version: gateway.version,
    status: gateway.status,
    adapters: gateway.adapters,
    capabilities: gateway.capabilities,
    capabilitySetId: gateway.capabilitySetId,
    currentLoad: gateway.currentLoad,
    maxConcurrentTasks: gateway.maxConcurrentTasks,
    successRate: gateway.successRate,
    lastHeartbeatAt: gateway.lastHeartbeatAt,
  };
}

function page<T extends { updatedAt?: string; id: string }>(items: T[], query: PageQuery): PageResult<T> {
  const sorted = [...items].sort((left, right) => {
    const field = query.sort?.field as keyof T | undefined;
    const direction = query.sort?.direction === 'desc' ? -1 : 1;
    const leftValue = field ? String(left[field] ?? '') : String(left.updatedAt ?? left.id);
    const rightValue = field ? String(right[field] ?? '') : String(right.updatedAt ?? right.id);
    return leftValue.localeCompare(rightValue) * direction;
  });
  const start = (query.page - 1) * query.pageSize;
  return { items: sorted.slice(start, start + query.pageSize), page: query.page, pageSize: query.pageSize, total: sorted.length };
}

function key(tenantId: string, id: string): string {
  return `${tenantId}:${id}`;
}

function reachabilityKey(tenantId: string, gatewayId: string, targetId: string, protocol: string): string {
  return `${tenantId}:${gatewayId}:${targetId}:${protocol}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

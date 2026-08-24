import { AppError } from '../../../common/errors/app-error.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { newId } from '../../../shared/id.js';
import type { GatewayAgentProfile, GatewayAdapterType, GatewayStatus, ReachabilityRecord, Zone } from '../../gateway-agents/index.js';
import { PgGatewayTargetHistoryRepository, type GatewayTargetHistoryRecord, type GatewayTargetHistoryRepositoryPort } from '../../gateway-agents/gateway-target-history.service.js';
import type { GatewayCredentialSessionDto, GatewayDto, GatewayReachabilityDto, GatewayZoneDto, RegisterGatewayInput } from '../dto/gateways.dto.js';

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface GatewaysRepository {
  readonly moduleName: 'gateways';
  ensureDefaultZones(tenantId: string): Promise<GatewayZoneDto[]>;
  upsertZone(tenantId: string, input: Omit<Zone, 'id'> & { id?: string }): Promise<GatewayZoneDto>;
  listZones(tenantId: string): Promise<GatewayZoneDto[]>;
  registerGateway(tenantId: string, input: RegisterGatewayInput): Promise<GatewayDto>;
  updateGatewayStatus(tenantId: string, gatewayId: string, input: Partial<GatewayDto>): Promise<GatewayDto>;
  getGateway(tenantId: string, gatewayId: string): Promise<GatewayDto | undefined>;
  findGatewayByAgentId(tenantId: string, agentId: string): Promise<GatewayDto | undefined>;
  listGateways(tenantId: string, query: PageQuery): Promise<PageResult<GatewayDto>>;
  upsertReachability(tenantId: string, input: Omit<GatewayReachabilityDto, 'id' | 'tenantId' | 'checkedAt' | 'expiresAt' | 'createdAt' | 'updatedAt'> & { ttlSeconds: number; now?: Date }): Promise<GatewayReachabilityDto>;
  listReachability(tenantId: string, gatewayId?: string, targetId?: string): Promise<GatewayReachabilityDto[]>;
  findReachability(tenantId: string, gatewayId: string, targetId: string, protocol: GatewayAdapterType, now?: Date): Promise<ReachabilityRecord | undefined>;
  recordCredentialSession(tenantId: string, input: Omit<GatewayCredentialSessionDto, 'tenantId'>): Promise<GatewayCredentialSessionDto>;
  revokeUnusedCredentialSessions(tenantId: string, gatewayId: string, now?: Date): Promise<GatewayCredentialSessionDto[]>;
  toZoneRouterInputs(tenantId: string): Promise<{ zones: Zone[]; gateways: GatewayAgentProfile[] }>;
}

export class PgGatewaysRepository implements GatewaysRepository {
  readonly moduleName = 'gateways' as const;

  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async ensureDefaultZones(tenantId: string): Promise<GatewayZoneDto[]> {
    const existing = await this.listZones(tenantId);
    if (existing.length > 0) return existing;
    return [
      await this.upsertZone(tenantId, { id: 'zone_prod', name: '生产区', type: 'production', enabled: true, policy: { priority: 10, allowedAdapters: ['ssh', 'winrm', 'curl'], maxConcurrentTasks: 10 } }),
      await this.upsertZone(tenantId, { id: 'zone_dmz', name: 'DMZ', type: 'dmz', enabled: true, policy: { priority: 8, allowedAdapters: ['ssh', 'curl'], maxConcurrentTasks: 5 } }),
    ];
  }

  async upsertZone(tenantId: string, input: Omit<Zone, 'id'> & { id?: string }): Promise<GatewayZoneDto> {
    await this.ensureSchema();
    const id = input.id ?? newId('zone');
    const current = await this.getZone(tenantId, id);
    const now = nowIso();
    const zone: GatewayZoneDto = { id, tenantId, name: input.name, type: input.type, policy: input.policy, enabled: input.enabled, createdAt: current?.createdAt ?? now, updatedAt: now };
    await this.db.query(
      `insert into pg_gateway_zones (id, tenant_id, name, zone_type, policy, enabled, created_at, updated_at)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7::timestamptz,$8::timestamptz)
       on conflict (id) do update set name = excluded.name, zone_type = excluded.zone_type, policy = excluded.policy, enabled = excluded.enabled, updated_at = excluded.updated_at`,
      [zone.id, tenantId, zone.name, zone.type, JSON.stringify(zone.policy), zone.enabled, zone.createdAt, zone.updatedAt],
    );
    return zone;
  }

  async listZones(tenantId: string): Promise<GatewayZoneDto[]> {
    await this.ensureSchema();
    const rows = (await this.db.query<GatewayZoneRow>(`select * from pg_gateway_zones where tenant_id = $1 order by updated_at asc`, [tenantId])).rows;
    return rows.map(toZone);
  }

  async registerGateway(tenantId: string, input: RegisterGatewayInput): Promise<GatewayDto> {
    if (input.zoneIds.length === 0) throw new AppError('VALIDATION_FAILED', 'Gateway 必须绑定至少一个 Zone', { field: 'zoneIds' });
    await this.ensureDefaultZones(tenantId);
    const missingZone = (await Promise.all(input.zoneIds.map(async (zoneId) => [zoneId, await this.getZone(tenantId, zoneId)] as const))).find(([, zone]) => !zone);
    if (missingZone) throw new AppError('RESOURCE_NOT_FOUND', 'Zone 不存在', { zoneId: missingZone[0] });

    const current = input.id ? await this.getGateway(tenantId, input.id) : await this.findGatewayByAgentId(tenantId, input.agentId);
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
    await this.upsertGateway(gateway);
    return gateway;
  }

  async updateGatewayStatus(tenantId: string, gatewayId: string, input: Partial<GatewayDto>): Promise<GatewayDto> {
    const current = await this.requireGateway(tenantId, gatewayId);
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
    await this.upsertGateway(updated);
    if (status === 'disabled' || status === 'revoked') await this.revokeUnusedCredentialSessions(tenantId, gatewayId);
    return updated;
  }

  async getGateway(tenantId: string, gatewayId: string): Promise<GatewayDto | undefined> {
    await this.ensureSchema();
    const row = (await this.db.query<GatewayRow>(`select * from pg_gateways where tenant_id = $1 and id = $2`, [tenantId, gatewayId])).rows[0];
    return row ? toGateway(row) : undefined;
  }

  async findGatewayByAgentId(tenantId: string, agentId: string): Promise<GatewayDto | undefined> {
    await this.ensureSchema();
    const row = (await this.db.query<GatewayRow>(`select * from pg_gateways where tenant_id = $1 and agent_id = $2 order by updated_at desc limit 1`, [tenantId, agentId])).rows[0];
    return row ? toGateway(row) : undefined;
  }

  async listGateways(tenantId: string, query: PageQuery): Promise<PageResult<GatewayDto>> {
    const rows = (await this.db.query<GatewayRow>(`select * from pg_gateways where tenant_id = $1 order by updated_at asc`, [tenantId])).rows.map(toGateway);
    const filtered = rows.filter((gateway) => {
      if (query.filter.zoneId && !gateway.zoneIds.includes(query.filter.zoneId)) return false;
      if (query.filter.status && gateway.status !== query.filter.status) return false;
      return true;
    });
    return page(filtered, query);
  }

  async upsertReachability(tenantId: string, input: Omit<GatewayReachabilityDto, 'id' | 'tenantId' | 'checkedAt' | 'expiresAt' | 'createdAt' | 'updatedAt'> & { ttlSeconds: number; now?: Date }): Promise<GatewayReachabilityDto> {
    const gateway = await this.requireGateway(tenantId, input.gatewayId);
    void gateway;
    const now = input.now ?? new Date();
    const current = await this.getReachabilityRow(tenantId, input.gatewayId, input.targetId, input.protocol);
    const record: GatewayReachabilityDto = {
      id: current?.entity_id ?? current?.id ?? newId('reach'),
      tenantId,
      gatewayId: input.gatewayId,
      targetId: input.targetId,
      protocol: input.protocol,
      port: input.port,
      status: input.status,
      latencyMs: input.latencyMs,
      checkedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.ttlSeconds * 1000).toISOString(),
      createdAt: current?.created_at ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await this.db.query(
      `insert into pg_gateway_reachability (id, tenant_id, gateway_id, target_id, protocol, port, status, latency_ms, checked_at, expires_at, created_at, updated_at, entity_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz,$11::timestamptz,$12::timestamptz,$13)
       on conflict (tenant_id, gateway_id, target_id, protocol) do update set port = excluded.port, status = excluded.status, latency_ms = excluded.latency_ms, checked_at = excluded.checked_at, expires_at = excluded.expires_at, updated_at = excluded.updated_at, entity_id = excluded.entity_id`,
      [record.id, tenantId, record.gatewayId, record.targetId, record.protocol, record.port ?? null, record.status, record.latencyMs ?? null, record.checkedAt, record.expiresAt, record.createdAt, record.updatedAt, record.id],
    );
    return record;
  }

  async listReachability(tenantId: string, gatewayId?: string, targetId?: string): Promise<GatewayReachabilityDto[]> {
    const rows = (await this.db.query<GatewayReachabilityRow>(`select * from pg_gateway_reachability where tenant_id = $1`, [tenantId])).rows.map(toReachability);
    return rows.filter((record) => (!gatewayId || record.gatewayId === gatewayId) && (!targetId || record.targetId === targetId));
  }

  async findReachability(tenantId: string, gatewayId: string, targetId: string, protocol: GatewayAdapterType, now = new Date()): Promise<ReachabilityRecord | undefined> {
    const record = await this.getReachabilityRow(tenantId, gatewayId, targetId, protocol);
    if (!record) return undefined;
    const persisted = toReachability(record);
    const status = new Date(persisted.expiresAt).getTime() <= now.getTime() ? 'expired' : persisted.status;
    return { id: persisted.id, gatewayId, targetId, protocol, port: persisted.port, status, latencyMs: persisted.latencyMs, checkedAt: persisted.checkedAt, expiresAt: persisted.expiresAt };
  }

  async recordCredentialSession(tenantId: string, input: Omit<GatewayCredentialSessionDto, 'tenantId'>): Promise<GatewayCredentialSessionDto> {
    const session = { ...input, tenantId };
    await this.db.query(
      `insert into pg_gateway_credential_sessions (
         id, tenant_id, task_id, secret_ref, grant_ref, gateway_id, target_id, protocol, allowed_actions,
         remaining_uses, expires_at, status, created_at, revoked_at
       ) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11::timestamptz,$12,$13::timestamptz,$14::timestamptz)
       on conflict (id) do update set status = excluded.status, remaining_uses = excluded.remaining_uses, revoked_at = excluded.revoked_at`,
      [session.id, tenantId, session.taskId, JSON.stringify(session.secretRef), JSON.stringify(session.grantRef), session.gatewayId, session.targetId, session.protocol, JSON.stringify(session.allowedActions), session.remainingUses, session.expiresAt, session.status, session.createdAt, session.revokedAt ?? null],
    );
    return session;
  }

  async revokeUnusedCredentialSessions(tenantId: string, gatewayId: string, now = new Date()): Promise<GatewayCredentialSessionDto[]> {
    const revoked: GatewayCredentialSessionDto[] = [];
    const rows = (await this.db.query<GatewayCredentialSessionRow>(`select * from pg_gateway_credential_sessions where tenant_id = $1 and gateway_id = $2 and status = 'active'`, [tenantId, gatewayId])).rows;
    for (const row of rows) {
      const updated = toCredentialSession(row);
      updated.status = 'revoked';
      updated.revokedAt = now.toISOString();
      revoked.push(updated);
      await this.recordCredentialSession(tenantId, updated);
    }
    return revoked;
  }

  async toZoneRouterInputs(tenantId: string): Promise<{ zones: Zone[]; gateways: GatewayAgentProfile[] }> {
    await this.ensureDefaultZones(tenantId);
    return {
      zones: (await this.listZones(tenantId)).map(({ id, name, type, policy, enabled }) => ({ id, name, type, policy, enabled })),
      gateways: (await this.listGateways(tenantId, { page: 1, pageSize: 1000, filter: {} })).items.map(toGatewayProfile),
    };
  }

  private async upsertGateway(gateway: GatewayDto): Promise<void> {
    await this.db.query(
      `insert into pg_gateways (
         id, tenant_id, agent_id, zone_ids, version, status, adapters, capabilities, capability_set_id,
         current_load, max_concurrent_tasks, success_rate, last_heartbeat_at, revoked_at, disabled_at, created_at, updated_at
       ) values ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13::timestamptz,$14::timestamptz,$15::timestamptz,$16::timestamptz,$17::timestamptz)
       on conflict (id) do update set
         agent_id = excluded.agent_id,
         zone_ids = excluded.zone_ids,
         version = excluded.version,
         status = excluded.status,
         adapters = excluded.adapters,
         capabilities = excluded.capabilities,
         capability_set_id = excluded.capability_set_id,
         current_load = excluded.current_load,
         max_concurrent_tasks = excluded.max_concurrent_tasks,
         success_rate = excluded.success_rate,
         last_heartbeat_at = excluded.last_heartbeat_at,
         revoked_at = excluded.revoked_at,
         disabled_at = excluded.disabled_at,
         updated_at = excluded.updated_at`,
      [
        gateway.id, gateway.tenantId, gateway.agentId, JSON.stringify(gateway.zoneIds), gateway.version, gateway.status, JSON.stringify(gateway.adapters), JSON.stringify(gateway.capabilities), gateway.capabilitySetId,
        gateway.currentLoad, gateway.maxConcurrentTasks, gateway.successRate, gateway.lastHeartbeatAt ?? null, gateway.revokedAt ?? null, gateway.disabledAt ?? null, gateway.createdAt, gateway.updatedAt,
      ],
    );
  }

  private async requireGateway(tenantId: string, gatewayId: string): Promise<GatewayDto> {
    const gateway = await this.getGateway(tenantId, gatewayId);
    if (!gateway) throw new AppError('RESOURCE_NOT_FOUND', 'Gateway 不存在', { gatewayId });
    return gateway;
  }

  private async getZone(tenantId: string, zoneId: string): Promise<GatewayZoneDto | undefined> {
    const row = (await this.db.query<GatewayZoneRow>(`select * from pg_gateway_zones where tenant_id = $1 and id = $2`, [tenantId, zoneId])).rows[0];
    return row ? toZone(row) : undefined;
  }

  private async getReachabilityRow(tenantId: string, gatewayId: string, targetId: string, protocol: GatewayAdapterType): Promise<GatewayReachabilityRow | undefined> {
    await this.ensureSchema();
    return (await this.db.query<GatewayReachabilityRow>(`select * from pg_gateway_reachability where tenant_id = $1 and gateway_id = $2 and target_id = $3 and protocol = $4`, [tenantId, gatewayId, targetId, protocol])).rows[0];
  }

  private async ensureSchema(): Promise<void> {
    await this.db.exec(`
      create table if not exists pg_gateway_zones (
        id varchar(128) primary key,
        tenant_id varchar(128) not null,
        name text not null,
        zone_type varchar(64) not null,
        policy jsonb not null,
        enabled boolean not null default true,
        created_at timestamptz not null,
        updated_at timestamptz not null
      );
      create table if not exists pg_gateways (
        id varchar(128) primary key,
        tenant_id varchar(128) not null,
        agent_id varchar(128) not null,
        zone_ids jsonb not null,
        version varchar(64) not null,
        status varchar(32) not null,
        adapters jsonb not null,
        capabilities jsonb not null,
        capability_set_id varchar(128) not null,
        current_load integer not null default 0,
        max_concurrent_tasks integer not null default 4,
        success_rate numeric not null default 1,
        last_heartbeat_at timestamptz,
        revoked_at timestamptz,
        disabled_at timestamptz,
        created_at timestamptz not null,
        updated_at timestamptz not null
      );
      create unique index if not exists idx_pg_gateways_tenant_agent on pg_gateways (tenant_id, agent_id);
      create index if not exists idx_pg_gateways_tenant_status on pg_gateways (tenant_id, status, updated_at desc);
      create table if not exists pg_gateway_reachability (
        id varchar(128) primary key,
        tenant_id varchar(128) not null,
        gateway_id varchar(128) not null,
        target_id varchar(128) not null,
        protocol varchar(64) not null,
        port integer,
        status varchar(32) not null,
        latency_ms integer,
        checked_at timestamptz not null,
        expires_at timestamptz not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        entity_id varchar(128) not null
      );
      create unique index if not exists idx_pg_gateway_reachability_unique on pg_gateway_reachability (tenant_id, gateway_id, target_id, protocol);
      create table if not exists pg_gateway_credential_sessions (
        id varchar(128) primary key,
        tenant_id varchar(128) not null,
        task_id varchar(128) not null,
        secret_ref jsonb not null,
        grant_ref jsonb not null,
        gateway_id varchar(128) not null,
        target_id varchar(128) not null,
        protocol varchar(64) not null,
        allowed_actions jsonb not null,
        remaining_uses integer not null,
        expires_at timestamptz not null,
        status varchar(32) not null,
        created_at timestamptz not null,
        revoked_at timestamptz
      );
    `);
  }
}

type GatewayZoneRow = {
  id: string;
  tenant_id: string;
  name: string;
  zone_type: Zone['type'];
  policy: unknown;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type GatewayRow = {
  id: string;
  tenant_id: string;
  agent_id: string;
  zone_ids: unknown;
  version: string;
  status: GatewayStatus;
  adapters: unknown;
  capabilities: unknown;
  capability_set_id: string;
  current_load: number;
  max_concurrent_tasks: number;
  success_rate: number;
  last_heartbeat_at?: string | null;
  revoked_at?: string | null;
  disabled_at?: string | null;
  created_at: string;
  updated_at: string;
};

type GatewayReachabilityRow = {
  id: string;
  tenant_id: string;
  gateway_id: string;
  target_id: string;
  protocol: GatewayAdapterType;
  port?: number | null;
  status: GatewayReachabilityDto['status'];
  latency_ms?: number | null;
  checked_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  entity_id: string;
};

type GatewayCredentialSessionRow = {
  id: string;
  tenant_id: string;
  task_id: string;
  secret_ref: unknown;
  grant_ref: unknown;
  gateway_id: string;
  target_id: string;
  protocol: GatewayAdapterType;
  allowed_actions: unknown;
  remaining_uses: number;
  expires_at: string;
  status: GatewayCredentialSessionDto['status'];
  created_at: string;
  revoked_at?: string | null;
};

function toZone(row: GatewayZoneRow): GatewayZoneDto {
  return { id: row.id, tenantId: row.tenant_id, name: row.name, type: row.zone_type, policy: asObject(row.policy), enabled: row.enabled, createdAt: row.created_at, updatedAt: row.updated_at };
}

function toGateway(row: GatewayRow): GatewayDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    zoneIds: asStringArray(row.zone_ids),
    version: row.version,
    status: row.status,
    adapters: asStringArray(row.adapters) as GatewayAdapterType[],
    capabilities: asStringArray(row.capabilities),
    capabilitySetId: row.capability_set_id,
    currentLoad: row.current_load,
    maxConcurrentTasks: row.max_concurrent_tasks,
    successRate: Number(row.success_rate),
    lastHeartbeatAt: row.last_heartbeat_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    disabledAt: row.disabled_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toReachability(row: GatewayReachabilityRow): GatewayReachabilityDto {
  return {
    id: row.entity_id ?? row.id,
    tenantId: row.tenant_id,
    gatewayId: row.gateway_id,
    targetId: row.target_id,
    protocol: row.protocol,
    port: row.port ?? undefined,
    status: row.status,
    latencyMs: row.latency_ms ?? undefined,
    checkedAt: row.checked_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCredentialSession(row: GatewayCredentialSessionRow): GatewayCredentialSessionDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    taskId: row.task_id,
    secretRef: asObject(row.secret_ref) as { ref: string },
    grantRef: asObject(row.grant_ref) as { ref: string },
    gatewayId: row.gateway_id,
    targetId: row.target_id,
    protocol: row.protocol,
    allowedActions: asStringArray(row.allowed_actions),
    remainingUses: row.remaining_uses,
    expiresAt: row.expires_at,
    status: row.status,
    createdAt: row.created_at,
    revokedAt: row.revoked_at ?? undefined,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
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

function nowIso(): string {
  return new Date().toISOString();
}

export interface GatewayPersistenceOptions {
  backend?: 'postgres';
  env?: NodeJS.ProcessEnv;
  db?: DatabasePort;
}

export interface GatewayPersistenceRepositories {
  backend: 'postgres';
  durable: boolean;
  gateways: GatewaysRepository;
  targetHistory: GatewayTargetHistoryRepositoryPort;
}

export function createGatewayPersistenceRepositories(options: GatewayPersistenceOptions = {}): GatewayPersistenceRepositories {
  const backend = options.backend ?? readGatewayBackend(options.env ?? process.env);
  return {
    backend,
    durable: true,
    gateways: new PgGatewaysRepository(options.db),
    targetHistory: new PgGatewayTargetHistoryRepository(options.db),
  };
}

export function createGatewayRepository(options: GatewayPersistenceOptions = {}): GatewaysRepository {
  return new PgGatewaysRepository(options.db);
}

export function createGatewayTargetHistoryRepository(options: GatewayPersistenceOptions = {}): GatewayTargetHistoryRepositoryPort {
  return new PgGatewayTargetHistoryRepository(options.db);
}

function readGatewayBackend(env: NodeJS.ProcessEnv): 'postgres' {
  return 'postgres';
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

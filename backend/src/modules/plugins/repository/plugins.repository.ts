import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import type { IdentifiedEntity } from '../../../persistence/repositories/repository-port.js';
import type { PluginExecutionResult, PluginPackageRecord } from '../dto/plugins.dto.js';
import type { AgentPluginMount, AgentPluginPackageRecord, PluginCatalogActivationRecord, PluginCatalogActivationType } from '../dto/agent-deployment-plugins.dto.js';

export interface PluginsRepository {
  readonly moduleName: 'plugins';
  savePackage(record: PluginPackageRecord): Promise<PluginPackageRecord>;
  findPackage(id: string): Promise<PluginPackageRecord | undefined>;
  listPackages(tenantId?: string): Promise<PluginPackageRecord[]>;
  saveExecution(result: PluginExecutionResult): Promise<PluginExecutionResult>;
  listExecutions(pluginPackageId?: string): Promise<PluginExecutionResult[]>;
  saveAgentPackage(record: AgentPluginPackageRecord): Promise<AgentPluginPackageRecord>;
  findAgentPackage(id: string): Promise<AgentPluginPackageRecord | undefined>;
  listAgentPackages(tenantId?: string): Promise<AgentPluginPackageRecord[]>;
  saveCatalogActivation(record: PluginCatalogActivationRecord): Promise<PluginCatalogActivationRecord>;
  findCatalogActivation(tenantId: string, catalogType: PluginCatalogActivationType, pluginId: string): Promise<PluginCatalogActivationRecord | undefined>;
  listCatalogActivations(tenantId: string): Promise<PluginCatalogActivationRecord[]>;
  saveAgentMount(record: AgentPluginMount): Promise<AgentPluginMount>;
  findAgentMount(id: string): Promise<AgentPluginMount | undefined>;
  listAgentMounts(tenantId: string, agentId?: string): Promise<AgentPluginMount[]>;
  deleteAgentMount(id: string): Promise<void>;
}

type PluginPackageEntity = PluginPackageRecord & IdentifiedEntity;
type PluginExecutionEntity = PluginExecutionResult & IdentifiedEntity;
type AgentPluginPackageEntity = AgentPluginPackageRecord & IdentifiedEntity;
type PluginCatalogActivationEntity = PluginCatalogActivationRecord & IdentifiedEntity;

export class PgPluginsRepository implements PluginsRepository {
  readonly moduleName = 'plugins' as const;

  private readonly packages: PgDocumentRepository<PluginPackageEntity>;
  private readonly executions: PgDocumentRepository<PluginExecutionEntity>;
  private readonly agentPackages: PgDocumentRepository<AgentPluginPackageEntity>;
  private readonly catalogActivations: PgDocumentRepository<PluginCatalogActivationEntity>;
  private agentMountsInitialized?: Promise<void>;

  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {
    this.packages = new PgDocumentRepository(db, 'plugins:packages');
    this.executions = new PgDocumentRepository(db, 'plugins:executions');
    this.agentPackages = new PgDocumentRepository(db, 'plugins:agent-packages');
    this.catalogActivations = new PgDocumentRepository(db, 'plugins:catalog-activations');
  }

  async savePackage(record: PluginPackageRecord): Promise<PluginPackageRecord> {
    return this.packages.upsert(record as PluginPackageEntity);
  }

  async findPackage(id: string): Promise<PluginPackageRecord | undefined> {
    return this.packages.get(id);
  }

  async listPackages(tenantId?: string): Promise<PluginPackageRecord[]> {
    const records = await this.packages.list();
    return tenantId ? records.filter((record) => record.tenantId === tenantId) : records;
  }

  async saveExecution(result: PluginExecutionResult): Promise<PluginExecutionResult> {
    return this.executions.upsert({ ...result, id: result.executionId } as PluginExecutionEntity);
  }

  async listExecutions(pluginPackageId?: string): Promise<PluginExecutionResult[]> {
    const records = await this.executions.list();
    return pluginPackageId ? records.filter((record) => record.pluginPackageId === pluginPackageId) : records;
  }

  async saveAgentPackage(record: AgentPluginPackageRecord): Promise<AgentPluginPackageRecord> {
    return this.agentPackages.upsert(record as AgentPluginPackageEntity);
  }

  async findAgentPackage(id: string): Promise<AgentPluginPackageRecord | undefined> {
    return this.agentPackages.get(id);
  }

  async listAgentPackages(tenantId?: string): Promise<AgentPluginPackageRecord[]> {
    const records = await this.agentPackages.list();
    return tenantId ? records.filter((record) => record.tenantId === tenantId) : records;
  }

  async saveCatalogActivation(record: PluginCatalogActivationRecord): Promise<PluginCatalogActivationRecord> {
    return this.catalogActivations.upsert(record as PluginCatalogActivationEntity);
  }

  async findCatalogActivation(tenantId: string, catalogType: PluginCatalogActivationType, pluginId: string): Promise<PluginCatalogActivationRecord | undefined> {
    const records = await this.catalogActivations.list((record) => record.tenantId === tenantId && record.catalogType === catalogType && record.pluginId === pluginId);
    return records[0];
  }

  async listCatalogActivations(tenantId: string): Promise<PluginCatalogActivationRecord[]> {
    return this.catalogActivations.list((record) => record.tenantId === tenantId);
  }

  async saveAgentMount(record: AgentPluginMount): Promise<AgentPluginMount> {
    await this.ensureAgentMountsTable();
    await this.db.query(
      `insert into agent_plugin_mounts (
         id, tenant_id, agent_id, plugin_package_id, plugin_version_id, package_hash,
         status, compatibility_snapshot, permission_snapshot, mounted_at, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12)
       on conflict (id) do update set
         status = excluded.status,
         compatibility_snapshot = excluded.compatibility_snapshot,
         permission_snapshot = excluded.permission_snapshot,
         mounted_at = excluded.mounted_at,
         updated_at = excluded.updated_at`,
      [
        record.id,
        record.tenantId,
        record.agentId,
        record.pluginPackageId,
        record.pluginVersionId,
        record.packageHash,
        record.status,
        JSON.stringify(record.compatibilitySnapshot),
        JSON.stringify(record.permissionSnapshot),
        record.mountedAt ?? null,
        record.createdAt,
        record.updatedAt,
      ],
    );
    return structuredClone(record);
  }

  async findAgentMount(id: string): Promise<AgentPluginMount | undefined> {
    await this.ensureAgentMountsTable();
    const row = (await this.db.query<AgentPluginMountRow>('select * from agent_plugin_mounts where id = $1', [id])).rows[0];
    return row ? toAgentMount(row) : undefined;
  }

  async listAgentMounts(tenantId: string, agentId?: string): Promise<AgentPluginMount[]> {
    await this.ensureAgentMountsTable();
    const result = agentId
      ? await this.db.query<AgentPluginMountRow>('select * from agent_plugin_mounts where tenant_id = $1 and agent_id = $2 order by created_at desc', [tenantId, agentId])
      : await this.db.query<AgentPluginMountRow>('select * from agent_plugin_mounts where tenant_id = $1 order by created_at desc', [tenantId]);
    return result.rows.map(toAgentMount);
  }

  async deleteAgentMount(id: string): Promise<void> {
    await this.ensureAgentMountsTable();
    await this.db.query('delete from agent_plugin_mounts where id = $1', [id]);
  }

  private async ensureAgentMountsTable(): Promise<void> {
    if (!this.agentMountsInitialized) {
      this.agentMountsInitialized = this.db.exec(`
        create table if not exists agent_plugin_mounts (
          id varchar(128) primary key,
          tenant_id varchar(128) not null,
          agent_id varchar(128) not null,
          plugin_package_id varchar(128) not null,
          plugin_version_id varchar(128) not null,
          package_hash varchar(128) not null,
          status varchar(32) not null,
          compatibility_snapshot jsonb not null default '{}'::jsonb,
          permission_snapshot jsonb not null default '{}'::jsonb,
          mounted_at timestamptz,
          created_at timestamptz not null,
          updated_at timestamptz not null,
          unique (tenant_id, agent_id, plugin_version_id)
        );
        create index if not exists idx_agent_plugin_mounts_agent_status
          on agent_plugin_mounts (tenant_id, agent_id, status);
      `);
    }
    await this.agentMountsInitialized;
  }
}

interface AgentPluginMountRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  agent_id: string;
  plugin_package_id: string;
  plugin_version_id: string;
  package_hash: string;
  status: AgentPluginMount['status'];
  compatibility_snapshot: Record<string, unknown>;
  permission_snapshot: Record<string, unknown>;
  mounted_at?: string | null;
  created_at: string;
  updated_at: string;
}

function toAgentMount(row: AgentPluginMountRow): AgentPluginMount {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    pluginPackageId: row.plugin_package_id,
    pluginVersionId: row.plugin_version_id,
    packageHash: row.package_hash,
    status: row.status,
    compatibilitySnapshot: row.compatibility_snapshot ?? {},
    permissionSnapshot: row.permission_snapshot ?? {},
    mountedAt: row.mounted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import type { IdentifiedEntity } from '../../../persistence/repositories/repository-port.js';
import type { PluginExecutionResult, PluginPackageRecord } from '../dto/plugins.dto.js';
import type { PluginCatalogActivationRecord, PluginCatalogActivationType } from '../dto/agent-deployment-plugins.dto.js';

export interface PluginsRepository {
  readonly moduleName: 'plugins';
  savePackage(record: PluginPackageRecord): Promise<PluginPackageRecord>;
  findPackage(id: string): Promise<PluginPackageRecord | undefined>;
  listPackages(tenantId?: string): Promise<PluginPackageRecord[]>;
  saveExecution(result: PluginExecutionResult): Promise<PluginExecutionResult>;
  listExecutions(pluginPackageId?: string): Promise<PluginExecutionResult[]>;
  saveCatalogActivation(record: PluginCatalogActivationRecord): Promise<PluginCatalogActivationRecord>;
  findCatalogActivation(tenantId: string, catalogType: PluginCatalogActivationType, pluginId: string): Promise<PluginCatalogActivationRecord | undefined>;
  listCatalogActivations(tenantId: string): Promise<PluginCatalogActivationRecord[]>;
}

type PluginPackageEntity = PluginPackageRecord & IdentifiedEntity;
type PluginExecutionEntity = PluginExecutionResult & IdentifiedEntity;
type PluginCatalogActivationEntity = PluginCatalogActivationRecord & IdentifiedEntity;

export class PgPluginsRepository implements PluginsRepository {
  readonly moduleName = 'plugins' as const;

  private readonly packages: PgDocumentRepository<PluginPackageEntity>;
  private readonly executions: PgDocumentRepository<PluginExecutionEntity>;
  private readonly catalogActivations: PgDocumentRepository<PluginCatalogActivationEntity>;

  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {
    this.packages = new PgDocumentRepository(db, 'plugins:packages');
    this.executions = new PgDocumentRepository(db, 'plugins:executions');
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

}

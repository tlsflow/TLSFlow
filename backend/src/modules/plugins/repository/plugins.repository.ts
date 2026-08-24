import type { PluginExecutionResult, PluginPackageRecord } from '../dto/plugins.dto.js';

export interface PluginsRepository {
  readonly moduleName: 'plugins';
  savePackage(record: PluginPackageRecord): PluginPackageRecord;
  findPackage(id: string): PluginPackageRecord | undefined;
  listPackages(tenantId?: string): PluginPackageRecord[];
  saveExecution(result: PluginExecutionResult): PluginExecutionResult;
  listExecutions(pluginPackageId?: string): PluginExecutionResult[];
}

export class InMemoryPluginsRepository implements PluginsRepository {
  readonly moduleName = 'plugins' as const;

  private readonly packages = new Map<string, PluginPackageRecord>();
  private readonly executions = new Map<string, PluginExecutionResult>();

  savePackage(record: PluginPackageRecord): PluginPackageRecord {
    this.packages.set(record.id, record);
    return record;
  }

  findPackage(id: string): PluginPackageRecord | undefined {
    return this.packages.get(id);
  }

  listPackages(tenantId?: string): PluginPackageRecord[] {
    const records = [...this.packages.values()];
    return tenantId ? records.filter((record) => record.tenantId === tenantId) : records;
  }

  saveExecution(result: PluginExecutionResult): PluginExecutionResult {
    this.executions.set(result.executionId, result);
    return result;
  }

  listExecutions(pluginPackageId?: string): PluginExecutionResult[] {
    const records = [...this.executions.values()];
    return pluginPackageId ? records.filter((record) => record.pluginPackageId === pluginPackageId) : records;
  }
}

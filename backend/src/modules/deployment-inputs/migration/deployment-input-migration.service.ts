import type { DatabasePort } from '../../../database/database-port.js';
import { runMigrations } from '../../../database/migration-runner.js';
import { AppError } from '../../../common/errors/app-error.js';

export interface DeploymentInputMigrationDryRunV1 {
  alreadyMigrated: boolean;
  pluginBindings: number;
  workflowExecutionBindings: number;
  pluginBindingsWithLegacySecrets: number;
  applicationAssetBindings: number;
  applicationAssetBindingsWithoutOwnInput: number;
  issues: Array<{ code: 'LEGACY_SECRET_BINDINGS_REQUIRE_REBIND' | 'APPLICATION_BINDING_REQUIRES_MATERIALIZATION'; count: number }>;
}

export interface DeploymentInputMigrationAuditV1 {
  legacyColumnsRemaining: number;
  pluginBindingsMissingInputBindings: number;
  workflowBindingsMissingInputBindings: number;
  invalidInputBindings: number;
  unresolvedApplicationAssetBindings: number;
  valid: boolean;
}

export interface DeploymentInputMigrationResultV1 {
  before: DeploymentInputMigrationDryRunV1;
  after: DeploymentInputMigrationAuditV1;
  appliedMigrations: Array<{ version: string; name: string; status: string }>;
}

export class DeploymentInputMigrationService {
  constructor(private readonly db: DatabasePort) {}

  async dryRun(): Promise<DeploymentInputMigrationDryRunV1> {
    const alreadyMigrated = await this.hasColumn('unified_plugin_bindings', 'input_bindings');
    const hasLegacyPluginColumns = await this.hasColumn('unified_plugin_bindings', 'variable_bindings');
    const pluginBindingsWithLegacySecrets = hasLegacyPluginColumns
      ? await this.count(`select count(*) count from unified_plugin_bindings where coalesce(secret_bindings, '{}'::jsonb) <> '{}'::jsonb`)
      : 0;
    const applicationAssetBindingsWithoutOwnInput = hasLegacyPluginColumns
      ? await this.count(`select count(distinct assignment.plugin_binding_id) count
        from plugin_capability_assignments assignment
        join unified_plugin_bindings binding on binding.id=assignment.plugin_binding_id and binding.tenant_id=assignment.tenant_id
        where assignment.owner_type='APPLICATION_ASSET' and assignment.status='ACTIVE'
          and coalesce(binding.variable_bindings,'{}'::jsonb)='{}'::jsonb
          and coalesce(binding.connection_bindings,'{}'::jsonb)='{}'::jsonb
          and coalesce(binding.credential_bindings,'{}'::jsonb)='{}'::jsonb`)
      : 0;
    const issues: DeploymentInputMigrationDryRunV1['issues'] = [];
    if (pluginBindingsWithLegacySecrets > 0) issues.push({ code: 'LEGACY_SECRET_BINDINGS_REQUIRE_REBIND', count: pluginBindingsWithLegacySecrets });
    if (applicationAssetBindingsWithoutOwnInput > 0) issues.push({ code: 'APPLICATION_BINDING_REQUIRES_MATERIALIZATION', count: applicationAssetBindingsWithoutOwnInput });
    return {
      alreadyMigrated,
      pluginBindings: await this.countRows('unified_plugin_bindings'),
      workflowExecutionBindings: await this.countRows('workflow_execution_bindings'),
      pluginBindingsWithLegacySecrets,
      applicationAssetBindings: await this.count(`select count(distinct assignment.plugin_binding_id) count
        from plugin_capability_assignments assignment
        where assignment.owner_type='APPLICATION_ASSET' and assignment.status='ACTIVE'`),
      applicationAssetBindingsWithoutOwnInput,
      issues,
    };
  }

  async execute(options: { migrationsDir?: string; appliedBy: string }): Promise<DeploymentInputMigrationResultV1> {
    const before = await this.dryRun();
    if (before.pluginBindingsWithLegacySecrets > 0) {
      throw new AppError('VALIDATION_FAILED', '存在旧 Secret Binding，必须先重新绑定到 CredentialProfile', {
        code: 'LEGACY_SECRET_BINDINGS_REQUIRE_REBIND',
        count: before.pluginBindingsWithLegacySecrets,
      });
    }
    const applied = await runMigrations(this.db, options.migrationsDir, { appliedBy: options.appliedBy });
    const after = await this.audit();
    return {
      before,
      after,
      appliedMigrations: applied.map(({ version, name, status }) => ({ version, name, status })),
    };
  }

  async audit(): Promise<DeploymentInputMigrationAuditV1> {
    const legacyColumnsRemaining = await this.count(`select count(*) count from information_schema.columns
      where table_name in ('unified_plugin_bindings','workflow_execution_bindings')
        and column_name in ('variable_bindings','parameter_bindings','credential_bindings','secret_bindings','connection_bindings','certificate_artifact_bindings')`);
    const pluginBindingsMissingInputBindings = await this.count(`select count(*) count from unified_plugin_bindings where input_bindings is null`);
    const workflowBindingsMissingInputBindings = await this.count(`select count(*) count from workflow_execution_bindings where input_bindings is null`);
    const invalidInputBindings = await this.count(`select
      (select count(*) from unified_plugin_bindings where input_bindings->>'apiVersion'<>'gcac.input-bindings/v1'
        or jsonb_typeof(input_bindings->'variables')<>'object' or jsonb_typeof(input_bindings->'connections')<>'object'
        or jsonb_typeof(input_bindings->'credentials')<>'object' or jsonb_typeof(input_bindings->'artifacts')<>'object')
      +
      (select count(*) from workflow_execution_bindings where input_bindings->>'apiVersion'<>'gcac.input-bindings/v1'
        or jsonb_typeof(input_bindings->'variables')<>'object' or jsonb_typeof(input_bindings->'connections')<>'object'
        or jsonb_typeof(input_bindings->'credentials')<>'object' or jsonb_typeof(input_bindings->'artifacts')<>'object') count`);
    const unresolvedApplicationAssetBindings = await this.count(`select count(distinct assignment.plugin_binding_id) count
      from plugin_capability_assignments assignment
      join unified_plugin_bindings binding on binding.id=assignment.plugin_binding_id and binding.tenant_id=assignment.tenant_id
      where assignment.owner_type='APPLICATION_ASSET' and assignment.status='ACTIVE'
        and binding.input_bindings->'variables'='{}'::jsonb
        and binding.input_bindings->'connections'='{}'::jsonb
        and binding.input_bindings->'credentials'='{}'::jsonb`);
    return {
      legacyColumnsRemaining,
      pluginBindingsMissingInputBindings,
      workflowBindingsMissingInputBindings,
      invalidInputBindings,
      unresolvedApplicationAssetBindings,
      valid: legacyColumnsRemaining === 0
        && pluginBindingsMissingInputBindings === 0
        && workflowBindingsMissingInputBindings === 0
        && invalidInputBindings === 0
        && unresolvedApplicationAssetBindings === 0,
    };
  }

  private async hasColumn(tableName: string, columnName: string): Promise<boolean> {
    return (await this.count(`select count(*) count from information_schema.columns where table_name=$1 and column_name=$2`, [tableName, columnName])) > 0;
  }

  private async countRows(tableName: 'unified_plugin_bindings' | 'workflow_execution_bindings'): Promise<number> {
    return this.count(`select count(*) count from ${tableName}`);
  }

  private async count(sql: string, params: unknown[] = []): Promise<number> {
    const row = (await this.db.query<{ count: string | number }>(sql, params)).rows[0];
    return Number(row?.count ?? 0);
  }
}

import type { DatabasePort } from '../../../database/database-port.js';
import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import { PgDeviceAssetsRepository } from '../../device-assets/repository/device-assets.repository.js';
import { DeviceDiscoverySchemaService } from '../discovery/device-discovery-schema.service.js';
import { StandardDeviceDiscoveryProjector } from '../discovery/standard-device-discovery.projector.js';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import type { PluginBindingV1 } from '../dto/plugin-bindings.dto.js';
import type { PluginPromotionPreview, PluginPromotionPreviewInput, PluginPromotionRecord } from './plugin-promotion.dto.js';
import { PluginPromotionRepository } from './plugin-promotion.repository.js';

export class PluginPromotionService {
  private readonly repository: PluginPromotionRepository;
  private readonly devices: PgDeviceAssetsRepository;
  private readonly discoverySchema = new DeviceDiscoverySchemaService();
  private readonly projector: StandardDeviceDiscoveryProjector;

  constructor(private readonly db: DatabasePort) {
    this.repository = new PluginPromotionRepository(db);
    this.devices = new PgDeviceAssetsRepository(db);
    this.projector = new StandardDeviceDiscoveryProjector(db);
  }

  async preview(tenantId: string, input: PluginPromotionPreviewInput): Promise<PluginPromotionPreview> {
    const source = await this.requireBinding(tenantId, input.sourcePluginBindingId);
    if (source.mode !== 'STANDALONE') throw new AppError('VALIDATION_FAILED', '只有 Standalone Binding 可以归集为 Managed Device');
    const version = await this.requirePluginVersion(tenantId, source.pluginVersionId);
    if (!['BOTH', 'MANAGED'].includes(version.scope)) throw new AppError('VALIDATION_FAILED', '插件不支持 Managed 模式', { scope: version.scope });
    const discovery = this.discoverySchema.validate(input.discovery);
    const conflicts = await this.detectConflicts(tenantId, input, source);
    const now = new Date().toISOString();
    const promotionId = newId('prmt');
    const preview: PluginPromotionPreview = {
      promotionId,
      status: conflicts.some((item) => item.blocking) ? 'CONFLICT' : 'PREVIEWED',
      sourcePluginBindingId: source.id,
      pluginVersionId: source.pluginVersionId,
      mappings: {
        host: { action: conflicts.some((item) => item.code === 'HOST_REUSE') ? 'REUSE' : 'CREATE', address: input.managementAddress },
        device: { action: 'CREATE', displayName: input.displayName, deviceFamily: input.deviceFamily },
        frameworks: discovery.frameworks.map(({ stableKey, displayName }) => ({ stableKey, displayName })),
        sites: discovery.sites.map(({ stableKey, displayName }) => ({ stableKey, displayName })),
        managedTargets: discovery.sites.map(({ stableKey, displayName }) => ({ stableKey, displayName })),
        secretBindings: Object.entries(source.secretBindings).map(([slot, secretRef]) => ({ slot, secretRef, action: 'REUSE' as const })),
        variableBindings: Object.keys(source.variableBindings).sort(),
        certificateArtifactBindings: Object.keys(source.certificateArtifactBindings).sort(),
      },
      conflicts,
    };
    await this.repository.save({
      id: promotionId, tenantId, sourcePluginBindingId: source.id, applicationAssetId: input.applicationAssetId,
      status: preview.status, previewSnapshot: { ...input, discovery, pluginVersionId: source.pluginVersionId },
      createdResources: {}, createdAt: now, updatedAt: now, version: 1,
    });
    return preview;
  }

  async confirm(tenantId: string, promotionId: string): Promise<PluginPromotionRecord> {
    let record = await this.requireRecord(tenantId, promotionId);
    if (record.status === 'COMPLETED') return record;
    if (record.status !== 'PREVIEWED' && record.status !== 'ERROR') throw new AppError('VALIDATION_FAILED', '迁移记录当前状态不可确认', { status: record.status });
    record = await this.saveState(record, { status: 'RUNNING', errorCode: undefined, errorMessage: undefined });
    try {
      const source = await this.requireBinding(tenantId, record.sourcePluginBindingId);
      const snapshot = record.previewSnapshot;
      const device = record.deviceAssetId
        ? await this.devices.get(tenantId, record.deviceAssetId)
        : await this.devices.create(tenantId, {
          displayName: snapshot.displayName, managementAddress: snapshot.managementAddress,
          managementPort: snapshot.managementPort, deviceFamily: snapshot.deviceFamily,
          credentialId: Object.values(source.secretBindings)[0], authMode: snapshot.authMode,
          tlsVerify: snapshot.tlsVerify, gatewayId: snapshot.gatewayId,
        });
      if (!device) throw new AppError('RESOURCE_NOT_FOUND', '迁移设备不存在');
      record = await this.saveState(record, { deviceAssetId: device.id, createdResources: { ...record.createdResources, deviceAssetId: device.id } });
      const targetBinding = record.targetPluginBindingId
        ? await this.requireBinding(tenantId, record.targetPluginBindingId)
        : await this.createManagedBinding(tenantId, source, device.hostId);
      record = await this.saveState(record, { targetPluginBindingId: targetBinding.id, createdResources: { ...record.createdResources, pluginBindingId: targetBinding.id } });
      await this.db.query(`update pg_device_assets set plugin_version_id=$1,plugin_binding_id=$2,updated_at=$3,version=version+1
        where tenant_id=$4 and service_asset_id=$5`, [source.pluginVersionId, targetBinding.id, new Date().toISOString(), tenantId, device.id]);
      await this.projector.project({ tenantId, deviceAssetId: device.id, hostId: device.hostId, pluginVersionId: source.pluginVersionId, pluginBindingId: targetBinding.id }, snapshot.discovery);
      await this.createAssignments(tenantId, source.pluginVersionId, targetBinding.id, device.hostId);
      await this.db.query(`update unified_plugin_bindings set status='DISABLED',updated_at=$1,version=version+1 where tenant_id=$2 and id=$3`, [new Date().toISOString(), tenantId, source.id]);
      const completedAt = new Date().toISOString();
      return this.saveState(record, { status: 'COMPLETED', completedAt, updatedAt: completedAt });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      return this.saveState(record, { status: 'ERROR', errorCode: 'PLUGIN_PROMOTION_FAILED', errorMessage: error.message });
    }
  }

  async revoke(tenantId: string, promotionId: string): Promise<PluginPromotionRecord> {
    let record = await this.requireRecord(tenantId, promotionId);
    if (record.status === 'REVOKED') return record;
    const now = new Date().toISOString();
    if (record.targetPluginBindingId) {
      await this.db.query(`update plugin_capability_assignments set status='DISABLED',updated_at=$1 where tenant_id=$2 and plugin_binding_id=$3`, [now, tenantId, record.targetPluginBindingId]);
      await this.db.query(`update unified_plugin_bindings set status='DISABLED',updated_at=$1,version=version+1 where tenant_id=$2 and id=$3`, [now, tenantId, record.targetPluginBindingId]);
    }
    if (record.deviceAssetId) await this.devices.softDelete(tenantId, record.deviceAssetId);
    await this.db.query(`update unified_plugin_bindings set status='ACTIVE',updated_at=$1,version=version+1 where tenant_id=$2 and id=$3`, [now, tenantId, record.sourcePluginBindingId]);
    record = await this.saveState(record, { status: 'REVOKED', revokedAt: now, updatedAt: now });
    return record;
  }

  get(tenantId: string, promotionId: string): Promise<PluginPromotionRecord> {
    return this.requireRecord(tenantId, promotionId);
  }

  private async detectConflicts(tenantId: string, input: PluginPromotionPreviewInput, source: PluginBindingV1) {
    const conflicts = [] as PluginPromotionPreview['conflicts'];
    const existing = await this.db.query<{ id: string }>(`select id from pg_service_assets where tenant_id=$1 and address=$2 and port=$3 and deleted_at is null limit 1`, [tenantId, input.managementAddress, input.managementPort]);
    if (existing.rows[0]) conflicts.push({ code: 'DEVICE_ADDRESS_CONFLICT', path: 'managementAddress', message: '管理地址已被现有资产占用', blocking: true });
    for (const [slot, secretRef] of Object.entries(source.secretBindings)) {
      if (!/^secret:\/\//.test(secretRef)) conflicts.push({ code: 'SECRET_REF_INVALID', path: `secretBindings.${slot}`, message: '凭据必须使用 SecretRef', blocking: true });
    }
    const siteKeys = input.discovery.sites.map((item) => item.stableKey);
    if (new Set(siteKeys).size !== siteKeys.length) conflicts.push({ code: 'SITE_STABLE_KEY_CONFLICT', path: 'discovery.sites', message: '发现结果包含重复站点稳定键', blocking: true });
    return conflicts;
  }

  private async createManagedBinding(tenantId: string, source: PluginBindingV1, hostId: string): Promise<PluginBindingV1> {
    const now = new Date().toISOString();
    const binding: PluginBindingV1 = {
      ...source, id: newId('plgb'), tenantId, mode: 'MANAGED', managedContext: { hostId },
      status: 'ACTIVE', version: 1, createdAt: now, updatedAt: now,
    };
    await this.db.query(`insert into unified_plugin_bindings
      (id,tenant_id,plugin_version_id,mode,variable_bindings,credential_bindings,secret_bindings,certificate_artifact_bindings,connection_bindings,managed_context,status,version,created_at,updated_at)
      values ($1,$2,$3,'MANAGED',$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,'ACTIVE',1,$10,$10)`, [
      binding.id, tenantId, binding.pluginVersionId, JSON.stringify(binding.variableBindings), JSON.stringify(binding.credentialBindings), JSON.stringify(binding.secretBindings),
      JSON.stringify(binding.certificateArtifactBindings), JSON.stringify(binding.connectionBindings), JSON.stringify(binding.managedContext), now,
    ]);
    return binding;
  }

  private async createAssignments(tenantId: string, pluginVersionId: string, pluginBindingId: string, hostId: string): Promise<void> {
    const version = await this.requirePluginVersion(tenantId, pluginVersionId);
    const now = new Date().toISOString();
    for (const capability of version.manifest.capabilities) {
      await this.db.query(`insert into plugin_capability_assignments
        (id,tenant_id,owner_type,owner_id,capability_key,plugin_version_id,plugin_binding_id,precedence,status,created_at,updated_at)
        values ($1,$2,'DEVICE',$3,$4,$5,$6,'DEVICE_DEFAULT','ACTIVE',$7,$7)
        on conflict (tenant_id,owner_type,owner_id,capability_key) do update set plugin_version_id=excluded.plugin_version_id,
        plugin_binding_id=excluded.plugin_binding_id,status='ACTIVE',updated_at=excluded.updated_at`, [
        newId('capa'), tenantId, hostId, capability.key, pluginVersionId, pluginBindingId, now,
      ]);
    }
  }

  private async requireBinding(tenantId: string, id: string): Promise<PluginBindingV1> {
    const row = (await this.db.query<Record<string, unknown>>('select * from unified_plugin_bindings where tenant_id=$1 and id=$2', [tenantId, id])).rows[0];
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', 'PluginBinding 不存在', { id });
    return {
      id: String(row.id), tenantId: String(row.tenant_id), pluginVersionId: String(row.plugin_version_id), mode: row.mode as PluginBindingV1['mode'],
      variableBindings: (row.variable_bindings ?? {}) as Record<string, unknown>, credentialBindings: (row.credential_bindings ?? {}) as PluginBindingV1['credentialBindings'], secretBindings: (row.secret_bindings ?? {}) as Record<string, string>,
      certificateArtifactBindings: (row.certificate_artifact_bindings ?? {}) as PluginBindingV1['certificateArtifactBindings'],
      connectionBindings: (row.connection_bindings ?? {}) as Record<string, unknown>, managedContext: row.managed_context as PluginBindingV1['managedContext'],
      status: row.status as PluginBindingV1['status'], version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  private async requirePluginVersion(tenantId: string, id: string): Promise<UnifiedPluginVersionRecord> {
    const row = (await this.db.query<{ tenant_id: string; manifest: UnifiedPluginVersionRecord['manifest']; scope: UnifiedPluginVersionRecord['scope'] }>('select tenant_id,manifest,scope from unified_plugin_versions where id=$1', [id])).rows[0];
    if (!row || row.tenant_id !== tenantId) throw new AppError('RESOURCE_NOT_FOUND', '统一插件版本不存在', { id });
    return { id, tenantId, manifest: row.manifest, scope: row.scope } as UnifiedPluginVersionRecord;
  }

  private async requireRecord(tenantId: string, id: string): Promise<PluginPromotionRecord> {
    const record = await this.repository.get(tenantId, id);
    if (!record) throw new AppError('RESOURCE_NOT_FOUND', '插件归集记录不存在', { id });
    return record;
  }

  private saveState(record: PluginPromotionRecord, patch: Partial<PluginPromotionRecord>): Promise<PluginPromotionRecord> {
    return this.repository.save({ ...record, ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString(), version: record.version + 1 });
  }
}

import type { Router } from '../../../common/http/router.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { pageResponseSchema } from '../../../common/openapi/schemas.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import { UnifiedPluginsApplicationService } from '../application/unified-plugins.application-service.js';
import { PluginBindingsApplicationService } from '../application/plugin-bindings.application-service.js';
import { ManagedTargetPluginQueryService, type SaveManagedTargetPluginOverrideInput } from '../application/managed-target-plugin-query.service.js';
import type { ImportUnifiedPluginVersionInput } from '../dto/unified-plugins.dto.js';
import { StandardPluginFieldRegistry } from '../forms/standard-plugin-field.registry.js';
import { PluginCapabilityRegistry } from '../capabilities/plugin-capability.registry.js';
import { PluginPromotionService } from '../promotion/plugin-promotion.service.js';
import { pluginRuntimeGuard } from '../runtime/plugin-runtime-guard.service.js';
import { BuiltinPluginCompatibilityUpgradeService } from '../application/builtin-plugin-compatibility-upgrade.service.js';
import { enqueueTaskBestEffort, isUnifiedTaskWorkerEnabled, type TaskEnqueuer } from '../../tasks/task-enqueue.js';
import type { SecurityServices } from '../../security/security.controller.js';
import {
  assertRouteAction,
  assertRouteObjectAccess,
  filterAuthorizedItems,
  requireRouteSecurity,
  type RouteSecurityContext,
} from '../../security/security-route-helpers.js';

export interface BuiltinPluginCatalogRefresher {
  refresh(tenantId?: string): Promise<{
    refreshedAt: string;
    versions: Array<{ id: string; pluginId: string; version: string; status: string }>;
    projection?: {
      attempted: number;
      projected: number;
      skipped: number;
      failed: Array<{ tenantId: string; agentId: string; error: string }>;
    };
  }>;
}

const tags = ['Plugins'];

export class PluginsController {
  private readonly standardFields = new StandardPluginFieldRegistry();
  private readonly capabilityRegistry = new PluginCapabilityRegistry();
  constructor(
    private readonly unifiedPlugins = new UnifiedPluginsApplicationService(),
    private readonly pluginBindings = new PluginBindingsApplicationService(),
    private readonly promotions?: PluginPromotionService,
    private readonly managedTargetPlugins?: ManagedTargetPluginQueryService,
    private readonly versionSwitcher?: BuiltinPluginCompatibilityUpgradeService,
    private readonly builtinCatalogRefresher?: BuiltinPluginCatalogRefresher,
    private readonly tasks?: TaskEnqueuer,
    private readonly security?: SecurityServices,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/plugin-catalog', '查询统一插件目录', tags, (request) => this.listCatalog(request));
    router.post('/api/v1/plugin-catalog/refresh-builtins', '刷新内置插件注册表', tags, (request) => this.refreshBuiltinCatalog(request));
    router.get('/api/v1/plugin-versions', '查询统一插件版本', tags, (request) => this.listUnifiedPluginVersions(request));
    router.get('/api/v1/plugin-version-groups', '查询插件版本分组', tags, (request) => this.listPluginVersionGroups(request));
    router.get('/api/v1/plugin-version-management/:pluginVersionId', '查询插件版本管理详情', tags, (request) => this.getPluginVersionManagementDetail(request));
    router.post('/api/v1/plugin-version-management/switch', '切换插件运行版本', tags, (request) => this.switchPluginVersion(request));
    router.post('/api/v1/plugin-packages/import', '导入统一插件版本', tags, (request) => this.importUnifiedPluginVersion(request));
    router.post('/api/v1/plugin-versions/approve-permissions', '审批统一插件权限', tags, (request) => this.approveUnifiedPluginPermissions(request));
    router.post('/api/v1/plugin-versions/enable', '启用统一插件版本', tags, (request) => this.enableUnifiedPluginVersion(request));
    router.post('/api/v1/plugin-versions/disable', '禁用统一插件版本', tags, (request) => this.disableUnifiedPluginVersion(request));
    router.post('/api/v1/plugin-versions/retire', '退休统一插件版本', tags, (request) => this.retireUnifiedPluginVersion(request));
    router.get('/api/v1/plugin-versions/upgrade-diff', '查询统一插件升级差异', tags, (request) => this.getUnifiedPluginUpgradeDiff(request));
    router.get('/api/v1/plugin-form/standard-fields', '查询插件标准字段', tags, (request) => this.listStandardFields(request));
    router.get('/api/v1/plugin-capabilities', '查询宿主支持的插件能力 Contract', tags, (request) => this.listPluginCapabilities(request));
    router.get('/api/v1/plugin-versions/ui-resources', '查询插件表单、展示和语言资源', tags, (request) => this.getUnifiedPluginUiResources(request));
    router.post('/api/v1/plugin-bindings', '创建统一插件绑定', tags, (request) => this.createPluginBinding(request));
    router.get('/api/v1/plugin-bindings', '查询统一插件绑定', tags, (request) => this.getPluginBinding(request));
    router.patch('/api/v1/plugin-bindings', '更新统一插件绑定', tags, (request) => this.updatePluginBinding(request));
    router.post('/api/v1/capability-assignments', '设置插件能力指派', tags, (request) => this.assignPluginCapability(request));
    router.post('/api/v1/capability-assignments/resolve', '解析插件能力来源', tags, (request) => this.resolvePluginCapability(request));
    router.post('/api/v1/plugin-promotions/preview', '预览 Standalone 目标归集', tags, (request) => this.previewPromotion(request));
    router.post('/api/v1/plugin-promotions/confirm', '确认 Standalone 目标归集', tags, (request) => this.confirmPromotion(request));
    router.post('/api/v1/plugin-promotions/revoke', '撤销 Standalone 目标归集', tags, (request) => this.revokePromotion(request));
    router.get('/api/v1/plugin-promotions', '查询 Standalone 目标归集记录', tags, (request) => this.getPromotion(request));
    router.get('/api/v1/plugin-runtime/metrics', '查询插件运行指标', tags, (request) => this.listRuntimeMetrics(request));
    router.get('/api/v1/managed-targets/:managedTargetId/deployment-capabilities/:capabilityKey', '查询受管目标生效部署能力', tags, (request) => this.getManagedTargetEffectiveCapability(request));
    router.get('/api/v1/managed-targets/:managedTargetId/compatible-plugins', '查询受管目标兼容插件', tags, (request) => this.listManagedTargetCompatiblePlugins(request));
    router.post('/api/v1/managed-targets/:managedTargetId/deployment-input-projection', '生成应用资产插件部署输入投影', tags, (request) => this.projectApplicationAssetPluginInputs(request));
    router.put('/api/v1/application-assets/:applicationAssetId/managed-target', '保存应用资产受管目标和插件覆盖', tags, (request) => this.saveApplicationAssetManagedTarget(request));
  }

  private async listCatalog(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const locale = typeof request.query['filter[locale]'] === 'string' ? request.query['filter[locale]'] : 'zh-CN';
    const runtime = queryFilterString(request, 'runtime');
    const providerKey = queryFilterString(request, 'providerKey');
    const items = await this.unifiedPlugins.listCatalog(security.tenantId, locale, {
      ...(runtime ? { runtime: runtime as 'AGENT_ATOMIC' | 'WORKFLOW_DSL' | 'TRUSTED_JS' } : {}),
      ...(providerKey ? { providerKey } : {}),
    });
    const authorizedItems = await this.filterVersionItems(security, items, 'pluginVersionId');
    return { items: authorizedItems, page: 1, pageSize: authorizedItems.length, total: authorizedItems.length };
  }

  private async refreshBuiltinCatalog(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    if (!this.builtinCatalogRefresher) throw new Error('内置插件热刷新服务未接入');
    if (this.tasks && isUnifiedTaskWorkerEnabled()) {
      const task = await this.tasks.enqueue({
        tenantId: security.tenantId,
        taskType: 'PLUGIN_REFERENCE_REFRESH',
        requestedBy: request.context.actorId ?? 'system',
        triggerSource: 'plugin.catalog.refresh',
        idempotencyKey: `plugin-reference-refresh:${security.tenantId}:${new Date().toISOString().slice(0, 16)}`,
        payload: { scope: 'builtin-catalog' },
        resourceRefs: [{ resourceType: 'pluginCatalog', resourceId: 'builtin' }],
      });
      return { statusCode: 202, body: { taskId: task.id, status: task.status } };
    }
    return this.builtinCatalogRefresher.refresh(security.tenantId);
  }

  private async listUnifiedPluginVersions(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const items = await this.unifiedPlugins.listVersions(security.tenantId);
    const authorizedItems = await filterAuthorizedItems(security, items, 'plugin_version', 'read');
    return { items: authorizedItems, page: 1, pageSize: authorizedItems.length, total: authorizedItems.length };
  }

  private async listPluginVersionGroups(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const groups = await this.unifiedPlugins.listVersionGroups(security.tenantId);
    const result = [];
    for (const group of groups) {
      const versions = await this.filterVersionItems(security, group.versions, 'id');
      if (versions.length === 0) continue;
      result.push({
        ...group,
        versions,
        ...(group.activeVersionId && versions.some((item) => item.id === group.activeVersionId)
          ? { activeVersionId: group.activeVersionId }
          : {}),
      });
    }
    return result;
  }

  private async getPluginVersionManagementDetail(request: HttpRequest) {
    const security = this.securityContext(request);
    const pluginVersionId = request.path.match(/^\/api\/v1\/plugin-version-management\/([^/]+)$/)?.[1];
    if (!pluginVersionId) throw new Error('插件版本管理详情路径无效');
    const version = await this.requirePluginVersion(security, decodeURIComponent(pluginVersionId), 'read');
    return this.unifiedPlugins.getVersionManagementDetail(security.tenantId, version.id);
  }

  private async switchPluginVersion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    if (!this.versionSwitcher) throw new Error('插件版本切换服务未接入');
    const body = validateObject(request.body, {
      pluginId: { type: 'string', required: true },
      targetPluginVersionId: { type: 'string', required: true },
      expectedCurrentPluginVersionId: { type: 'string' },
    });
    const targetVersion = await this.requirePluginVersion(security, String(body.targetPluginVersionId), 'control');
    const result = await this.versionSwitcher.switchVersion(security.tenantId, {
      pluginId: String(body.pluginId),
      targetPluginVersionId: targetVersion.id,
      ...(typeof body.expectedCurrentPluginVersionId === 'string'
        ? { expectedCurrentPluginVersionId: body.expectedCurrentPluginVersionId }
        : {}),
    });
    if (isUnifiedTaskWorkerEnabled()) {
      enqueueTaskBestEffort(this.tasks, {
        tenantId: security.tenantId,
        taskType: 'PLUGIN_REFERENCE_REFRESH',
        requestedBy: request.context.actorId ?? 'system',
        triggerSource: 'plugin.version.switch',
        idempotencyKey: `plugin-reference-refresh:${security.tenantId}:${result.toPluginVersionId}:${result.switchedAt}`,
        payload: {
          pluginId: result.pluginId,
          targetPluginVersionId: result.toPluginVersionId,
        },
        resourceRefs: [{ resourceType: 'pluginVersion', resourceId: result.toPluginVersionId }],
      });
    } else {
      if (!this.builtinCatalogRefresher) throw new Error('内置插件热刷新服务未接入');
      await this.builtinCatalogRefresher.refresh(security.tenantId);
    }
    return result;
  }

  private async importUnifiedPluginVersion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, {
      manifest: { type: 'object', required: true },
      resources: { type: 'object' },
      packageContent: { type: 'string' },
    });
    return {
      statusCode: 201,
      body: await this.unifiedPlugins.importVersion(security.tenantId, body as unknown as ImportUnifiedPluginVersionInput),
    };
  }

  private async approveUnifiedPluginPermissions(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, {
      pluginVersionId: { type: 'string', required: true },
      approvedPermissions: { type: 'array', required: true },
    });
    const version = await this.requirePluginVersion(security, String(body.pluginVersionId), 'control');
    return this.unifiedPlugins.approvePermissions(
      version.id,
      (body.approvedPermissions as unknown[]).map(String),
    );
  }

  private async enableUnifiedPluginVersion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, { pluginVersionId: { type: 'string', required: true } });
    const version = await this.requirePluginVersion(security, String(body.pluginVersionId), 'control');
    return this.unifiedPlugins.enableVersion(version.id);
  }

  private async disableUnifiedPluginVersion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, { pluginVersionId: { type: 'string', required: true } });
    const version = await this.requirePluginVersion(security, String(body.pluginVersionId), 'control');
    return this.unifiedPlugins.disableVersion(version.id);
  }

  private async retireUnifiedPluginVersion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, { pluginVersionId: { type: 'string', required: true } });
    const version = await this.requirePluginVersion(security, String(body.pluginVersionId), 'control');
    return this.unifiedPlugins.retireVersion(version.id);
  }

  private async getUnifiedPluginUpgradeDiff(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const fromVersionId = typeof request.query.fromVersionId === 'string' ? request.query.fromVersionId : '';
    const toVersionId = typeof request.query.toVersionId === 'string' ? request.query.toVersionId : '';
    const [from, to] = await Promise.all([
      this.requirePluginVersion(security, fromVersionId, 'read'),
      this.requirePluginVersion(security, toVersionId, 'read'),
    ]);
    return this.unifiedPlugins.getUpgradeDiff(from.id, to.id);
  }

  private async getUnifiedPluginUiResources(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const pluginVersionId = typeof request.query.pluginVersionId === 'string' ? request.query.pluginVersionId : '';
    const locale = typeof request.query.locale === 'string' ? request.query.locale : 'zh-CN';
    const version = await this.requirePluginVersion(security, pluginVersionId, 'read');
    return this.unifiedPlugins.getUiResources(version.id, locale);
  }

  private async createPluginBinding(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, {
      pluginVersionId: { type: 'string', required: true }, mode: { type: 'string', required: true },
      inputBindings: { type: 'object', required: true }, managedContext: { type: 'object' },
    });
    await this.requirePluginVersion(security, String(body.pluginVersionId), 'read');
    return this.pluginBindings.createBinding(security.tenantId, {
      pluginVersionId: String(body.pluginVersionId), mode: body.mode as 'MANAGED' | 'STANDALONE',
      inputBindings: body.inputBindings as never,
      managedContext: body.managedContext as never,
    });
  }

  private async getPluginBinding(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const bindingId = typeof request.query.bindingId === 'string' ? request.query.bindingId : '';
    const binding = await this.pluginBindings.getTenantBinding(security.tenantId, bindingId);
    await assertRouteObjectAccess(security, 'read', {
      objectType: 'plugin_binding',
      objectId: binding.id,
      tenantId: binding.tenantId,
    });
    await this.requirePluginVersion(security, binding.pluginVersionId, 'read');
    return binding;
  }

  private async updatePluginBinding(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, {
      bindingId: { type: 'string', required: true }, expectedVersion: { type: 'number', required: true },
      inputBindings: { type: 'object' }, managedContext: { type: 'object' }, status: { type: 'string' },
    });
    const binding = await this.pluginBindings.getTenantBinding(security.tenantId, String(body.bindingId));
    await assertRouteObjectAccess(security, 'edit', {
      objectType: 'plugin_binding',
      objectId: binding.id,
      tenantId: binding.tenantId,
    });
    await this.requirePluginVersion(security, binding.pluginVersionId, 'read');
    return this.pluginBindings.updateBinding(security.tenantId, String(body.bindingId), body as never);
  }

  private async assignPluginCapability(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, {
      ownerType: { type: 'string', required: true }, ownerId: { type: 'string', required: true }, capabilityKey: { type: 'string', required: true },
      pluginVersionId: { type: 'string', required: true }, pluginBindingId: { type: 'string', required: true }, precedence: { type: 'string', required: true },
    });
    const binding = await this.pluginBindings.getTenantBinding(security.tenantId, String(body.pluginBindingId));
    await assertRouteObjectAccess(security, 'edit', {
      objectType: 'plugin_binding',
      objectId: binding.id,
      tenantId: binding.tenantId,
    });
    await this.requirePluginVersion(security, String(body.pluginVersionId), 'read');
    await this.assertObjectReadForOwner(security, String(body.ownerType), String(body.ownerId));
    return this.pluginBindings.assignCapability(security.tenantId, body as never);
  }

  private async resolvePluginCapability(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const body = validateObject(request.body, {
      capabilityKey: { type: 'string', required: true }, deviceId: { type: 'string' }, managedTargetId: { type: 'string' }, applicationAssetId: { type: 'string' },
    });
    const owners = {
      deviceId: typeof body.deviceId === 'string' ? body.deviceId : undefined,
      managedTargetId: typeof body.managedTargetId === 'string' ? body.managedTargetId : undefined,
      applicationAssetId: typeof body.applicationAssetId === 'string' ? body.applicationAssetId : undefined,
    };
    for (const [ownerType, ownerId] of [
      ['DEVICE', owners.deviceId],
      ['MANAGED_TARGET', owners.managedTargetId],
      ['APPLICATION_ASSET', owners.applicationAssetId],
    ] as const) {
      if (ownerId) await this.assertObjectReadForOwner(security, ownerType, ownerId);
    }
    const assignment = await this.pluginBindings.resolveAssignment(security.tenantId, String(body.capabilityKey), owners);
    if (assignment) {
      await assertRouteObjectAccess(security, 'read', {
        objectType: 'plugin_capability_assignment',
        objectId: assignment.id,
        tenantId: assignment.tenantId,
      });
      await assertRouteObjectAccess(security, 'read', {
        objectType: 'plugin_binding',
        objectId: assignment.pluginBindingId,
        tenantId: assignment.tenantId,
      });
      await this.requirePluginVersion(security, assignment.pluginVersionId, 'read');
    }
    return assignment;
  }

  private async previewPromotion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, {
      sourcePluginBindingId: { type: 'string', required: true }, displayName: { type: 'string', required: true },
      deviceFamily: { type: 'string', required: true }, managementAddress: { type: 'string', required: true },
      managementPort: { type: 'number', required: true }, authMode: { type: 'string', required: true },
      tlsVerify: { type: 'boolean', required: true }, gatewayId: { type: 'string' }, applicationAssetId: { type: 'string' },
      discovery: { type: 'object', required: true },
    });
    const source = await this.pluginBindings.getTenantBinding(security.tenantId, String(body.sourcePluginBindingId));
    await assertRouteObjectAccess(security, 'control', {
      objectType: 'plugin_binding',
      objectId: source.id,
      tenantId: source.tenantId,
    });
    await this.requirePluginVersion(security, source.pluginVersionId, 'read');
    if (typeof body.gatewayId === 'string') await this.assertObjectRead(security, 'gateway', body.gatewayId);
    if (typeof body.applicationAssetId === 'string') await this.assertObjectRead(security, 'application_asset', body.applicationAssetId);
    return this.requirePromotions().preview(security.tenantId, body as never);
  }

  private async confirmPromotion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, { promotionId: { type: 'string', required: true } });
    const record = await this.requirePromotions().get(security.tenantId, String(body.promotionId));
    await this.assertPromotionObjects(security, record);
    return this.requirePromotions().confirm(security.tenantId, record.id);
  }

  private async revokePromotion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, { promotionId: { type: 'string', required: true } });
    const record = await this.requirePromotions().get(security.tenantId, String(body.promotionId));
    await this.assertPromotionObjects(security, record);
    return this.requirePromotions().revoke(security.tenantId, record.id);
  }

  private async getPromotion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const promotionId = typeof request.query.promotionId === 'string' ? request.query.promotionId : '';
    const record = await this.requirePromotions().get(security.tenantId, promotionId);
    await this.assertPromotionObjects(security, record, 'read');
    return record;
  }

  private async getManagedTargetEffectiveCapability(request: HttpRequest) {
    const security = this.securityContext(request);
    const service = this.requireManagedTargetPlugins();
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const match = request.path.match(/^\/api\/v1\/managed-targets\/([^/]+)\/deployment-capabilities\/([^/]+)$/);
    if (!match) throw new Error('受管目标能力路径无效');
    const managedTargetId = decodeURIComponent(match[1]!);
    await this.assertObjectRead(security, 'managed_target', managedTargetId);
    const applicationAssetId = queryString(request, 'applicationAssetId');
    if (applicationAssetId) await this.assertObjectRead(security, 'application_asset', applicationAssetId);
    return service.getEffectiveCapability({
      tenantId: security.tenantId,
      managedTargetId,
      capabilityKey: decodeURIComponent(match[2]!),
      applicationAssetId,
    });
  }

  private async listManagedTargetCompatiblePlugins(request: HttpRequest) {
    const security = this.securityContext(request);
    const service = this.requireManagedTargetPlugins();
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const managedTargetId = request.path.match(/^\/api\/v1\/managed-targets\/([^/]+)\/compatible-plugins$/)?.[1];
    if (!managedTargetId) throw new Error('受管目标兼容插件路径无效');
    const resolvedManagedTargetId = decodeURIComponent(managedTargetId);
    await this.assertObjectRead(security, 'managed_target', resolvedManagedTargetId);
    const applicationAssetId = queryString(request, 'applicationAssetId');
    if (applicationAssetId) await this.assertObjectRead(security, 'application_asset', applicationAssetId);
    const result = await service.listCompatiblePlugins({
      tenantId: security.tenantId,
      managedTargetId: resolvedManagedTargetId,
      capabilityKey: queryString(request, 'capabilityKey') ?? 'certificate.deploy',
      applicationAssetId,
      locale: queryString(request, 'locale') ?? 'zh-CN',
    });
    return { ...result, items: await this.filterVersionItems(security, result.items, 'pluginVersionId') };
  }

  private async saveApplicationAssetManagedTarget(request: HttpRequest) {
    const security = this.securityContext(request);
    const service = this.requireManagedTargetPlugins();
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const applicationAssetId = request.path.match(/^\/api\/v1\/application-assets\/([^/]+)\/managed-target$/)?.[1];
    if (!applicationAssetId) throw new Error('应用资产受管目标路径无效');
    const body = validateObject(request.body, {
      managedTargetId: { type: 'string', required: true },
      certificateFormatId: { type: 'string' },
      executionMode: { type: 'string' },
      expectedTargetVersion: { type: 'number' },
      capabilityKey: { type: 'string' },
      pluginOverride: { type: 'object' },
      workflowExecution: { type: 'object' },
    }) as unknown as SaveManagedTargetPluginOverrideInput;
    const resolvedApplicationAssetId = decodeURIComponent(applicationAssetId);
    await this.assertObjectAccess(security, 'application_asset', resolvedApplicationAssetId, 'edit');
    await this.assertObjectAccess(security, 'managed_target', String(body.managedTargetId), 'edit');
    if (body.pluginOverride) {
      await this.requirePluginVersion(security, body.pluginOverride.pluginVersionId, 'read');
      if (body.pluginOverride.pluginBindingId) {
        const binding = await this.pluginBindings.getTenantBinding(security.tenantId, body.pluginOverride.pluginBindingId);
        await assertRouteObjectAccess(security, 'edit', {
          objectType: 'plugin_binding',
          objectId: binding.id,
          tenantId: binding.tenantId,
        });
      }
    }
    return service.saveApplicationAssetTarget({
      tenantId: security.tenantId,
      applicationAssetId: resolvedApplicationAssetId,
      value: body,
    });
  }

  private async projectApplicationAssetPluginInputs(request: HttpRequest) {
    const security = this.securityContext(request);
    const service = this.requireManagedTargetPlugins();
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const managedTargetId = request.path.match(/^\/api\/v1\/managed-targets\/([^/]+)\/deployment-input-projection$/)?.[1];
    if (!managedTargetId) throw new Error('受管目标部署输入投影路径无效');
    const body = validateObject(request.body, {
      capabilityKey: { type: 'string' },
      pluginVersionId: { type: 'string' },
      certificateFormatId: { type: 'string' },
      applicationAsset: { type: 'object', required: true },
      inputBindings: { type: 'object' },
    });
    const applicationAsset = body.applicationAsset as Record<string, unknown>;
    const resolvedManagedTargetId = decodeURIComponent(managedTargetId);
    await this.assertObjectRead(security, 'managed_target', resolvedManagedTargetId);
    if (typeof applicationAsset.id === 'string' && applicationAsset.id !== 'draft') {
      await this.assertObjectRead(security, 'application_asset', applicationAsset.id);
    }
    if (typeof body.pluginVersionId === 'string') await this.requirePluginVersion(security, body.pluginVersionId, 'read');
    return service.projectApplicationAssetPluginInputs({
      tenantId: security.tenantId,
      managedTargetId: resolvedManagedTargetId,
      capabilityKey: typeof body.capabilityKey === 'string' ? body.capabilityKey : undefined,
      pluginVersionId: typeof body.pluginVersionId === 'string' ? body.pluginVersionId : undefined,
      certificateFormatId: typeof body.certificateFormatId === 'string' ? body.certificateFormatId : undefined,
      applicationAsset: {
        id: String(applicationAsset.id ?? 'draft'),
        address: String(applicationAsset.address ?? ''),
        sniName: typeof applicationAsset.sniName === 'string' ? applicationAsset.sniName : undefined,
        port: Number(applicationAsset.port),
        protocol: String(applicationAsset.protocol ?? 'HTTPS'),
        displayName: typeof applicationAsset.displayName === 'string' ? applicationAsset.displayName : undefined,
      },
      inputBindings: body.inputBindings as never,
    });
  }

  private listStandardFields(request: HttpRequest) {
    const security = this.securityContext(request);
    return assertRouteAction(security, 'plugin.read', 'plugin').then(() => ({ items: this.standardFields.list() }));
  }

  private listPluginCapabilities(request: HttpRequest) {
    const security = this.securityContext(request);
    return assertRouteAction(security, 'plugin.read', 'plugin').then(() => ({ items: this.capabilityRegistry.list() }));
  }

  private async listRuntimeMetrics(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const items = await this.filterVersionItems(
      security,
      pluginRuntimeGuard.listMetrics(security.tenantId),
      'pluginVersionId',
    );
    return { items, page: 1, pageSize: items.length, total: items.length };
  }

  private securityContext(request: HttpRequest): RouteSecurityContext {
    return requireRouteSecurity(request, this.security);
  }

  private async requirePluginVersion(
    security: RouteSecurityContext,
    pluginVersionId: string,
    accessLevel: 'read' | 'control',
  ) {
    if (!pluginVersionId.trim()) throw new Error('pluginVersionId 不能为空');
    const version = await this.unifiedPlugins.getVersionForTenant(security.tenantId, pluginVersionId);
    await assertRouteObjectAccess(security, accessLevel, {
      objectType: 'plugin_version',
      objectId: version.id,
      tenantId: version.ownerType === 'SYSTEM' ? security.tenantId : version.tenantId,
      ownerType: version.ownerType,
    });
    return version;
  }

  private async filterVersionItems<T extends object>(
    security: RouteSecurityContext,
    items: T[],
    objectIdField: string,
  ): Promise<T[]> {
    const decorated = items.map((item) => ({ ...item, tenantId: security.tenantId }));
    const authorized = await filterAuthorizedItems(security, decorated, 'plugin_version', 'read', objectIdField);
    const allowed = new Set(authorized.map((item) => String((item as Record<string, unknown>)[objectIdField])));
    return items.filter((item) => allowed.has(String((item as Record<string, unknown>)[objectIdField])));
  }

  private async assertObjectRead(security: RouteSecurityContext, objectType: string, objectId: string): Promise<void> {
    await assertRouteObjectAccess(security, 'read', {
      objectType,
      objectId,
      tenantId: security.tenantId,
    });
  }

  private async assertObjectAccess(
    security: RouteSecurityContext,
    objectType: string,
    objectId: string,
    accessLevel: 'read' | 'edit' | 'control',
  ): Promise<void> {
    await assertRouteObjectAccess(security, accessLevel, {
      objectType,
      objectId,
      tenantId: security.tenantId,
    });
  }

  private async assertObjectReadForOwner(
    security: RouteSecurityContext,
    ownerType: string,
    ownerId: string,
  ): Promise<void> {
    const objectType = ownerType === 'DEVICE'
      ? 'device_asset'
      : ownerType === 'MANAGED_TARGET'
        ? 'managed_target'
        : ownerType === 'APPLICATION_ASSET'
          ? 'application_asset'
          : undefined;
    if (!objectType) throw new Error(`不支持的插件能力所有者类型: ${ownerType}`);
    await this.assertObjectRead(security, objectType, ownerId);
  }

  private async assertPromotionObjects(
    security: RouteSecurityContext,
    record: {
      sourcePluginBindingId: string;
      targetPluginBindingId?: string;
      deviceAssetId?: string;
      applicationAssetId?: string;
    },
    accessLevel: 'read' | 'control' = 'control',
  ): Promise<void> {
    await this.assertObjectAccess(security, 'plugin_binding', record.sourcePluginBindingId, accessLevel);
    if (record.targetPluginBindingId) await this.assertObjectAccess(security, 'plugin_binding', record.targetPluginBindingId, accessLevel);
    if (record.deviceAssetId) await this.assertObjectAccess(security, 'device_asset', record.deviceAssetId, accessLevel);
    if (record.applicationAssetId) await this.assertObjectAccess(security, 'application_asset', record.applicationAssetId, accessLevel);
  }

  private requireManagedTargetPlugins(): ManagedTargetPluginQueryService {
    if (!this.managedTargetPlugins) throw new Error('受管目标插件查询服务未接入');
    return this.managedTargetPlugins;
  }

  private requirePromotions(): PluginPromotionService {
    if (!this.promotions) throw new Error('PluginPromotionService 未配置');
    return this.promotions;
  }

}

export function getPluginsRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/plugin-catalog', operationId: 'listPluginCatalog', summary: '查询统一插件目录', tags, responseSchema: pageResponseSchema },
    { method: 'POST', path: '/api/v1/plugin-catalog/refresh-builtins', operationId: 'refreshBuiltinPluginCatalog', summary: '刷新内置插件注册表', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/plugin-versions', operationId: 'listUnifiedPluginVersions', summary: '查询统一插件版本', tags, responseSchema: pageResponseSchema },
    { method: 'GET', path: '/api/v1/plugin-version-groups', operationId: 'listPluginVersionGroups', summary: '查询插件版本分组', tags, responseSchema: { type: 'array', items: { type: 'object', additionalProperties: true } } },
    { method: 'GET', path: '/api/v1/plugin-version-management/:pluginVersionId', operationId: 'getPluginVersionManagementDetail', summary: '查询插件版本管理详情', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-version-management/switch', operationId: 'switchPluginVersion', summary: '切换插件运行版本', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-packages/import', operationId: 'importUnifiedPluginVersion', summary: '导入统一插件版本', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-versions/approve-permissions', operationId: 'approveUnifiedPluginPermissions', summary: '审批统一插件权限', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-versions/enable', operationId: 'enableUnifiedPluginVersion', summary: '启用统一插件版本', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-versions/disable', operationId: 'disableUnifiedPluginVersion', summary: '禁用统一插件版本', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-versions/retire', operationId: 'retireUnifiedPluginVersion', summary: '退休统一插件版本', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/plugin-versions/upgrade-diff', operationId: 'getUnifiedPluginUpgradeDiff', summary: '查询统一插件升级差异', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-bindings', operationId: 'createPluginBinding', summary: '创建统一插件绑定', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/plugin-bindings', operationId: 'getPluginBinding', summary: '查询统一插件绑定', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/plugin-bindings', operationId: 'updatePluginBinding', summary: '更新统一插件绑定', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/capability-assignments', operationId: 'assignPluginCapability', summary: '设置插件能力指派', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/capability-assignments/resolve', operationId: 'resolvePluginCapability', summary: '解析插件能力来源', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-promotions/preview', operationId: 'previewPluginPromotion', summary: '预览 Standalone 目标归集', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-promotions/confirm', operationId: 'confirmPluginPromotion', summary: '确认 Standalone 目标归集', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-promotions/revoke', operationId: 'revokePluginPromotion', summary: '撤销 Standalone 目标归集', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/plugin-promotions', operationId: 'getPluginPromotion', summary: '查询 Standalone 目标归集记录', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/plugin-runtime/metrics', operationId: 'listPluginRuntimeMetrics', summary: '查询插件运行指标', tags, responseSchema: pageResponseSchema },
    { method: 'GET', path: '/api/v1/managed-targets/:managedTargetId/deployment-capabilities/:capabilityKey', operationId: 'getManagedTargetEffectiveCapability', summary: '查询受管目标生效部署能力', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/managed-targets/:managedTargetId/compatible-plugins', operationId: 'listManagedTargetCompatiblePlugins', summary: '查询受管目标兼容插件', tags, responseSchema: pageResponseSchema },
    { method: 'POST', path: '/api/v1/managed-targets/:managedTargetId/deployment-input-projection', operationId: 'projectApplicationAssetPluginInputs', summary: '生成应用资产插件部署输入投影', tags, responseSchema: objectSchema() },
    { method: 'PUT', path: '/api/v1/application-assets/:applicationAssetId/managed-target', operationId: 'saveApplicationAssetManagedTarget', summary: '保存应用资产受管目标和插件覆盖', tags, responseSchema: objectSchema() },
  ];
}

function queryString(request: HttpRequest, key: string): string | undefined {
  return typeof request.query[key] === 'string' ? request.query[key] : undefined;
}

function queryFilterString(request: HttpRequest, key: string): string | undefined {
  return queryString(request, `filter[${key}]`);
}

function objectSchema() {
  return { type: 'object', additionalProperties: true };
}

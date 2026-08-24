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

const tags = ['Plugins'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class PluginsController {
  private readonly standardFields = new StandardPluginFieldRegistry();
  private readonly capabilityRegistry = new PluginCapabilityRegistry();
  constructor(
    private readonly unifiedPlugins = new UnifiedPluginsApplicationService(),
    private readonly pluginBindings = new PluginBindingsApplicationService(),
    private readonly promotions?: PluginPromotionService,
    private readonly managedTargetPlugins?: ManagedTargetPluginQueryService,
    private readonly versionSwitcher?: BuiltinPluginCompatibilityUpgradeService,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/plugin-catalog', '查询统一插件目录', tags, (request) => this.listCatalog(request));
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
    router.get('/api/v1/plugin-form/standard-fields', '查询插件标准字段', tags, () => ({ items: this.standardFields.list() }));
    router.get('/api/v1/plugin-capabilities', '查询宿主支持的插件能力 Contract', tags, () => ({ items: this.capabilityRegistry.list() }));
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
    router.get('/api/v1/plugin-runtime/metrics', '查询插件运行指标', tags, (request) => ({ items: pluginRuntimeGuard.listMetrics(tenantId(request)) }));
    router.get('/api/v1/managed-targets/:managedTargetId/deployment-capabilities/:capabilityKey', '查询受管目标生效部署能力', tags, (request) => this.getManagedTargetEffectiveCapability(request));
    router.get('/api/v1/managed-targets/:managedTargetId/compatible-plugins', '查询受管目标兼容插件', tags, (request) => this.listManagedTargetCompatiblePlugins(request));
    router.put('/api/v1/application-assets/:applicationAssetId/managed-target', '保存应用资产受管目标和插件覆盖', tags, (request) => this.saveApplicationAssetManagedTarget(request));
  }

  private async listCatalog(request: HttpRequest) {
    const locale = typeof request.query['filter[locale]'] === 'string' ? request.query['filter[locale]'] : 'zh-CN';
    const items = await this.unifiedPlugins.listCatalog(tenantId(request), locale);
    return { items, page: 1, pageSize: items.length, total: items.length };
  }

  private async listUnifiedPluginVersions(request: HttpRequest) {
    const items = await this.unifiedPlugins.listVersions(tenantId(request));
    return { items, page: 1, pageSize: items.length, total: items.length };
  }

  private listPluginVersionGroups(request: HttpRequest) {
    return this.unifiedPlugins.listVersionGroups(tenantId(request));
  }

  private getPluginVersionManagementDetail(request: HttpRequest) {
    const pluginVersionId = request.path.match(/^\/api\/v1\/plugin-version-management\/([^/]+)$/)?.[1];
    if (!pluginVersionId) throw new Error('插件版本管理详情路径无效');
    return this.unifiedPlugins.getVersionManagementDetail(tenantId(request), decodeURIComponent(pluginVersionId));
  }

  private switchPluginVersion(request: HttpRequest) {
    if (!this.versionSwitcher) throw new Error('插件版本切换服务未接入');
    const body = validateObject(request.body, {
      pluginId: { type: 'string', required: true },
      targetPluginVersionId: { type: 'string', required: true },
      expectedCurrentPluginVersionId: { type: 'string' },
    });
    return this.versionSwitcher.switchVersion(tenantId(request), {
      pluginId: String(body.pluginId),
      targetPluginVersionId: String(body.targetPluginVersionId),
      ...(typeof body.expectedCurrentPluginVersionId === 'string'
        ? { expectedCurrentPluginVersionId: body.expectedCurrentPluginVersionId }
        : {}),
    });
  }

  private async importUnifiedPluginVersion(request: HttpRequest) {
    const body = validateObject(request.body, {
      manifest: { type: 'object', required: true },
      resources: { type: 'object' },
      packageContent: { type: 'string' },
    });
    return {
      statusCode: 201,
      body: await this.unifiedPlugins.importVersion(tenantId(request), body as unknown as ImportUnifiedPluginVersionInput),
    };
  }

  private approveUnifiedPluginPermissions(request: HttpRequest) {
    const body = validateObject(request.body, {
      pluginVersionId: { type: 'string', required: true },
      approvedPermissions: { type: 'array', required: true },
    });
    return this.unifiedPlugins.approvePermissions(
      String(body.pluginVersionId),
      (body.approvedPermissions as unknown[]).map(String),
    );
  }

  private enableUnifiedPluginVersion(request: HttpRequest) {
    const body = validateObject(request.body, { pluginVersionId: { type: 'string', required: true } });
    return this.unifiedPlugins.enableVersion(String(body.pluginVersionId));
  }

  private disableUnifiedPluginVersion(request: HttpRequest) {
    const body = validateObject(request.body, { pluginVersionId: { type: 'string', required: true } });
    return this.unifiedPlugins.disableVersion(String(body.pluginVersionId));
  }

  private retireUnifiedPluginVersion(request: HttpRequest) {
    const body = validateObject(request.body, { pluginVersionId: { type: 'string', required: true } });
    return this.unifiedPlugins.retireVersion(String(body.pluginVersionId));
  }

  private getUnifiedPluginUpgradeDiff(request: HttpRequest) {
    const fromVersionId = typeof request.query.fromVersionId === 'string' ? request.query.fromVersionId : '';
    const toVersionId = typeof request.query.toVersionId === 'string' ? request.query.toVersionId : '';
    return this.unifiedPlugins.getUpgradeDiff(fromVersionId, toVersionId);
  }

  private getUnifiedPluginUiResources(request: HttpRequest) {
    const pluginVersionId = typeof request.query.pluginVersionId === 'string' ? request.query.pluginVersionId : '';
    const locale = typeof request.query.locale === 'string' ? request.query.locale : 'zh-CN';
    return this.unifiedPlugins.getUiResources(pluginVersionId, locale);
  }

  private createPluginBinding(request: HttpRequest) {
    const body = validateObject(request.body, {
      pluginVersionId: { type: 'string', required: true }, mode: { type: 'string', required: true },
      inputBindings: { type: 'object', required: true }, managedContext: { type: 'object' },
    });
    return this.pluginBindings.createBinding(tenantId(request), {
      pluginVersionId: String(body.pluginVersionId), mode: body.mode as 'MANAGED' | 'STANDALONE',
      inputBindings: body.inputBindings as never,
      managedContext: body.managedContext as never,
    });
  }

  private getPluginBinding(request: HttpRequest) {
    const bindingId = typeof request.query.bindingId === 'string' ? request.query.bindingId : '';
    return this.pluginBindings.getTenantBinding(tenantId(request), bindingId);
  }

  private updatePluginBinding(request: HttpRequest) {
    const body = validateObject(request.body, {
      bindingId: { type: 'string', required: true }, expectedVersion: { type: 'number', required: true },
      inputBindings: { type: 'object' }, managedContext: { type: 'object' }, status: { type: 'string' },
    });
    return this.pluginBindings.updateBinding(tenantId(request), String(body.bindingId), body as never);
  }

  private assignPluginCapability(request: HttpRequest) {
    const body = validateObject(request.body, {
      ownerType: { type: 'string', required: true }, ownerId: { type: 'string', required: true }, capabilityKey: { type: 'string', required: true },
      pluginVersionId: { type: 'string', required: true }, pluginBindingId: { type: 'string', required: true }, precedence: { type: 'string', required: true },
    });
    return this.pluginBindings.assignCapability(tenantId(request), body as never);
  }

  private resolvePluginCapability(request: HttpRequest) {
    const body = validateObject(request.body, {
      capabilityKey: { type: 'string', required: true }, deviceId: { type: 'string' }, managedTargetId: { type: 'string' }, applicationAssetId: { type: 'string' },
    });
    return this.pluginBindings.resolveAssignment(tenantId(request), String(body.capabilityKey), {
      deviceId: typeof body.deviceId === 'string' ? body.deviceId : undefined,
      managedTargetId: typeof body.managedTargetId === 'string' ? body.managedTargetId : undefined,
      applicationAssetId: typeof body.applicationAssetId === 'string' ? body.applicationAssetId : undefined,
    });
  }

  private previewPromotion(request: HttpRequest) {
    const body = validateObject(request.body, {
      sourcePluginBindingId: { type: 'string', required: true }, displayName: { type: 'string', required: true },
      deviceFamily: { type: 'string', required: true }, managementAddress: { type: 'string', required: true },
      managementPort: { type: 'number', required: true }, authMode: { type: 'string', required: true },
      tlsVerify: { type: 'boolean', required: true }, gatewayId: { type: 'string' }, applicationAssetId: { type: 'string' },
      discovery: { type: 'object', required: true },
    });
    return this.requirePromotions().preview(tenantId(request), body as never);
  }

  private confirmPromotion(request: HttpRequest) {
    const body = validateObject(request.body, { promotionId: { type: 'string', required: true } });
    return this.requirePromotions().confirm(tenantId(request), String(body.promotionId));
  }

  private revokePromotion(request: HttpRequest) {
    const body = validateObject(request.body, { promotionId: { type: 'string', required: true } });
    return this.requirePromotions().revoke(tenantId(request), String(body.promotionId));
  }

  private getPromotion(request: HttpRequest) {
    const promotionId = typeof request.query.promotionId === 'string' ? request.query.promotionId : '';
    return this.requirePromotions().get(tenantId(request), promotionId);
  }

  private getManagedTargetEffectiveCapability(request: HttpRequest) {
    const service = this.requireManagedTargetPlugins();
    const match = request.path.match(/^\/api\/v1\/managed-targets\/([^/]+)\/deployment-capabilities\/([^/]+)$/);
    if (!match) throw new Error('受管目标能力路径无效');
    return service.getEffectiveCapability({
      tenantId: tenantId(request),
      managedTargetId: decodeURIComponent(match[1]!),
      capabilityKey: decodeURIComponent(match[2]!),
      applicationAssetId: queryString(request, 'applicationAssetId'),
    });
  }

  private listManagedTargetCompatiblePlugins(request: HttpRequest) {
    const service = this.requireManagedTargetPlugins();
    const managedTargetId = request.path.match(/^\/api\/v1\/managed-targets\/([^/]+)\/compatible-plugins$/)?.[1];
    if (!managedTargetId) throw new Error('受管目标兼容插件路径无效');
    return service.listCompatiblePlugins({
      tenantId: tenantId(request),
      managedTargetId: decodeURIComponent(managedTargetId),
      capabilityKey: queryString(request, 'capabilityKey') ?? 'certificate.deploy',
      applicationAssetId: queryString(request, 'applicationAssetId'),
      locale: queryString(request, 'locale') ?? 'zh-CN',
    });
  }

  private saveApplicationAssetManagedTarget(request: HttpRequest) {
    const service = this.requireManagedTargetPlugins();
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
    return service.saveApplicationAssetTarget({
      tenantId: tenantId(request),
      applicationAssetId: decodeURIComponent(applicationAssetId),
      value: body,
    });
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

function tenantId(request: HttpRequest): string {
  return request.context.tenantId ?? tenantFallback;
}

export function getPluginsRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/plugin-catalog', operationId: 'listPluginCatalog', summary: '查询统一插件目录', tags, responseSchema: pageResponseSchema },
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
    { method: 'PUT', path: '/api/v1/application-assets/:applicationAssetId/managed-target', operationId: 'saveApplicationAssetManagedTarget', summary: '保存应用资产受管目标和插件覆盖', tags, responseSchema: objectSchema() },
  ];
}

function queryString(request: HttpRequest, key: string): string | undefined {
  return typeof request.query[key] === 'string' ? request.query[key] : undefined;
}

function objectSchema() {
  return { type: 'object', additionalProperties: true };
}

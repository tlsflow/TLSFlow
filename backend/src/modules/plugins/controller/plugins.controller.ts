import type { Router } from '../../../common/http/router.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { pageResponseSchema } from '../../../common/openapi/schemas.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import { PluginsApplicationService } from '../application/plugins.application-service.js';
import { AgentDeploymentPluginsApplicationService } from '../application/agent-deployment-plugins.application-service.js';
import { UnifiedPluginsApplicationService } from '../application/unified-plugins.application-service.js';
import { PluginBindingsApplicationService } from '../application/plugin-bindings.application-service.js';
import type { ImportUnifiedPluginVersionInput } from '../dto/unified-plugins.dto.js';
import type {
  PluginEnableInput,
  PluginExecutionRequest,
  PluginPackageUploadInput,
  PluginPermissionApprovalInput,
} from '../dto/plugins.dto.js';

const tags = ['Plugins'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class PluginsController {
  constructor(
    private readonly service = new PluginsApplicationService(),
    private readonly agentPlugins = new AgentDeploymentPluginsApplicationService(),
    private readonly unifiedPlugins = new UnifiedPluginsApplicationService(),
    private readonly pluginBindings = new PluginBindingsApplicationService(),
  ) {}

  register(router: Router): void {
    router.get('/api/v1/plugins/packages', '查询插件包', tags, (request) => this.listPackages(request));
    router.post('/api/v1/plugins/packages', '上传插件包', tags, (request) => this.uploadPackage(request));
    router.post('/api/v1/plugins/permissions/approve', '审批插件权限', tags, (request) => this.approvePermissions(request));
    router.post('/api/v1/plugins/enable', '启用插件', tags, (request) => this.enablePlugin(request));
    router.post('/api/v1/plugins/disable', '禁用插件', tags, (request) => this.disablePlugin(request));
    router.post('/api/v1/plugins/execute', '执行插件 mock runtime', tags, (request) => this.execute(request));
    router.get('/api/v1/plugins/executions', '查询插件执行记录', tags, (request) => this.listExecutions(request));
    router.post('/api/v1/plugins/step-draft', '生成插件编排步骤草案', tags, (request) => this.getStepDraft(request));
    router.post('/api/v1/plugins/permission-summary', '生成插件权限摘要', tags, (request) => this.getPermissionSummary(request));
    router.post('/api/v1/plugins/capabilities', '输出插件 Capability 声明', tags, (request) => this.publishCapabilities(request));
    router.get('/api/v1/plugin-catalog', '查询统一插件目录', tags, (request) => this.listCatalog(request));
    router.get('/api/v1/plugin-versions', '查询统一插件版本', tags, (request) => this.listUnifiedPluginVersions(request));
    router.post('/api/v1/plugin-packages/import', '导入统一插件版本', tags, (request) => this.importUnifiedPluginVersion(request));
    router.post('/api/v1/plugin-versions/approve-permissions', '审批统一插件权限', tags, (request) => this.approveUnifiedPluginPermissions(request));
    router.post('/api/v1/plugin-versions/enable', '启用统一插件版本', tags, (request) => this.enableUnifiedPluginVersion(request));
    router.post('/api/v1/plugin-versions/disable', '禁用统一插件版本', tags, (request) => this.disableUnifiedPluginVersion(request));
    router.post('/api/v1/plugin-versions/retire', '退休统一插件版本', tags, (request) => this.retireUnifiedPluginVersion(request));
    router.get('/api/v1/plugin-versions/upgrade-diff', '查询统一插件升级差异', tags, (request) => this.getUnifiedPluginUpgradeDiff(request));
    router.post('/api/v1/plugin-bindings', '创建统一插件绑定', tags, (request) => this.createPluginBinding(request));
    router.post('/api/v1/capability-assignments', '设置插件能力指派', tags, (request) => this.assignPluginCapability(request));
    router.post('/api/v1/capability-assignments/resolve', '解析插件能力来源', tags, (request) => this.resolvePluginCapability(request));
    router.post('/api/v1/plugin-catalog/workflow-templates/enable', '启用 DSL 模板插件', tags, (request) => this.enableWorkflowTemplatePlugin(request));
    router.post('/api/v1/plugin-catalog/workflow-templates/disable', '禁用 DSL 模板插件', tags, (request) => this.disableWorkflowTemplatePlugin(request));
    router.get('/api/v1/plugins/agent-packages', '查询 Agent 插件包', tags, (request) => this.listAgentPackages(request));
    router.post('/api/v1/plugins/agent-packages', '上传 Agent 插件包', tags, (request) => this.uploadAgentPackage(request));
    router.post('/api/v1/plugins/agent-packages/permissions/approve', '审批 Agent 插件权限', tags, (request) => this.approveAgentPermissions(request));
    router.post('/api/v1/plugins/agent-packages/enable', '启用 Agent 插件', tags, (request) => this.enableAgentPackage(request));
    router.post('/api/v1/plugins/agent-packages/disable', '禁用 Agent 插件', tags, (request) => this.disableAgentPackage(request));
    router.get('/api/v1/plugins/agent-mounts', '查询 Agent 插件挂载', tags, (request) => this.listAgentMounts(request));
    router.post('/api/v1/plugins/agent-mounts/validate', '校验 Agent 插件挂载', tags, (request) => this.validateAgentMount(request));
    router.post('/api/v1/plugins/agent-mounts', '创建 Agent 插件挂载', tags, (request) => this.createAgentMount(request));
    router.post('/api/v1/plugins/agent-mounts/disable', '禁用 Agent 插件挂载', tags, (request) => this.disableAgentMount(request));
    router.delete('/api/v1/plugins/agent-mounts', '删除 Agent 插件挂载', tags, (request) => this.deleteAgentMount(request));
    router.post('/api/v1/plugins/agent-binding/preview', '预览 Agent 插件资产绑定', tags, (request) => this.previewAgentBinding(request));
    router.post('/api/v1/plugins/agent-plan/compile', '编译 Agent 插件执行计划', tags, (request) => this.compileAgentPlan(request));
  }

  getApplicationService(): PluginsApplicationService {
    return this.service;
  }

  private async listPackages(request: HttpRequest) {
    const items = await this.service.listPackages(tenantId(request));
    return { items, page: 1, pageSize: 100, total: items.length };
  }

  private async uploadPackage(request: HttpRequest) {
    const body = validateObject(request.body, {
      manifest: { type: 'object', required: true },
      packageContent: { type: 'string', required: true },
      expectedHash: { type: 'string' },
      signature: { type: 'string' },
    }) as unknown as PluginPackageUploadInput;
    return { statusCode: 201, body: await this.service.uploadPackage(body, tenantId(request)) };
  }

  private async approvePermissions(request: HttpRequest) {
    const body = validateObject(request.body, {
      pluginPackageId: { type: 'string', required: true },
      approvedBy: { type: 'string', required: true },
      approvedPermissions: { type: 'array', required: true },
    }) as unknown as PluginPermissionApprovalInput;
    return this.service.approvePermissions(body);
  }

  private async enablePlugin(request: HttpRequest) {
    const body = validateObject(request.body, { pluginPackageId: { type: 'string', required: true } }) as unknown as PluginEnableInput;
    return this.service.enablePlugin(body);
  }

  private async disablePlugin(request: HttpRequest) {
    const body = validateObject(request.body, { pluginPackageId: { type: 'string', required: true } }) as unknown as PluginEnableInput;
    return this.service.disablePlugin(body);
  }

  private async execute(request: HttpRequest) {
    const body = validateObject(request.body, {
      pluginPackageId: { type: 'string', required: true },
      action: { type: 'string', required: true },
      command: { type: 'string', required: true },
      input: { type: 'object' },
      timeoutSeconds: { type: 'number' },
      secretRefs: { type: 'array' },
      allowedSecretRefs: { type: 'array' },
      mockStdout: { type: 'string' },
      mockStderr: { type: 'string' },
    }) as unknown as PluginExecutionRequest;
    return this.service.execute(body);
  }

  private async listExecutions(request: HttpRequest) {
    const pluginPackageId = typeof request.query.pluginPackageId === 'string' ? request.query.pluginPackageId : undefined;
    const items = await this.service.listExecutions(pluginPackageId);
    return { items, page: 1, pageSize: 100, total: items.length };
  }

  private async getStepDraft(request: HttpRequest) {
    const body = validateObject(request.body, {
      pluginPackageId: { type: 'string', required: true },
      action: { type: 'string', required: true },
    });
    return this.service.getStepDraft(String(body.pluginPackageId), String(body.action));
  }

  private async getPermissionSummary(request: HttpRequest) {
    const body = validateObject(request.body, { pluginPackageId: { type: 'string', required: true } });
    return this.service.getPermissionSummary(String(body.pluginPackageId));
  }

  private async publishCapabilities(request: HttpRequest) {
    const body = validateObject(request.body, { pluginPackageId: { type: 'string', required: true } });
    return this.service.publishCapabilities(String(body.pluginPackageId));
  }

  private async listCatalog(request: HttpRequest) {
    const [legacyItems, unifiedItems] = await Promise.all([
      this.agentPlugins.listCatalog(tenantId(request)),
      this.unifiedPlugins.listCatalog(tenantId(request)),
    ]);
    const items = [...unifiedItems, ...legacyItems];
    return { items, page: 1, pageSize: items.length, total: items.length };
  }

  private async listUnifiedPluginVersions(request: HttpRequest) {
    const items = await this.unifiedPlugins.listVersions(tenantId(request));
    return { items, page: 1, pageSize: items.length, total: items.length };
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

  private createPluginBinding(request: HttpRequest) {
    const body = validateObject(request.body, {
      pluginVersionId: { type: 'string', required: true }, mode: { type: 'string', required: true },
      variableBindings: { type: 'object' }, secretBindings: { type: 'object' }, certificateArtifactBindings: { type: 'object' },
      connectionBindings: { type: 'object' }, managedContext: { type: 'object' },
    });
    return this.pluginBindings.createBinding(tenantId(request), {
      pluginVersionId: String(body.pluginVersionId), mode: body.mode as 'MANAGED' | 'STANDALONE',
      variableBindings: (body.variableBindings ?? {}) as Record<string, unknown>,
      secretBindings: (body.secretBindings ?? {}) as Record<string, string>,
      certificateArtifactBindings: (body.certificateArtifactBindings ?? {}) as never,
      connectionBindings: (body.connectionBindings ?? {}) as Record<string, unknown>,
      managedContext: body.managedContext as never,
    });
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

  private enableWorkflowTemplatePlugin(request: HttpRequest) {
    const body = validateObject(request.body, { fileTemplateId: { type: 'string', required: true } });
    return this.agentPlugins.enableWorkflowTemplatePlugin(tenantId(request), String(body.fileTemplateId));
  }

  private disableWorkflowTemplatePlugin(request: HttpRequest) {
    const body = validateObject(request.body, { fileTemplateId: { type: 'string', required: true } });
    return this.agentPlugins.disableWorkflowTemplatePlugin(tenantId(request), String(body.fileTemplateId));
  }

  private async listAgentPackages(request: HttpRequest) {
    const items = await this.agentPlugins.listPackages(tenantId(request));
    return { items, page: 1, pageSize: items.length, total: items.length };
  }

  private async uploadAgentPackage(request: HttpRequest) {
    const body = validateObject(request.body, {
      manifest: { type: 'object', required: true },
      packageContent: { type: 'string', required: true },
      expectedHash: { type: 'string' },
      signature: { type: 'string' },
    });
    return { statusCode: 201, body: await this.agentPlugins.uploadPackage(body as never, tenantId(request)) };
  }

  private approveAgentPermissions(request: HttpRequest) {
    const body = validateObject(request.body, {
      pluginPackageId: { type: 'string', required: true },
      approvedBy: { type: 'string', required: true },
      approvedPermissions: { type: 'array', required: true },
    });
    return this.agentPlugins.approvePermissions(body as never);
  }

  private enableAgentPackage(request: HttpRequest) {
    const body = validateObject(request.body, { pluginPackageId: { type: 'string', required: true } });
    return this.agentPlugins.enablePackage(body as never);
  }

  private disableAgentPackage(request: HttpRequest) {
    const body = validateObject(request.body, { pluginPackageId: { type: 'string', required: true } });
    return this.agentPlugins.disablePackage(body as never);
  }

  private async listAgentMounts(request: HttpRequest) {
    const agentId = typeof request.query.agentId === 'string' ? request.query.agentId : undefined;
    const items = await this.agentPlugins.listMounts(tenantId(request), agentId);
    return { items, page: 1, pageSize: items.length, total: items.length };
  }

  private validateAgentMount(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      pluginPackageId: { type: 'string', required: true },
    });
    return this.agentPlugins.validateMount(tenantId(request), body as never);
  }

  private createAgentMount(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      pluginPackageId: { type: 'string', required: true },
    });
    return this.agentPlugins.createMount(tenantId(request), body as never);
  }

  private disableAgentMount(request: HttpRequest) {
    const body = validateObject(request.body, { mountId: { type: 'string', required: true } });
    return this.agentPlugins.disableMount(tenantId(request), String(body.mountId));
  }

  private async deleteAgentMount(request: HttpRequest) {
    const mountId = typeof request.query.mountId === 'string' ? request.query.mountId : '';
    await this.agentPlugins.deleteMount(tenantId(request), mountId);
    return { deleted: true, mountId };
  }

  private previewAgentBinding(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      binding: { type: 'object', required: true },
    });
    return this.agentPlugins.previewBinding(tenantId(request), String(body.agentId), body.binding as never);
  }

  private compileAgentPlan(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      executionRunId: { type: 'string', required: true },
      executionStepId: { type: 'string', required: true },
      binding: { type: 'object', required: true },
      artifacts: { type: 'object', required: true },
      executionVariables: { type: 'object' },
      ttlSeconds: { type: 'number' },
    });
    return this.agentPlugins.compileExecutionPlan({ tenantId: tenantId(request), ...body } as never);
  }
}

function tenantId(request: HttpRequest): string {
  return request.context.tenantId ?? tenantFallback;
}

export function getPluginsRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/plugins/packages', operationId: 'listPluginPackages', summary: '查询插件包', tags, responseSchema: pageResponseSchema },
    { method: 'POST', path: '/api/v1/plugins/packages', operationId: 'uploadPluginPackage', summary: '上传插件包', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugins/permissions/approve', operationId: 'approvePluginPermissions', summary: '审批插件权限', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugins/enable', operationId: 'enablePlugin', summary: '启用插件', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugins/disable', operationId: 'disablePlugin', summary: '禁用插件', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugins/execute', operationId: 'executePluginMockRuntime', summary: '执行插件 mock runtime', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/plugins/executions', operationId: 'listPluginExecutions', summary: '查询插件执行记录', tags, responseSchema: pageResponseSchema },
    { method: 'POST', path: '/api/v1/plugins/step-draft', operationId: 'createPluginStepDraft', summary: '生成插件编排步骤草案', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugins/permission-summary', operationId: 'createPluginPermissionSummary', summary: '生成插件权限摘要', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugins/capabilities', operationId: 'publishPluginCapabilities', summary: '输出插件 Capability 声明', tags, responseSchema: { type: 'array', items: objectSchema() } },
    { method: 'GET', path: '/api/v1/plugin-catalog', operationId: 'listPluginCatalog', summary: '查询统一插件目录', tags, responseSchema: pageResponseSchema },
    { method: 'GET', path: '/api/v1/plugin-versions', operationId: 'listUnifiedPluginVersions', summary: '查询统一插件版本', tags, responseSchema: pageResponseSchema },
    { method: 'POST', path: '/api/v1/plugin-packages/import', operationId: 'importUnifiedPluginVersion', summary: '导入统一插件版本', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-versions/approve-permissions', operationId: 'approveUnifiedPluginPermissions', summary: '审批统一插件权限', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-versions/enable', operationId: 'enableUnifiedPluginVersion', summary: '启用统一插件版本', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-versions/disable', operationId: 'disableUnifiedPluginVersion', summary: '禁用统一插件版本', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-versions/retire', operationId: 'retireUnifiedPluginVersion', summary: '退休统一插件版本', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/plugin-versions/upgrade-diff', operationId: 'getUnifiedPluginUpgradeDiff', summary: '查询统一插件升级差异', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-bindings', operationId: 'createPluginBinding', summary: '创建统一插件绑定', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/capability-assignments', operationId: 'assignPluginCapability', summary: '设置插件能力指派', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/capability-assignments/resolve', operationId: 'resolvePluginCapability', summary: '解析插件能力来源', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-catalog/workflow-templates/enable', operationId: 'enableWorkflowTemplatePlugin', summary: '启用 DSL 模板插件', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugin-catalog/workflow-templates/disable', operationId: 'disableWorkflowTemplatePlugin', summary: '禁用 DSL 模板插件', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/plugins/agent-packages', operationId: 'listAgentPluginPackages', summary: '查询 Agent 插件包', tags, responseSchema: pageResponseSchema },
    { method: 'POST', path: '/api/v1/plugins/agent-packages', operationId: 'uploadAgentPluginPackage', summary: '上传 Agent 插件包', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugins/agent-packages/permissions/approve', operationId: 'approveAgentPluginPermissions', summary: '审批 Agent 插件权限', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugins/agent-packages/enable', operationId: 'enableAgentPluginPackage', summary: '启用 Agent 插件', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugins/agent-packages/disable', operationId: 'disableAgentPluginPackage', summary: '禁用 Agent 插件', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/plugins/agent-mounts', operationId: 'listAgentPluginMounts', summary: '查询 Agent 插件挂载', tags, responseSchema: pageResponseSchema },
    { method: 'POST', path: '/api/v1/plugins/agent-mounts/validate', operationId: 'validateAgentPluginMount', summary: '校验 Agent 插件挂载', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugins/agent-mounts', operationId: 'createAgentPluginMount', summary: '创建 Agent 插件挂载', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugins/agent-mounts/disable', operationId: 'disableAgentPluginMount', summary: '禁用 Agent 插件挂载', tags, responseSchema: objectSchema() },
    { method: 'DELETE', path: '/api/v1/plugins/agent-mounts', operationId: 'deleteAgentPluginMount', summary: '删除 Agent 插件挂载', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugins/agent-binding/preview', operationId: 'previewAgentPluginBinding', summary: '预览 Agent 插件资产绑定', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/plugins/agent-plan/compile', operationId: 'compileAgentPluginPlan', summary: '编译 Agent 插件执行计划', tags, responseSchema: objectSchema() },
  ];
}

function objectSchema() {
  return { type: 'object', additionalProperties: true };
}

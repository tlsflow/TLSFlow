import type { Router } from '../../../common/http/router.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { pageResponseSchema } from '../../../common/openapi/schemas.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import { PluginsApplicationService } from '../application/plugins.application-service.js';
import type {
  PluginEnableInput,
  PluginExecutionRequest,
  PluginPackageUploadInput,
  PluginPermissionApprovalInput,
} from '../dto/plugins.dto.js';

const tags = ['Plugins'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class PluginsController {
  constructor(private readonly service = new PluginsApplicationService()) {}

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
  ];
}

function objectSchema() {
  return { type: 'object', additionalProperties: true };
}

import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import type { SecurityServices } from '../../security/security.controller.js';
import {
  assertRouteAction,
  assertRouteObjectAccess,
  filterAuthorizedItems,
  requireRouteSecurity,
} from '../../security/security-route-helpers.js';
import { WorkflowTemplatesApplicationService } from '../application/workflow-templates.application-service.js';
import { PluginWorkflowSourceService } from '../application/plugin-workflow-source.service.js';
import { WorkflowExecutionBindingsService } from '../application/workflow-execution-bindings.service.js';
import type {
  CreateWorkflowTemplateInput,
  CreateWorkflowFromPluginInput,
  RenameWorkflowTemplateInput,
  UpdateWorkflowTemplateInput,
  UpdateWorkflowTemplateVersionNoteInput,
  WorkflowRuntimeInput,
  WorkflowStepRuntimeInput,
} from '../dto/workflow-templates.dto.js';

const tag = ['WorkflowTemplates'];

export class WorkflowTemplatesController {
  constructor(
    private readonly service = new WorkflowTemplatesApplicationService(),
    private readonly security?: SecurityServices,
    private readonly pluginSources?: PluginWorkflowSourceService,
    private readonly executionBindings?: WorkflowExecutionBindingsService,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/workflows', '列出工作流', tag, async (request) => this.listWorkflows(request));
    router.get('/api/v1/workflow-sources/plugins', '列出插件工作流来源', tag, async (request) => this.listPluginSources(request));
    router.get('/api/v1/workflow-execution-bindings/:bindingId', '读取工作流执行绑定', tag, async (request) => this.getExecutionBinding(request));
    router.post('/api/v1/workflows/from-plugin', '从插件能力创建工作流', tag, async (request) => this.createWorkflowFromPlugin(request));
    router.post('/api/v1/workflows/:workflowId/drafts/from-plugin', '从插件能力生成工作流草稿', tag, async (request) => this.createWorkflowDraftFromPlugin(request));
    // 兼容旧客户端；正式工作流列表统一使用 /api/v1/workflows。
    router.get('/api/v1/workflow-templates', '兼容：列出工作流模板', tag, async (request) => this.listTemplates(request));
    router.post('/api/v1/workflow-templates/rename', '修改工作流名称', tag, async (request) => this.renameTemplate(request));
    router.post('/api/v1/workflow-templates/canvas/compile', '后端编译工作流画布', tag, async (request) => ({ statusCode: 200, body: this.service.compileCanvas(request.body) }));
    router.post('/api/v1/workflow-templates/canvas/validate', '后端校验工作流画布', tag, async (request) => ({ statusCode: 200, body: this.service.validateCanvas(request.body) }));
    router.post('/api/v1/workflow-templates/delete', '删除工作流模板', tag, async (request) => this.deleteTemplate(request));
    router.get('/api/v1/workflow-template-versions', '列出模板版本', tag, async (request) => this.listVersions(request));
    router.post('/api/v1/workflow-template-versions', '创建不可变模板版本', tag, async (request) => this.createDraftVersion(request));
    router.post('/api/v1/workflow-template-versions/draft', '更新当前草稿版本', tag, async (request) => this.updateCurrentDraftVersion(request));
    router.post('/api/v1/workflow-template-versions/note', '更新模板版本备注', tag, async (request) => this.updateVersionNote(request));
    router.post('/api/v1/workflow-template-versions/publish', '发布模板版本', tag, async (request) => this.publishVersion(request));
    router.post('/api/v1/workflow-template-runs/preview', '渲染模板预览', tag, async (request) => this.preview(request));
    router.post('/api/v1/workflow-template-runs/test', '执行模板测试运行计划', tag, async (request) => this.testRun(request));
    router.post('/api/v1/workflow-template-runs/test-step', '执行单节点测试运行', tag, async (request) => this.testStep(request));
  }

  private requirePluginSources(): PluginWorkflowSourceService {
    if (!this.pluginSources) throw new Error('PluginWorkflowSourceService 未接入');
    return this.pluginSources;
  }

  private requireExecutionBindings(): WorkflowExecutionBindingsService {
    if (!this.executionBindings) throw new Error('WorkflowExecutionBindingsService 未接入');
    return this.executionBindings;
  }

  getApplicationService(): WorkflowTemplatesApplicationService {
    return this.service;
  }

  private async listTemplates(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'workflow.read', 'workflow');
    const items = await this.service.listTemplates();
    return { statusCode: 200, body: { items: await filterAuthorizedItems(security, items, 'workflow', 'read') } };
  }

  private async listWorkflows(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'workflow.read', 'workflow');
    const items = await this.service.listWorkflows(security.tenantId);
    return { statusCode: 200, body: { items: await filterAuthorizedItems(security, items, 'workflow', 'read') } };
  }

  private async listVersions(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'workflow.read', 'workflow');
    const templateId = String(request.query.templateId ?? '');
    if (templateId) {
      await assertRouteObjectAccess(security, 'read', { objectType: 'workflow', objectId: templateId, tenantId: security.tenantId });
    }
    const items = await this.service.listVersions(templateId);
    return {
      statusCode: 200,
      body: { items: await filterAuthorizedItems(security, items, 'workflow', 'read', 'templateId') },
    };
  }

  private async listPluginSources(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'workflow.read', 'workflow');
    return {
      statusCode: 200,
      body: {
        items: await this.requirePluginSources().list(
          security.tenantId,
          typeof request.query.locale === 'string' ? request.query.locale : 'zh-CN',
        ),
      },
    };
  }

  private async getExecutionBinding(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const bindingId = request.path.match(/^\/api\/v1\/workflow-execution-bindings\/([^/]+)$/)?.[1];
    if (!bindingId) throw new Error('工作流执行绑定路径无效');
    const decodedId = decodeURIComponent(bindingId);
    await assertRouteAction(security, 'workflow.execution_binding.read', 'workflow_execution_binding', { resourceId: decodedId });
    await assertRouteObjectAccess(security, 'read', { objectType: 'workflow_execution_binding', objectId: decodedId, tenantId: security.tenantId });
    return { statusCode: 200, body: await this.requireExecutionBindings().get(security.tenantId, decodedId) };
  }

  private async createWorkflowFromPlugin(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const input = request.body as CreateWorkflowFromPluginInput;
    await assertRouteAction(security, 'workflow.create', 'workflow');
    if (typeof input.pluginVersionId === 'string' && input.pluginVersionId.trim() !== '') {
      await assertRouteObjectAccess(security, 'read', { objectType: 'plugin_version', objectId: input.pluginVersionId, tenantId: security.tenantId });
    }
    return { statusCode: 201, body: await this.requirePluginSources().createWorkflow(security.tenantId, input) };
  }

  private async createWorkflowDraftFromPlugin(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const workflowId = request.path.match(/^\/api\/v1\/workflows\/([^/]+)\/drafts\/from-plugin$/)?.[1];
    if (!workflowId) throw new Error('工作流插件派生路径无效');
    const templateId = decodeURIComponent(workflowId);
    const input = request.body as CreateWorkflowFromPluginInput;
    await assertRouteAction(security, 'workflow.update', 'workflow', { resourceId: templateId });
    await assertRouteObjectAccess(security, 'edit', { objectType: 'workflow', objectId: templateId, tenantId: security.tenantId });
    if (typeof input.pluginVersionId === 'string' && input.pluginVersionId.trim() !== '') {
      await assertRouteObjectAccess(security, 'read', { objectType: 'plugin_version', objectId: input.pluginVersionId, tenantId: security.tenantId });
    }
    return { statusCode: 201, body: await this.requirePluginSources().createDraft(security.tenantId, { ...input, templateId }) };
  }

  private async renameTemplate(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const input = request.body as RenameWorkflowTemplateInput;
    await assertRouteAction(security, 'workflow.update', 'workflow', { resourceId: input.templateId });
    await assertRouteObjectAccess(security, 'edit', { objectType: 'workflow', objectId: input.templateId, tenantId: security.tenantId });
    return { statusCode: 200, body: await this.service.renameTemplate(input) };
  }

  private async deleteTemplate(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const templateId = String((request.body as { id?: string }).id ?? '');
    await assertRouteAction(security, 'workflow.delete', 'workflow', { resourceId: templateId });
    await assertRouteObjectAccess(security, 'control', { objectType: 'workflow', objectId: templateId, tenantId: security.tenantId });
    return { statusCode: 200, body: await this.service.disableTemplate(templateId) };
  }

  private async createDraftVersion(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const input = request.body as UpdateWorkflowTemplateInput;
    await assertRouteAction(security, 'workflow.update', 'workflow', { resourceId: input.templateId });
    await assertRouteObjectAccess(security, 'edit', { objectType: 'workflow', objectId: input.templateId, tenantId: security.tenantId });
    return { statusCode: 201, body: await this.service.createDraftVersion(input) };
  }

  private async updateCurrentDraftVersion(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const input = request.body as UpdateWorkflowTemplateInput;
    await assertRouteAction(security, 'workflow.update', 'workflow', { resourceId: input.templateId });
    await assertRouteObjectAccess(security, 'edit', { objectType: 'workflow', objectId: input.templateId, tenantId: security.tenantId });
    return { statusCode: 200, body: await this.service.updateCurrentDraftVersion(input) };
  }

  private async updateVersionNote(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const input = request.body as UpdateWorkflowTemplateVersionNoteInput;
    const version = await this.service.getVersion(input.versionId);
    await assertRouteAction(security, 'workflow.update', 'workflow', { resourceId: version.templateId });
    await assertRouteObjectAccess(security, 'edit', { objectType: 'workflow', objectId: version.templateId, tenantId: security.tenantId });
    return { statusCode: 200, body: await this.service.updateVersionNote(input) };
  }

  private async publishVersion(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const versionId = (request.body as { versionId: string }).versionId;
    const version = await this.service.getVersion(versionId);
    await assertRouteAction(security, 'workflow.publish', 'workflow', { resourceId: version.templateId });
    await assertRouteObjectAccess(security, 'control', { objectType: 'workflow', objectId: version.templateId, tenantId: security.tenantId });
    return { statusCode: 200, body: await this.service.publishVersion(versionId) };
  }

  private async preview(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const input = request.body as WorkflowRuntimeInput;
    await this.assertWorkflowRuntimeAccess(security, input);
    return { statusCode: 200, body: await this.service.preview(input) };
  }

  private async testRun(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const input = request.body as WorkflowRuntimeInput;
    await this.assertWorkflowRuntimeAccess(security, input);
    return { statusCode: 200, body: await this.service.testRun(input) };
  }

  private async testStep(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const input = request.body as WorkflowStepRuntimeInput;
    await this.assertWorkflowRuntimeAccess(security, input);
    return { statusCode: 200, body: await this.service.testStep(input) };
  }

  private async assertWorkflowRuntimeAccess(
    security: ReturnType<typeof requireRouteSecurity>,
    input: WorkflowRuntimeInput | WorkflowStepRuntimeInput,
  ): Promise<void> {
    await assertRouteAction(security, 'workflow.test', 'workflow');
    if ('templateVersionId' in input && typeof input.templateVersionId === 'string' && input.templateVersionId.trim() !== '') {
      const version = await this.service.getVersion(input.templateVersionId);
      await assertRouteObjectAccess(security, 'control', { objectType: 'workflow', objectId: version.templateId, tenantId: security.tenantId });
    }
  }
}

function tenantId(request: HttpRequest): string {
  return requireTenantId(request);
}

export function getWorkflowTemplateRouteContracts(): RouteContract[] {
  const objectSchema = { type: 'object', additionalProperties: true };
  return [
    { method: 'GET', path: '/api/v1/workflows', operationId: 'listWorkflows', summary: '列出工作流', tags: tag, responseSchema: objectSchema },
    { method: 'GET', path: '/api/v1/workflow-sources/plugins', operationId: 'listPluginWorkflowSources', summary: '列出插件工作流来源', tags: tag, responseSchema: objectSchema },
    { method: 'GET', path: '/api/v1/workflow-execution-bindings/:bindingId', operationId: 'getWorkflowExecutionBinding', summary: '读取工作流执行绑定', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflows/from-plugin', operationId: 'createWorkflowFromPlugin', summary: '从插件能力创建工作流', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflows/:workflowId/drafts/from-plugin', operationId: 'createWorkflowDraftFromPlugin', summary: '从插件能力生成工作流草稿', tags: tag, responseSchema: objectSchema },
    { method: 'GET', path: '/api/v1/workflow-templates', operationId: 'listWorkflowTemplates', summary: '兼容：列出工作流模板', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-templates/rename', operationId: 'renameWorkflowTemplate', summary: '修改工作流名称', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-templates/canvas/compile', operationId: 'compileWorkflowCanvas', summary: '后端编译工作流画布', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-templates/canvas/validate', operationId: 'validateWorkflowCanvas', summary: '后端校验工作流画布', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-templates/delete', operationId: 'deleteWorkflowTemplate', summary: '删除工作流模板', tags: tag, responseSchema: objectSchema },
    { method: 'GET', path: '/api/v1/workflow-template-versions', operationId: 'listWorkflowTemplateVersions', summary: '列出模板版本', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-versions', operationId: 'createWorkflowTemplateVersion', summary: '创建不可变模板版本', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-versions/draft', operationId: 'updateCurrentWorkflowTemplateDraftVersion', summary: '更新当前草稿版本', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-versions/note', operationId: 'updateWorkflowTemplateVersionNote', summary: '更新模板版本备注', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-versions/publish', operationId: 'publishWorkflowTemplateVersion', summary: '发布模板版本', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-runs/preview', operationId: 'previewWorkflowTemplateRun', summary: '渲染模板预览', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-runs/test', operationId: 'testWorkflowTemplateRun', summary: '执行模板测试运行计划', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-runs/test-step', operationId: 'testWorkflowTemplateStep', summary: '执行单节点测试运行', tags: tag, responseSchema: objectSchema },
  ];
}

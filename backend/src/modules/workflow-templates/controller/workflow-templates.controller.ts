import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import type { SecurityServices } from '../../security/security.controller.js';
import {
  assertRouteAction,
  assertRouteObjectAccess,
  decorateAuthorizedItem,
  filterAuthorizedItems,
  requireRouteSecurity,
} from '../../security/security-route-helpers.js';
import { unifiedPluginVersionOwnerType } from '../../plugins/application/unified-plugins.application-service.js';
import type { ResourceOwnerType } from '../../../shared/security-types.js';
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
    return { statusCode: 200, body: { items: await this.filterWorkflowItems(security, items) } };
  }

  private async listWorkflows(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'workflow.read', 'workflow');
    const items = await this.service.listWorkflows(security.tenantId);
    return { statusCode: 200, body: { items: await this.filterWorkflowItems(security, items) } };
  }

  private async listVersions(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'workflow.read', 'workflow');
    const templateId = String(request.query.templateId ?? '');
    let requestedTemplate:
      | Awaited<ReturnType<WorkflowTemplatesController['requireWorkflowTemplate']>>
      | undefined;
    if (templateId) {
      requestedTemplate = await this.requireWorkflowTemplate(templateId);
      await assertRouteObjectAccess(security, 'read', {
        objectType: 'workflow',
        objectId: requestedTemplate.id,
        ...this.workflowOwnership(requestedTemplate),
      });
    }
    const items = await this.service.listVersions(templateId);
    const ownershipByTemplateId = requestedTemplate
      ? new Map([[requestedTemplate.id, this.workflowOwnership(requestedTemplate)] as const])
      : new Map(
        (await this.service.listTemplates()).map((template) => [template.id, this.workflowOwnership(template)] as const),
      );
    return {
      statusCode: 200,
      body: {
        items: await this.filterWorkflowItems(
          security,
          items,
          'templateId',
          (item) => ownershipByTemplateId.get(String((item as unknown as Record<string, unknown>).templateId)),
        ),
      },
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
      await this.assertPluginVersionAccess(security, 'read', input.pluginVersionId);
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
    await this.assertWorkflowTemplateAccess(security, 'edit', templateId);
    if (typeof input.pluginVersionId === 'string' && input.pluginVersionId.trim() !== '') {
      await this.assertPluginVersionAccess(security, 'read', input.pluginVersionId);
    }
    return { statusCode: 201, body: await this.requirePluginSources().createDraft(security.tenantId, { ...input, templateId }) };
  }

  private async renameTemplate(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const input = request.body as RenameWorkflowTemplateInput;
    await assertRouteAction(security, 'workflow.update', 'workflow', { resourceId: input.templateId });
    await this.assertWorkflowTemplateAccess(security, 'edit', input.templateId);
    return { statusCode: 200, body: await this.service.renameTemplate(input) };
  }

  private async deleteTemplate(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const templateId = String((request.body as { id?: string }).id ?? '');
    await assertRouteAction(security, 'workflow.delete', 'workflow', { resourceId: templateId });
    await this.assertWorkflowTemplateAccess(security, 'control', templateId);
    return { statusCode: 200, body: await this.service.disableTemplate(templateId) };
  }

  private async createDraftVersion(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const input = request.body as UpdateWorkflowTemplateInput;
    await assertRouteAction(security, 'workflow.update', 'workflow', { resourceId: input.templateId });
    await this.assertWorkflowTemplateAccess(security, 'edit', input.templateId);
    return { statusCode: 201, body: await this.service.createDraftVersion(input) };
  }

  private async updateCurrentDraftVersion(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const input = request.body as UpdateWorkflowTemplateInput;
    await assertRouteAction(security, 'workflow.update', 'workflow', { resourceId: input.templateId });
    await this.assertWorkflowTemplateAccess(security, 'edit', input.templateId);
    return { statusCode: 200, body: await this.service.updateCurrentDraftVersion(input) };
  }

  private async updateVersionNote(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const input = request.body as UpdateWorkflowTemplateVersionNoteInput;
    const version = await this.service.getVersion(input.versionId);
    await assertRouteAction(security, 'workflow.update', 'workflow', { resourceId: version.templateId });
    await this.assertWorkflowTemplateAccess(security, 'edit', version.templateId);
    return { statusCode: 200, body: await this.service.updateVersionNote(input) };
  }

  private async publishVersion(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const versionId = (request.body as { versionId: string }).versionId;
    const version = await this.service.getVersion(versionId);
    await assertRouteAction(security, 'workflow.publish', 'workflow', { resourceId: version.templateId });
    await this.assertWorkflowTemplateAccess(security, 'control', version.templateId);
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
      await this.assertWorkflowTemplateAccess(security, 'control', version.templateId);
    }
  }

  private async filterWorkflowItems<T extends object>(
    security: ReturnType<typeof requireRouteSecurity>,
    items: T[],
    objectIdField = 'id',
    ownershipOfItem?: (item: T) => { tenantId?: string; ownerType?: ResourceOwnerType } | undefined,
  ): Promise<T[]> {
    const decorated = items.map((item) => decorateAuthorizedItem(
      item,
      security.tenantId,
      ownershipOfItem?.(item)
        ?? {
          tenantId: readOptionalString(item, 'tenantId'),
          ownerType: readWorkflowOwnerType(item),
        },
    ));
    const authorized = await filterAuthorizedItems(security, decorated, 'workflow', 'read', objectIdField);
    const allowed = new Set(authorized.map((item) => String((item as Record<string, unknown>)[objectIdField])));
    return items.filter((item) => allowed.has(String((item as Record<string, unknown>)[objectIdField])));
  }

  private async assertWorkflowTemplateAccess(
    security: ReturnType<typeof requireRouteSecurity>,
    accessLevel: 'read' | 'edit' | 'control',
    templateId: string,
  ): Promise<void> {
    const template = await this.requireWorkflowTemplate(templateId);
    await assertRouteObjectAccess(security, accessLevel, {
      objectType: 'workflow',
      objectId: template.id,
      ...this.workflowOwnership(template),
    });
  }

  private async assertPluginVersionAccess(
    security: ReturnType<typeof requireRouteSecurity>,
    accessLevel: 'read' | 'control',
    pluginVersionId: string,
  ): Promise<void> {
    const version = await this.requirePluginSources().getAccessiblePluginVersion(security.tenantId, pluginVersionId);
    const ownerType = unifiedPluginVersionOwnerType(version);
    await assertRouteObjectAccess(security, accessLevel, {
      objectType: 'plugin_version',
      objectId: version.id,
      ownerType,
      tenantId: ownerType === 'SYSTEM' ? undefined : version.tenantId,
    });
  }

  private async requireWorkflowTemplate(templateId: string) {
    return this.service.getTemplate(templateId);
  }

  private workflowOwnership(template: { ownerType?: string; tenantId?: string }) {
    const ownerType = template.ownerType === 'SYSTEM' ? 'SYSTEM' : 'TENANT';
    return {
      ownerType,
      tenantId: ownerType === 'SYSTEM' ? undefined : template.tenantId,
    } as const;
  }
}

function tenantId(request: HttpRequest): string {
  return requireTenantId(request);
}

function readOptionalString(value: object, key: string): string | undefined {
  const current = (value as Record<string, unknown>)[key];
  return typeof current === 'string' && current.trim() ? current : undefined;
}

function readWorkflowOwnerType(value: object): ResourceOwnerType | undefined {
  const current = (value as Record<string, unknown>).ownerType;
  return current === 'SYSTEM' || current === 'GROUP' || current === 'TENANT' ? current : undefined;
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

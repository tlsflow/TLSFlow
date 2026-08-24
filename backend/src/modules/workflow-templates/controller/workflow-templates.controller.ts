import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { applyAuthorizationFilter } from '../../../common/pagination/pagination.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
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
    router.get('/api/v1/workflow-sources/plugins', '列出插件工作流来源', tag, async (request) => ({
      statusCode: 200,
      body: {
        items: await this.requirePluginSources().list(
          tenantId(request),
          typeof request.query.locale === 'string' ? request.query.locale : 'zh-CN',
        ),
      },
    }));
    router.get('/api/v1/workflow-execution-bindings/:bindingId', '读取工作流执行绑定', tag, async (request) => {
      const bindingId = request.path.match(/^\/api\/v1\/workflow-execution-bindings\/([^/]+)$/)?.[1];
      if (!bindingId) throw new Error('工作流执行绑定路径无效');
      return { statusCode: 200, body: await this.requireExecutionBindings().get(tenantId(request), decodeURIComponent(bindingId)) };
    });
    router.post('/api/v1/workflows/from-plugin', '从插件能力创建工作流', tag, async (request) => ({ statusCode: 201, body: await this.requirePluginSources().createWorkflow(tenantId(request), request.body as CreateWorkflowFromPluginInput) }));
    router.post('/api/v1/workflows/:workflowId/drafts/from-plugin', '从插件能力生成工作流草稿', tag, async (request) => {
      const workflowId = request.path.match(/^\/api\/v1\/workflows\/([^/]+)\/drafts\/from-plugin$/)?.[1];
      if (!workflowId) throw new Error('工作流插件派生路径无效');
      return { statusCode: 201, body: await this.requirePluginSources().createDraft(tenantId(request), { ...(request.body as CreateWorkflowFromPluginInput), templateId: decodeURIComponent(workflowId) }) };
    });
    // 兼容旧客户端；正式工作流列表统一使用 /api/v1/workflows。
    router.get('/api/v1/workflow-templates', '兼容：列出工作流模板', tag, async (request) => this.listTemplates(request));
    router.post('/api/v1/workflow-templates/rename', '修改工作流名称', tag, async (request) => ({ statusCode: 200, body: await this.service.renameTemplate(request.body as RenameWorkflowTemplateInput) }));
    router.post('/api/v1/workflow-templates/canvas/compile', '后端编译工作流画布', tag, async (request) => ({ statusCode: 200, body: this.service.compileCanvas(request.body) }));
    router.post('/api/v1/workflow-templates/canvas/validate', '后端校验工作流画布', tag, async (request) => ({ statusCode: 200, body: this.service.validateCanvas(request.body) }));
    router.post('/api/v1/workflow-templates/delete', '删除工作流模板', tag, async (request) => ({ statusCode: 200, body: await this.service.disableTemplate(String((request.body as { id?: string }).id ?? '')) }));
    router.get('/api/v1/workflow-template-versions', '列出模板版本', tag, async (request) => this.listVersions(request));
    router.post('/api/v1/workflow-template-versions', '创建不可变模板版本', tag, async (request) => ({ statusCode: 201, body: await this.service.createDraftVersion(request.body as UpdateWorkflowTemplateInput) }));
    router.post('/api/v1/workflow-template-versions/draft', '更新当前草稿版本', tag, async (request) => ({ statusCode: 200, body: await this.service.updateCurrentDraftVersion(request.body as UpdateWorkflowTemplateInput) }));
    router.post('/api/v1/workflow-template-versions/note', '更新模板版本备注', tag, async (request) => ({ statusCode: 200, body: await this.service.updateVersionNote(request.body as UpdateWorkflowTemplateVersionNoteInput) }));
    router.post('/api/v1/workflow-template-versions/publish', '发布模板版本', tag, async (request) => ({ statusCode: 200, body: await this.service.publishVersion((request.body as { versionId: string }).versionId) }));
    router.post('/api/v1/workflow-template-runs/preview', '渲染模板预览', tag, async (request) => ({ statusCode: 200, body: await this.service.preview(request.body as WorkflowRuntimeInput) }));
    router.post('/api/v1/workflow-template-runs/test', '执行模板测试运行计划', tag, async (request) => ({ statusCode: 200, body: await this.service.testRun(request.body as WorkflowRuntimeInput) }));
    router.post('/api/v1/workflow-template-runs/test-step', '执行单节点测试运行', tag, async (request) => ({ statusCode: 200, body: await this.service.testStep(request.body as WorkflowStepRuntimeInput) }));
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
    const items = await this.service.listTemplates();
    return { statusCode: 200, body: { items: await this.authorizedItems(this.subjectFromRequest(request), 'workflow', items) } };
  }

  private async listWorkflows(request: HttpRequest) {
    const items = await this.service.listWorkflows(tenantId(request));
    return { statusCode: 200, body: { items: await this.authorizedItems(this.subjectFromRequest(request), 'workflow', items) } };
  }

  private async listVersions(request: HttpRequest) {
    const templateId = String(request.query.templateId ?? '');
    const items = await this.service.listVersions(templateId);
    return {
      statusCode: 200,
      body: { items: await this.authorizedItems(this.subjectFromRequest(request), 'workflow', items, 'templateId') },
    };
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    return { id: request.context.actorId ?? 'system_workflows', type: request.context.actorId ? 'user' : 'system', scope: { tenantId: request.context.tenantId } };
  }

  private async authorizedItems<T extends object>(subject: SecuritySubject, objectType: string, items: T[], objectIdField = 'id'): Promise<T[]> {
    if (!this.security || subject.type === 'system') return items;
    const authorization = await this.security.objectPermissions.buildAuthorizedQuery(subject, objectType, 'read');
    return applyAuthorizationFilter(items, { page: 1, pageSize: Math.max(items.length, 1), filter: {}, authorization: { ...authorization, objectIdField } });
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

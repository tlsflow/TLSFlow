import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { applyAuthorizationFilter } from '../../../common/pagination/pagination.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { WorkflowTemplatesApplicationService } from '../application/workflow-templates.application-service.js';
import type {
  ApplyWorkflowTemplateFromFileInput,
  CreateWorkflowTemplateFromFileInput,
  CreateWorkflowTemplateInput,
  UpdateWorkflowTemplateInput,
  WorkflowRuntimeInput,
  WorkflowStepRuntimeInput,
} from '../dto/workflow-templates.dto.js';

const tag = ['WorkflowTemplates'];

export class WorkflowTemplatesController {
  constructor(private readonly service = new WorkflowTemplatesApplicationService(), private readonly security?: SecurityServices) {}

  register(router: Router): void {
    router.get('/api/v1/workflow-templates', '列出工作流模板', tag, async (request) => this.listTemplates(request));
    router.post('/api/v1/workflow-templates', '创建工作流模板草稿', tag, async (request) => ({ statusCode: 201, body: await this.service.createTemplate(request.body as CreateWorkflowTemplateInput) }));
    router.post('/api/v1/workflow-templates/canvas/compile', '后端编译工作流画布', tag, async (request) => ({ statusCode: 200, body: this.service.compileCanvas(request.body) }));
    router.post('/api/v1/workflow-templates/canvas/validate', '后端校验工作流画布', tag, async (request) => ({ statusCode: 200, body: this.service.validateCanvas(request.body) }));
    router.post('/api/v1/workflow-templates/delete', '删除工作流模板', tag, async (request) => ({ statusCode: 200, body: await this.service.disableTemplate(String((request.body as { id?: string }).id ?? '')) }));
    router.get('/api/v1/workflow-file-templates', '扫描 data/workflows 工作流文件模板', tag, async () => ({ statusCode: 200, body: { items: await this.service.listFileTemplates() } }));
    router.post('/api/v1/workflow-file-templates/create', '基于工作流文件模板创建草稿', tag, async (request) => ({ statusCode: 201, body: await this.service.createTemplateFromFile(request.body as CreateWorkflowTemplateFromFileInput) }));
    router.post('/api/v1/workflow-file-templates/apply', '用工作流文件模板覆盖现有草稿', tag, async (request) => ({ statusCode: 200, body: await this.service.applyFileTemplateToTemplate(request.body as ApplyWorkflowTemplateFromFileInput) }));
    router.get('/api/v1/workflow-template-versions', '列出模板版本', tag, async (request) => this.listVersions(request));
    router.post('/api/v1/workflow-template-versions', '创建不可变模板版本', tag, async (request) => ({ statusCode: 201, body: await this.service.createDraftVersion(request.body as UpdateWorkflowTemplateInput) }));
    router.post('/api/v1/workflow-template-versions/draft', '更新当前草稿版本', tag, async (request) => ({ statusCode: 200, body: await this.service.updateCurrentDraftVersion(request.body as UpdateWorkflowTemplateInput) }));
    router.post('/api/v1/workflow-template-versions/publish', '发布模板版本', tag, async (request) => ({ statusCode: 200, body: await this.service.publishVersion((request.body as { versionId: string }).versionId) }));
    router.post('/api/v1/workflow-template-runs/preview', '渲染模板预览', tag, async (request) => ({ statusCode: 200, body: await this.service.preview(request.body as WorkflowRuntimeInput) }));
    router.post('/api/v1/workflow-template-runs/test', '执行模板测试运行计划', tag, async (request) => ({ statusCode: 200, body: await this.service.testRun(request.body as WorkflowRuntimeInput) }));
    router.post('/api/v1/workflow-template-runs/test-step', '执行单节点测试运行', tag, async (request) => ({ statusCode: 200, body: await this.service.testStep(request.body as WorkflowStepRuntimeInput) }));
  }

  getApplicationService(): WorkflowTemplatesApplicationService {
    return this.service;
  }

  private async listTemplates(request: HttpRequest) {
    const items = await this.service.listTemplates();
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

export function getWorkflowTemplateRouteContracts(): RouteContract[] {
  const objectSchema = { type: 'object', additionalProperties: true };
  return [
    { method: 'GET', path: '/api/v1/workflow-templates', operationId: 'listWorkflowTemplates', summary: '列出工作流模板', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-templates', operationId: 'createWorkflowTemplate', summary: '创建工作流模板草稿', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-templates/canvas/compile', operationId: 'compileWorkflowCanvas', summary: '后端编译工作流画布', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-templates/canvas/validate', operationId: 'validateWorkflowCanvas', summary: '后端校验工作流画布', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-templates/delete', operationId: 'deleteWorkflowTemplate', summary: '删除工作流模板', tags: tag, responseSchema: objectSchema },
    { method: 'GET', path: '/api/v1/workflow-file-templates', operationId: 'listWorkflowFileTemplates', summary: '扫描 data/workflows 工作流文件模板', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-file-templates/create', operationId: 'createWorkflowTemplateFromFile', summary: '基于工作流文件模板创建草稿', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-file-templates/apply', operationId: 'applyWorkflowTemplateFromFile', summary: '用工作流文件模板覆盖现有草稿', tags: tag, responseSchema: objectSchema },
    { method: 'GET', path: '/api/v1/workflow-template-versions', operationId: 'listWorkflowTemplateVersions', summary: '列出模板版本', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-versions', operationId: 'createWorkflowTemplateVersion', summary: '创建不可变模板版本', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-versions/draft', operationId: 'updateCurrentWorkflowTemplateDraftVersion', summary: '更新当前草稿版本', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-versions/publish', operationId: 'publishWorkflowTemplateVersion', summary: '发布模板版本', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-runs/preview', operationId: 'previewWorkflowTemplateRun', summary: '渲染模板预览', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-runs/test', operationId: 'testWorkflowTemplateRun', summary: '执行模板测试运行计划', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-runs/test-step', operationId: 'testWorkflowTemplateStep', summary: '执行单节点测试运行', tags: tag, responseSchema: objectSchema },
  ];
}

import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { WorkflowTemplatesApplicationService } from '../application/workflow-templates.application-service.js';
import type { CreateWorkflowTemplateInput, UpdateWorkflowTemplateInput, WorkflowRuntimeInput } from '../dto/workflow-templates.dto.js';

const tag = ['WorkflowTemplates'];

export class WorkflowTemplatesController {
  constructor(private readonly service = new WorkflowTemplatesApplicationService()) {}

  register(router: Router): void {
    router.get('/api/v1/workflow-templates', '列出工作流模板', tag, async () => ({ statusCode: 200, body: { items: this.service.listTemplates() } }));
    router.post('/api/v1/workflow-templates', '创建工作流模板草稿', tag, async (request) => ({ statusCode: 201, body: this.service.createTemplate(request.body as CreateWorkflowTemplateInput) }));
    router.get('/api/v1/workflow-template-versions', '列出模板版本', tag, async (request) => ({ statusCode: 200, body: { items: this.service.listVersions(String(request.query.templateId ?? '')) } }));
    router.post('/api/v1/workflow-template-versions', '创建不可变模板版本', tag, async (request) => ({ statusCode: 201, body: this.service.createDraftVersion(request.body as UpdateWorkflowTemplateInput) }));
    router.post('/api/v1/workflow-template-versions/publish', '发布模板版本', tag, async (request) => ({ statusCode: 200, body: this.service.publishVersion((request.body as { versionId: string }).versionId) }));
    router.post('/api/v1/workflow-template-runs/preview', '渲染模板预览', tag, async (request) => ({ statusCode: 200, body: this.service.preview(request.body as WorkflowRuntimeInput) }));
    router.post('/api/v1/workflow-template-runs/test', '执行模板测试运行计划', tag, async (request) => ({ statusCode: 200, body: this.service.testRun(request.body as WorkflowRuntimeInput) }));
  }

  getApplicationService(): WorkflowTemplatesApplicationService {
    return this.service;
  }
}

export function getWorkflowTemplateRouteContracts(): RouteContract[] {
  const objectSchema = { type: 'object', additionalProperties: true };
  return [
    { method: 'GET', path: '/api/v1/workflow-templates', operationId: 'listWorkflowTemplates', summary: '列出工作流模板', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-templates', operationId: 'createWorkflowTemplate', summary: '创建工作流模板草稿', tags: tag, responseSchema: objectSchema },
    { method: 'GET', path: '/api/v1/workflow-template-versions', operationId: 'listWorkflowTemplateVersions', summary: '列出模板版本', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-versions', operationId: 'createWorkflowTemplateVersion', summary: '创建不可变模板版本', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-versions/publish', operationId: 'publishWorkflowTemplateVersion', summary: '发布模板版本', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-runs/preview', operationId: 'previewWorkflowTemplateRun', summary: '渲染模板预览', tags: tag, responseSchema: objectSchema },
    { method: 'POST', path: '/api/v1/workflow-template-runs/test', operationId: 'testWorkflowTemplateRun', summary: '执行模板测试运行计划', tags: tag, responseSchema: objectSchema },
  ];
}

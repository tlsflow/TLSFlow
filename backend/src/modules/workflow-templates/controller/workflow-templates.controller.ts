import type { Router } from '../../../common/http/router.js';
import { WorkflowTemplatesApplicationService } from '../application/workflow-templates.application-service.js';

export class WorkflowTemplatesController {
  constructor(private readonly service = new WorkflowTemplatesApplicationService()) {}

  register(_router: Router): void {
    // 真实业务 API 由 025 接入。基础工程只保留模块边界，不提供假接口糊弄前端。
    void this.service;
  }
}

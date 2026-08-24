import type { Router } from '../../../common/http/router.js';
import { ExecutionsApplicationService } from '../application/executions.application-service.js';

export class ExecutionsController {
  constructor(private readonly service = new ExecutionsApplicationService()) {}

  register(_router: Router): void {
    // 真实业务 API 由 010 接入。基础工程只保留模块边界，不提供假接口糊弄前端。
    void this.service;
  }
}

import type { Router } from '../../../common/http/router.js';
import { AgentsApplicationService } from '../application/agents.application-service.js';

export class AgentsController {
  constructor(private readonly service = new AgentsApplicationService()) {}

  register(_router: Router): void {
    // 真实业务 API 由 011 接入。基础工程只保留模块边界，不提供假接口糊弄前端。
    void this.service;
  }
}

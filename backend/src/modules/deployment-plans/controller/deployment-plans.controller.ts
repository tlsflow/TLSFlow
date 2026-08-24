import type { Router } from '../../../common/http/router.js';
import { DeploymentPlansApplicationService } from '../application/deployment-plans.application-service.js';

export class DeploymentPlansController {
  constructor(private readonly service = new DeploymentPlansApplicationService()) {}

  register(_router: Router): void {
    // 真实业务 API 由 009 接入。基础工程只保留模块边界，不提供假接口糊弄前端。
    void this.service;
  }
}

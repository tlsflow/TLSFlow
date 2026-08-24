import type { Router } from '../../../common/http/router.js';
import { MonitorsApplicationService } from '../application/monitors.application-service.js';

export class MonitorsController {
  constructor(private readonly service = new MonitorsApplicationService()) {}

  register(_router: Router): void {
    // 真实业务 API 由 027 接入。基础工程只保留模块边界，不提供假接口糊弄前端。
    void this.service;
  }
}

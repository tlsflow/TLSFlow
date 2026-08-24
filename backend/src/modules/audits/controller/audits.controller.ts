import type { Router } from '../../../common/http/router.js';
import { AuditsApplicationService } from '../application/audits.application-service.js';

export class AuditsController {
  constructor(private readonly service = new AuditsApplicationService()) {}

  register(_router: Router): void {
    // 真实业务 API 由 005 接入。基础工程只保留模块边界，不提供假接口糊弄前端。
    void this.service;
  }
}

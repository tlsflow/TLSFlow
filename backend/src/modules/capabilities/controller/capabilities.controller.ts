import type { Router } from '../../../common/http/router.js';
import { CapabilitiesApplicationService } from '../application/capabilities.application-service.js';

export class CapabilitiesController {
  constructor(private readonly service = new CapabilitiesApplicationService()) {}

  register(_router: Router): void {
    // 真实业务 API 由 008 接入。基础工程只保留模块边界，不提供假接口糊弄前端。
    void this.service;
  }
}

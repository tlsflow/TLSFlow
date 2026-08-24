import type { Router } from '../../../common/http/router.js';
import { PluginsApplicationService } from '../application/plugins.application-service.js';

export class PluginsController {
  constructor(private readonly service = new PluginsApplicationService()) {}

  register(_router: Router): void {
    // 真实业务 API 由 024 接入。基础工程只保留模块边界，不提供假接口糊弄前端。
    void this.service;
  }
}

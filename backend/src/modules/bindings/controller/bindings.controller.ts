import type { Router } from '../../../common/http/router.js';
import { BindingsApplicationService } from '../application/bindings.application-service.js';

export class BindingsController {
  constructor(private readonly service = new BindingsApplicationService()) {}

  register(_router: Router): void {
    // 真实业务 API 由 007 接入。基础工程只保留模块边界，不提供假接口糊弄前端。
    void this.service;
  }
}

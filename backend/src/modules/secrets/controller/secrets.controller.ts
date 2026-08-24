import type { Router } from '../../../common/http/router.js';
import { SecretsApplicationService } from '../application/secrets.application-service.js';

export class SecretsController {
  constructor(private readonly service = new SecretsApplicationService()) {}

  register(_router: Router): void {
    // 真实业务 API 由 005 接入。基础工程只保留模块边界，不提供假接口糊弄前端。
    void this.service;
  }
}

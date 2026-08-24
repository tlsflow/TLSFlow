import type { Router } from '../../../common/http/router.js';
import { CertificatesApplicationService } from '../application/certificates.application-service.js';

export class CertificatesController {
  constructor(private readonly service = new CertificatesApplicationService()) {}

  register(_router: Router): void {
    // 真实业务 API 由 006 接入。基础工程只保留模块边界，不提供假接口糊弄前端。
    void this.service;
  }
}

import type { RequestContext } from '../../../shared/security-types.js';
import type { CertificateRequestEntity } from '../schema/internal-ca.schema.js';
import type { CreateCertificateRequestInput, InternalCaApplicationService } from './internal-ca.application-service.js';

/**
 * 受管密钥的唯一编排入口。
 *
 * 适配器只返回申请和公开指纹，私钥仍由 InternalCaApplicationService 写入
 * SecretService。这样生命周期服务不会因为接入新的密钥后端而复制密钥处理逻辑。
 */
export class ManagedKeyCustodyAdapter {
  constructor(private readonly internalCa: Pick<InternalCaApplicationService, 'createCertificateRequest'>) {}

  async createRequest(
    tenantId: string,
    input: Omit<CreateCertificateRequestInput, 'custodyMode'>,
    context?: RequestContext,
  ): Promise<CertificateRequestEntity> {
    return this.internalCa.createCertificateRequest(tenantId, {
      ...input,
      custodyMode: 'managed_secret',
    }, context);
  }
}

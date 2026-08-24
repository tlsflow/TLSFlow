import { AppError } from '../../../common/errors/app-error.js';
import type { CertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import type { CertificateVersionFormatEntity } from '../../certificates/schema/certificates.schema.js';

export class DeployableArtifactResolver {
  constructor(
    private readonly certificates: CertificatesRepository,
  ) {}

  async resolveWindowsIisPfx(certificateVersionId: string): Promise<CertificateVersionFormatEntity> {
    const version = await this.certificates.getVersion(certificateVersionId);
    if (!version) {
      throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId });
    }
    const formatsPage = await this.certificates.listFormats({
      page: 1,
      pageSize: 5000,
      filter: {
        format: 'pfx',
        containsPrivateKey: 'true',
      },
    });
    const formats = formatsPage.items.filter((format) => this.isWindowsIisPfxTemplate(format, certificateVersionId));
    const candidate = this.pickBestPfxFormat(formats);
    if (!candidate) {
      throw new AppError('VALIDATION_FAILED', '当前不存在可用于 Windows IIS 的 PFX 格式配置模板', {
        certificateVersionId,
        requiredFormat: 'pfx',
        requiredSystemPlatform: 'windows',
        requiredRuntimePlatform: 'iis',
      });
    }
    return candidate;
  }

  private pickBestPfxFormat(formats: CertificateVersionFormatEntity[]): CertificateVersionFormatEntity | undefined {
    return [...formats]
      .filter((format) => format.format === 'pfx' && format.containsPrivateKey === true)
      .sort((left, right) => {
        const leftSpecificity = left.certificateVersionId ? 1 : 0;
        const rightSpecificity = right.certificateVersionId ? 1 : 0;
        if (leftSpecificity !== rightSpecificity) return rightSpecificity - leftSpecificity;
        return right.createdAt.localeCompare(left.createdAt);
      })[0];
  }

  private isWindowsIisPfxTemplate(format: CertificateVersionFormatEntity, certificateVersionId: string): boolean {
    if (format.format !== 'pfx' || format.containsPrivateKey !== true) return false;
    if (format.certificateVersionId && format.certificateVersionId !== certificateVersionId) return false;
    const systemPlatform = String(format.parameters?.systemPlatform ?? '').trim().toLowerCase();
    const runtimePlatform = String(format.parameters?.runtimePlatform ?? '').trim().toLowerCase();
    return systemPlatform === 'windows' && runtimePlatform === 'iis';
  }
}

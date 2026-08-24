import { AppError } from '../../../common/errors/app-error.js';
import type { CertificateImportMaterial, DecodedCertificateMaterial, FormatCodec } from './format-codec.js';
import { requireBase64Buffer } from './format-codec.js';
import { derToCertificatePem, parseJksKeystore } from './jks-keystore.js';

export class JksCodec implements FormatCodec {
  readonly format = 'jks' as const;

  detect(input: CertificateImportMaterial): boolean {
    return Boolean(input.jksBase64);
  }

  decode(input: CertificateImportMaterial): DecodedCertificateMaterial {
    const jks = requireBase64Buffer(input.jksBase64, 'jksBase64');
    if (!input.jksPassword) {
      throw new AppError('VALIDATION_FAILED', 'JKS 导入必须提供 jksPassword', { field: 'jksPassword' }, false);
    }

    try {
      const entry = parseJksKeystore(jks, input.jksKeyPassword ?? input.jksPassword, input.jksAlias);
      return {
        sourceFormat: 'jks',
        certificatePem: entry.certificateDers.map(derToCertificatePem).join('\n'),
        privateKeyPem: entry.privateKeyPem,
        diagnostics: ['JKS 已解析为 PEM 证书材料；私钥条目按 JKS 标准保护算法解密'],
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('CERT_PARSE_FAILED', 'JKS 解析失败：文件损坏、密码错误或 alias 不存在', { format: 'jks' }, false);
    }
  }
}

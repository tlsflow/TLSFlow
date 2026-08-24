import { Buffer } from 'node:buffer';
import { AppError } from '../../../common/errors/app-error.js';
import type { CertificateFormat } from '../schema/certificates.schema.js';

export interface CertificateImportMaterial {
  certificatePem?: string;
  certificateDerBase64?: string;
  pfxBase64?: string;
  pfxPassword?: string;
  jksBase64?: string;
  jksPassword?: string;
  jksKeyPassword?: string;
  jksAlias?: string;
  p7bBase64?: string;
  declaredFormat?: CertificateFormat;
}

export interface DecodedCertificateMaterial {
  sourceFormat: CertificateFormat;
  certificatePem?: string;
  certificateDerBase64?: string;
  privateKeyPem?: string;
  passwordSecretRef?: string;
  diagnostics: string[];
}

export interface FormatCodec {
  readonly format: CertificateFormat;
  detect(input: CertificateImportMaterial): boolean;
  decode(input: CertificateImportMaterial): DecodedCertificateMaterial;
}

export class FormatCodecRegistry {
  constructor(private readonly codecs: FormatCodec[]) {}

  supportedFormats(): CertificateFormat[] {
    return this.codecs.map((codec) => codec.format);
  }

  detect(input: CertificateImportMaterial): CertificateFormat {
    if (input.declaredFormat) {
      const codec = this.codecs.find((item) => item.format === input.declaredFormat);
      if (!codec) throw unsupported(input.declaredFormat);
      if (!codec.detect(input)) {
        throw new AppError('CERT_FORMAT_UNSUPPORTED', `声明格式 ${input.declaredFormat} 与输入材料不匹配`, { format: input.declaredFormat });
      }
      return codec.format;
    }
    const matched = this.codecs.find((codec) => codec.detect(input));
    if (!matched) throw new AppError('CERT_FORMAT_UNSUPPORTED', '无法识别证书格式；当前入口支持 PEM、DER、JKS', { supportedFormats: this.supportedFormats() });
    return matched.format;
  }

  decode(input: CertificateImportMaterial): DecodedCertificateMaterial {
    const format = this.detect(input);
    const codec = this.codecs.find((item) => item.format === format);
    if (!codec) throw unsupported(format);
    return codec.decode(input);
  }
}

export function requireBase64Buffer(value: string | undefined, field: string): Buffer {
  if (!value) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length === 0) throw new AppError('VALIDATION_FAILED', `${field} 不是有效 base64 内容`, { field });
  return buffer;
}

export function unsupported(format: CertificateFormat, operation: 'import' | 'export' = 'import'): AppError {
  return new AppError(
    'CERT_FORMAT_UNSUPPORTED',
    `${format.toUpperCase()} ${operation === 'import' ? '导入' : '导出'}尚无生产 Plugin Runner 支持，宿主不会启动厂商工具或创建半成品证书材料`,
    { format, operation, implementation: 'controlled_error' },
  );
}

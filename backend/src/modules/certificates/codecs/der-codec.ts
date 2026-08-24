import type { CertificateImportMaterial, DecodedCertificateMaterial, FormatCodec } from './format-codec.js';
import { requireBase64Buffer } from './format-codec.js';

export class DerCodec implements FormatCodec {
  readonly format = 'der' as const;

  detect(input: CertificateImportMaterial): boolean {
    return Boolean(input.certificateDerBase64);
  }

  decode(input: CertificateImportMaterial): DecodedCertificateMaterial {
    requireBase64Buffer(input.certificateDerBase64, 'certificateDerBase64');
    return { sourceFormat: 'der', certificateDerBase64: input.certificateDerBase64, diagnostics: ['DER 单证书格式已识别'] };
  }
}

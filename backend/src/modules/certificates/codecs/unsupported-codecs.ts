import type { CertificateImportMaterial, DecodedCertificateMaterial, FormatCodec } from './format-codec.js';
import { requireBase64Buffer, unsupported } from './format-codec.js';

export class JksCodec implements FormatCodec {
  readonly format = 'jks' as const;
  detect(input: CertificateImportMaterial): boolean { return Boolean(input.jksBase64); }
  decode(input: CertificateImportMaterial): DecodedCertificateMaterial {
    requireBase64Buffer(input.jksBase64, 'jksBase64');
    throw unsupported('jks');
  }
}

export class P7bCodec implements FormatCodec {
  readonly format = 'p7b' as const;
  detect(input: CertificateImportMaterial): boolean { return Boolean(input.p7bBase64); }
  decode(input: CertificateImportMaterial): DecodedCertificateMaterial {
    requireBase64Buffer(input.p7bBase64, 'p7bBase64');
    throw unsupported('p7b');
  }
}

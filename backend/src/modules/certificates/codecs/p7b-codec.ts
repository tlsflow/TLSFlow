import type { CertificateImportMaterial, DecodedCertificateMaterial, FormatCodec } from './format-codec.js';
import { unsupported } from './format-codec.js';

export class P7bCodec implements FormatCodec {
  readonly format = 'p7b' as const;

  detect(input: CertificateImportMaterial): boolean {
    return Boolean(input.p7bBase64);
  }

  decode(input: CertificateImportMaterial): DecodedCertificateMaterial {
    void input;
    throw unsupported('p7b');
  }
}

import type { CertificateImportMaterial, DecodedCertificateMaterial, FormatCodec } from './format-codec.js';
import { unsupported } from './format-codec.js';

export class PfxCodec implements FormatCodec {
  readonly format = 'pfx' as const;

  detect(input: CertificateImportMaterial): boolean {
    return Boolean(input.pfxBase64);
  }

  decode(input: CertificateImportMaterial): DecodedCertificateMaterial {
    void input;
    throw unsupported('pfx');
  }
}

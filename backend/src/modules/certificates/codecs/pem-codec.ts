import type { CertificateImportMaterial, DecodedCertificateMaterial, FormatCodec } from './format-codec.js';

export class PemCodec implements FormatCodec {
  readonly format = 'pem' as const;

  detect(input: CertificateImportMaterial): boolean {
    return Boolean(input.certificatePem?.includes('-----BEGIN CERTIFICATE-----'));
  }

  decode(input: CertificateImportMaterial): DecodedCertificateMaterial {
    return { sourceFormat: 'pem', certificatePem: input.certificatePem, diagnostics: ['PEM 格式已识别'] };
  }
}

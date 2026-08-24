import forge from 'node-forge';
import { AppError } from '../../../common/errors/app-error.js';
import type { CertificateImportMaterial, DecodedCertificateMaterial, FormatCodec } from './format-codec.js';
import { requireBase64Buffer } from './format-codec.js';

export class PfxCodec implements FormatCodec {
  readonly format = 'pfx' as const;

  detect(input: CertificateImportMaterial): boolean {
    return Boolean(input.pfxBase64);
  }

  decode(input: CertificateImportMaterial): DecodedCertificateMaterial {
    const content = requireBase64Buffer(input.pfxBase64, 'pfxBase64');
    if (input.pfxPassword === undefined) {
      throw new AppError('VALIDATION_FAILED', 'PFX 导入必须提供 pfxPassword', { field: 'pfxPassword' }, false);
    }

    try {
      const pfx = forge.pkcs12.pkcs12FromAsn1(
        forge.asn1.fromDer(content.toString('binary'), true),
        true,
        input.pfxPassword,
      );
      const certificatePem = readCertificatePem(pfx);
      const privateKeyPem = readPrivateKeyPem(pfx);
      if (!certificatePem.length) {
        throw new AppError('CERT_PARSE_FAILED', 'PFX 中不包含 X.509 证书', { format: 'pfx' }, false);
      }
      if (!privateKeyPem) {
        throw new AppError('CERT_PARSE_FAILED', 'PFX 中不包含可解析的私钥', { format: 'pfx' }, false);
      }
      return {
        sourceFormat: 'pfx',
        certificatePem: certificatePem.join('\n'),
        privateKeyPem,
        diagnostics: ['PFX/PKCS#12 已由宿主进程解析；未调用 Plugin Runner 或外部工具'],
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('CERT_PARSE_FAILED', 'PFX 解析失败：密码错误、文件损坏或使用了不受支持的 PKCS#12 加密算法', { format: 'pfx' }, false);
    }
  }
}

function readCertificatePem(pfx: forge.pkcs12.Pkcs12Pfx): string[] {
  const bags = pfx.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  return bags
    .flatMap((bag) => bag.cert ? [forge.pki.certificateToPem(bag.cert)] : [])
    .filter((pem, index, entries) => entries.indexOf(pem) === index);
}

function readPrivateKeyPem(pfx: forge.pkcs12.Pkcs12Pfx): string | undefined {
  for (const bagType of [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]) {
    const bags = pfx.getBags({ bagType })[bagType] ?? [];
    const key = bags.find((bag) => bag.key)?.key;
    if (key) return forge.pki.privateKeyToPem(key);
  }
  return undefined;
}

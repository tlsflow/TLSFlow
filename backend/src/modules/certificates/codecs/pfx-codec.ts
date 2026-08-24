import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '../../../common/errors/app-error.js';
import type { CertificateImportMaterial, DecodedCertificateMaterial, FormatCodec } from './format-codec.js';
import { requireBase64Buffer } from './format-codec.js';

export class PfxCodec implements FormatCodec {
  readonly format = 'pfx' as const;

  detect(input: CertificateImportMaterial): boolean {
    return Boolean(input.pfxBase64);
  }

  decode(input: CertificateImportMaterial): DecodedCertificateMaterial {
    const pfx = requireBase64Buffer(input.pfxBase64, 'pfxBase64');
    const dir = mkdtempSync(join(tmpdir(), 'gcac-pfx-'));
    try {
      const inputPath = join(dir, 'input.p12');
      const certPath = join(dir, 'certs.pem');
      const keyPath = join(dir, 'key.pem');
      writeFileSync(inputPath, pfx);
      const passArg = `pass:${input.pfxPassword ?? ''}`;
      execFileSync('openssl', ['pkcs12', '-in', inputPath, '-nokeys', '-out', certPath, '-passin', passArg], { stdio: 'ignore' });
      execFileSync('openssl', ['pkcs12', '-in', inputPath, '-nocerts', '-nodes', '-out', keyPath, '-passin', passArg], { stdio: 'ignore' });
      return {
        sourceFormat: 'pfx',
        certificatePem: readFileSync(certPath, 'utf8'),
        privateKeyPem: readFileSync(keyPath, 'utf8'),
        diagnostics: ['PFX 已通过 openssl 解析为 PEM 证书和私钥；密码只作为本次解析输入使用'],
      };
    } catch {
      throw new AppError('CERT_PARSE_FAILED', 'PFX/PKCS12 解析失败：文件损坏、密码错误或 openssl 不可用', { format: 'pfx' }, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

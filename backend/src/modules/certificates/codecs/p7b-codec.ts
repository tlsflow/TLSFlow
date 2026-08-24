import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '../../../common/errors/app-error.js';
import type { CertificateImportMaterial, DecodedCertificateMaterial, FormatCodec } from './format-codec.js';
import { requireBase64Buffer } from './format-codec.js';

export class P7bCodec implements FormatCodec {
  readonly format = 'p7b' as const;

  detect(input: CertificateImportMaterial): boolean {
    return Boolean(input.p7bBase64);
  }

  decode(input: CertificateImportMaterial): DecodedCertificateMaterial {
    const p7b = requireBase64Buffer(input.p7bBase64, 'p7bBase64');
    const dir = mkdtempSync(join(tmpdir(), 'gcac-p7b-'));
    try {
      const inputPath = join(dir, 'input.p7b');
      const outputPath = join(dir, 'certificates.pem');
      writeFileSync(inputPath, p7b);
      if (!runPkcs7(inputPath, outputPath, 'DER') && !runPkcs7(inputPath, outputPath, 'PEM')) {
        throw new Error('openssl pkcs7 cannot parse input');
      }
      const certificatePem = readFileSync(outputPath, 'utf8');
      if (!certificatePem.includes('-----BEGIN CERTIFICATE-----')) {
        throw new Error('pkcs7 output does not contain certificate');
      }
      return {
        sourceFormat: 'p7b',
        certificatePem,
        diagnostics: ['P7B/PKCS#7 已由宿主 OpenSSL 解析为 PEM 证书链；该格式不包含私钥。'],
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('CERT_PARSE_FAILED', 'P7B/PKCS#7 解析失败：文件损坏、编码错误或 openssl 不可用', { format: 'p7b' }, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function runPkcs7(inputPath: string, outputPath: string, inform: 'DER' | 'PEM'): boolean {
  try {
    execFileSync('openssl', ['pkcs7', '-print_certs', '-inform', inform, '-in', inputPath, '-out', outputPath], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

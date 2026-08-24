import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '../../../common/errors/app-error.js';
import type { CertificateFormat, CertificateVersionEntity } from '../schema/certificates.schema.js';
import { generateJksKeystore } from '../codecs/jks-keystore.js';

export interface CertificateExportMaterial {
  version: CertificateVersionEntity;
  leafDer: Buffer;
  chainDer: Buffer[];
  privateKeyPem?: string;
  password?: string;
  parameters?: Record<string, unknown>;
}

export interface GeneratedCertificateFormatArtifact {
  format: CertificateFormat;
  content: Buffer;
  contentType: string;
  warnings: string[];
  debug?: {
    passwordUtf8Sha256?: string;
    passwordUtf8Length?: number;
  };
}

export class CertificateFormatExporter {
  generate(format: CertificateFormat, input: CertificateExportMaterial): GeneratedCertificateFormatArtifact {
    switch (format) {
      case 'pem':
        return this.generatePem(input);
      case 'der':
        return { format: 'der', content: Buffer.from(input.leafDer), contentType: 'application/pkix-cert', warnings: [] };
      case 'p7b':
        return this.generateP7b(input);
      case 'pfx':
        return this.generatePfx(input);
      case 'jks':
        return this.generateJks(input);
      default:
        throw new AppError('CERT_EXPORT_FORMAT_INVALID', '证书格式不合法', { format });
    }
  }

  private generatePem(input: CertificateExportMaterial): GeneratedCertificateFormatArtifact {
    const includeLeafCertificate = input.parameters?.includeLeafCertificate !== false;
    const includeCertificateChain = Boolean(input.parameters?.includeCertificateChain);
    const includePrivateKey = Boolean(input.parameters?.includePrivateKey);
    const blocks: string[] = [];

    if (includeLeafCertificate) blocks.push(toPem(input.leafDer));
    if (includeCertificateChain) blocks.push(...input.chainDer.map(toPem));
    if (includePrivateKey && input.privateKeyPem) blocks.push(input.privateKeyPem.trimEnd());

    return {
      format: 'pem',
      content: Buffer.from(`${blocks.join('\n')}\n`, 'utf8'),
      contentType: 'application/x-pem-file',
      warnings: [],
    };
  }

  private generateP7b(input: CertificateExportMaterial): GeneratedCertificateFormatArtifact {
    const dir = mkdtempSync(join(tmpdir(), 'gcac-export-p7b-'));
    try {
      const certsPath = join(dir, 'certs.pem');
      const outPath = join(dir, 'bundle.p7b');
      writeFileSync(certsPath, [toPem(input.leafDer), ...input.chainDer.map(toPem)].join('\n'));
      execFileSync('openssl', ['crl2pkcs7', '-nocrl', '-certfile', certsPath, '-out', outPath, '-outform', 'DER'], { stdio: 'pipe' });
      return {
        format: 'p7b',
        content: readFileSync(outPath),
        contentType: 'application/pkcs7-mime',
        warnings: ['P7B 不包含私钥，只包含证书链材料'],
      };
    } catch (error) {
      throw wrapOpenSslError('p7b', 'P7B 导出失败', error);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private generatePfx(input: CertificateExportMaterial): GeneratedCertificateFormatArtifact {
    if (!input.privateKeyPem) throw new AppError('VALIDATION_FAILED', 'PFX 导出必须包含私钥', { format: 'pfx' });
    if (input.password === undefined) throw new AppError('VALIDATION_FAILED', 'PFX 导出必须提供密码 SecretRef', { format: 'pfx' });
    const dir = mkdtempSync(join(tmpdir(), 'gcac-export-pfx-'));
    try {
      const leafPath = join(dir, 'leaf.pem');
      const chainPath = join(dir, 'chain.pem');
      const keyPath = join(dir, 'key.pem');
      const outPath = join(dir, 'bundle.p12');
      const passwordPath = join(dir, 'password.txt');
      writeFileSync(leafPath, toPem(input.leafDer));
      writeFileSync(chainPath, input.chainDer.map(toPem).join('\n'));
      writeFileSync(keyPath, input.privateKeyPem);
      const passwordUtf8 = Buffer.from(input.password, 'utf8');
      writeFileSync(passwordPath, passwordUtf8);
      const args = [
        'pkcs12',
        '-export',
        '-legacy',
        '-inkey',
        keyPath,
        '-in',
        leafPath,
        '-out',
        outPath,
        '-passout',
        `file:${passwordPath}`,
        '-keypbe',
        'PBE-SHA1-3DES',
        '-certpbe',
        'PBE-SHA1-3DES',
        '-macalg',
        'sha1',
      ];
      if (input.chainDer.length > 0) args.push('-certfile', chainPath);
      const alias = readAlias(input.parameters);
      if (alias) args.push('-name', alias);
      execFileSync('openssl', args, { stdio: 'pipe' });
      verifyGeneratedPfx(outPath, passwordPath);
      return {
        format: 'pfx',
        content: readFileSync(outPath),
        contentType: 'application/x-pkcs12',
        warnings: [],
        debug: {
          passwordUtf8Sha256: createHash('sha256').update(passwordUtf8).digest('hex'),
          passwordUtf8Length: passwordUtf8.length,
        },
      };
    } catch (error) {
      throw wrapOpenSslError('pfx', 'PFX/PKCS12 导出失败', error);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private generateJks(input: CertificateExportMaterial): GeneratedCertificateFormatArtifact {
    if (!input.privateKeyPem) throw new AppError('VALIDATION_FAILED', 'JKS 导出必须包含私钥', { format: 'jks' });
    if (input.password === undefined) throw new AppError('VALIDATION_FAILED', 'JKS 导出必须提供密码 SecretRef', { format: 'jks' });
    const alias = readAlias(input.parameters) ?? input.version.commonName ?? input.version.id;
    return {
      format: 'jks',
      content: generateJksKeystore({
        alias,
        password: input.password,
        privateKeyPem: input.privateKeyPem,
        certificateDers: [input.leafDer, ...input.chainDer],
      }),
      contentType: 'application/x-java-keystore',
      warnings: ['JKS 产物按 Java KeyStore v2 格式生成'],
    };
  }
}

function toPem(der: Buffer): string {
  const body = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
}

function readAlias(parameters: Record<string, unknown> | undefined): string | undefined {
  const alias = parameters?.alias;
  return typeof alias === 'string' && alias.trim() ? alias.trim() : undefined;
}

function verifyGeneratedPfx(pfxPath: string, passwordPath: string): void {
  try {
    execFileSync('openssl', ['pkcs12', '-in', pfxPath, '-nokeys', '-passin', `file:${passwordPath}`], { stdio: 'pipe' });
  } catch (error) {
    throw wrapOpenSslError('pfx', 'PFX/PKCS12 导出后自校验失败', error);
  }
}

function wrapOpenSslError(format: 'p7b' | 'pfx', message: string, error: unknown): AppError {
  const details: Record<string, unknown> = { format, exporter: 'openssl' };
  if (error && typeof error === 'object') {
    const candidate = error as {
      code?: unknown;
      errno?: unknown;
      status?: unknown;
      signal?: unknown;
      message?: unknown;
      stderr?: unknown;
    };
    if (candidate.code !== undefined) details.opensslCode = candidate.code;
    if (candidate.errno !== undefined) details.opensslErrno = candidate.errno;
    if (candidate.status !== undefined) details.opensslStatus = candidate.status;
    if (candidate.signal !== undefined) details.opensslSignal = candidate.signal;
    if (candidate.message !== undefined) details.opensslMessage = String(candidate.message);
    if (candidate.stderr !== undefined) details.opensslStderr = toReadableText(candidate.stderr);
  }
  return new AppError('CERT_EXPORT_FAILED', message, details, false);
}

function toReadableText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8').trim();
    return text || value.toString('base64');
  }
  const text = String(value).trim();
  return text || undefined;
}

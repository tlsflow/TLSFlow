import { createHash, createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '../../../common/errors/app-error.js';
import type { CertificateFormat, CertificateVersionEntity } from '../schema/certificates.schema.js';
import { generateJksKeystore, parseJksKeystore } from '../codecs/jks-keystore.js';

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
  files: GeneratedCertificateArtifactFile[];
  debug?: {
    passwordUtf8Sha256?: string;
    passwordUtf8Length?: number;
  };
}

export interface GeneratedCertificateArtifactFile {
  key: string;
  role: 'public_certificate' | 'private_key' | 'certificate_chain' | 'bundle' | string;
  format: string;
  content?: string;
  contentBase64?: string;
  contentEncoding: 'utf8' | 'base64' | string;
}

export class CertificateFormatExporter {
  generate(format: CertificateFormat, input: CertificateExportMaterial): GeneratedCertificateFormatArtifact {
    switch (format) {
      case 'pem':
        return this.generatePem(input);
      case 'der':
        return {
          format: 'der',
          content: Buffer.from(input.leafDer),
          contentType: 'application/pkix-cert',
          warnings: [],
          files: [{
            key: 'public',
            role: 'public_certificate',
            format: 'der',
            contentBase64: Buffer.from(input.leafDer).toString('base64'),
            contentEncoding: 'base64',
          }],
        };
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
    const generateChainFile = Boolean(input.parameters?.generateChainFile);
    const generatePrivateKeyFile = Boolean(input.parameters?.generatePrivateKeyFile);
    const leafPem = toPem(input.leafDer);
    const chainPem = input.chainDer.map(toPem).join('\n');
    const privateKeyPem = input.privateKeyPem?.trimEnd();
    const blocks: string[] = [];

    if (includeLeafCertificate) blocks.push(leafPem);
    if (includeCertificateChain && chainPem) blocks.push(chainPem);
    if (includePrivateKey && privateKeyPem) blocks.push(privateKeyPem);
    const bundle = `${blocks.join('\n')}\n`;
    const files: GeneratedCertificateArtifactFile[] = [];
    if (includeLeafCertificate) {
      files.push({
        key: 'public',
        role: 'public_certificate',
        format: 'pem',
        content: `${leafPem}\n`,
        contentEncoding: 'utf8',
      });
    }
    if ((includeCertificateChain || generateChainFile) && chainPem) {
      if (includeLeafCertificate) {
        files.push({
          key: 'fullchain',
          role: 'public_certificate',
          format: 'pem',
          content: `${leafPem}\n${chainPem}\n`,
          contentEncoding: 'utf8',
        });
      }
      files.push({
        key: 'chain',
        role: 'certificate_chain',
        format: 'pem',
        content: `${chainPem}\n`,
        contentEncoding: 'utf8',
      });
    }
    if ((includePrivateKey || generatePrivateKeyFile) && privateKeyPem) {
      files.push({
        key: 'private',
        role: 'private_key',
        format: 'pem',
        content: `${privateKeyPem}\n`,
        contentEncoding: 'utf8',
      });
    }
    if (blocks.length > 0) {
      files.push({
        key: 'bundle',
        role: 'bundle',
        format: 'pem',
        content: bundle,
        contentEncoding: 'utf8',
      });
    }

    return {
      format: 'pem',
      content: Buffer.from(bundle, 'utf8'),
      contentType: 'application/x-pem-file',
      warnings: [],
      files,
    };
  }

  private generateP7b(input: CertificateExportMaterial): GeneratedCertificateFormatArtifact {
    const dir = mkdtempSync(join(tmpdir(), 'gcac-export-p7b-'));
    try {
      const certificatesPath = join(dir, 'certificates.pem');
      const outputPath = join(dir, 'bundle.p7b');
      writeFileSync(certificatesPath, [toPem(input.leafDer), ...input.chainDer.map(toPem)].join('\n'));
      execFileSync('openssl', ['crl2pkcs7', '-nocrl', '-certfile', certificatesPath, '-out', outputPath, '-outform', 'DER'], { stdio: 'pipe' });
      verifyGeneratedP7b(outputPath, input);
      const content = readFileSync(outputPath);
      return {
        format: 'p7b',
        content,
        contentType: 'application/pkcs7-mime',
        warnings: ['P7B 只包含叶子证书和完整证书链，不包含私钥。'],
        files: [{
          key: 'bundle',
          role: 'bundle',
          format: 'p7b',
          contentBase64: content.toString('base64'),
          contentEncoding: 'base64',
        }],
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
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
      try {
        execFileSync('openssl', ['pkcs12', '-export', '-legacy', ...args.slice(2)], { stdio: 'pipe' });
      } catch (error) {
        // LibreSSL 没有 -legacy；回退到同一组显式 PBE 参数，保持跨平台宿主能力。
        if (!isLegacyOptionUnsupported(error)) throw error;
        execFileSync('openssl', args, { stdio: 'pipe' });
      }
      verifyGeneratedPfx(outPath, passwordPath, input);
      const content = readFileSync(outPath);
      return {
        format: 'pfx',
        content,
        contentType: 'application/x-pkcs12',
        warnings: [],
        files: [{
          key: 'bundle',
          role: 'bundle',
          format: 'pfx',
          contentBase64: content.toString('base64'),
          contentEncoding: 'base64',
        }],
        debug: {
          passwordUtf8Sha256: createHash('sha256').update(passwordUtf8).digest('hex'),
          passwordUtf8Length: passwordUtf8.length,
        },
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw wrapOpenSslError('pfx', 'PFX/PKCS12 导出失败', error);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private generateJks(input: CertificateExportMaterial): GeneratedCertificateFormatArtifact {
    if (!input.privateKeyPem) throw new AppError('VALIDATION_FAILED', 'JKS 导出必须包含私钥', { format: 'jks' });
    if (input.password === undefined) throw new AppError('VALIDATION_FAILED', 'JKS 导出必须提供密码 SecretRef', { format: 'jks' });
    const alias = readAlias(input.parameters) ?? input.version.commonName ?? input.version.id;
    const content = generateJksKeystore({
      alias,
      password: input.password,
      privateKeyPem: input.privateKeyPem,
      certificateDers: [input.leafDer, ...input.chainDer],
    });
    verifyGeneratedJks(content, input.password, alias, input);
    return {
      format: 'jks',
      content,
      contentType: 'application/x-java-keystore',
      warnings: ['JKS 产物按 Java KeyStore v2 格式生成'],
      files: [{
        key: 'bundle',
        role: 'bundle',
        format: 'jks',
        contentBase64: content.toString('base64'),
        contentEncoding: 'base64',
      }],
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

function verifyGeneratedPfx(pfxPath: string, passwordPath: string, input: CertificateExportMaterial): void {
  const unpacked = execFileSync('openssl', ['pkcs12', '-in', pfxPath, '-nodes', '-passin', `file:${passwordPath}`], { stdio: 'pipe' });
  verifyGeneratedContainer('pfx', input, readCertificateDers(unpacked), readPrivateKeyPem(unpacked));
}

function verifyGeneratedP7b(p7bPath: string, input: CertificateExportMaterial): void {
  const unpacked = execFileSync('openssl', ['pkcs7', '-print_certs', '-inform', 'DER', '-in', p7bPath], { stdio: 'pipe' });
  verifyCertificateSet('p7b', input, readCertificateDers(unpacked));
}

function verifyGeneratedJks(content: Buffer, password: string, alias: string, input: CertificateExportMaterial): void {
  try {
    const entry = parseJksKeystore(content, password, alias);
    verifyGeneratedContainer('jks', input, entry.certificateDers, entry.privateKeyPem);
  } catch (error) {
    if (error instanceof AppError && error.errorCode === 'CERT_EXPORT_FAILED') throw error;
    throw new AppError('CERT_EXPORT_FAILED', 'JKS 导出后自校验失败', { format: 'jks' }, false);
  }
}

function verifyGeneratedContainer(
  format: 'pfx' | 'jks',
  input: CertificateExportMaterial,
  certificateDers: Buffer[],
  privateKeyPem: string | undefined,
): void {
  verifyCertificateSet(format, input, certificateDers);
  if (!privateKeyPem || !privateKeyMatchesLeaf(privateKeyPem, input.leafDer)) {
    throw new AppError('CERT_EXPORT_FAILED', `${format.toUpperCase()} 导出后自校验失败：私钥缺失或与叶子证书不匹配`, { format }, false);
  }
}

function verifyCertificateSet(format: 'p7b' | 'pfx' | 'jks', input: CertificateExportMaterial, certificateDers: Buffer[]): void {
  const expectedFingerprints = [input.leafDer, ...input.chainDer].map(certificateFingerprint).sort();
  const actualFingerprints = certificateDers.map(certificateFingerprint).sort();
  if (actualFingerprints.length !== expectedFingerprints.length || actualFingerprints.some((value, index) => value !== expectedFingerprints[index])) {
    throw new AppError('CERT_EXPORT_FAILED', `${format.toUpperCase()} 导出后自校验失败：证书链不完整`, {
      format,
      expectedCertificateCount: expectedFingerprints.length,
      actualCertificateCount: actualFingerprints.length,
    }, false);
  }
}

function readCertificateDers(content: Buffer): Buffer[] {
  const blocks = content.toString('utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  return blocks.map((block) => new X509Certificate(block).raw);
}

function readPrivateKeyPem(content: Buffer): string | undefined {
  return content.toString('utf8').match(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/)?.[0];
}

function certificateFingerprint(der: Buffer): string {
  return createHash('sha256').update(der).digest('hex');
}

function privateKeyMatchesLeaf(privateKeyPem: string, leafDer: Buffer): boolean {
  try {
    const publicFromPrivate = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'der' });
    const publicFromCertificate = new X509Certificate(leafDer).publicKey.export({ type: 'spki', format: 'der' });
    return Buffer.isBuffer(publicFromPrivate) && Buffer.isBuffer(publicFromCertificate) && publicFromPrivate.equals(publicFromCertificate);
  } catch {
    return false;
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

function isLegacyOptionUnsupported(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { message?: unknown; stderr?: unknown };
  const detail = `${String(candidate.message ?? '')}\n${toReadableText(candidate.stderr) ?? ''}`;
  return /unknown option[^\n]*legacy|unrecognized option[^\n]*legacy|invalid option[^\n]*legacy/i.test(detail);
}

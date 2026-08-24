import { X509Certificate } from 'node:crypto';
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
  content: Buffer;
  contentType: string;
  warnings: string[];
}

export class CertificateFormatExporter {
  generate(format: CertificateFormat, input: CertificateExportMaterial): GeneratedCertificateFormatArtifact {
    switch (format) {
      case 'pem':
        return this.generatePem(input);
      case 'der':
        return { content: Buffer.from(input.leafDer), contentType: 'application/pkix-cert', warnings: [] };
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

    if (includeLeafCertificate) {
      blocks.push(toPem(input.leafDer));
    }
    if (includeCertificateChain) {
      blocks.push(...input.chainDer.map(toPem));
    }
    if (includePrivateKey && input.privateKeyPem) {
      blocks.push(input.privateKeyPem.trimEnd());
    }
    return { content: Buffer.from(`${blocks.join('\n')}\n`, 'utf8'), contentType: 'application/x-pem-file', warnings: [] };
  }

  private generateP7b(input: CertificateExportMaterial): GeneratedCertificateFormatArtifact {
    const dir = mkdtempSync(join(tmpdir(), 'gcac-export-p7b-'));
    try {
      const certsPath = join(dir, 'certs.pem');
      const outPath = join(dir, 'bundle.p7b');
      writeFileSync(certsPath, [toPem(input.leafDer), ...input.chainDer.map(toPem)].join('\n'));
      execFileSync('openssl', ['crl2pkcs7', '-nocrl', '-certfile', certsPath, '-out', outPath, '-outform', 'DER'], { stdio: 'ignore' });
      return { content: readFileSync(outPath), contentType: 'application/pkcs7-mime', warnings: ['P7B 不包含私钥，仅包含证书链材料'] };
    } catch {
      throw new AppError('CERT_EXPORT_FAILED', 'P7B 导出失败：openssl 不可用或证书材料无效', { format: 'p7b' }, false);
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
      writeFileSync(leafPath, toPem(input.leafDer));
      writeFileSync(chainPath, input.chainDer.map(toPem).join('\n'));
      writeFileSync(keyPath, input.privateKeyPem);
      const args = ['pkcs12', '-export', '-inkey', keyPath, '-in', leafPath, '-out', outPath, '-passout', `pass:${input.password}`];
      if (input.chainDer.length > 0) args.push('-certfile', chainPath);
      const alias = readAlias(input.parameters);
      if (alias) args.push('-name', alias);
      execFileSync('openssl', args, { stdio: 'ignore' });
      return { content: readFileSync(outPath), contentType: 'application/x-pkcs12', warnings: [] };
    } catch {
      throw new AppError('CERT_EXPORT_FAILED', 'PFX/PKCS12 导出失败：openssl 不可用或证书材料无效', { format: 'pfx' }, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private generateJks(input: CertificateExportMaterial): GeneratedCertificateFormatArtifact {
    if (!input.privateKeyPem) throw new AppError('VALIDATION_FAILED', 'JKS 导出必须包含私钥', { format: 'jks' });
    if (input.password === undefined) throw new AppError('VALIDATION_FAILED', 'JKS 导出必须提供密码 SecretRef', { format: 'jks' });
    const alias = readAlias(input.parameters) ?? input.version.commonName ?? input.version.id;
    return {
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

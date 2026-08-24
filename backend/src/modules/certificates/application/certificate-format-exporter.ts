import { AppError } from '../../../common/errors/app-error.js';
import type { CertificateFormat, CertificateVersionEntity } from '../schema/certificates.schema.js';
import { generateJksKeystore } from '../codecs/jks-keystore.js';
import { unsupported } from '../codecs/format-codec.js';

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
        throw unsupportedFormat('p7b');
      case 'pfx':
        throw unsupportedFormat('pfx');
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

function unsupportedFormat(format: 'p7b' | 'pfx'): never {
  throw unsupported(format, 'export');
}

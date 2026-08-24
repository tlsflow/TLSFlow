import { X509Certificate, createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import {
  FormatCodecRegistry,
  DerCodec,
  JksCodec,
  P7bCodec,
  PemCodec,
  PfxCodec,
  type CertificateImportMaterial,
  type DecodedCertificateMaterial,
} from '../codecs/index.js';
import type { CertificateChainStatus, CertificateDistinguishedName } from '../schema/certificates.schema.js';

export interface ParsedCertificate {
  pem: string;
  der: Buffer;
  commonName?: string;
  sans: string[];
  issuer: CertificateDistinguishedName;
  subject: CertificateDistinguishedName;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  fingerprintSha256: string;
  publicKeyFingerprintSha256: string;
  publicKeyAlgorithm: string;
  signatureAlgorithm: string;
  x509: X509Certificate;
}

export interface ParsedCertificateBundle {
  leaf: ParsedCertificate;
  certificates: ParsedCertificate[];
  chainStatus: CertificateChainStatus;
  chainOrder: string[];
  chainDiagnostics: string[];
}

const CERT_BLOCK_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

export interface ParsedMaterialBundle extends ParsedCertificateBundle {
  sourceFormat: import('../schema/certificates.schema.js').CertificateFormat;
  decodedPrivateKeyPem?: string;
  formatDiagnostics: string[];
}

export interface CertificateImportValidationResult extends ParsedMaterialBundle {
  importable: boolean;
  blockers: string[];
  warnings: string[];
  privateKeyMatched: boolean;
  privateKeySource: 'input' | 'container' | 'none';
}

export class CertificatesDomainService {
  constructor(
    private readonly codecs = new FormatCodecRegistry([new PemCodec(), new DerCodec(), new PfxCodec(), new JksCodec(), new P7bCodec()]),
  ) {}

  getFormatCapabilities() {
    return {
      formats: [
        {
          format: 'pem',
          importSupported: true,
          exportSupported: true,
          containsPrivateKey: 'required',
          implementation: 'node_crypto',
          limitations: ['导入时必须提供服务器证书、中间证书链和私钥；根证书不是强制项。'],
        },
        {
          format: 'pfx',
          importSupported: true,
          exportSupported: true,
          containsPrivateKey: 'required',
          implementation: 'openssl',
          limitations: ['宿主负责生成和解析 PFX/PKCS#12；必须提供密码、服务器证书、中间证书链和私钥。'],
        },
        {
          format: 'der',
          importSupported: true,
          exportSupported: true,
          containsPrivateKey: 'never',
          implementation: 'node_crypto',
          limitations: ['DER 只包含单张证书，导入后不可直接部署。'],
        },
        {
          format: 'jks',
          importSupported: true,
          exportSupported: true,
          containsPrivateKey: 'required',
          implementation: 'node_crypto',
          limitations: ['宿主负责生成和解析 JKS；必须提供密码、服务器证书、中间证书链和私钥，可选指定 alias。'],
        },
        {
          format: 'p7b',
          importSupported: true,
          exportSupported: true,
          containsPrivateKey: 'never',
          implementation: 'openssl',
          limitations: ['宿主负责解析和生成 PKCS#7；P7B 只包含服务器证书和完整证书链，导入创建版本时必须另行提供匹配私钥。'],
        },
      ],
    } as const;
  }

  parseCertificateMaterial(input: CertificateImportMaterial): ParsedMaterialBundle {
    const decoded = this.codecs.decode(input);
    const parsedBundle = this.parseDecodedCertificateMaterial(decoded);
    return {
      ...parsedBundle,
      sourceFormat: decoded.sourceFormat,
      decodedPrivateKeyPem: decoded.privateKeyPem,
      formatDiagnostics: decoded.diagnostics,
    };
  }

  validateCertificateMaterial(input: CertificateImportMaterial, privateKeyPem?: string): CertificateImportValidationResult {
    const bundle = this.parseCertificateMaterial(input);
    const extractedPrivateKeyPem = this.extractPrivateKeyPem(privateKeyPem ?? bundle.decodedPrivateKeyPem);
    const blockers: string[] = [];
    const warnings: string[] = [...bundle.formatDiagnostics];
    let privateKeyMatched = false;
    let privateKeySource: 'input' | 'container' | 'none' = 'none';

    const chainAssessment = assessChainDiagnostics(bundle);
    blockers.push(...chainAssessment.blockers);
    warnings.push(...chainAssessment.warnings);

    if (bundle.certificates.length < 2) {
      blockers.push('证书链不完整：至少必须包含服务器证书和中间证书。');
    }

    if (!extractedPrivateKeyPem) {
      blockers.push('缺少私钥，不能导入。');
    } else {
      try {
        this.assertPrivateKeyMatchesCertificate(extractedPrivateKeyPem, bundle.leaf);
        privateKeyMatched = true;
        privateKeySource = privateKeyPem ? 'input' : 'container';
      } catch (error) {
        if (error instanceof AppError) {
          blockers.push(error.message);
        } else {
          blockers.push('私钥校验失败');
        }
      }
    }

    return {
      ...bundle,
      importable: blockers.length === 0,
      blockers,
      warnings,
      privateKeyMatched,
      privateKeySource,
    };
  }

  private parseDecodedCertificateMaterial(input: DecodedCertificateMaterial): ParsedCertificateBundle {
    const pemBlocks = input.certificatePem?.match(CERT_BLOCK_PATTERN) ?? [];
    if (pemBlocks.length > 0) return this.parsePemCertificates(pemBlocks);
    throw new AppError('CERT_FORMAT_UNSUPPORTED', '必须提供 PEM、DER 或 JKS 证书材料');
  }

  extractPrivateKeyPem(input?: string): string | undefined {
    if (!input) return undefined;
    const matched = input.match(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/);
    if (!matched) {
      throw new AppError('CERT_PARSE_FAILED', '私钥 PEM 格式不合法', { field: 'privateKeyPem' }, false);
    }
    return matched[0];
  }

  assertPrivateKeyMatchesCertificate(privateKeyPem: string, certificate: ParsedCertificate): void {
    try {
      const publicFromPrivate = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'der' });
      const publicFromCert = certificate.x509.publicKey.export({ type: 'spki', format: 'der' });
      if (!Buffer.isBuffer(publicFromPrivate) || !Buffer.isBuffer(publicFromCert) || !publicFromPrivate.equals(publicFromCert)) {
        throw new AppError('CERT_PRIVATE_KEY_MISMATCH', '私钥与证书不匹配');
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('CERT_PARSE_FAILED', '私钥无法解析或算法不支持', { field: 'privateKeyPem' }, false);
    }
  }

  private parsePemCertificates(pemBlocks: string[]): ParsedCertificateBundle {
    try {
      const certificates = pemBlocks.map((pem) => this.toParsed(new X509Certificate(pem)));
      const leaf = findLeafCertificate(certificates);
      const validation = validateCertificateChain(leaf, certificates);
      return {
        leaf,
        certificates,
        ...validation,
      };
    } catch (error) {
      throw new AppError('CERT_PARSE_FAILED', 'PEM 证书解析失败', { reason: error instanceof Error ? error.message : String(error) });
    }
  }

  private toParsed(x509: X509Certificate): ParsedCertificate {
    const subject = parseDistinguishedName(x509.subject);
    const issuer = parseDistinguishedName(x509.issuer);
    return {
      pem: x509.toString(),
      der: x509.raw,
      commonName: subject.commonName,
      sans: parseSubjectAltNames(x509.subjectAltName),
      issuer,
      subject,
      serialNumber: x509.serialNumber,
      notBefore: new Date(x509.validFrom).toISOString(),
      notAfter: new Date(x509.validTo).toISOString(),
      fingerprintSha256: x509.fingerprint256.replaceAll(':', '').toLowerCase(),
      publicKeyFingerprintSha256: createHash('sha256')
        .update(x509.publicKey.export({ type: 'spki', format: 'der' }))
        .digest('hex'),
      publicKeyAlgorithm: x509.publicKey.asymmetricKeyType ?? 'unknown',
      signatureAlgorithm: 'unknown',
      x509,
    };
  }
}

function findLeafCertificate(certificates: ParsedCertificate[]): ParsedCertificate {
  const issuerSubjects = new Set(certificates.map((certificate) => certificate.issuer.raw));
  return certificates.find((certificate) => !certificate.x509.ca && !issuerSubjects.has(certificate.subject.raw))
    ?? certificates.find((certificate) => !certificate.x509.ca)
    ?? certificates.find((certificate) => !issuerSubjects.has(certificate.subject.raw))
    ?? certificates[0]!;
}

function validateCertificateChain(
  leaf: ParsedCertificate,
  certificates: ParsedCertificate[],
): Pick<ParsedCertificateBundle, 'chainStatus' | 'chainOrder' | 'chainDiagnostics'> {
  const bySubject = new Map(certificates.map((certificate) => [certificate.subject.raw, certificate]));
  const diagnostics: string[] = [];
  const order: string[] = [];
  let current = leaf;
  const visited = new Set<string>();

  while (true) {
    order.push(current.fingerprintSha256);
    if (visited.has(current.fingerprintSha256)) {
      diagnostics.push('证书链存在循环签发关系');
      return { chainStatus: 'invalid', chainOrder: order, chainDiagnostics: diagnostics };
    }
    visited.add(current.fingerprintSha256);

    if (current.subject.raw === current.issuer.raw) {
      const validSelfSignature = current.x509.verify(current.x509.publicKey);
      diagnostics.push(validSelfSignature ? '证书链已到达自签根证书' : '自签根证书签名校验失败');
      return { chainStatus: validSelfSignature ? 'valid' : 'invalid', chainOrder: order, chainDiagnostics: diagnostics };
    }

    const issuer = bySubject.get(current.issuer.raw);
    if (!issuer) {
      diagnostics.push(`缺少签发者证书：${current.issuer.raw}`);
      return { chainStatus: 'incomplete', chainOrder: order, chainDiagnostics: diagnostics };
    }

    if (!current.x509.verify(issuer.x509.publicKey)) {
      diagnostics.push(`证书签名校验失败：${current.subject.raw}`);
      return { chainStatus: 'invalid', chainOrder: order, chainDiagnostics: diagnostics };
    }

    current = issuer;
  }
}

function assessChainDiagnostics(bundle: ParsedCertificateBundle): { blockers: string[]; warnings: string[] } {
  if (bundle.chainStatus === 'valid') {
    return { blockers: [], warnings: [] };
  }

  const missingIssuer = bundle.chainDiagnostics.find((item) => item.startsWith('缺少签发者证书：'));
  if (bundle.chainStatus === 'incomplete' && missingIssuer) {
    const lastCertificate = bundle.certificates.find((item) => item.fingerprintSha256 === bundle.chainOrder.at(-1));
    const missingRootOnly = Boolean(lastCertificate && lastCertificate.x509.ca && lastCertificate.subject.raw !== lastCertificate.issuer.raw);
    if (missingRootOnly) {
      return {
        blockers: [],
        warnings: [`${missingIssuer}。根证书不做强制导入要求，允许继续导入，但建议补齐以便完整展示证书链。`],
      };
    }
  }

  return { blockers: [...bundle.chainDiagnostics], warnings: [] };
}

function parseSubjectAltNames(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .map((item) => {
      const matched = item.match(/^(DNS|IP Address|URI|email):(.+)$/i);
      return matched ? matched[2].trim() : item;
    })
    .filter(Boolean);
}

function parseDistinguishedName(value: string): CertificateDistinguishedName {
  const output: CertificateDistinguishedName = { raw: value };
  for (const line of value.split(/\n|,\s*/).map((item) => item.trim()).filter(Boolean)) {
    const [key, ...rest] = line.split('=');
    const fieldValue = rest.join('=');
    if (!key || !fieldValue) continue;
    switch (key) {
      case 'CN':
        output.commonName = fieldValue;
        break;
      case 'O':
        output.organization = fieldValue;
        break;
      case 'OU':
        output.organizationalUnit = fieldValue;
        break;
      case 'C':
        output.country = fieldValue;
        break;
      case 'ST':
        output.state = fieldValue;
        break;
      case 'L':
        output.locality = fieldValue;
        break;
      default:
        break;
    }
  }
  return output;
}

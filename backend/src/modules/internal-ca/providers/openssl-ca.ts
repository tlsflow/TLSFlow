import { X509Certificate, createHash, createPublicKey, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppError } from '../../../common/errors/app-error.js';

const execFileAsync = promisify(execFile);

export interface GeneratedCaMaterial {
  privateKeyPem: string;
  certificatePem: string;
  certificateChainPem: string;
  publicKeyFingerprintSha256: string;
  fingerprintSha256: string;
  notBefore: string;
  notAfter: string;
}

export interface ParsedCsr {
  csrPem: string;
  csrSha256: string;
  publicKeyFingerprintSha256: string;
  subject: string;
}

interface IssuedCertificateMaterial {
  certificatePem: string;
  certificateChainPem: string;
  serialNumber: string;
  fingerprintSha256: string;
  publicKeyFingerprintSha256: string;
  notBefore: string;
  notAfter: string;
}

export class OpenSslCa {
  async createRoot(commonName: string, validityDays: number, pathLengthConstraint = 1): Promise<GeneratedCaMaterial> {
    return withTemporaryDirectory(async (directory) => {
      const keyPath = join(directory, 'root.key.pem');
      const certPath = join(directory, 'root.cert.pem');
      const configPath = join(directory, 'root.cnf');
      await writeFile(configPath, caConfig(commonName, pathLengthConstraint), 'utf8');
      await runOpenSsl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072', '-out', keyPath]);
      await runOpenSsl([
        'req', '-new', '-x509', '-key', keyPath, '-out', certPath, '-days', String(validityDays), '-sha256',
        '-config', configPath, '-extensions', 'v3_ca',
      ]);
      const privateKeyPem = await readFile(keyPath, 'utf8');
      const certificatePem = await readFile(certPath, 'utf8');
      return materialFromCertificate(privateKeyPem, certificatePem, certificatePem);
    });
  }

  async createIntermediate(input: {
    commonName: string;
    validityDays: number;
    pathLengthConstraint: number;
    parentPrivateKeyPem: string;
    parentCertificatePem: string;
    parentChainPem: string;
  }): Promise<GeneratedCaMaterial> {
    return withTemporaryDirectory(async (directory) => {
      const keyPath = join(directory, 'intermediate.key.pem');
      const csrPath = join(directory, 'intermediate.csr.pem');
      const certPath = join(directory, 'intermediate.cert.pem');
      const parentKeyPath = join(directory, 'parent.key.pem');
      const parentCertPath = join(directory, 'parent.cert.pem');
      const configPath = join(directory, 'intermediate.cnf');
      await Promise.all([
        writeFile(parentKeyPath, input.parentPrivateKeyPem, 'utf8'),
        writeFile(parentCertPath, input.parentCertificatePem, 'utf8'),
        writeFile(configPath, caConfig(input.commonName, input.pathLengthConstraint), 'utf8'),
      ]);
      await runOpenSsl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072', '-out', keyPath]);
      await runOpenSsl(['req', '-new', '-key', keyPath, '-out', csrPath, '-config', configPath]);
      await runOpenSsl([
        'x509', '-req', '-in', csrPath, '-CA', parentCertPath, '-CAkey', parentKeyPath,
        '-set_serial', serialArgument(), '-days', String(input.validityDays), '-sha256',
        '-extfile', configPath, '-extensions', 'v3_ca', '-out', certPath,
      ]);
      const privateKeyPem = await readFile(keyPath, 'utf8');
      const certificatePem = await readFile(certPath, 'utf8');
      return materialFromCertificate(privateKeyPem, certificatePem, `${certificatePem.trim()}\n${input.parentChainPem.trim()}\n`);
    });
  }

  async generateManagedKeyAndCsr(input: { commonName: string; sans: string[]; algorithm?: 'rsa' | 'ec'; rsaBits?: number }): Promise<{ privateKeyPem: string; csr: ParsedCsr }> {
    return withTemporaryDirectory(async (directory) => {
      const keyPath = join(directory, 'leaf.key.pem');
      const csrPath = join(directory, 'leaf.csr.pem');
      const configPath = join(directory, 'leaf.cnf');
      await writeFile(configPath, leafCsrConfig(input.commonName, input.sans), 'utf8');
      if (input.algorithm === 'ec') {
        await runOpenSsl(['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', keyPath]);
      } else {
        await runOpenSsl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', `rsa_keygen_bits:${input.rsaBits ?? 2048}`, '-out', keyPath]);
      }
      await runOpenSsl(['req', '-new', '-key', keyPath, '-out', csrPath, '-config', configPath]);
      const privateKeyPem = await readFile(keyPath, 'utf8');
      const csrPem = await readFile(csrPath, 'utf8');
      return { privateKeyPem, csr: await this.parseCsr(csrPem) };
    });
  }

  async parseCsr(csrPem: string): Promise<ParsedCsr> {
    return withTemporaryDirectory(async (directory) => {
      const csrPath = join(directory, 'request.csr.pem');
      await writeFile(csrPath, csrPem, 'utf8');
      const verified = await runOpenSsl(['req', '-in', csrPath, '-noout', '-verify', '-subject', '-pubkey']);
      const publicKeyPem = extractPem(verified.stdout, 'PUBLIC KEY');
      if (!publicKeyPem) throw new AppError('CSR_SIGNATURE_INVALID', 'CSR 未包含可解析公钥');
      const publicKey = createPublicKey(publicKeyPem);
      return {
        csrPem: normalizePem(csrPem),
        csrSha256: createHash('sha256').update(normalizePem(csrPem)).digest('hex'),
        publicKeyFingerprintSha256: createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex'),
        subject: verified.stdout.split(/\r?\n/).find((line) => line.startsWith('subject='))?.slice('subject='.length).trim() ?? '',
      };
    });
  }

  async signCsr(input: {
    csrPem: string;
    caPrivateKeyPem: string;
    caCertificatePem: string;
    caChainPem: string;
    validityDays: number;
    sans: string[];
    extendedKeyUsages: string[];
    serialNumber?: string;
  }): Promise<IssuedCertificateMaterial> {
    return withTemporaryDirectory(async (directory) => {
      const csrPath = join(directory, 'request.csr.pem');
      const caKeyPath = join(directory, 'ca.key.pem');
      const caCertPath = join(directory, 'ca.cert.pem');
      const certPath = join(directory, 'issued.cert.pem');
      const extensionPath = join(directory, 'leaf.ext.cnf');
      const serialNumber = input.serialNumber ?? randomBytes(16).toString('hex');
      await Promise.all([
        writeFile(csrPath, input.csrPem, 'utf8'),
        writeFile(caKeyPath, input.caPrivateKeyPem, 'utf8'),
        writeFile(caCertPath, input.caCertificatePem, 'utf8'),
        writeFile(extensionPath, leafExtensionConfig(input.sans, input.extendedKeyUsages), 'utf8'),
      ]);
      await runOpenSsl(['req', '-in', csrPath, '-noout', '-verify']);
      await runOpenSsl([
        'x509', '-req', '-in', csrPath, '-CA', caCertPath, '-CAkey', caKeyPath,
        '-set_serial', `0x${serialNumber}`, '-days', String(input.validityDays), '-sha256',
        '-extfile', extensionPath, '-extensions', 'leaf_ext', '-out', certPath,
      ]);
      const certificatePem = await readFile(certPath, 'utf8');
      const certificate = new X509Certificate(certificatePem);
      return {
        certificatePem,
        certificateChainPem: `${certificatePem.trim()}\n${input.caChainPem.trim()}\n`,
        serialNumber,
        fingerprintSha256: normalizeFingerprint(certificate.fingerprint256),
        publicKeyFingerprintSha256: createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'),
        notBefore: new Date(certificate.validFrom).toISOString(),
        notAfter: new Date(certificate.validTo).toISOString(),
      };
    });
  }
}

async function withTemporaryDirectory<T>(work: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'gcac-ca-'));
  try {
    return await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runOpenSsl(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(process.env.GCAC_OPENSSL_PATH?.trim() || 'openssl', args, {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const detail = error as { stderr?: string; message?: string };
    throw new AppError('CA_KEY_BACKEND_UNAVAILABLE', 'OpenSSL CA 操作失败', {
      reason: sanitizeOpenSslError(detail.stderr ?? detail.message ?? 'unknown error'),
    });
  }
}

function materialFromCertificate(privateKeyPem: string, certificatePem: string, certificateChainPem: string): GeneratedCaMaterial {
  const certificate = new X509Certificate(certificatePem);
  return {
    privateKeyPem,
    certificatePem,
    certificateChainPem,
    publicKeyFingerprintSha256: createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'),
    fingerprintSha256: normalizeFingerprint(certificate.fingerprint256),
    notBefore: new Date(certificate.validFrom).toISOString(),
    notAfter: new Date(certificate.validTo).toISOString(),
  };
}

function caConfig(commonName: string, pathLengthConstraint: number): string {
  return `[req]\nprompt = no\ndistinguished_name = dn\nx509_extensions = v3_ca\n[dn]\nCN = ${escapeConfigValue(commonName)}\n[v3_ca]\nsubjectKeyIdentifier = hash\nauthorityKeyIdentifier = keyid:always,issuer\nbasicConstraints = critical,CA:true,pathlen:${Math.max(0, pathLengthConstraint)}\nkeyUsage = critical,keyCertSign,cRLSign\n`;
}

function leafCsrConfig(commonName: string, sans: string[]): string {
  const sanSection = sans.length > 0 ? `\nreq_extensions = req_ext\n[req_ext]\nsubjectAltName = ${sanExpression(sans)}\n` : '\n';
  return `[req]\nprompt = no\ndistinguished_name = dn${sanSection}[dn]\nCN = ${escapeConfigValue(commonName)}\n`;
}

function leafExtensionConfig(sans: string[], extendedKeyUsages: string[]): string {
  const usages = extendedKeyUsages.length > 0 ? extendedKeyUsages.join(',') : 'serverAuth';
  const san = sans.length > 0 ? `\nsubjectAltName = ${sanExpression(sans)}` : '';
  return `[leaf_ext]\nbasicConstraints = critical,CA:false\nsubjectKeyIdentifier = hash\nauthorityKeyIdentifier = keyid,issuer\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = ${usages}${san}\n`;
}

function sanExpression(sans: string[]): string {
  return sans.map((value) => isIp(value) ? `IP:${value}` : `DNS:${value}`).join(',');
}

function isIp(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(':');
}

function escapeConfigValue(value: string): string {
  return value.replace(/[\r\n]/g, ' ').replace(/[=]/g, '\\=');
}

function serialArgument(): string {
  return `0x${randomBytes(16).toString('hex')}`;
}

function normalizeFingerprint(value: string): string {
  return value.replaceAll(':', '').toLowerCase();
}

function normalizePem(value: string): string {
  return `${value.trim()}\n`;
}

function extractPem(value: string, label: string): string | undefined {
  return value.match(new RegExp(`-----BEGIN ${label}-----[\\s\\S]*?-----END ${label}-----`))?.[0];
}

function sanitizeOpenSslError(value: string): string {
  return value.replace(/-----BEGIN[\s\S]*?-----END[^-]+-----/g, '[REDACTED]').slice(0, 800);
}

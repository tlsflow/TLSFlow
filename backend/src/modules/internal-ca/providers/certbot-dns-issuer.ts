import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppError } from '../../../common/errors/app-error.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type { CredentialsApplicationService } from '../../credentials/application/credentials.application-service.js';
import type { CertificateRequestEntity, CaProviderEntity } from '../schema/internal-ca.schema.js';
import type { AcmeCertificateMaterial } from './acme-provider.js';
import { findAcmeDnsProvider } from './acme-dns-provider.registry.js';

const execFileAsync = promisify(execFile);

interface CertbotProcessResult {
  stdout: string;
  stderr: string;
}

export interface CertbotProcessRunner {
  run(command: string, args: string[], options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }): Promise<CertbotProcessResult>;
}

export interface CertbotDnsIssuerDependencies {
  credentials: Pick<CredentialsApplicationService, 'get'>;
  secrets: Pick<SecretService, 'resolveForService'>;
  runner?: CertbotProcessRunner;
  certbotPath?: string;
  pythonPath?: string;
  certbotVersion?: string;
  autoInstallPlugins?: boolean;
}

export interface CertbotDnsIssueInput {
  tenantId: string;
  jobId: string;
  request: Pick<CertificateRequestEntity, 'csrPem' | 'subjectCommonName' | 'sans'>;
  provider: Pick<CaProviderEntity, 'endpoint'>;
  dnsProviderId: string;
  dnsCredentialId: string;
  contactEmail: string;
  propagationSeconds?: number;
  actorId: string;
}

/**
 * 使用 Certbot 完整执行 DNS-01。
 *
 * Certbot 自己创建 ACME Account、Order 和 Challenge。GCAC 只负责提供受控
 * 参数和凭据，并把 certbot 生成的证书材料导回现有证书申请流程。
 */
export class CertbotDnsIssuer {
  private readonly runner: CertbotProcessRunner;
  private readonly certbotPath: string;
  private readonly pythonPath: string;
  private readonly certbotVersion?: string;
  private readonly autoInstallPlugins: boolean;
  private readonly installedPlugins = new Set<string>();
  private installQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: CertbotDnsIssuerDependencies) {
    this.runner = dependencies.runner ?? new LocalCertbotProcessRunner();
    this.certbotPath = dependencies.certbotPath ?? process.env.GCAC_CERTBOT_PATH?.trim() ?? 'certbot';
    this.pythonPath = dependencies.pythonPath ?? process.env.GCAC_CERTBOT_PYTHON?.trim() ?? 'python3';
    this.certbotVersion = dependencies.certbotVersion ?? process.env.GCAC_CERTBOT_VERSION?.trim();
    this.autoInstallPlugins = dependencies.autoInstallPlugins
      ?? process.env.GCAC_CERTBOT_AUTO_INSTALL_PLUGINS !== 'false';
  }

  async issue(input: CertbotDnsIssueInput): Promise<AcmeCertificateMaterial> {
    const definition = findAcmeDnsProvider(input.dnsProviderId);
    if (!definition) throw new AppError('CA_CAPABILITY_UNSUPPORTED', 'DNS Provider 未注册', { providerId: input.dnsProviderId });
    if (!input.provider.endpoint?.trim()) throw new AppError('ACME_PROVIDER_CONFIG_INVALID', 'ACME Provider 缺少 Directory 地址');
    if (!input.contactEmail.trim()) throw new AppError('VALIDATION_FAILED', 'Certbot 申请缺少联系邮箱');

    const credential = await this.dependencies.credentials.get(input.tenantId, input.dnsCredentialId);
    if (credential.kind !== 'DNS_PROVIDER' || credential.status !== 'active') {
      throw new AppError('VALIDATION_FAILED', 'DNS 凭据不存在或未启用', { credentialId: input.dnsCredentialId });
    }
    if (credential.metadata.providerId !== input.dnsProviderId) {
      throw new AppError('VALIDATION_FAILED', 'DNS 凭据与 Provider 不匹配', {
        credentialId: input.dnsCredentialId,
        providerId: input.dnsProviderId,
      });
    }
    const credentialRef = credential.secretSlots.config;
    if (!credentialRef) throw new AppError('VALIDATION_FAILED', 'DNS 凭据缺少配置内容');
    const resolvedCredential = await this.dependencies.secrets.resolveForService({
      secretRef: credentialRef,
      expectedType: 'password',
      purpose: 'acme.certbot.dns_credentials',
      actorId: input.actorId,
    });

    try {
      await this.ensurePlugin(definition);
    } catch (error) {
      throw new AppError('ACME_RENEWAL_FAILED', 'Certbot DNS-01 插件准备失败', {
        providerId: input.dnsProviderId,
        jobId: input.jobId,
        reason: summarizeCertbotError(error),
      });
    }
    const directory = await mkdtemp(join(tmpdir(), `gcac-certbot-${safeTempSegment(input.jobId)}-`));
    const credentialsPath = join(directory, 'dns-credentials.ini');
    const csrPath = join(directory, 'request.csr.pem');
    const certPath = join(directory, 'cert.pem');
    const chainPath = join(directory, 'chain.pem');
    const fullChainPath = join(directory, 'fullchain.pem');
    const configDir = join(directory, 'config');
    const workDir = join(directory, 'work');
    const logsDir = join(directory, 'logs');

    try {
      await writeFile(credentialsPath, resolvedCredential.plainText, { encoding: 'utf8', mode: 0o600 });
      await chmod(credentialsPath, 0o600);
      await writeFile(csrPath, input.request.csrPem, 'utf8');

      const args = [
        'certonly',
        '--non-interactive',
        '--agree-tos',
        '--email', input.contactEmail.trim(),
        '--server', input.provider.endpoint.trim(),
        '--preferred-challenges', 'dns',
        '--authenticator', definition.fullPluginName,
        '--csr', csrPath,
        '--cert-path', certPath,
        '--chain-path', chainPath,
        '--fullchain-path', fullChainPath,
        '--config-dir', configDir,
        '--work-dir', workDir,
        '--logs-dir', logsDir,
      ];
      const env = { ...process.env };
      if (input.propagationSeconds !== undefined && input.dnsProviderId !== 'route53') {
        args.push(`--${definition.fullPluginName}-propagation-seconds`, String(input.propagationSeconds));
      }
      if (input.dnsProviderId === 'route53') {
        env.AWS_CONFIG_FILE = credentialsPath;
      } else {
        args.push(`--${definition.fullPluginName}-credentials`, credentialsPath);
      }

      await this.runner.run(this.certbotPath, args, { cwd: directory, env });
      const [certificatePem, certificateChainPem] = await Promise.all([
        readFile(certPath, 'utf8'),
        readFile(fullChainPath, 'utf8'),
      ]);
      return {
        certificatePem,
        certificateChainPem,
        certificateUrl: `certbot://${input.jobId}`,
      };
    } catch (error) {
      throw new AppError('ACME_RENEWAL_FAILED', 'Certbot DNS-01 签发失败', {
        providerId: input.dnsProviderId,
        jobId: input.jobId,
        reason: summarizeCertbotError(error),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async ensurePlugin(definition: NonNullable<ReturnType<typeof findAcmeDnsProvider>>): Promise<void> {
    if (this.installedPlugins.has(definition.id)) return;
    this.installQueue = this.installQueue.then(async () => {
      if (this.installedPlugins.has(definition.id)) return;
      if (this.autoInstallPlugins) {
        const packageSpec = `${definition.packageName}${normalizePackageVersion(definition.version, this.certbotVersion)}`;
        const dependencyArgs = normalizeDependencyArgs(definition.dependencies, this.certbotVersion);
        await this.runner.run(this.pythonPath, [
          '-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', packageSpec, ...dependencyArgs,
        ], { env: { ...process.env, PIP_NO_INPUT: '1' } });
      }
      this.installedPlugins.add(definition.id);
    });
    const currentInstall = this.installQueue;
    this.installQueue = currentInstall.catch(() => undefined);
    await currentInstall;
  }
}

class LocalCertbotProcessRunner implements CertbotProcessRunner {
  async run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<CertbotProcessResult> {
    try {
      return await execFileAsync(command, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch (error) {
      const detail = error as { stdout?: string; stderr?: string; message?: string };
      throw new Error(summarizeCertbotError(detail.stderr ?? detail.stdout ?? detail.message ?? 'unknown error'));
    }
  }
}

function normalizePackageVersion(version: string, certbotVersion?: string): string {
  const normalized = version.trim();
  if (!normalized) return '';
  if (!normalized.includes('{{certbot-version}}')) return normalized;
  return certbotVersion ? normalized.replaceAll('{{certbot-version}}', certbotVersion) : '';
}

function normalizeDependencyArgs(value: string | undefined, certbotVersion?: string): string[] {
  if (!value) return [];
  if (value.includes('{{certbot-version}}') && !certbotVersion) return [];
  return value
    .replaceAll('{{certbot-version}}', certbotVersion ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function safeTempSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'job';
}

function summarizeCertbotError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/-----BEGIN[\s\S]*?-----END[^-]+-----/g, '[REDACTED]')
    .replace(/(?:api[_-]?key|token|secret|password)\s*=\s*[^\s]+/gi, '$1=[REDACTED]')
    .slice(0, 800);
}

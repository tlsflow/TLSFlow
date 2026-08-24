import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

interface LegoProcessResult {
  stdout: string;
  stderr: string;
}

export interface LegoProcessRunner {
  run(command: string, args: string[], options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  }): Promise<LegoProcessResult>;
}

export interface LegoDnsIssuerDependencies {
  credentials: Pick<CredentialsApplicationService, 'get'>;
  secrets: Pick<SecretService, 'resolveForService'>;
  runner?: LegoProcessRunner;
  legoPath?: string;
  timeoutMs?: number;
}

export interface LegoDnsIssueInput {
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
 * 使用 lego 完整执行 DNS-01。
 *
 * lego 是单一外部可执行文件，GCAC 不再安装 Python、pip 或 Certbot 插件。
 * Provider 凭据先由全局 Secret 服务解密，再写入本次任务的临时 env 文件，
 * lego 通过 --env-file 读取，任务完成后连同证书材料一起删除。
 */
export class LegoDnsIssuer {
  private readonly runner: LegoProcessRunner;
  private readonly legoPath: string;
  private readonly timeoutMs: number;

  constructor(private readonly dependencies: LegoDnsIssuerDependencies) {
    this.runner = dependencies.runner ?? new LocalLegoProcessRunner();
    this.legoPath = dependencies.legoPath ?? process.env.GCAC_LEGO_PATH?.trim() ?? 'lego';
    this.timeoutMs = positiveInteger(
      dependencies.timeoutMs ?? Number(process.env.GCAC_LEGO_TIMEOUT_MS),
      600_000,
    );
  }

  async issue(input: LegoDnsIssueInput): Promise<AcmeCertificateMaterial> {
    const definition = findAcmeDnsProvider(input.dnsProviderId);
    if (!definition) {
      throw new AppError('ACME_PROVIDER_CONFIG_INVALID', 'DNS Provider 未注册', { providerId: input.dnsProviderId });
    }
    if (!input.provider.endpoint?.trim()) {
      throw new AppError('ACME_PROVIDER_CONFIG_INVALID', 'ACME Provider 缺少 Directory 地址');
    }
    if (!input.contactEmail.trim()) {
      throw new AppError('VALIDATION_FAILED', 'lego 申请缺少联系邮箱');
    }

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
      purpose: 'acme.lego.dns_credentials',
      actorId: input.actorId,
    });

    const directory = await mkdtemp(join(tmpdir(), `gcac-lego-${safeTempSegment(input.jobId)}-`));
    const envPath = join(directory, 'dns-credentials.env');
    const csrPath = join(directory, 'request.csr.pem');
    const legoPath = join(directory, 'lego-data');
    const certificatesPath = join(legoPath, 'certificates');

    try {
      if (!resolvedCredential.plainText.trim()) {
        throw new AppError('VALIDATION_FAILED', 'lego 环境文件不能为空');
      }
      await writeFile(envPath, resolvedCredential.plainText.trim().concat('\n'), { encoding: 'utf8', mode: 0o600 });
      await chmod(envPath, 0o600);
      await writeFile(csrPath, input.request.csrPem, 'utf8');

      const credentialEnv = parseLegoEnvironmentFile(
        await readFile(envPath, 'utf8'),
        definition.credentialKeys,
        definition.credentialTemplate,
      );
      const args = [
        '--accept-tos',
        '--email', input.contactEmail.trim(),
        '--server', input.provider.endpoint.trim(),
        '--dns', definition.id,
        '--path', legoPath,
        '--csr', csrPath,
      ];
      if (input.propagationSeconds !== undefined) {
        args.push('--dns.propagation-wait', `${input.propagationSeconds}s`);
      }
      args.push('run');

      await this.runner.run(this.legoPath, args, {
        cwd: directory,
        env: {
          ...process.env,
          ...credentialEnv,
          LEGO_DISABLE_CNAME_SUPPORT: 'true',
        },
        timeoutMs: this.timeoutMs,
      });

      const certificateBundlePath = await findCertificateBundle(certificatesPath);
      const certificatePem = await readFile(certificateBundlePath, 'utf8');
      const issuerPath = certificateBundlePath.replace(/\.crt$/i, '.issuer.crt');
      const issuerPem = await readOptionalFile(issuerPath);
      const certificateChainPem = issuerPem
        ? `${certificatePem.trim()}\n${issuerPem.trim()}\n`
        : certificatePem;

      return {
        certificatePem: firstPemCertificate(certificatePem),
        certificateChainPem,
        certificateUrl: `lego://${input.jobId}`,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('ACME_RENEWAL_FAILED', 'lego DNS-01 签发失败', {
        providerId: input.dnsProviderId,
        jobId: input.jobId,
        reason: summarizeLegoError(error),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

class LocalLegoProcessRunner implements LegoProcessRunner {
  async run(
    command: string,
    args: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
  ): Promise<LegoProcessResult> {
    try {
      return await execFileAsync(command, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        timeout: options.timeoutMs,
      });
    } catch (error) {
      const detail = error as {
        stdout?: string;
        stderr?: string;
        message?: string;
        killed?: boolean;
        code?: string;
      };
      if (detail.killed || detail.code === 'ETIMEDOUT') {
        throw new Error(`lego 执行超时（${options.timeoutMs ?? 0}ms）`);
      }
      throw new Error(summarizeLegoError(detail.stderr ?? detail.stdout ?? detail.message ?? 'unknown error'));
    }
  }
}

async function findCertificateBundle(certificatesPath: string): Promise<string> {
  const files = await readdir(certificatesPath);
  const certificate = files.find((file) => file.endsWith('.crt') && !file.endsWith('.issuer.crt'));
  if (!certificate) throw new Error('lego 未生成证书文件');
  return join(certificatesPath, certificate);
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

function firstPemCertificate(value: string): string {
  const match = value.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  if (!match) throw new Error('lego 输出缺少 leaf certificate');
  return `${match[0]}\n`;
}

function safeTempSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'job';
}

function summarizeLegoError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/-----BEGIN[\s\S]*?-----END[^-]+-----/g, '[REDACTED]')
    .replace(/(?:api[_-]?key|token|secret|password)\s*=\s*[^\s]+/gi, '$1=[REDACTED]')
    .slice(0, 800);
}

function parseLegoEnvironmentFile(
  content: string,
  credentialKeys: readonly string[],
  credentialTemplate: string,
): NodeJS.ProcessEnv {
  const allowedKeys = new Set([
    ...credentialKeys,
    ...credentialTemplate
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => line.slice(0, line.indexOf('=')).trim()),
  ]);
  const allowedPrefixes = new Set(
    [...allowedKeys]
      .filter((key) => key.includes('_'))
      .map((key) => `${key.slice(0, key.indexOf('_'))}_`),
  );
  const environment: NodeJS.ProcessEnv = {};

  for (const [index, sourceLine] of content.split(/\r?\n/).entries()) {
    let line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();
    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new AppError('VALIDATION_FAILED', `lego 环境文件第 ${index + 1} 行缺少等号`);
    }
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new AppError('VALIDATION_FAILED', `lego 环境文件第 ${index + 1} 行变量名无效`);
    }
    if (!allowedKeys.has(key) && ![...allowedPrefixes].some((prefix) => key.startsWith(prefix))) {
      throw new AppError('VALIDATION_FAILED', `lego 环境变量 ${key} 不属于当前 DNS Provider`);
    }
    const value = parseEnvironmentValue(line.slice(separator + 1).trim(), index + 1);
    if (!value) {
      throw new AppError('VALIDATION_FAILED', `lego 环境变量 ${key} 不能为空`);
    }
    environment[key] = value;
  }

  if (Object.keys(environment).length === 0) {
    throw new AppError('VALIDATION_FAILED', 'lego 环境文件没有可用变量');
  }
  return environment;
}

function parseEnvironmentValue(value: string, lineNumber: number): string {
  if (value.includes('\0')) {
    throw new AppError('VALIDATION_FAILED', `lego 环境文件第 ${lineNumber} 行包含非法字符`);
  }
  if (!value.startsWith('"') && !value.startsWith("'")) return value;
  const quote = value[0];
  if (value.length < 2 || value.at(-1) !== quote) {
    throw new AppError('VALIDATION_FAILED', `lego 环境文件第 ${lineNumber} 行引号未闭合`);
  }
  const unquoted = value.slice(1, -1);
  if (quote === "'") return unquoted;
  return unquoted.replace(/\\(["\\nrt])/g, (_match, escaped: string) => {
    if (escaped === 'n') return '\n';
    if (escaped === 'r') return '\r';
    if (escaped === 't') return '\t';
    return escaped;
  });
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}

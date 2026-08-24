import { createHash } from 'node:crypto';
import type { DeploymentDraftBundle, DeploymentStepDraft, DiscoveryExecutionContext, DiscoveryResult, ProviderDescriptor } from '../dto/providers.dto.js';
import type { Provider } from '../application/provider.interface.js';

export interface ApacheVirtualHost {
  addresses: Array<{ listenIp?: string; port: number }>;
  serverName?: string;
  serverAliases: string[];
  sslCertificate?: string;
  sslCertificateKey?: string;
  sslCertificateChain?: string;
  includes: string[];
  listens: Array<{ listenIp?: string; port: number }>;
  chainStrategy: 'FULLCHAIN_CERT_FILE' | 'SEPARATE_CHAIN_FILE' | 'UNKNOWN';
  diagnostics: string[];
}

export interface ApacheCommandStrategy {
  binaryPath: string;
  testCommand: string;
  reloadCommand?: string;
  reloadMode: 'graceful' | 'reload' | 'manual';
  manualReload: boolean;
}

export class ApacheProvider implements Provider {
  getDescriptor(): ProviderDescriptor {
    return {
      metadata: {
        id: 'apache-provider',
        type: 'APACHE',
        displayName: 'Apache Provider',
        description: '解析 Apache VirtualHost 配置并生成证书部署步骤草案，不执行真实命令。',
        version: '0.1.0',
        capabilities: ['DISCOVERY', 'STEP_DRAFT_MAPPING', 'SNAPSHOT_PERSISTENCE'],
        supportedDiscoverySources: ['SSH', 'AGENT', 'MANUAL', 'GATEWAY'],
        supportedStages: ['HOST', 'SERVICE', 'ENDPOINT', 'BINDING'],
        tags: ['apache', 'httpd', 'linux'],
        priority: 21,
      },
      matchRules: {
        providerType: 'APACHE',
        serviceNames: ['apache', 'apache2', 'httpd'],
        configPathPatterns: ['apache2.conf', 'httpd.conf', '/etc/apache2/', '/etc/httpd/'],
        endpointProtocols: ['HTTPS', 'TLS'],
        tags: ['apache', 'httpd'],
      },
    };
  }

  discover(_context: DiscoveryExecutionContext, input: { source: DiscoveryResult['source']; scope: Record<string, string>; payload: Record<string, unknown> }): DiscoveryResult {
    const configText = String(input.payload.configText ?? '');
    const configPath = String(input.payload.configPath ?? '/etc/apache2/apache2.conf');
    const osType = String(input.payload.osType ?? input.scope.osType ?? 'LINUX').toUpperCase();
    const apacheVersion = normalizeOptionalString(input.payload.apacheVersion) ?? normalizeOptionalString(input.payload.version);
    const binaryPath = String(input.payload.binaryPath ?? 'apachectl');
    const commandStrategy = buildApacheCommandStrategy({
      binaryPath,
      testCommand: input.payload.testCommand as string | undefined,
      reloadCommand: input.payload.reloadCommand as string | undefined,
      reloadMode: input.payload.reloadMode as ApacheCommandStrategy['reloadMode'] | undefined,
      manualReload: input.payload.manualReload === true,
    });
    const hostname = String(input.scope.hostname ?? input.payload.hostname ?? 'apache-host').toLowerCase();
    const virtualHosts = parseApacheVirtualHosts(configText, { chainStrategy: normalizeChainStrategy(input.payload.chainStrategy) });
    const hostKey = `host:${hostname}`;
    const serviceKey = `service:${hostname}:apache`;
    const endpoints = [];
    const bindings = [];
    let index = 1;

    for (const virtualHost of virtualHosts) {
      const names = domainNamesFor(virtualHost, hostname);
      const address = virtualHost.addresses.find((item) => item.port === 443) ?? virtualHost.addresses[0] ?? virtualHost.listens[0] ?? { port: 443 };
      const endpointKey = `endpoint:${hostname}:${address.port}:${index}`;
      const bindingKey = `binding:${hostname}:${address.port}:${index}`;
      endpoints.push({
        key: endpointKey,
        serviceKey,
        protocol: address.port === 443 || virtualHost.sslCertificate ? 'HTTPS' : 'HTTP',
        hostName: names[0],
        listenIp: address.listenIp,
        port: address.port,
        pathHint: configPath,
        status: 'ACTIVE',
        rawFacts: { serverNames: names, includes: virtualHost.includes, listens: virtualHost.listens },
      });
      bindings.push({
        key: bindingKey,
        endpointKey,
        bindingType: 'FILE_PATH',
        domainName: names[0],
        certificateRef: virtualHost.sslCertificate ? `file://${virtualHost.sslCertificate}` : undefined,
        privateKeyRef: virtualHost.sslCertificateKey ? `file://${virtualHost.sslCertificateKey}` : undefined,
        configPath,
        rawFacts: {
          diagnostics: virtualHost.diagnostics,
          serverName: virtualHost.serverName,
          serverAliases: virtualHost.serverAliases,
          sslCertificate: virtualHost.sslCertificate,
          sslCertificateChain: virtualHost.sslCertificateChain,
          chainStrategy: virtualHost.chainStrategy,
          apacheVersion,
        },
      });
      index += 1;
    }

    return {
      providerId: 'apache-provider',
      providerType: 'APACHE',
      source: input.source,
      discoveredAt: new Date().toISOString(),
      scope: input.scope,
      hosts: [{ key: hostKey, hostname, ipAddresses: [], osType, tags: ['apache', 'httpd'] }],
      services: [{
        key: serviceKey,
        hostKey,
        providerType: 'APACHE',
        serviceName: 'apache',
        displayName: 'Apache HTTP Server',
        versionText: apacheVersion,
        configPath,
        installPath: binaryPath,
        status: 'ACTIVE',
        rawFacts: { virtualHostCount: virtualHosts.length, commandStrategy, requiredCapabilities: requiredApacheCapabilities() },
      }],
      endpoints,
      bindings,
      serviceAssets: endpoints.map((endpoint, assetIndex) => ({
        key: `service-asset:${hostname}:${endpoint.port}:${assetIndex + 1}`,
        serviceKey,
        endpointKey: endpoint.key,
        address: endpoint.hostName,
        addressType: 'DNS',
        port: endpoint.port,
        protocol: endpoint.protocol === 'HTTPS' ? 'HTTPS' : 'HTTP',
        sniName: endpoint.hostName,
        displayName: endpoint.hostName,
        status: 'ACTIVE',
        rawFacts: { projectedFrom: 'apache-virtual-host' },
      })),
      rawPayload: { configPath, binaryPath, apacheVersion, commandStrategy, diagnostics: virtualHosts.flatMap((item) => item.diagnostics) },
    };
  }

  toDeploymentDraft(result: DiscoveryResult): DeploymentDraftBundle {
    const steps: DeploymentStepDraft[] = [];
    for (const binding of result.bindings) {
      const endpoint = result.endpoints.find((item) => item.key === binding.endpointKey);
      const service = endpoint ? result.services.find((item) => item.key === endpoint.serviceKey) : undefined;
      const commandStrategy = service?.rawFacts?.commandStrategy as ApacheCommandStrategy | undefined;
      const chainPath = readChainPath(binding);
      const ids = ['backup-cert', 'backup-key', 'backup-chain', 'upload-cert', 'upload-key', 'upload-chain', 'configtest', 'reload', 'verify'].map((name) => stableId(result.providerId, binding.key, name));
      steps.push(step(ids[0]!, '备份 Apache 证书文件', 'BACKUP', result, binding, service?.hostKey, [], ['file.backup'], { path: binding.certificateRef, backupManifestRef: `backup://${binding.key}/cert` }, 'medium'));
      steps.push(step(ids[1]!, '备份 Apache 私钥文件', 'BACKUP', result, binding, service?.hostKey, [ids[0]!], ['file.backup'], { path: binding.privateKeyRef, backupManifestRef: `backup://${binding.key}/key` }, 'critical'));
      const uploadCertDependencies = [ids[1]!];
      if (chainPath) {
        steps.push(step(ids[2]!, '备份 Apache chain 文件', 'BACKUP', result, binding, service?.hostKey, [ids[1]!], ['file.backup'], { path: chainPath, backupManifestRef: `backup://${binding.key}/chain` }, 'medium'));
        uploadCertDependencies[0] = ids[2]!;
      }
      steps.push(step(ids[3]!, '上传 Apache 证书', 'INSTALL_CERTIFICATE', result, binding, service?.hostKey, uploadCertDependencies, ['file.write'], { certPath: binding.certificateRef, certificateSecretRef: 'secret://certificate/leaf-or-fullchain#current' }, 'high'));
      steps.push(step(ids[4]!, '上传 Apache 私钥', 'INSTALL_PRIVATE_KEY', result, binding, service?.hostKey, [ids[3]!], ['file.write'], { keyPath: binding.privateKeyRef, privateKeySecretRef: 'secret://certificate/private-key#current' }, 'critical'));
      const configtestDependencies = [ids[4]!];
      if (chainPath) {
        steps.push(step(ids[5]!, '上传 Apache chain 文件', 'INSTALL_CERTIFICATE_CHAIN', result, binding, service?.hostKey, [ids[4]!], ['file.write'], { chainPath, chainSecretRef: 'secret://certificate/chain#current' }, 'high'));
        configtestDependencies[0] = ids[5]!;
      }
      steps.push(step(ids[6]!, '执行 Apache configtest', 'VALIDATE', result, binding, service?.hostKey, configtestDependencies, ['process.exec', 'apache.configtest'], { command: commandStrategy?.testCommand ?? 'apachectl configtest' }, 'medium'));
      if (commandStrategy?.manualReload) {
        steps.push(step(ids[7]!, '人工 Reload Apache', 'RELOAD_SERVICE', result, binding, service?.hostKey, [ids[6]!], ['manual.reload'], { manualRequired: true, command: commandStrategy.reloadCommand }, 'high'));
      } else {
        steps.push(step(ids[7]!, 'Reload/Graceful Apache', 'RELOAD_SERVICE', result, binding, service?.hostKey, [ids[6]!], ['process.exec', 'apache.reload'], { command: commandStrategy?.reloadCommand ?? 'apachectl graceful', reloadMode: commandStrategy?.reloadMode ?? 'graceful' }, 'high'));
      }
      steps.push(step(ids[8]!, '验证远程 TLS', 'VERIFY_BINDING', result, binding, service?.hostKey, [ids[7]!], ['tls.remote_probe'], { domainName: binding.domainName, port: endpoint?.port ?? 443 }, 'medium'));
    }
    return draftBundle(result, steps);
  }

  toRollbackDraft(result: DiscoveryResult): DeploymentDraftBundle {
    const steps: DeploymentStepDraft[] = [];
    for (const binding of result.bindings) {
      const endpoint = result.endpoints.find((item) => item.key === binding.endpointKey);
      const service = endpoint ? result.services.find((item) => item.key === endpoint.serviceKey) : undefined;
      const commandStrategy = service?.rawFacts?.commandStrategy as ApacheCommandStrategy | undefined;
      const ids = ['restore', 'configtest', 'reload', 'verify'].map((name) => stableId(result.providerId, binding.key, 'rollback', name));
      steps.push(step(ids[0]!, '恢复 Apache 证书备份', 'ROLLBACK', result, binding, service?.hostKey, [], ['file.rollback'], { backupManifestRef: `backup://${binding.key}`, restorePaths: { certPath: binding.certificateRef, keyPath: binding.privateKeyRef, chainPath: readChainPath(binding) } }, 'critical'));
      steps.push(step(ids[1]!, '回滚后执行 Apache configtest', 'VALIDATE', result, binding, service?.hostKey, [ids[0]!], ['process.exec', 'apache.configtest'], { command: commandStrategy?.testCommand ?? 'apachectl configtest' }, 'medium'));
      steps.push(step(ids[2]!, '回滚后 Reload/Graceful Apache', 'RELOAD_SERVICE', result, binding, service?.hostKey, [ids[1]!], commandStrategy?.manualReload ? ['manual.reload'] : ['process.exec', 'apache.reload'], { command: commandStrategy?.reloadCommand ?? 'apachectl graceful', manualRequired: commandStrategy?.manualReload ?? false }, 'high'));
      steps.push(step(ids[3]!, '验证回滚后远程 TLS', 'VERIFY_BINDING', result, binding, service?.hostKey, [ids[2]!], ['tls.remote_probe'], { domainName: binding.domainName, port: endpoint?.port ?? 443, expected: 'previousFingerprint' }, 'medium'));
    }
    return draftBundle(result, steps);
  }
}

export function parseApacheVirtualHosts(configText: string, options: { chainStrategy?: ApacheVirtualHost['chainStrategy'] } = {}): ApacheVirtualHost[] {
  const globalListens = parseListenDirectives(configText);
  return extractVirtualHostBlocks(configText).map((block) => {
    const body = stripApacheComments(block.body);
    const sslCertificate = normalizeApachePath(readDirective(body, 'SSLCertificateFile'));
    const sslCertificateKey = normalizeApachePath(readDirective(body, 'SSLCertificateKeyFile'));
    const sslCertificateChain = normalizeApachePath(readDirective(body, 'SSLCertificateChainFile'));
    const serverName = readDirective(body, 'ServerName')?.split(/\s+/)[0];
    const serverAliases = readDirectives(body, 'ServerAlias').flatMap((item) => item.split(/\s+/)).filter(Boolean);
    const includes = readDirectives(body, 'Include').concat(readDirectives(body, 'IncludeOptional'));
    const chainStrategy = resolveChainStrategy({ chainStrategy: options.chainStrategy, sslCertificateChain });
    const diagnostics = [];
    if (sslCertificate && !sslCertificateKey) diagnostics.push('缺少 SSLCertificateKeyFile');
    if (!sslCertificate && sslCertificateKey) diagnostics.push('缺少 SSLCertificateFile');
    if (sslCertificateChain && chainStrategy === 'SEPARATE_CHAIN_FILE') diagnostics.push('Apache 2.2/旧配置使用独立 SSLCertificateChainFile，部署时必须保留 chain 文件策略');
    if ([sslCertificate, sslCertificateKey, sslCertificateChain].some((path) => path && hasApacheVariable(path))) diagnostics.push('证书路径包含变量或表达式，不能自动部署');
    return {
      addresses: block.addresses,
      serverName,
      serverAliases,
      sslCertificate,
      sslCertificateKey,
      sslCertificateChain,
      includes,
      listens: globalListens,
      chainStrategy,
      diagnostics,
    };
  });
}

export function buildApacheCommandStrategy(input: { binaryPath?: string; testCommand?: string; reloadCommand?: string; reloadMode?: 'graceful' | 'reload' | 'manual'; manualReload?: boolean }): ApacheCommandStrategy {
  const binaryPath = input.binaryPath ?? 'apachectl';
  const binary = quotePath(binaryPath);
  const reloadMode = input.manualReload ? 'manual' : input.reloadMode ?? 'graceful';
  if (input.manualReload || reloadMode === 'manual') {
    return { binaryPath, testCommand: input.testCommand ?? `${binary} configtest`, reloadCommand: input.reloadCommand, reloadMode: 'manual', manualReload: true };
  }
  return {
    binaryPath,
    testCommand: input.testCommand ?? (binaryPath.endsWith('httpd') || binaryPath.endsWith('httpd.exe') ? `${binary} -t` : `${binary} configtest`),
    reloadCommand: input.reloadCommand ?? `${binary} ${reloadMode}`,
    reloadMode,
    manualReload: false,
  };
}

export function requiredApacheCapabilities(): string[] {
  return ['apache.configtest', 'apache.reload', 'file.backup', 'file.write', 'process.exec', 'tls.remote_probe'];
}

function extractVirtualHostBlocks(configText: string): Array<{ addresses: ApacheVirtualHost['addresses']; body: string }> {
  const output: Array<{ addresses: ApacheVirtualHost['addresses']; body: string }> = [];
  const pattern = /<VirtualHost\s+([^>]*)>/gi;
  for (const match of configText.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length;
    const endMatch = /<\/VirtualHost>/i.exec(configText.slice(start));
    if (!endMatch) continue;
    const end = start + endMatch.index;
    output.push({ addresses: parseVirtualHostAddresses(match[1] ?? ''), body: configText.slice(start, end) });
  }
  return output;
}

function parseVirtualHostAddresses(raw: string): ApacheVirtualHost['addresses'] {
  return raw.split(/\s+/).filter(Boolean).map((item) => {
    const port = Number(item.match(/:(\d+)$/)?.[1] ?? item.match(/^(\d+)$/)?.[1] ?? 443);
    const listenIp = item.includes(':') ? item.replace(/:\d+$/, '') : undefined;
    return { listenIp: listenIp && listenIp !== '*' ? listenIp : undefined, port };
  });
}

function parseListenDirectives(configText: string): ApacheVirtualHost['listens'] {
  return readDirectives(stripApacheComments(configText), 'Listen').map((raw) => {
    const port = Number(raw.match(/(\d+)$/)?.[1] ?? 80);
    const listenIp = raw.includes(':') ? raw.replace(/:\d+$/, '') : undefined;
    return { listenIp, port };
  });
}

function readDirective(body: string, directive: string): string | undefined {
  return readDirectives(body, directive)[0];
}

function readDirectives(body: string, directive: string): string[] {
  const pattern = new RegExp(`^\\s*${directive}\\s+(.+?)\\s*$`, 'gim');
  return [...body.matchAll(pattern)].map((match) => match[1]!.trim().replace(/^"(.+)"$/, '$1'));
}

function stripApacheComments(configText: string): string {
  return configText.split('\n').map((line) => line.replace(/\s+#.*$/, '').replace(/^#.*$/, '')).join('\n');
}

function resolveChainStrategy(input: { chainStrategy?: ApacheVirtualHost['chainStrategy']; sslCertificateChain?: string }): ApacheVirtualHost['chainStrategy'] {
  if (input.chainStrategy) return input.chainStrategy;
  if (input.sslCertificateChain) return 'SEPARATE_CHAIN_FILE';
  return 'UNKNOWN';
}

function domainNamesFor(virtualHost: ApacheVirtualHost, hostname: string): string[] {
  const names = [virtualHost.serverName, ...virtualHost.serverAliases].filter((item): item is string => Boolean(item));
  return names.length ? names : [hostname];
}

function readChainPath(binding: DiscoveryResult['bindings'][number]): string | undefined {
  const chain = binding.rawFacts?.sslCertificateChain;
  return typeof chain === 'string' ? `file://${chain}` : undefined;
}

function normalizeApachePath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const trimmed = path.replace(/\\\\/g, '/').trim();
  return trimmed || undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeChainStrategy(value: unknown): ApacheVirtualHost['chainStrategy'] | undefined {
  return value === 'FULLCHAIN_CERT_FILE' || value === 'SEPARATE_CHAIN_FILE' || value === 'UNKNOWN' ? value : undefined;
}

function hasApacheVariable(path: string): boolean {
  return /\$\{[^}]+}|%[A-Za-z_]+%|\$[A-Za-z_][A-Za-z0-9_]*/.test(path);
}

function quotePath(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

function step(id: string, title: string, action: DeploymentStepDraft['action'], result: DiscoveryResult, binding: DiscoveryResult['bindings'][number], hostKey: string | undefined, dependsOn: string[], requiredCapabilities: string[], inputs: Record<string, unknown>, riskLevel: DeploymentStepDraft['riskLevel']): DeploymentStepDraft {
  return {
    id,
    title,
    action,
    providerType: result.providerType,
    bindingKey: binding.key,
    target: { hostKey, bindingKey: binding.key },
    inputs,
    dependsOn,
    requiredCapabilities,
    riskLevel,
    idempotencyKey: id,
    rollbackHint: '使用 BACKUP 步骤产物恢复 cert/key/chain 后执行 Apache configtest，成功后再 graceful/reload',
  };
}

function draftBundle(result: DiscoveryResult, steps: DeploymentStepDraft[]): DeploymentDraftBundle {
  return { providerId: result.providerId, providerType: result.providerType, steps, summary: { hostCount: result.hosts.length, serviceCount: result.services.length, endpointCount: result.endpoints.length, bindingCount: result.bindings.length, stepCount: steps.length } };
}

function stableId(...parts: string[]): string {
  return `apache_${createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)}`;
}

import { createHash } from 'node:crypto';
import type { DeploymentDraftBundle, DeploymentStepDraft, DiscoveryExecutionContext, DiscoveryResult, ProviderDescriptor } from '../dto/providers.dto.js';
import type { Provider } from '../application/provider.interface.js';

export interface NginxServerBlock {
  serverNames: string[];
  listens: Array<{ port: number; ssl: boolean }>;
  sslCertificate?: string;
  sslCertificateKey?: string;
  includes: string[];
  diagnostics: string[];
}

export interface NginxCommandStrategy {
  testCommand: string;
  reloadCommand?: string;
  manualReload: boolean;
}

export class NginxProvider implements Provider {
  getDescriptor(): ProviderDescriptor {
    return {
      metadata: {
        id: 'nginx-provider',
        type: 'NGINX',
        displayName: 'NGINX Provider',
        description: '解析 NGINX 配置并生成证书部署步骤草案，不执行真实命令。',
        version: '0.1.0',
        capabilities: ['DISCOVERY', 'STEP_DRAFT_MAPPING', 'SNAPSHOT_PERSISTENCE'],
        supportedDiscoverySources: ['SSH', 'AGENT', 'MANUAL', 'GATEWAY'],
        supportedStages: ['HOST', 'SERVICE', 'ENDPOINT', 'BINDING'],
        tags: ['nginx', 'linux'],
        priority: 20,
      },
      matchRules: {
        providerType: 'NGINX',
        serviceNames: ['nginx'],
        configPathPatterns: ['nginx.conf', '/etc/nginx/'],
        endpointProtocols: ['HTTPS', 'TLS'],
        tags: ['nginx'],
      },
    };
  }

  discover(_context: DiscoveryExecutionContext, input: { source: DiscoveryResult['source']; scope: Record<string, string>; payload: Record<string, unknown> }): DiscoveryResult {
    const configText = String(input.payload.configText ?? '');
    const configPath = String(input.payload.configPath ?? '/etc/nginx/nginx.conf');
    const osType = String(input.payload.osType ?? input.scope.osType ?? 'LINUX').toUpperCase();
    const binaryPath = String(input.payload.binaryPath ?? (osType === 'WINDOWS' ? 'nginx.exe' : 'nginx'));
    const commandStrategy = buildNginxCommandStrategy({
      osType,
      binaryPath,
      testCommand: input.payload.testCommand as string | undefined,
      reloadCommand: input.payload.reloadCommand as string | undefined,
      manualReload: input.payload.manualReload === true,
    });
    const hostname = String(input.scope.hostname ?? input.payload.hostname ?? 'nginx-host').toLowerCase();
    const blocks = parseNginxServerBlocks(configText);
    const hostKey = `host:${hostname}`;
    const serviceKey = `service:${hostname}:nginx`;
    const endpoints = [];
    const bindings = [];
    let index = 1;
    for (const block of blocks) {
      const names = block.serverNames.length ? block.serverNames : [`${hostname}`];
      const listen = block.listens.find((item) => item.ssl) ?? block.listens[0] ?? { port: 443, ssl: true };
      const endpointKey = `endpoint:${hostname}:${listen.port}:${index}`;
      const bindingKey = `binding:${hostname}:${listen.port}:${index}`;
      endpoints.push({
        key: endpointKey,
        serviceKey,
        protocol: listen.ssl ? 'HTTPS' : 'HTTP',
        hostName: names[0],
        port: listen.port,
        pathHint: configPath,
        status: 'ACTIVE',
        rawFacts: { serverNames: names, includes: block.includes },
      });
      bindings.push({
        key: bindingKey,
        endpointKey,
        bindingType: 'FILE_PATH',
        domainName: names[0],
        certificateRef: block.sslCertificate ? `file://${block.sslCertificate}` : undefined,
        privateKeyRef: block.sslCertificateKey ? `file://${block.sslCertificateKey}` : undefined,
        configPath,
        rawFacts: { diagnostics: block.diagnostics, serverNames: names, sslCertificate: block.sslCertificate },
      });
      index += 1;
    }
    return {
      providerId: 'nginx-provider',
      providerType: 'NGINX',
      source: input.source,
      discoveredAt: new Date().toISOString(),
      scope: input.scope,
      hosts: [{ key: hostKey, hostname, ipAddresses: [], osType, tags: ['nginx'] }],
      services: [{ key: serviceKey, hostKey, providerType: 'NGINX', serviceName: 'nginx', displayName: 'NGINX', configPath, installPath: binaryPath, status: 'ACTIVE', rawFacts: { serverBlockCount: blocks.length, commandStrategy } }],
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
        rawFacts: { projectedFrom: 'nginx-server-block' },
      })),
      rawPayload: { configPath, binaryPath, commandStrategy, diagnostics: blocks.flatMap((block) => block.diagnostics) },
    };
  }

  toDeploymentDraft(result: DiscoveryResult): DeploymentDraftBundle {
    const steps: DeploymentStepDraft[] = [];
    for (const binding of result.bindings) {
      const endpoint = result.endpoints.find((item) => item.key === binding.endpointKey);
      const service = endpoint ? result.services.find((item) => item.key === endpoint.serviceKey) : undefined;
      const commandStrategy = service?.rawFacts?.commandStrategy as NginxCommandStrategy | undefined;
      const ids = ['backup', 'upload-cert', 'upload-key', 'configtest', 'reload', 'verify'].map((name) => stableId(result.providerId, binding.key, name));
      steps.push(step(ids[0]!, '备份 NGINX 证书材料', 'BACKUP', result, binding, service?.hostKey, [], ['ssh.connect', 'file.backup', 'file.read'], { certPath: binding.certificateRef, keyPath: binding.privateKeyRef, backupManifestRef: `backup://${binding.key}` }, 'medium'));
      steps.push(step(ids[1]!, '上传 NGINX 证书', 'INSTALL_CERTIFICATE', result, binding, service?.hostKey, [ids[0]!], ['ssh.connect', 'file.write'], { certPath: binding.certificateRef, certificateSecretRef: 'secret://certificate/leaf#current' }, 'high'));
      steps.push(step(ids[2]!, '上传 NGINX 私钥', 'INSTALL_PRIVATE_KEY', result, binding, service?.hostKey, [ids[1]!], ['ssh.connect', 'file.write'], { keyPath: binding.privateKeyRef, privateKeySecretRef: 'secret://certificate/private-key#current' }, 'critical'));
      steps.push(step(ids[3]!, '执行 nginx -t', 'VALIDATE', result, binding, service?.hostKey, [ids[2]!], ['ssh.connect', 'process.exec', 'nginx.configtest'], { command: commandStrategy?.testCommand ?? 'nginx -t' }, 'medium'));
      if (commandStrategy?.manualReload) {
        steps.push(step(ids[4]!, '人工 Reload NGINX', 'RELOAD_SERVICE', result, binding, service?.hostKey, [ids[3]!], ['manual.reload'], { manualRequired: true, command: commandStrategy.reloadCommand }, 'high'));
      } else {
        steps.push(step(ids[4]!, 'Reload NGINX', 'RELOAD_SERVICE', result, binding, service?.hostKey, [ids[3]!], ['ssh.connect', 'process.exec', 'nginx.reload'], { command: commandStrategy?.reloadCommand ?? 'nginx -s reload' }, 'high'));
      }
      steps.push(step(ids[5]!, '验证远程 TLS', 'VERIFY_BINDING', result, binding, service?.hostKey, [ids[4]!], ['tls.remote_probe'], { domainName: binding.domainName, port: endpoint?.port ?? 443 }, 'medium'));
    }
    return { providerId: result.providerId, providerType: result.providerType, steps, summary: { hostCount: result.hosts.length, serviceCount: result.services.length, endpointCount: result.endpoints.length, bindingCount: result.bindings.length, stepCount: steps.length } };
  }

  toRollbackDraft(result: DiscoveryResult): DeploymentDraftBundle {
    const steps: DeploymentStepDraft[] = [];
    for (const binding of result.bindings) {
      const endpoint = result.endpoints.find((item) => item.key === binding.endpointKey);
      const service = endpoint ? result.services.find((item) => item.key === endpoint.serviceKey) : undefined;
      const commandStrategy = service?.rawFacts?.commandStrategy as NginxCommandStrategy | undefined;
      const ids = ['restore', 'configtest', 'reload', 'verify'].map((name) => stableId(result.providerId, binding.key, 'rollback', name));
      steps.push(step(ids[0]!, '恢复 NGINX 证书备份', 'ROLLBACK', result, binding, service?.hostKey, [], ['ssh.connect', 'file.rollback'], { backupManifestRef: `backup://${binding.key}` }, 'critical'));
      steps.push(step(ids[1]!, '回滚后执行 nginx -t', 'VALIDATE', result, binding, service?.hostKey, [ids[0]!], ['ssh.connect', 'process.exec', 'nginx.configtest'], { command: commandStrategy?.testCommand ?? 'nginx -t' }, 'medium'));
      steps.push(step(ids[2]!, '回滚后 Reload NGINX', 'RELOAD_SERVICE', result, binding, service?.hostKey, [ids[1]!], commandStrategy?.manualReload ? ['manual.reload'] : ['ssh.connect', 'process.exec', 'nginx.reload'], { command: commandStrategy?.reloadCommand ?? 'nginx -s reload', manualRequired: commandStrategy?.manualReload ?? false }, 'high'));
      steps.push(step(ids[3]!, '验证回滚后远程 TLS', 'VERIFY_BINDING', result, binding, service?.hostKey, [ids[2]!], ['tls.remote_probe'], { domainName: binding.domainName, port: endpoint?.port ?? 443, expected: 'previousFingerprint' }, 'medium'));
    }
    return { providerId: result.providerId, providerType: result.providerType, steps, summary: { hostCount: result.hosts.length, serviceCount: result.services.length, endpointCount: result.endpoints.length, bindingCount: result.bindings.length, stepCount: steps.length } };
  }
}

export function parseNginxServerBlocks(configText: string): NginxServerBlock[] {
  const blocks = extractServerBodies(configText);
  return blocks.map((body) => {
    const serverNames = [...body.matchAll(/server_name\s+([^;]+);/g)].flatMap((match) => match[1]!.split(/\s+/).map((item) => item.trim()).filter(Boolean));
    const listens = [...body.matchAll(/listen\s+([^;]+);/g)].map((match) => {
      const raw = match[1]!;
      const port = Number(raw.match(/(\d+)/)?.[1] ?? 80);
      return { port, ssl: /\bssl\b/.test(raw) || port === 443 };
    });
    const sslCertificate = normalizeNginxPath(body.match(/ssl_certificate\s+([^;]+);/)?.[1]?.trim());
    const sslCertificateKey = normalizeNginxPath(body.match(/ssl_certificate_key\s+([^;]+);/)?.[1]?.trim());
    const includes = [...body.matchAll(/include\s+([^;]+);/g)].map((match) => match[1]!.trim());
    const diagnostics = [];
    if (sslCertificate && !sslCertificateKey) diagnostics.push('缺少 ssl_certificate_key');
    if (!sslCertificate && sslCertificateKey) diagnostics.push('缺少 ssl_certificate');
    if (sslCertificate?.includes('$') || sslCertificateKey?.includes('$')) diagnostics.push('证书路径包含变量，不能自动部署');
    return { serverNames, listens, sslCertificate, sslCertificateKey, includes, diagnostics };
  });
}

export function buildNginxCommandStrategy(input: { osType: string; binaryPath: string; testCommand?: string; reloadCommand?: string; manualReload?: boolean }): NginxCommandStrategy {
  if (input.manualReload) return { testCommand: input.testCommand ?? `${quotePath(input.binaryPath)} -t`, reloadCommand: input.reloadCommand, manualReload: true };
  const binary = quotePath(input.binaryPath);
  return { testCommand: input.testCommand ?? `${binary} -t`, reloadCommand: input.reloadCommand ?? `${binary} -s reload`, manualReload: false };
}

function normalizeNginxPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const trimmed = path.replace(/\\\\/g, '/').trim();
  return trimmed || undefined;
}

function quotePath(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

function extractServerBodies(configText: string): string[] {
  const output: string[] = [];
  const pattern = /server\s*\{/g;
  for (const match of configText.matchAll(pattern)) {
    let depth = 1;
    let index = (match.index ?? 0) + match[0].length;
    const start = index;
    while (index < configText.length && depth > 0) {
      const char = configText[index++];
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
    }
    if (depth === 0) output.push(configText.slice(start, index - 1));
  }
  return output;
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
    rollbackHint: '使用 BACKUP 步骤产物恢复证书、私钥和链文件后执行 nginx -t && nginx -s reload',
  };
}

function stableId(...parts: string[]): string {
  return `nginx_${createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)}`;
}

import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { DeploymentDraftBundle, DeploymentStepDraft, DiscoveryExecutionContext, DiscoveryResult, ProviderDescriptor } from '../dto/providers.dto.js';
import type { Provider } from '../application/provider.interface.js';

export interface WindowsCertificate {
  storeLocation: string;
  storeName: string;
  thumbprint: string;
  subject: string;
  notAfter: string;
  hasPrivateKey: boolean;
}

export interface IisBinding {
  siteName: string;
  protocol: string;
  ip: string;
  port: number;
  hostHeader: string;
  certificateHash?: string;
  appPool?: string;
}

export interface WindowsCompatibilityPolicy {
  level: 'modern' | 'legacy' | 'obsolete';
  deploymentMode: 'full_agent' | 'winrm_smb_wmi' | 'script_package' | 'manual' | 'monitor_only';
  requiredCapabilities: string[];
  diagnostics: string[];
}

const baseCapabilities = [
  'windows.cert_store',
  'iis.binding',
  'windows.pfx.import',
  'windows.private_key_acl',
  'tls.remote_probe',
];

export class IISProvider implements Provider {
  getDescriptor(): ProviderDescriptor {
    return {
      metadata: {
        id: 'iis-provider',
        type: 'IIS',
        displayName: 'IIS Provider',
        description: '解析 Windows 证书存储和 IIS Binding fixture，生成可审计的部署步骤草案，不连接真实 Windows。',
        version: '0.1.0',
        capabilities: ['DISCOVERY', 'STEP_DRAFT_MAPPING', 'SNAPSHOT_PERSISTENCE'],
        supportedDiscoverySources: ['AGENT', 'MANUAL', 'GATEWAY'],
        supportedStages: ['HOST', 'SERVICE', 'ENDPOINT', 'BINDING'],
        tags: ['windows', 'iis', 'cert-store'],
        priority: 30,
      },
      matchRules: {
        providerType: 'IIS',
        serviceNames: ['iis', 'w3svc', 'world wide web publishing service'],
        endpointProtocols: ['HTTPS', 'TLS'],
        tags: ['windows', 'iis'],
      },
    };
  }

  discover(_context: DiscoveryExecutionContext, input: { source: DiscoveryResult['source']; scope: Record<string, string>; payload: Record<string, unknown> }): DiscoveryResult {
    rejectSensitivePayload(input.payload);
    const hostname = String(input.scope.hostname ?? input.payload.hostname ?? 'windows-iis-host').toLowerCase();
    const osVersion = String(input.payload.osVersion ?? input.scope.osVersion ?? 'Windows Server 2019');
    const compatibility = resolveWindowsCompatibility(osVersion, input.payload);
    const certificates = parseWindowsCertificates(String(input.payload.certStoreText ?? input.payload.certutilText ?? ''));
    const bindings = parseIisBindings(input.payload.iisBindings ?? input.payload.iisBindingText ?? '');
    const hostKey = `host:${hostname}`;
    const serviceKey = `service:${hostname}:iis`;

    return {
      providerId: 'iis-provider',
      providerType: 'IIS',
      source: input.source,
      discoveredAt: new Date().toISOString(),
      scope: input.scope,
      hosts: [{
        key: hostKey,
        hostname,
        ipAddresses: normalizeIpList(input.payload.ipAddresses),
        osType: 'WINDOWS',
        osName: 'Windows Server',
        osVersion,
        tags: ['windows', 'iis', compatibility.deploymentMode],
        rawFacts: { compatibility },
      }],
      services: [{
        key: serviceKey,
        hostKey,
        providerType: 'IIS',
        serviceName: 'iis',
        displayName: 'IIS',
        status: 'ACTIVE',
        rawFacts: {
          appPools: [...new Set(bindings.map((binding) => binding.appPool).filter(Boolean))],
          certificateStore: 'LocalMachine\\My',
          requiredCapabilities: compatibility.requiredCapabilities,
          compatibility,
        },
      }],
      endpoints: bindings.map((binding, index) => ({
        key: `endpoint:${hostname}:${binding.siteName}:${binding.port}:${index + 1}`,
        serviceKey,
        protocol: binding.protocol.toUpperCase() === 'HTTPS' ? 'HTTPS' : binding.protocol.toUpperCase(),
        hostName: binding.hostHeader || hostname,
        listenIp: binding.ip,
        port: binding.port,
        status: 'ACTIVE',
        rawFacts: { siteName: binding.siteName, appPool: binding.appPool },
      })),
      bindings: bindings.map((binding, index) => {
        const certificate = findCertificate(certificates, binding.certificateHash);
        return {
          key: `binding:${hostname}:${binding.siteName}:${binding.port}:${index + 1}`,
          endpointKey: `endpoint:${hostname}:${binding.siteName}:${binding.port}:${index + 1}`,
          bindingType: 'WINDOWS_CERT_STORE',
          domainName: binding.hostHeader || hostname,
          certificateRef: binding.certificateHash ? `certstore://LocalMachine/My/${normalizeThumbprint(binding.certificateHash)}` : undefined,
          privateKeyRef: certificate?.hasPrivateKey ? `certstore-private-key://LocalMachine/My/${certificate.thumbprint}` : undefined,
          configPath: 'IIS:\\Sites',
          rawFacts: { ...binding, certificate, certificateStore: 'LocalMachine\\My' },
        };
      }),
      serviceAssets: bindings.map((binding, index) => ({
        key: `service-asset:${hostname}:${binding.siteName}:${binding.hostHeader || hostname}:${binding.port}:${index + 1}`,
        serviceKey,
        endpointKey: `endpoint:${hostname}:${binding.siteName}:${binding.port}:${index + 1}`,
        address: (binding.hostHeader || hostname).toLowerCase(),
        addressType: 'DNS',
        port: binding.port,
        protocol: 'HTTPS',
        sniName: (binding.hostHeader || hostname).toLowerCase(),
        displayName: `${binding.siteName}:${binding.hostHeader || hostname}:${binding.port}`,
        status: 'ACTIVE',
        rawFacts: { projectedFrom: 'iis-binding', siteName: binding.siteName, bindingInformation: `${binding.ip}:${binding.port}:${binding.hostHeader}` },
      })),
      siteAssets: bindings.map((binding, index) => ({
        key: `site-asset:${hostname}:${binding.siteName}:${binding.ip}:${binding.port}:${binding.hostHeader || '_'}`.toLowerCase(),
        serviceKey,
        serviceAssetKey: `service-asset:${hostname}:${binding.siteName}:${binding.hostHeader || hostname}:${binding.port}:${index + 1}`,
        siteType: 'WEB_SITE',
        siteName: binding.siteName,
        siteKey: [hostname, 'IIS', binding.siteName, `${binding.ip}:${binding.port}:${binding.hostHeader}`].join(':').toLowerCase(),
        bindingInformation: `${binding.ip}:${binding.port}:${binding.hostHeader}`,
        hostHeader: (binding.hostHeader || hostname).toLowerCase(),
        listenIp: binding.ip,
        port: binding.port,
        protocol: 'HTTPS',
        configPath: 'IIS:\\Sites',
        runtimeStatus: 'Started',
        status: 'ACTIVE',
        rawFacts: { appPool: binding.appPool, certificateHash: binding.certificateHash, siteName: binding.siteName },
      })),
      rawPayload: {
        parser: 'fixture-only',
        certificateCount: certificates.length,
        bindingCount: bindings.length,
        certificates,
        compatibility,
        diagnostics: [...compatibility.diagnostics],
      },
    };
  }

  toDeploymentDraft(result: DiscoveryResult): DeploymentDraftBundle {
    const steps: DeploymentStepDraft[] = [];
    const compatibility = result.hosts[0]?.rawFacts?.compatibility as WindowsCompatibilityPolicy | undefined;
    for (const binding of result.bindings) {
      const endpoint = result.endpoints.find((item) => item.key === binding.endpointKey);
      const service = endpoint ? result.services.find((item) => item.key === endpoint.serviceKey) : undefined;
      const mode = compatibility?.deploymentMode ?? 'winrm_smb_wmi';
      const ids = ['backup', 'import-pfx', 'set-acl', 'update-binding', 'verify'].map((name) => stableId(result.providerId, binding.key, name));
      const manual = mode === 'script_package' || mode === 'manual' || mode === 'monitor_only';
      steps.push(step(ids[0]!, '备份 IIS Binding 快照', 'BACKUP', result, binding, service?.key, endpoint?.key, service?.hostKey, [], capabilitiesFor(mode, ['iis.binding']), { snapshotRef: `backup://${binding.key}/iis-binding`, siteName: binding.rawFacts?.siteName, binding: binding.rawFacts, executionMode: mode }, manual ? 'medium' : 'high', rollbackHintFor('backup', mode)));
      steps.push(step(ids[1]!, '导入 PFX 到 LocalMachine\\My', 'INSTALL_CERTIFICATE', result, binding, service?.key, endpoint?.key, service?.hostKey, [ids[0]!], capabilitiesFor(mode, ['windows.cert_store', 'windows.pfx.import']), { storeLocation: 'LocalMachine', storeName: 'My', pfxSecretRef: 'secret://certificate/pfx#next', targetThumbprintRef: `runtime://${binding.key}/new-thumbprint`, executionMode: mode }, 'critical', rollbackHintFor('import', mode)));
      steps.push(step(ids[2]!, '设置 IIS 应用池私钥读取 ACL', 'INSTALL_PRIVATE_KEY', result, binding, service?.key, endpoint?.key, service?.hostKey, [ids[1]!], capabilitiesFor(mode, ['windows.private_key_acl', 'iis.binding']), { appPool: binding.rawFacts?.appPool, identityHint: appPoolIdentity(binding.rawFacts?.appPool), thumbprintRef: `runtime://${binding.key}/new-thumbprint`, executionMode: mode }, 'critical', rollbackHintFor('acl', mode)));
      steps.push(step(ids[3]!, '更新 IIS HTTPS Binding 证书', 'RELOAD_SERVICE', result, binding, service?.key, endpoint?.key, service?.hostKey, [ids[2]!], capabilitiesFor(mode, ['iis.binding', 'windows.cert_store']), { siteName: binding.rawFacts?.siteName, protocol: endpoint?.protocol, ip: binding.rawFacts?.ip, port: endpoint?.port, hostHeader: binding.domainName, certificateHashRef: `runtime://${binding.key}/new-thumbprint`, executionMode: mode }, 'critical', rollbackHintFor('binding', mode)));
      steps.push(step(ids[4]!, '验证远程 TLS 证书', 'VERIFY_BINDING', result, binding, service?.key, endpoint?.key, service?.hostKey, [ids[3]!], capabilitiesFor(mode, ['tls.remote_probe']), { domainName: binding.domainName, port: endpoint?.port ?? 443, expectedThumbprintRef: `runtime://${binding.key}/new-thumbprint`, executionMode: mode }, manual ? 'medium' : 'high', rollbackHintFor('verify', mode)));
    }
    return { providerId: result.providerId, providerType: result.providerType, steps, summary: { hostCount: result.hosts.length, serviceCount: result.services.length, endpointCount: result.endpoints.length, bindingCount: result.bindings.length, stepCount: steps.length } };
  }

  toRollbackDraft(result: DiscoveryResult): DeploymentDraftBundle {
    const steps = result.bindings.map((binding) => step(stableId(result.providerId, binding.key, 'rollback'), '恢复 IIS Binding 快照', 'ROLLBACK', result, binding, undefined, binding.endpointKey, undefined, [], ['iis.binding', 'windows.cert_store'], { snapshotRef: `backup://${binding.key}/iis-binding` }, 'critical', '恢复备份的 certificateHash 和 SNI/hostHeader 后再次执行 TLS 探测。'));
    return { providerId: result.providerId, providerType: result.providerType, steps, summary: { hostCount: result.hosts.length, serviceCount: result.services.length, endpointCount: result.endpoints.length, bindingCount: result.bindings.length, stepCount: steps.length } };
  }
}

export const WindowsCertStoreProvider = IISProvider;

export function parseWindowsCertificates(text: string): WindowsCertificate[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const json = tryParseJson(trimmed);
  if (Array.isArray(json)) return json.map(normalizeCertificate).filter(Boolean) as WindowsCertificate[];
  const chunks = splitCertutilBlocks(trimmed);
  return chunks.map(parseCertificateBlock).filter(Boolean) as WindowsCertificate[];
}

export function parseIisBindings(input: unknown): IisBinding[] {
  if (Array.isArray(input)) return input.map(normalizeBinding).filter(Boolean) as IisBinding[];
  const text = String(input ?? '').trim();
  if (!text) return [];
  const json = tryParseJson(text);
  if (Array.isArray(json)) return json.map(normalizeBinding).filter(Boolean) as IisBinding[];
  return text.split(/\r?\n/).map(parseAppcmdLine).filter(Boolean) as IisBinding[];
}

export function resolveWindowsCompatibility(osVersion: string, payload: Record<string, unknown> = {}): WindowsCompatibilityPolicy {
  void osVersion;
  const level = normalizeCompatibilityLevel(payload.compatibilityLevel);
  const deploymentMode = normalizeDeploymentMode(payload.resolvedDeploymentMode ?? payload.remoteStrategy);
  return {
    level,
    deploymentMode,
    requiredCapabilities: capabilitiesFor(deploymentMode, baseCapabilities),
    diagnostics: Array.isArray(payload.compatibilityDiagnostics) ? payload.compatibilityDiagnostics.map(String) : [],
  };
}

function normalizeCompatibilityLevel(value: unknown): WindowsCompatibilityPolicy['level'] {
  return value === 'legacy' || value === 'obsolete' ? value : 'modern';
}

function normalizeDeploymentMode(value: unknown): WindowsCompatibilityPolicy['deploymentMode'] {
  return value === 'winrm_smb_wmi' || value === 'script_package' || value === 'manual' || value === 'monitor_only' ? value : 'full_agent';
}

function parseCertificateBlock(block: string): WindowsCertificate | undefined {
  const thumbprint = pickValue(block, [/Thumbprint\s*[:=]\s*([A-Fa-f0-9 ]{20,})/, /Cert Hash\(sha1\)\s*:\s*([A-Fa-f0-9 ]{20,})/]);
  if (!thumbprint) return undefined;
  return {
    storeLocation: 'LocalMachine',
    storeName: 'My',
    thumbprint: normalizeThumbprint(thumbprint),
    subject: pickValue(block, [/Subject\s*[:=]\s*(.+)/, /Subject:\s*(.+)/]) ?? '',
    notAfter: normalizeDate(pickValue(block, [/NotAfter\s*[:=]\s*(.+)/, /NotAfter:\s*(.+)/, /NotAfter\s+(.+)/]) ?? ''),
    hasPrivateKey: /HasPrivateKey\s*[:=]\s*True|Private key is NOT exportable|Key Container/i.test(block) && !/HasPrivateKey\s*[:=]\s*False/i.test(block),
  };
}

function normalizeCertificate(raw: unknown): WindowsCertificate | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Record<string, unknown>;
  const thumbprint = normalizeThumbprint(String(item.thumbprint ?? item.Thumbprint ?? item.certificateHash ?? item.CertificateHash ?? ''));
  if (!thumbprint) return undefined;
  return {
    storeLocation: String(item.storeLocation ?? item.StoreLocation ?? 'LocalMachine'),
    storeName: String(item.storeName ?? item.StoreName ?? 'My'),
    thumbprint,
    subject: String(item.subject ?? item.Subject ?? ''),
    notAfter: normalizeDate(String(item.notAfter ?? item.NotAfter ?? '')),
    hasPrivateKey: Boolean(item.hasPrivateKey ?? item.HasPrivateKey),
  };
}

function normalizeBinding(raw: unknown): IisBinding | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Record<string, unknown>;
  const bindingInformation = String(item.bindingInformation ?? item.BindingInformation ?? '');
  const parsed = parseBindingInformation(bindingInformation);
  const siteName = String(item.siteName ?? item.SiteName ?? item.name ?? item.Name ?? '').trim();
  const protocol = String(item.protocol ?? item.Protocol ?? 'https').toLowerCase();
  if (!siteName || protocol !== 'https') return undefined;
  return {
    siteName,
    protocol,
    ip: String(item.ip ?? item.IP ?? parsed.ip),
    port: Number(item.port ?? item.Port ?? parsed.port),
    hostHeader: String(item.hostHeader ?? item.HostHeader ?? parsed.hostHeader),
    certificateHash: normalizeThumbprint(String(item.certificateHash ?? item.CertificateHash ?? item.sslThumbprint ?? '')) || undefined,
    appPool: String(item.appPool ?? item.applicationPool ?? item.ApplicationPool ?? '').trim() || undefined,
  };
}

function parseAppcmdLine(line: string): IisBinding | undefined {
  const siteName = line.match(/SITE\s+"([^"]+)"/i)?.[1] ?? line.match(/siteName[:=]"?([^"\s]+)/i)?.[1];
  const protocol = line.match(/protocol[:=]"?([^",\s]+)/i)?.[1] ?? line.match(/\bhttps\/([^,\s]+)/i)?.[0]?.split('/')[0];
  const bindingInformation = line.match(/bindingInformation[:=]"?([^",\]]+)/i)?.[1] ?? line.match(/\bhttps\/([^,\s]+)/i)?.[1];
  const certificateHash = line.match(/certificateHash[:=]"?([A-Fa-f0-9 ]{20,})/i)?.[1] ?? line.match(/sslThumbprint[:=]"?([A-Fa-f0-9 ]{20,})/i)?.[1];
  const appPool = line.match(/applicationPool[:=]"?([^",\]]+)/i)?.[1] ?? line.match(/appPool[:=]"?([^",\]]+)/i)?.[1];
  if (!siteName || !protocol || protocol.toLowerCase() !== 'https') return undefined;
  const parsed = parseBindingInformation(bindingInformation ?? '');
  return { siteName, protocol: 'https', ip: parsed.ip, port: parsed.port, hostHeader: parsed.hostHeader, certificateHash: certificateHash ? normalizeThumbprint(certificateHash) : undefined, appPool };
}

function parseBindingInformation(value: string): { ip: string; port: number; hostHeader: string } {
  const [ip = '*', port = '443', hostHeader = ''] = value.split(':');
  return { ip: ip || '*', port: Number(port || 443), hostHeader };
}

function step(id: string, title: string, action: DeploymentStepDraft['action'], result: DiscoveryResult, binding: DiscoveryResult['bindings'][number], serviceKey: string | undefined, endpointKey: string | undefined, hostKey: string | undefined, dependsOn: string[], requiredCapabilities: string[], inputs: Record<string, unknown>, riskLevel: DeploymentStepDraft['riskLevel'], rollbackHint: string): DeploymentStepDraft {
  return {
    id,
    title,
    action,
    providerType: result.providerType,
    serviceKey,
    endpointKey,
    bindingKey: binding.key,
    target: { hostKey, serviceKey, endpointKey, bindingKey: binding.key },
    inputs,
    dependsOn,
    requiredCapabilities,
    riskLevel,
    idempotencyKey: id,
    rollbackHint,
  };
}

function capabilitiesFor(mode: WindowsCompatibilityPolicy['deploymentMode'], required: string[]): string[] {
  if (mode === 'full_agent') return [...required, 'full_agent'];
  if (mode === 'winrm_smb_wmi') return [...required, 'winrm.connect', 'smb.file_transfer', 'wmi.query'];
  if (mode === 'monitor_only') return [...required, 'monitor_only', 'manual.confirm'];
  return [...required, 'script_package', 'manual.confirm'];
}

function rollbackHintFor(stage: string, mode: WindowsCompatibilityPolicy['deploymentMode']): string {
  const prefix = mode === 'winrm_smb_wmi' || mode === 'full_agent' ? '失败时自动使用备份快照' : '失败时不要继续自动切换，交由脚本包/人工流程使用备份快照';
  const hints: Record<string, string> = {
    backup: '快照必须包含 siteName、bindingInformation、certificateHash、SNI 标志和应用池。',
    import: '导入失败不得进入 ACL 或 Binding 更新；必要时删除新导入证书。',
    acl: 'ACL 失败不得切换 Binding；保留旧 certificateHash。',
    binding: 'Binding 更新失败必须恢复旧 certificateHash 和 hostHeader。',
    verify: 'TLS 验证失败必须恢复旧 Binding 并重新探测远程证书。',
  };
  return `${prefix}回滚。${hints[stage] ?? ''}`;
}

function appPoolIdentity(appPool: unknown): string {
  const name = String(appPool ?? '').trim();
  return name ? `IIS AppPool\\${name}` : 'IIS AppPool\\<site-app-pool>';
}

function splitCertutilBlocks(text: string): string[] {
  if (/={5,}\s*Certificate\s+\d+\s*={5,}/i.test(text)) return text.split(/={5,}\s*Certificate\s+\d+\s*={5,}/i).filter((item) => item.trim());
  return text.split(/\n\s*\n/).filter((item) => item.trim());
}

function pickValue(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function findCertificate(certificates: WindowsCertificate[], hash: string | undefined): WindowsCertificate | undefined {
  const normalized = normalizeThumbprint(hash ?? '');
  return certificates.find((certificate) => certificate.thumbprint === normalized);
}

function normalizeThumbprint(value: string): string {
  return value.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
}

function normalizeDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function normalizeIpList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function rejectSensitivePayload(payload: Record<string, unknown>): void {
  scanSensitive(payload, []);
}

function scanSensitive(value: unknown, path: string[]): void {
  if (typeof value === 'string' && /-----BEGIN [A-Z ]*PRIVATE KEY-----|password=|token=|sk-[A-Za-z0-9]{20,}/i.test(value)) throw new AppError('VALIDATION_FAILED', 'IIS Provider fixture 包含疑似明文敏感信息', { fieldPath: path.join('.') });
  if (Array.isArray(value)) value.forEach((item, index) => scanSensitive(item, [...path, String(index)]));
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/password|passwd|secret|token|privateKey|pfxPassword/i.test(key)) throw new AppError('VALIDATION_FAILED', 'IIS Provider fixture 包含敏感字段名', { fieldPath: [...path, key].join('.') });
      scanSensitive(child, [...path, key]);
    }
  }
}

function stableId(...parts: string[]): string {
  return `iis_${createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)}`;
}

import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { DeploymentDraftBundle, DeploymentStepDraft, DiscoveryExecutionContext, DiscoveryResult, ProviderDescriptor } from '../dto/providers.dto.js';
import type { Provider } from '../application/provider.interface.js';

export interface TomcatConnector {
  index: number;
  port: number;
  protocol?: string;
  scheme?: string;
  sslEnabled: boolean;
  secure?: boolean;
  keystoreFile?: string;
  keystoreType: 'JKS' | 'PFX' | 'PKCS12' | 'UNKNOWN';
  keyAlias?: string;
  certificateKeystoreFile?: string;
  certificateKeystoreType?: 'JKS' | 'PFX' | 'PKCS12' | 'UNKNOWN';
  certificateKeyAlias?: string;
  truststoreFile?: string;
  hostName?: string;
  defaultSSLHostConfigName?: string;
  bindingType: 'KEYSTORE' | 'PFX' | 'JKS';
  sourceNodePath: string;
  rawAttributes: Record<string, string>;
  rawFacts: Record<string, unknown>;
  diagnostics: string[];
}

export interface TomcatServiceStrategy {
  serviceName: string;
  restartCommand?: string;
  reloadCommand?: string;
  manualRestart: boolean;
  mode: 'systemd' | 'windows-service' | 'custom' | 'manual';
}

export class TomcatProvider implements Provider {
  getDescriptor(): ProviderDescriptor {
    return {
      metadata: {
        id: 'tomcat-provider',
        type: 'TOMCAT',
        displayName: 'Tomcat Provider',
        description: '解析 Tomcat server.xml fixture，生成 keystore/alias 证书部署计划，不触碰真实 Tomcat。',
        version: '0.1.0',
        capabilities: ['DISCOVERY', 'STEP_DRAFT_MAPPING', 'SNAPSHOT_PERSISTENCE'],
        supportedDiscoverySources: ['SSH', 'AGENT', 'MANUAL', 'GATEWAY'],
        supportedStages: ['HOST', 'SERVICE', 'ENDPOINT', 'BINDING'],
        tags: ['tomcat', 'java', 'keystore', 'fixture-only'],
        priority: 22,
      },
      matchRules: {
        providerType: 'TOMCAT',
        serviceNames: ['tomcat', 'catalina'],
        configPathPatterns: ['server.xml', '/conf/server.xml', 'CATALINA_BASE'],
        endpointProtocols: ['HTTPS', 'TLS'],
        tags: ['tomcat', 'java'],
      },
    };
  }

  discover(_context: DiscoveryExecutionContext, input: { source: DiscoveryResult['source']; scope: Record<string, string>; payload: Record<string, unknown> }): DiscoveryResult {
    rejectSensitivePayload(input.payload);
    const serverXml = String(input.payload.serverXml ?? input.payload.configText ?? '');
    const hostname = String(input.scope.hostname ?? input.payload.hostname ?? 'tomcat-host').toLowerCase();
    const osType = String(input.payload.osType ?? input.scope.osType ?? 'LINUX').toUpperCase();
    const catalinaBase = optionalString(input.payload.catalinaBase) ?? optionalString(input.payload.catalinaHome) ?? '/opt/tomcat';
    const catalinaHome = optionalString(input.payload.catalinaHome) ?? catalinaBase;
    const configPath = optionalString(input.payload.configPath) ?? `${catalinaBase}/conf/server.xml`;
    const versionText = optionalString(input.payload.tomcatVersion) ?? optionalString(input.payload.version);
    const strategy = buildTomcatServiceStrategy({
      osType,
      serviceName: optionalString(input.payload.serviceName),
      restartCommand: optionalString(input.payload.restartCommand),
      reloadCommand: optionalString(input.payload.reloadCommand),
      manualRestart: input.payload.manualRestart === true,
    });
    const connectors = parseTomcatServerXml(serverXml);
    const deployableConnectors = connectors.filter((connector) => connector.sslEnabled);
    const reverseProxyHint = detectReverseProxy(connectors);
    const hostKey = `host:${hostname}`;
    const serviceKey = `service:${hostname}:tomcat`;

    return {
      providerId: 'tomcat-provider',
      providerType: 'TOMCAT',
      source: input.source,
      discoveredAt: new Date().toISOString(),
      scope: input.scope,
      hosts: [{
        key: hostKey,
        hostname,
        ipAddresses: normalizeIpList(input.payload.ipAddresses),
        osType,
        tags: ['tomcat', reverseProxyHint.mode],
        rawFacts: { reverseProxyHint },
      }],
      services: [{
        key: serviceKey,
        hostKey,
        providerType: 'TOMCAT',
        serviceName: strategy.serviceName,
        displayName: 'Apache Tomcat',
        versionText,
        installPath: catalinaHome,
        configPath,
        status: reverseProxyHint.mode === 'monitor_only' ? 'MONITOR_ONLY' : 'ACTIVE',
        rawFacts: {
          catalinaBase,
          catalinaHome,
          connectorCount: connectors.length,
          httpsConnectorCount: deployableConnectors.length,
          serviceStrategy: strategy,
          requiredCapabilities: requiredTomcatCapabilities(strategy),
          reverseProxyHint,
        },
      }],
      endpoints: connectors.map((connector) => ({
        key: endpointKey(hostname, connector),
        serviceKey,
        protocol: connector.sslEnabled ? 'HTTPS' : normalizeEndpointProtocol(connector.protocol),
        hostName: normalizeHostName(connector.hostName ?? connector.defaultSSLHostConfigName) ?? hostname,
        port: connector.port,
        pathHint: configPath,
        status: connector.sslEnabled ? 'ACTIVE' : 'MONITOR_ONLY',
        rawFacts: {
          connectorIndex: connector.index,
          scheme: connector.scheme,
          sslEnabled: connector.sslEnabled,
          sourceNodePath: connector.sourceNodePath,
          diagnostics: connector.diagnostics,
          reverseProxyMode: connector.sslEnabled ? undefined : reverseProxyHint.mode,
        },
      })),
      bindings: deployableConnectors.map((connector) => ({
        key: bindingKey(hostname, connector),
        endpointKey: endpointKey(hostname, connector),
        bindingType: connector.bindingType,
        domainName: normalizeHostName(connector.hostName ?? connector.defaultSSLHostConfigName) ?? hostname,
        certificateRef: keystoreRefFor(connector),
        configPath,
        rawFacts: {
          alias: connector.certificateKeyAlias ?? connector.keyAlias,
          keyAlias: connector.keyAlias,
          certificateKeyAlias: connector.certificateKeyAlias,
          keystoreFile: connector.keystoreFile,
          certificateKeystoreFile: connector.certificateKeystoreFile,
          keystoreType: connector.certificateKeystoreType ?? connector.keystoreType,
          truststoreFile: connector.truststoreFile,
          keystoreInspectionPlan: buildKeystoreInspectionPlan(connector),
          aliasPlan: buildAliasPlan(connector),
          sourceNodePath: connector.sourceNodePath,
          rawAttributes: connector.rawAttributes,
          diagnostics: connector.diagnostics,
          rawFacts: connector.rawFacts,
        },
      })),
      serviceAssets: deployableConnectors.map((connector) => ({
        key: `service-asset:${hostname}:${connector.port}:${connector.index}`,
        serviceKey,
        endpointKey: endpointKey(hostname, connector),
        address: normalizeHostName(connector.hostName ?? connector.defaultSSLHostConfigName) ?? hostname,
        addressType: 'DNS',
        port: connector.port,
        protocol: 'HTTPS',
        sniName: normalizeHostName(connector.hostName ?? connector.defaultSSLHostConfigName) ?? hostname,
        displayName: normalizeHostName(connector.hostName ?? connector.defaultSSLHostConfigName) ?? hostname,
        status: 'ACTIVE',
        rawFacts: { sourceNodePath: connector.sourceNodePath, bindingType: connector.bindingType },
      })),
      rawPayload: {
        parser: 'fixture-only',
        configPath,
        connectorCount: connectors.length,
        httpsConnectorCount: deployableConnectors.length,
        diagnostics: [...connectors.flatMap((item) => item.diagnostics), ...reverseProxyHint.diagnostics],
        reverseProxyHint,
      },
    };
  }

  toDeploymentDraft(result: DiscoveryResult): DeploymentDraftBundle {
    const steps: DeploymentStepDraft[] = [];
    const reverseProxyHint = result.hosts[0]?.rawFacts?.reverseProxyHint as { mode?: string } | undefined;
    if (reverseProxyHint?.mode === 'manual' || reverseProxyHint?.mode === 'proxy-managed' || reverseProxyHint?.mode === 'monitor_only') {
      return draftBundle(result, []);
    }

    for (const binding of result.bindings) {
      const endpoint = result.endpoints.find((item) => item.key === binding.endpointKey);
      const service = endpoint ? result.services.find((item) => item.key === endpoint.serviceKey) : undefined;
      const strategy = service?.rawFacts?.serviceStrategy as TomcatServiceStrategy | undefined;
      const ids = ['backup-keystore', 'install-keystore', 'update-connector', 'restart', 'verify'].map((name) => stableId(result.providerId, binding.key, name));
      const keystoreFile = binding.rawFacts?.certificateKeystoreFile ?? binding.rawFacts?.keystoreFile ?? binding.certificateRef;
      const keystoreType = String(binding.rawFacts?.keystoreType ?? binding.bindingType);
      steps.push(step(ids[0]!, '备份 Tomcat keystore', 'BACKUP', result, binding, service?.key, endpoint?.key, service?.hostKey, [], ['file.backup', 'file.read'], {
        keystoreRef: binding.certificateRef,
        keystorePath: keystoreFile,
        configPath: binding.configPath,
        backupManifestRef: `backup://${binding.key}/tomcat-keystore`,
      }, 'critical'));
      steps.push(step(ids[1]!, keystoreType === 'PFX' || keystoreType === 'PKCS12' ? '上传/导入 Tomcat PFX' : '上传/导入 Tomcat JKS keystore', 'INSTALL_CERTIFICATE', result, binding, service?.key, endpoint?.key, service?.hostKey, [ids[0]!], ['file.write', 'tomcat.keystore.plan'], {
        keystorePath: keystoreFile,
        targetFormat: normalizeKeystoreFormat(keystoreType),
        keystoreSecretRef: 'secret://certificate/keystore#next',
        storepassSecretRef: 'secret://tomcat/keystore-pass#target',
        alias: binding.rawFacts?.alias,
        aliasPlan: binding.rawFacts?.aliasPlan,
        fixtureOnly: true,
      }, 'critical'));
      steps.push(step(ids[2]!, '更新 Tomcat Connector/alias 计划', 'UPDATE_CONFIG', result, binding, service?.key, endpoint?.key, service?.hostKey, [ids[1]!], ['file.write', 'tomcat.server_xml.plan'], {
        configPath: binding.configPath,
        sourceNodePath: binding.rawFacts?.sourceNodePath,
        setAlias: binding.rawFacts?.alias ?? 'runtime://certificate/default-alias',
        preserveUnrelatedAttributes: true,
        fixtureOnly: true,
      }, 'high'));
      const restartCapabilities = strategy?.manualRestart ? ['manual.restart'] : ['process.exec', 'tomcat.restart'];
      steps.push(step(ids[3]!, strategy?.manualRestart ? '人工 Restart Tomcat' : 'Restart Tomcat 服务', 'RELOAD_SERVICE', result, binding, service?.key, endpoint?.key, service?.hostKey, [ids[2]!], restartCapabilities, {
        serviceName: strategy?.serviceName ?? service?.serviceName ?? 'tomcat',
        command: strategy?.restartCommand,
        mode: strategy?.mode ?? 'manual',
        reason: 'Tomcat keystore 通常不能可靠热加载，默认重启而不是假装 reload。',
      }, 'critical'));
      steps.push(step(ids[4]!, '宿主验证 Tomcat TLS 证书', 'VERIFY_BINDING', result, binding, service?.key, endpoint?.key, service?.hostKey, [ids[3]!], ['certificate.verify'], {
        domainName: binding.domainName,
        port: endpoint?.port ?? 443,
        expectedFingerprintRef: `runtime://${binding.key}/new-fingerprint`,
      }, 'high'));
    }
    return draftBundle(result, steps);
  }

  toRollbackDraft(result: DiscoveryResult): DeploymentDraftBundle {
    const steps: DeploymentStepDraft[] = [];
    for (const binding of result.bindings) {
      const endpoint = result.endpoints.find((item) => item.key === binding.endpointKey);
      const service = endpoint ? result.services.find((item) => item.key === endpoint.serviceKey) : undefined;
      const strategy = service?.rawFacts?.serviceStrategy as TomcatServiceStrategy | undefined;
      const ids = ['restore', 'restart', 'verify'].map((name) => stableId(result.providerId, binding.key, 'rollback', name));
      steps.push(step(ids[0]!, '恢复 Tomcat keystore/server.xml 备份', 'ROLLBACK', result, binding, service?.key, endpoint?.key, service?.hostKey, [], ['file.rollback'], { backupManifestRef: `backup://${binding.key}/tomcat-keystore`, restoreConfigPath: binding.configPath }, 'critical'));
      steps.push(step(ids[1]!, '回滚后 Restart Tomcat', 'RELOAD_SERVICE', result, binding, service?.key, endpoint?.key, service?.hostKey, [ids[0]!], strategy?.manualRestart ? ['manual.restart'] : ['process.exec', 'tomcat.restart'], { serviceName: strategy?.serviceName ?? 'tomcat', command: strategy?.restartCommand, manualRequired: strategy?.manualRestart ?? false }, 'critical'));
      steps.push(step(ids[2]!, '宿主验证回滚后 Tomcat TLS', 'VERIFY_BINDING', result, binding, service?.key, endpoint?.key, service?.hostKey, [ids[1]!], ['certificate.verify'], { domainName: binding.domainName, port: endpoint?.port ?? 443, expected: 'previousFingerprint' }, 'medium'));
    }
    return draftBundle(result, steps);
  }
}

export function parseTomcatServerXml(xml: string): TomcatConnector[] {
  const cleaned = stripXmlComments(xml);
  const output: TomcatConnector[] = [];
  let index = 1;
  for (const match of cleaned.matchAll(/<Connector\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Connector>)/gi)) {
    const attrs = parseXmlAttributes(match[1] ?? '');
    const body = match[2] ?? '';
    const sslHostConfigs = parseSslHostConfigs(body);
    if (sslHostConfigs.length === 0) {
      output.push(normalizeConnector({ attrs, index, sslHostConfig: undefined }));
      index += 1;
      continue;
    }
    for (const sslHostConfig of sslHostConfigs) {
      output.push(normalizeConnector({ attrs, index, sslHostConfig }));
      index += 1;
    }
  }
  return output;
}

export function buildTomcatServiceStrategy(input: { osType: string; serviceName?: string; restartCommand?: string; reloadCommand?: string; manualRestart?: boolean }): TomcatServiceStrategy {
  const serviceName = input.serviceName ?? 'tomcat';
  if (input.manualRestart) return { serviceName, restartCommand: input.restartCommand, reloadCommand: input.reloadCommand, manualRestart: true, mode: 'manual' };
  if (input.restartCommand) return { serviceName, restartCommand: input.restartCommand, reloadCommand: input.reloadCommand, manualRestart: false, mode: 'custom' };
  return { serviceName, restartCommand: undefined, reloadCommand: input.reloadCommand, manualRestart: true, mode: 'manual' };
}

export function requiredTomcatCapabilities(strategy: TomcatServiceStrategy): string[] {
  const restart = strategy.manualRestart ? ['manual.restart'] : ['process.exec', 'tomcat.restart'];
  return ['file.read', 'file.backup', 'file.write', 'tomcat.keystore.plan', 'tomcat.server_xml.plan', 'certificate.verify', ...restart];
}

function parseSslHostConfigs(body: string): Array<{ attrs: Record<string, string>; certificateAttrs?: Record<string, string> }> {
  const configs: Array<{ attrs: Record<string, string>; certificateAttrs?: Record<string, string> }> = [];
  for (const match of body.matchAll(/<SSLHostConfig\b([^>]*?)(?:\/>|>([\s\S]*?)<\/SSLHostConfig>)/gi)) {
    const attrs = parseXmlAttributes(match[1] ?? '');
    const configBody = match[2] ?? '';
    const certificates = [...configBody.matchAll(/<Certificate\b([^>]*?)(?:\/>|>[\s\S]*?<\/Certificate>)/gi)].map((item) => parseXmlAttributes(item[1] ?? ''));
    if (certificates.length === 0) configs.push({ attrs });
    for (const certificateAttrs of certificates) configs.push({ attrs, certificateAttrs });
  }
  return configs;
}

function normalizeConnector(input: { attrs: Record<string, string>; index: number; sslHostConfig?: { attrs: Record<string, string>; certificateAttrs?: Record<string, string> } }): TomcatConnector {
  const attrs = input.attrs;
  const sslAttrs = input.sslHostConfig?.attrs ?? {};
  const certAttrs = input.sslHostConfig?.certificateAttrs ?? {};
  const port = Number(attrs.port ?? 443);
  const protocol = attrs.protocol;
  const scheme = attrs.scheme;
  const keystoreFile = normalizePath(attrs.keystoreFile ?? sslAttrs.certificateKeystoreFile ?? sslAttrs.keystoreFile);
  const certificateKeystoreFile = normalizePath(certAttrs.certificateKeystoreFile ?? certAttrs.keystoreFile);
  const keyAlias = optionalString(attrs.keyAlias ?? sslAttrs.keyAlias ?? sslAttrs.certificateKeyAlias);
  const certificateKeyAlias = optionalString(certAttrs.certificateKeyAlias ?? certAttrs.keyAlias);
  const keystoreType = normalizeKeystoreType(attrs.keystoreType ?? sslAttrs.certificateKeystoreType ?? sslAttrs.keystoreType ?? keystoreFile);
  const certificateKeystoreType = certificateKeystoreFile ? normalizeKeystoreType(certAttrs.certificateKeystoreType ?? certAttrs.keystoreType ?? certificateKeystoreFile) : undefined;
  const sslEnabled = parseBoolean(attrs.SSLEnabled) || parseBoolean(attrs.sslEnabled) || scheme?.toLowerCase() === 'https' || Boolean(keystoreFile || certificateKeystoreFile || input.sslHostConfig);
  const diagnostics: string[] = [];
  const effectiveKeystore = certificateKeystoreFile ?? keystoreFile;
  const effectiveType = certificateKeystoreType ?? keystoreType;
  if (sslEnabled && !effectiveKeystore) diagnostics.push('HTTPS Connector 缺少 keystoreFile/certificateKeystoreFile，只能人工补充。');
  if (effectiveKeystore && hasVariable(effectiveKeystore)) diagnostics.push('keystore 路径包含变量，占位符按原样保留，自动部署前必须解析。');
  if (effectiveType === 'UNKNOWN') diagnostics.push('keystore 类型未知，部署计划只保留人工确认信息。');
  if (containsSensitiveAttribute(attrs) || containsSensitiveAttribute(sslAttrs) || containsSensitiveAttribute(certAttrs)) diagnostics.push('server.xml 包含密码类属性，解析结果已拒绝保留明文字段。');
  return {
    index: input.index,
    port,
    protocol,
    scheme,
    sslEnabled,
    secure: parseBoolean(attrs.secure),
    keystoreFile,
    keystoreType,
    keyAlias,
    certificateKeystoreFile,
    certificateKeystoreType,
    certificateKeyAlias,
    truststoreFile: normalizePath(attrs.truststoreFile ?? sslAttrs.truststoreFile),
    hostName: normalizeHostName(sslAttrs.hostName),
    defaultSSLHostConfigName: normalizeHostName(attrs.defaultSSLHostConfigName),
    bindingType: bindingTypeFor(effectiveType),
    sourceNodePath: input.sslHostConfig ? `/Server/Service/Connector[${input.index}]/SSLHostConfig/Certificate` : `/Server/Service/Connector[${input.index}]`,
    rawAttributes: redactSensitiveAttributes({ ...attrs, ...sslAttrs, ...certAttrs }),
    rawFacts: { connectorAttributes: redactSensitiveAttributes(attrs), sslHostConfigAttributes: redactSensitiveAttributes(sslAttrs), certificateAttributes: redactSensitiveAttributes(certAttrs) },
    diagnostics,
  };
}

function detectReverseProxy(connectors: TomcatConnector[]): { mode: 'automatic' | 'manual' | 'proxy-managed' | 'monitor_only'; diagnostics: string[] } {
  const hasHttps = connectors.some((connector) => connector.sslEnabled);
  if (hasHttps) return { mode: 'automatic', diagnostics: [] };
  const hasProxyishBackend = connectors.some((connector) => connector.scheme?.toLowerCase() === 'https' || connector.port === 8009 || /ajp/i.test(connector.protocol ?? ''));
  if (hasProxyishBackend) return { mode: 'proxy-managed', diagnostics: ['未发现 HTTPS Connector，但存在 AJP/代理后端特征，诊断为前置代理托管证书。'] };
  if (connectors.length > 0) return { mode: 'monitor_only', diagnostics: ['未发现 HTTPS Connector，仅生成 monitor_only 诊断，不生成 Tomcat 自动部署计划。'] };
  return { mode: 'manual', diagnostics: ['server.xml 中没有可解析 Connector，需要人工补充 Tomcat 或前置代理信息。'] };
}

function buildKeystoreInspectionPlan(connector: TomcatConnector): Record<string, unknown> {
  const keystorePath = connector.certificateKeystoreFile ?? connector.keystoreFile;
  return {
    mode: 'plan_only',
    fixtureOnly: true,
    keystorePath,
    keystoreType: normalizeKeystoreFormat(String(connector.certificateKeystoreType ?? connector.keystoreType)),
    passwordRefRequired: Boolean(keystorePath),
    selectedAlias: connector.certificateKeyAlias ?? connector.keyAlias,
    checks: ['alias_exists', 'certificate_chain_present', 'fingerprint_match_after_deploy'],
  };
}

function buildAliasPlan(connector: TomcatConnector): Record<string, unknown> {
  const selectedAlias = connector.certificateKeyAlias ?? connector.keyAlias;
  return {
    selectedAlias,
    strategy: selectedAlias ? 'use_configured_alias' : 'manual_or_single_private_key_entry',
    updateConnectorAttribute: connector.certificateKeystoreFile ? 'certificateKeyAlias' : 'keyAlias',
    preserveOtherAliases: true,
  };
}

function parseXmlAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[match[1]!] = decodeXml(match[2] ?? match[3] ?? '');
  return attrs;
}

function stripXmlComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

function decodeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function rejectSensitivePayload(payload: Record<string, unknown>): void {
  const sensitiveKeys = ['password', 'pass', 'secret', 'token', 'privatekey', 'keystorepass', 'keypass', 'certificatekeystorepassword'];
  const scan = (value: unknown, path: string[]): void => {
    const key = path[path.length - 1]?.replace(/[^a-z0-9]/gi, '').toLowerCase() ?? '';
    if (sensitiveKeys.some((item) => key.includes(item))) throw new AppError('VALIDATION_FAILED', 'Tomcat Provider fixture 不接受明文敏感字段', { fieldPath: path.join('.') });
    if (typeof value === 'string' && /-----BEGIN [A-Z ]*PRIVATE KEY-----|password=|token=|sk-[A-Za-z0-9]{20,}/i.test(value)) throw new AppError('VALIDATION_FAILED', 'Tomcat Provider fixture 不接受疑似明文敏感值', { fieldPath: path.join('.') });
    if (Array.isArray(value)) value.forEach((item, index) => scan(item, [...path, String(index)]));
    if (value && typeof value === 'object') for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) scan(child, [...path, childKey]);
  };
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'serverXml' || key === 'configText') continue;
    scan(value, [key]);
  }
}

function containsSensitiveAttribute(attrs: Record<string, string>): boolean {
  return Object.keys(attrs).some((key) => /pass(word)?|secret|token/i.test(key));
}

function redactSensitiveAttributes(attrs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(attrs).filter(([key]) => !/pass(word)?|secret|token/i.test(key)));
}

function normalizeKeystoreType(value: string | undefined): TomcatConnector['keystoreType'] {
  const normalized = String(value ?? '').toUpperCase();
  if (normalized.includes('PKCS12') || normalized.endsWith('.P12') || normalized.endsWith('.PFX')) return normalized.endsWith('.PFX') ? 'PFX' : 'PKCS12';
  if (normalized.includes('JKS') || normalized.endsWith('.JKS')) return 'JKS';
  return 'UNKNOWN';
}

function normalizeKeystoreFormat(value: string): 'JKS' | 'PFX' {
  const normalized = value.toUpperCase();
  return normalized === 'JKS' ? 'JKS' : 'PFX';
}

function bindingTypeFor(type: TomcatConnector['keystoreType'] | undefined): TomcatConnector['bindingType'] {
  if (type === 'JKS') return 'JKS';
  if (type === 'PFX' || type === 'PKCS12') return 'PFX';
  return 'KEYSTORE';
}

function normalizeEndpointProtocol(protocol: string | undefined): string {
  if (!protocol) return 'HTTP';
  if (/ajp/i.test(protocol)) return 'AJP';
  return protocol.toUpperCase().includes('HTTP') ? 'HTTP' : protocol.toUpperCase();
}

function keystoreRefFor(connector: TomcatConnector): string | undefined {
  const path = connector.certificateKeystoreFile ?? connector.keystoreFile;
  return path ? `keystore://${path}` : undefined;
}

function endpointKey(hostname: string, connector: TomcatConnector): string {
  return `endpoint:${hostname}:${connector.port}:${connector.index}`;
}

function bindingKey(hostname: string, connector: TomcatConnector): string {
  return `binding:${hostname}:${connector.port}:${connector.index}`;
}

function normalizePath(path: string | undefined): string | undefined {
  const trimmed = optionalString(path)?.replace(/\\\\/g, '/');
  return trimmed || undefined;
}

function normalizeHostName(hostName: string | undefined): string | undefined {
  const normalized = optionalString(hostName);
  if (!normalized || normalized === '_default_') return undefined;
  return normalized.toLowerCase();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseBoolean(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true';
}

function hasVariable(value: string): boolean {
  return /\$\{[^}]+}|%[A-Za-z_]+%/.test(value);
}

function normalizeIpList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function step(id: string, title: string, action: DeploymentStepDraft['action'], result: DiscoveryResult, binding: DiscoveryResult['bindings'][number], serviceKey: string | undefined, endpointKey: string | undefined, hostKey: string | undefined, dependsOn: string[], requiredCapabilities: string[], inputs: Record<string, unknown>, riskLevel: DeploymentStepDraft['riskLevel']): DeploymentStepDraft {
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
    rollbackHint: '使用 backup keystore/server.xml 恢复原文件和 alias，重启 Tomcat 后再次做 TLS 探测。',
  };
}

function draftBundle(result: DiscoveryResult, steps: DeploymentStepDraft[]): DeploymentDraftBundle {
  return { providerId: result.providerId, providerType: result.providerType, steps, summary: { hostCount: result.hosts.length, serviceCount: result.services.length, endpointCount: result.endpoints.length, bindingCount: result.bindings.length, stepCount: steps.length } };
}

function stableId(...parts: string[]): string {
  return `tomcat_${createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)}`;
}

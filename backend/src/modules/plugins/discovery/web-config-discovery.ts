/**
 * Web 配置事实解析器。
 *
 * Agent 只负责回传受控目录中的原始配置文本；这里按固定插件语法解析，
 * 不依赖进程名或监听端口猜测产品，也不会执行配置中的任何内容。
 */
export interface WebConfigDiscoveryResult {
  frameworks: Array<Record<string, unknown>>;
  sites: Array<Record<string, unknown>>;
}

export function discoverWebConfigs(files: readonly Record<string, unknown>[], fallbackAddress?: string): WebConfigDiscoveryResult {
  const frameworks: Array<Record<string, unknown>> = [];
  const sites: Array<Record<string, unknown>> = [];
  const seenFrameworks = new Set<string>();
  for (const file of files) {
    const path = text(file.path);
    const content = text(file.content);
    if (!path || !content) continue;
    const parser = parserFor(path, content);
    if (!parser) continue;
    const result = withSourceConfigPath(parser(content, fallbackAddress), path);
    for (const framework of result.frameworks) {
      const key = String(framework.frameworkType);
      if (seenFrameworks.has(key)) continue;
      seenFrameworks.add(key);
      frameworks.push(framework);
    }
    for (const site of result.sites) {
      const key = siteIdentity(site);
      const existingIndex = sites.findIndex((item) => siteIdentity(item) === key);
      if (existingIndex < 0) {
        sites.push(site);
        continue;
      }
      sites[existingIndex] = mergeSiteFacts(sites[existingIndex]!, site);
    }
  }
  return { frameworks, sites };
}

function withSourceConfigPath(result: WebConfigDiscoveryResult, path: string): WebConfigDiscoveryResult {
  const sourceConfigPath = normalizeConfigPath(path);
  return {
    ...result,
    sites: result.sites.map((site) => {
      const metadata = isRecord(site.metadata) ? site.metadata : {};
      const listeners = Array.isArray(metadata.listeners)
        ? metadata.listeners.map((listener) => {
          if (!isRecord(listener) || (!text(listener.certificatePath) && !text(listener.keystorePath) && !text(listener.certificateThumbprint) && !text(listener.bindingStorageKind))) return listener;
          return { ...listener, sourceConfigPath };
        })
        : metadata.listeners;
      return listeners === metadata.listeners ? site : { ...site, metadata: { ...metadata, listeners } };
    }),
  };
}

function siteIdentity(site: Record<string, unknown>): string {
  const addresses = Array.isArray(site.addresses)
    ? site.addresses.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const names = addresses.length ? addresses : [String(site.name ?? '')];
  return `${String(site.frameworkType ?? '')}:${[...new Set(names.map((name) => name.trim().toLowerCase()))].sort().join('|')}`;
}

function mergeSiteFacts(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
  const leftAddresses = Array.isArray(left.addresses) ? left.addresses : [];
  const rightAddresses = Array.isArray(right.addresses) ? right.addresses : [];
  const leftListeners = isRecord(left.metadata) && Array.isArray(left.metadata.listeners) ? left.metadata.listeners : [];
  const rightListeners = isRecord(right.metadata) && Array.isArray(right.metadata.listeners) ? right.metadata.listeners : [];
  const metadata = {
    ...(isRecord(left.metadata) ? left.metadata : {}),
    ...(isRecord(right.metadata) ? right.metadata : {}),
    listeners: [...leftListeners, ...rightListeners],
  };
  const preferRight = String(right.protocol ?? '').toUpperCase() === 'HTTPS' || String(left.protocol ?? '').toUpperCase() !== 'HTTPS';
  const preferred = preferRight ? right : left;
  return {
    ...left,
    ...right,
    port: preferred.port,
    protocol: preferred.protocol,
    addresses: [...new Set([...leftAddresses, ...rightAddresses].filter((item): item is string => typeof item === 'string'))],
    metadata,
  };
}

type Parser = (content: string, fallbackAddress?: string) => WebConfigDiscoveryResult;

function parserFor(path: string, content: string): Parser | undefined {
  const normalized = path.replaceAll('\\', '/').toLowerCase();
  const basename = normalized.split('/').at(-1) ?? normalized;
  const activeContent = stripHashComments(content).replace(/<!--[\s\S]*?-->/g, '');
  if (normalized.endsWith('/inetsrv/config/applicationhost.config') || /<configuration>\s*<configsections\b|<sites>\s*<site\b/i.test(activeContent)) return parseIis;
  if (basename === 'nginx.conf' || normalized.includes('/nginx/') || normalized.includes('/nginx-')) return parseNginx;
  if (basename === 'httpd.conf' || basename === 'apache2.conf' || basename.startsWith('httpd-') || normalized.includes('/apache') || normalized.includes('/sites-enabled/') || normalized.includes('/conf-enabled/')) return parseApache;
  if (basename === 'server.xml' && (normalized.includes('tomcat') || normalized.includes('catalina'))) return parseTomcat;
  if (/\bserver\s*\{|\bserver_name\s+/i.test(activeContent)) return parseNginx;
  if (/<VirtualHost\b|\bSSLCertificateFile\s+/i.test(activeContent)) return parseApache;
  if (/<Connector\b|<Context\b|<Host\b/i.test(activeContent)) return parseTomcat;
  return undefined;
}

function parseIis(content: string, fallbackAddress?: string): WebConfigDiscoveryResult {
  const activeContent = content.replace(/<!--[\s\S]*?-->/g, '');
  const sites: Array<Record<string, unknown>> = [];
  const sitePattern = /<site\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/site>)/gi;
  let matched: RegExpExecArray | null;
  while ((matched = sitePattern.exec(activeContent))) {
    const siteAttributes = attributes(matched[1] ?? '');
    const siteName = siteAttributes.name ?? fallbackAddress ?? 'Default Web Site';
    const body = matched[2] ?? '';
    const listeners: Array<Record<string, unknown>> = [];
    const addresses: string[] = [];
    for (const binding of body.matchAll(/<binding\b([^>]*?)(?:\/\s*>|>)/gi)) {
      const bindingAttributes = attributes(binding[1] ?? '');
      const protocol = String(bindingAttributes.protocol ?? 'http').toLowerCase() === 'https' ? 'HTTPS' : 'HTTP';
      const parts = String(bindingAttributes.bindingInformation ?? '').split(':');
      const port = parsePort(parts.length > 1 ? parts[1]! : '') ?? (protocol === 'HTTPS' ? 443 : 80);
      const host = parts.length > 2 ? parts.slice(2).join(':').trim() : '';
      if (host && host !== '*') addresses.push(host);
      const certificateHash = normalizeThumbprint(bindingAttributes.certificateHash);
      listeners.push({
        port,
        protocol,
        ...(protocol === 'HTTPS' ? { bindingStorageKind: 'WINDOWS_CERTIFICATE_STORE' } : {}),
        bindingInformation: bindingAttributes.bindingInformation ?? '',
        ...(host ? { host } : {}),
        ...(certificateHash ? { certificateThumbprint: certificateHash } : {}),
        ...(bindingAttributes.certificateStoreName ? { certificateStoreName: bindingAttributes.certificateStoreName } : {}),
        ...(bindingAttributes.certificateStoreLocation ? { certificateStoreLocation: bindingAttributes.certificateStoreLocation } : {}),
      });
    }
    const preferred = listeners.find((listener) => listener.protocol === 'HTTPS') ?? listeners[0];
    sites.push({
      frameworkType: 'web.iis',
      name: siteName,
      addresses: addresses.length ? [...new Set(addresses)] : [fallbackAddress ?? siteName],
      ...(preferred ? { port: preferred.port, protocol: preferred.protocol } : {}),
      metadata: { siteId: siteAttributes.id, listeners },
    });
  }
  return { frameworks: [{ frameworkType: 'web.iis', displayName: 'IIS' }], sites };
}

function parseNginx(content: string, fallbackAddress?: string): WebConfigDiscoveryResult {
  const activeContent = stripHashComments(content);
  const sites: Array<Record<string, unknown>> = [];
  const blocks = activeContent.match(/server\s*\{([\s\S]*?)\}/gi) ?? [];
  for (const block of blocks) {
    const body = block.replace(/^server\s*\{/, '').replace(/\}\s*$/, '');
    const names = words(body, /server_name\s+([^;]+);/i).flatMap((value) => value.split(/\s+/)).filter(Boolean);
    const listens = directiveValues(body, /listen\s+([^;]+);/gi);
    const certificate = match(body, /ssl_certificate\s+([^;]+);/i);
    const certificateKey = match(body, /ssl_certificate_key\s+([^;]+);/i);
    const siteNames = names.length ? names : [fallbackAddress ?? 'default'];
    const listenerValues = listens.length ? listens : ['80'];
    const listeners = listenerValues.map((listen) => {
      const port = parsePort(listen) ?? 80;
      const protocol = /ssl|443/.test(listen.toLowerCase()) ? 'HTTPS' : 'HTTP';
      return { port, protocol, ...(certificate ? { certificatePath: certificate } : {}), ...(certificateKey ? { certificateKeyPath: certificateKey } : {}) };
    });
    const preferred = listeners.find((listener) => listener.protocol === 'HTTPS') ?? listeners[0]!;
    sites.push({ frameworkType: 'web.nginx', name: siteNames[0], addresses: siteNames, port: preferred.port, protocol: preferred.protocol, metadata: { listeners } });
  }
  return { frameworks: [{ frameworkType: 'web.nginx', displayName: 'Nginx' }], sites };
}

function parseApache(content: string, fallbackAddress?: string): WebConfigDiscoveryResult {
  const activeContent = stripHashComments(content);
  const sites: Array<Record<string, unknown>> = [];
  const blocks = activeContent.match(/<VirtualHost\s+([^>]+)>([\s\S]*?)<\/VirtualHost>/gi) ?? [];
  for (const block of blocks) {
    const header = match(block, /<VirtualHost\s+([^>]+)>/i) ?? '*:80';
    const names = words(block, /ServerName\s+([^\s#]+)|ServerAlias\s+([^\s#]+)/gi);
    const certificate = match(block, /SSLCertificateFile\s+([^\s#]+)/i);
    const certificateKey = match(block, /SSLCertificateKeyFile\s+([^\s#]+)/i);
    const certificateChain = match(block, /SSLCertificateChainFile\s+([^\s#]+)/i);
    const siteNames = names.length ? names : [fallbackAddress ?? header];
    const endpoints = header.split(/\s+/).filter(Boolean);
    const listeners = (endpoints.length ? endpoints : ['*:80']).map((endpoint) => {
      const port = parsePort(endpoint) ?? 80;
      const protocol = /443|ssl/i.test(endpoint) || /SSLEngine\s+on/i.test(block) ? 'HTTPS' : 'HTTP';
      return { port, protocol, ...(certificate ? { certificatePath: certificate } : {}), ...(certificateKey ? { certificateKeyPath: certificateKey } : {}), ...(certificateChain ? { certificateChainPath: certificateChain } : {}) };
    });
    const preferred = listeners.find((listener) => listener.protocol === 'HTTPS') ?? listeners[0]!;
    sites.push({ frameworkType: 'web.apache', name: siteNames[0], addresses: siteNames, port: preferred.port, protocol: preferred.protocol, metadata: { listeners } });
  }
  // 没有 VirtualHost 时，httpd.conf 仍可能通过 Listen/ServerName 提供一个可管理站点。
  if (sites.length === 0) sites.push(parseApacheFallback(activeContent, fallbackAddress));
  return { frameworks: [{ frameworkType: 'web.apache', displayName: 'Apache' }], sites };
}

function parseApacheFallback(content: string, fallbackAddress?: string): Record<string, unknown> {
  const names = words(content, /ServerName\s+([^\s#]+)|ServerAlias\s+([^\s#]+)/gi);
  const siteNames = names.length ? names : [fallbackAddress ?? 'localhost'];
  const endpoints = directiveValues(content, /Listen\s+([^\n#]+)/gi)
    .map((value) => value.split(/\s+/)[0] ?? '')
    .filter(Boolean);
  const certificate = match(content, /SSLCertificateFile\s+([^\s#]+)/i);
  const certificateKey = match(content, /SSLCertificateKeyFile\s+([^\s#]+)/i);
  const certificateChain = match(content, /SSLCertificateChainFile\s+([^\s#]+)/i);
  const listeners = (endpoints.length ? endpoints : ['80']).map((endpoint) => {
    const port = parsePort(endpoint) ?? 80;
    const protocol = /443|ssl/i.test(endpoint) || /SSLEngine\s+on/i.test(content) ? 'HTTPS' : 'HTTP';
    return { port, protocol, ...(certificate ? { certificatePath: certificate } : {}), ...(certificateKey ? { certificateKeyPath: certificateKey } : {}), ...(certificateChain ? { certificateChainPath: certificateChain } : {}) };
  });
  const preferred = listeners.find((listener) => listener.protocol === 'HTTPS') ?? listeners[0]!;
  return { frameworkType: 'web.apache', name: siteNames[0], addresses: siteNames, port: preferred.port, protocol: preferred.protocol, metadata: { listeners } };
}

function parseTomcat(content: string, fallbackAddress?: string): WebConfigDiscoveryResult {
  // Tomcat 默认 server.xml 带有大量注释示例；注释中的 Connector 不能成为运行时站点。
  const activeContent = content.replace(/<!--[\s\S]*?-->/g, '');
  const sites: Array<Record<string, unknown>> = [];
  const connectorPattern = /<Connector\b([^>]*?)(?:\/>|>)([\s\S]*?<\/Connector>)?/gi;
  let connector: RegExpExecArray | null;
  while ((connector = connectorPattern.exec(activeContent))) {
    const attrs = attributes(connector[1] ?? '');
    const connectorBody = connector[2] ?? '';
    const port = Number(attrs.port ?? 8080);
    const certificateAttributes = [...connectorBody.matchAll(/<Certificate\b([^>]*?)(?:\/>|>)/gi)]
      .map((item) => attributes(item[1] ?? '')).find(Boolean) ?? {};
    const certificatePath = normalizeConfigPathValue(
      certificateAttributes.certificateFile ?? attrs.certificateFile,
    );
    const keystorePath = normalizeConfigPathValue(
      certificateAttributes.certificateKeystoreFile
      ?? certificateAttributes.keystoreFile
      ?? attrs.certificateKeystoreFile
      ?? attrs.keystoreFile,
    );
    const keystoreType = normalizeKeystoreType(
      certificateAttributes.certificateKeystoreType
      ?? certificateAttributes.keystoreType
      ?? attrs.certificateKeystoreType
      ?? attrs.keystoreType,
      keystorePath,
    );
    const keyAlias = text(
      certificateAttributes.certificateKeyAlias
      ?? certificateAttributes.keyAlias
      ?? attrs.certificateKeyAlias
      ?? attrs.keyAlias,
    );
    const protocol = /ssl|https/i.test(String(attrs.protocol ?? '')) || attrs.scheme === 'https' || Boolean(certificatePath || keystorePath) ? 'HTTPS' : 'HTTP';
    const hosts = [...activeContent.matchAll(/<Host\b([^>]*?)(?:\/>|>)/gi)].map((item) => attributes(item[1] ?? '').name).filter(Boolean);
    const names = hosts.length ? hosts : [fallbackAddress ?? 'localhost'];
    const certificateKeyPath = normalizeConfigPathValue(attrs.certificateKeyFile ?? certificateAttributes.certificateKeyFile);
    const certificateChainPath = normalizeConfigPathValue(attrs.certificateChainFile ?? certificateAttributes.certificateChainFile);
    for (const name of names) sites.push({
      frameworkType: 'app.tomcat',
      name,
      addresses: [name],
      port,
      protocol,
      metadata: {
        connectorProtocol: attrs.protocol,
        ...(keystorePath ? { keystoreFile: keystorePath } : {}),
        listeners: [{
          port,
          protocol,
          ...(certificatePath ? { certificatePath } : {}),
          ...(certificateKeyPath ? { certificateKeyPath } : {}),
          ...(certificateChainPath ? { certificateChainPath } : {}),
          ...(keystorePath ? { keystorePath } : {}),
          ...(keystoreType ? { keystoreType } : {}),
          ...(keyAlias ? { keyAlias } : {}),
        }],
      },
    });
  }
  const contexts = [...activeContent.matchAll(/<Context\b([^>]*?)(?:\/>|>)/gi)].map((item) => attributes(item[1] ?? '').path).filter(Boolean);
  for (const context of contexts) sites.push({ frameworkType: 'app.tomcat', name: context, addresses: [fallbackAddress ?? 'localhost'], metadata: { contextPath: context } });
  return { frameworks: [{ frameworkType: 'app.tomcat', displayName: 'Tomcat' }], sites };
}

function attributes(value: string): Record<string, string> {
  return Object.fromEntries([...value.matchAll(/([A-Za-z][\w-]*)\s*=\s*["']([^"']*)["']/g)].map((item) => [item[1]!, item[2]!].filter(Boolean) as [string, string]));
}

function words(value: string, pattern: RegExp): string[] {
  const global = pattern.flags.includes('g') ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
  return [...value.matchAll(global)].flatMap((item) => item.slice(1).filter((part): part is string => Boolean(part))).flatMap((item) => item.trim().split(/\s+/));
}

function directiveValues(value: string, pattern: RegExp): string[] {
  const global = pattern.flags.includes('g') ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
  return [...value.matchAll(global)]
    .map((item) => item[1]?.trim())
    .filter((item): item is string => Boolean(item));
}

function match(value: string, pattern: RegExp): string | undefined {
  const matched = pattern.exec(value)?.[1]?.trim();
  if (!matched) return undefined;
  return unquoteConfigValue(matched);
}

function unquoteConfigValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const first = trimmed.at(0);
  const last = trimmed.at(-1);
  if ((first === '"' || first === "'") && first === last && trimmed.length >= 2) {
    return normalizeConfigPathValue(trimmed.slice(1, -1));
  }
  return normalizeConfigPathValue(trimmed.replace(/^["']+|["']+$/g, ''));
}

function normalizeConfigPathValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replaceAll('\\', '/');
  return normalized || undefined;
}

function normalizeKeystoreType(value: string | undefined, path: string | undefined): 'JKS' | 'PKCS12' | 'PEM' | 'UNKNOWN' | undefined {
  const normalized = value?.trim().toUpperCase().replaceAll('-', '');
  if (normalized === 'JKS') return 'JKS';
  if (normalized === 'PKCS12' || normalized === 'PKCS#12') return 'PKCS12';
  if (normalized === 'PEM') return 'PEM';
  const extension = path?.toLowerCase().match(/\.([^.\\/]+)$/)?.[1];
  if (extension === 'p12' || extension === 'pfx') return 'PKCS12';
  if (extension === 'jks' || extension === 'keystore') return 'JKS';
  return value || path ? 'UNKNOWN' : undefined;
}

function normalizeConfigPath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/{2,}/g, '/');
}

function stripHashComments(content: string): string {
  let quote: '"' | "'" | undefined;
  let inComment = false;
  let result = '';
  for (const character of content) {
    if (inComment) {
      if (character === '\n' || character === '\r') {
        inComment = false;
        result += character;
      }
      continue;
    }
    if (quote) {
      result += character;
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      result += character;
      continue;
    }
    if (character === '#') {
      inComment = true;
      continue;
    }
    result += character;
  }
  return result;
}

function parsePort(value: string): number | undefined {
  const port = Number(value.match(/:(\d{1,5})/)?.[1] ?? value.match(/\b(\d{1,5})\b/)?.[1]);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

function normalizeThumbprint(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const compact = raw.replace(/\s+/g, '');
  if (/^[A-Fa-f0-9]+$/.test(compact) && compact.length >= 8 && compact.length % 2 === 0) return compact.toUpperCase();
  // IIS applicationHost.config 在部分版本中把 SHA-1 Binding Hash 写成 Base64。
  // 这里只接受解码后长度为 SHA-1 的 20 字节，避免把普通文本误当指纹。
  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 20) return decoded.toString('hex').toUpperCase();
  } catch {
    // 非 Base64 内容按无证书指纹处理，站点本身仍保留。
  }
  return undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

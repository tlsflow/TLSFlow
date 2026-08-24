import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { AppError } from '../../common/errors/app-error.js';

/**
 * 网关 TCP 中继（Gateway Relay）客户端
 *
 * 与网关 Agent 的 gcac.gateway-relay/v1 握手协议对齐：
 *   1. 网关下发随机 challenge（hex）；
 *   2. 客户端用控制面私有密钥对 challenge + ":" + host + ":" + port 做 ed25519 签名；
 *   3. 网关验证通过后返回 {"ok":true}，随后双向透传原始字节。
 *
 * 该模块只负责“私有密钥认证 + TCP 转发”，不解析任何应用协议。
 */

export const GATEWAY_RELAY_PROTOCOL = 'gcac.gateway-relay/v1';
export const GATEWAY_RELAY_DEFAULT_PORT = 18934;
export const GATEWAY_RELAY_IDENTITY_FILE = 'identity.json';

export interface GatewayRelayIdentity {
  privateKeyPem: string;
  publicKeyHex: string;
  createdAt: string;
}

export interface GatewayRelayTunnel {
  socket: net.Socket;
  sessionId: string;
  targetHost: string;
  targetPort: number;
}

export interface OpenGatewayRelayTunnelOptions {
  gatewayHost: string;
  gatewayPort?: number;
  targetHost: string;
  targetPort: number;
  identity: GatewayRelayIdentity;
  /** 控制面已签发的窄目标策略；缺少任一项都必须失败关闭。 */
  allowedTargets: readonly string[];
  allowedPorts: readonly number[];
  authorizationExpiresAt: string;
  connectTimeoutMs?: number;
  handshakeTimeoutMs?: number;
}

const MAX_FRAME_BYTES = 16 * 1024;

export function gatewayRelayIdentityDir(overrides?: string): string {
  return overrides
    ?? process.env.GCAC_GATEWAY_RELAY_IDENTITY_DIR
    ?? path.join(process.cwd(), '.gcac-data', 'gateway-relay');
}

/** 读取或创建控制面中继身份；私钥仅存在于控制面侧，公钥注入网关 Agent 配置。 */
export async function loadOrCreateGatewayRelayIdentity(overrides?: string): Promise<GatewayRelayIdentity> {
  const identityPath = path.join(gatewayRelayIdentityDir(overrides), GATEWAY_RELAY_IDENTITY_FILE);
  try {
    const raw = await fs.readFile(identityPath, 'utf8');
    const parsed = JSON.parse(raw) as GatewayRelayIdentity;
    if (typeof parsed.privateKeyPem === 'string' && parsed.privateKeyPem.trim()
      && typeof parsed.publicKeyHex === 'string' && parsed.publicKeyHex.trim()) {
      return parsed;
    }
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyHex = exportRawEd25519PublicKeyHex(publicKey);
  const identity: GatewayRelayIdentity = {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyHex,
    createdAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(identityPath), { recursive: true });
  await fs.writeFile(identityPath, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  return identity;
}

/** ed25519 SPKI DER 的最后 32 字节即原始公钥。 */
export function exportRawEd25519PublicKeyHex(publicKey: { export(options: { type: 'spki'; format: 'der' }): Buffer }): string {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  if (der.length < 32) throw new AppError('SYSTEM_INTERNAL_ERROR', 'ed25519 公钥导出异常');
  return der.subarray(der.length - 32).toString('hex');
}

/** 打开一条经过网关的 TCP 隧道：完成私有密钥握手后返回原始 socket。 */
export function openGatewayRelayTunnel(options: OpenGatewayRelayTunnelOptions): Promise<GatewayRelayTunnel> {
  const { gatewayHost, gatewayPort = GATEWAY_RELAY_DEFAULT_PORT, targetHost, targetPort, identity } = options;
  if (!gatewayHost || !targetHost) {
    return Promise.reject(new AppError('VALIDATION_FAILED', '网关中继需要 gatewayHost 与 targetHost'));
  }
  const normalizedHost = normalizeRelayHost(targetHost);
  try {
    assertGatewayRelayTargetPolicy(normalizedHost, targetPort, options);
  } catch (error) {
    return Promise.reject(error);
  }
  const privateKey = createPrivateKey(identity.privateKeyPem);
  const connectTimeoutMs = options.connectTimeoutMs ?? 8_000;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 10_000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = Buffer.alloc(0);
    let phase: 'hello' | 'response' | 'tunnel' = 'hello';
    let helloSession = '';

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    const socket = net.connect({ host: gatewayHost, port: gatewayPort, timeout: connectTimeoutMs }, () => {
      // 连接建立后由数据驱动握手。
    });
    socket.setTimeout(connectTimeoutMs, () => {
      fail(new AppError('EXECUTION_TARGET_UNAVAILABLE', `连接网关中继超时 ${gatewayHost}:${gatewayPort}`));
    });
    socket.on('error', (error) => fail(new AppError('EXECUTION_TARGET_UNAVAILABLE', `网关中继连接失败 ${gatewayHost}:${gatewayPort}: ${error.message}`, { gatewayHost, gatewayPort })));
    socket.on('close', () => {
      if (!settled) fail(new AppError('EXECUTION_TARGET_UNAVAILABLE', '网关中继连接提前关闭'));
    });

    socket.on('data', (chunk: Buffer) => {
      try {
        if (phase === 'tunnel') return;
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > MAX_FRAME_BYTES) {
          fail(new AppError('AUTH_FORBIDDEN', '网关中继握手帧超出长度限制'));
          return;
        }
        const newline = buffer.indexOf('\n');
        if (newline === -1) return;
        const line = buffer.subarray(0, newline).toString('utf8').trim();
        buffer = buffer.subarray(newline + 1);

        if (phase === 'hello') {
          const hello = parseJsonFrame(line, 'hello');
          if (hello.v !== GATEWAY_RELAY_PROTOCOL || typeof hello.challenge !== 'string' || !hello.challenge) {
            fail(new AppError('AUTH_FORBIDDEN', '网关中继 hello 帧不合法'));
            return;
          }
          helloSession = typeof hello.session === 'string' ? hello.session : '';
          const signed = `${hello.challenge}:${normalizedHost}:${targetPort}`;
          const signature = sign(null, Buffer.from(signed, 'utf8'), privateKey).toString('hex');
          socket.write(`${JSON.stringify({
            v: GATEWAY_RELAY_PROTOCOL,
            sig: signature,
            host: normalizedHost,
            port: targetPort,
          })}\n`);
          phase = 'response';
          socket.setTimeout(handshakeTimeoutMs, () => {
            fail(new AppError('AUTH_FORBIDDEN', '网关中继认证响应超时'));
          });
          return;
        }

        // phase === 'response'
        const response = parseJsonFrame(line, 'response');
        if (response.ok !== true) {
          const errorCode = typeof response.error === 'string' && response.error ? response.error : 'GATEWAY_RELAY_DENIED';
          fail(new AppError('AUTH_FORBIDDEN', `网关中继拒绝转发: ${response.message ?? response.error ?? '未知原因'}`, { error: errorCode }));
          return;
        }
        settled = true;
        socket.setTimeout(0);
        // 握手后剩余缓冲字节属于隧道流，退回给消费方读取。
        if (buffer.length > 0) socket.unshift(buffer);
        buffer = Buffer.alloc(0);
        resolve({
          socket,
          sessionId: typeof helloSession === 'string' ? helloSession : '',
          targetHost,
          targetPort,
        });
      } catch (error) {
        fail(error);
      }
    });
  });
}

/** 控制面在连接网关前执行的目标和端口门禁。Gateway 仍会再次执行同一策略。 */
export function assertGatewayRelayTargetPolicy(
  targetHost: string,
  targetPort: number,
  options: Pick<OpenGatewayRelayTunnelOptions, 'allowedTargets' | 'allowedPorts' | 'authorizationExpiresAt'>,
): void {
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
    throw new AppError('VALIDATION_FAILED', '网关中继目标端口不合法');
  }
  if (!options.authorizationExpiresAt || !Number.isFinite(Date.parse(options.authorizationExpiresAt))) {
    throw new AppError('AUTH_FORBIDDEN', 'Gateway RelayAuthorization 缺少有效过期时间', { reason: 'RELAY_AUTHORIZATION_REQUIRED' });
  }
  if (Date.parse(options.authorizationExpiresAt) <= Date.now()) {
    throw new AppError('AUTH_FORBIDDEN', 'Gateway RelayAuthorization 已过期', { reason: 'RELAY_AUTHORIZATION_EXPIRED' });
  }
  if (!options.allowedTargets.length || !options.allowedPorts.length) {
    throw new AppError('AUTH_FORBIDDEN', 'Relay 目标和端口授权策略不能为空', { reason: 'RELAY_AUTHORIZATION_REQUIRED' });
  }
  if (!options.allowedPorts.includes(targetPort)) {
    throw new AppError('AUTH_FORBIDDEN', '目标端口不在 Relay 授权范围内', { reason: 'PORT_NOT_ALLOWED', targetPort });
  }
  if (!options.allowedTargets.length) {
    throw new AppError('AUTH_FORBIDDEN', 'Relay 目标白名单为空', { reason: 'TARGET_NOT_ALLOWED' });
  }
  const normalized = normalizeRelayHost(targetHost);
  const exactHost = options.allowedTargets.some((item) => normalizeRelayHost(item) === normalized);
  const exactAddress = options.allowedTargets.some((item) => relayAddressMatchesEntry(normalized, item));
  if (!exactHost && !exactAddress) {
    throw new AppError('AUTH_FORBIDDEN', '目标不在 Relay 授权范围内', { reason: 'TARGET_NOT_ALLOWED', targetHost: normalized });
  }
}

function normalizeRelayHost(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\.$/u, '');
  if (!normalized || /[\\/\s\u0000%]/u.test(normalized)) {
    throw new AppError('VALIDATION_FAILED', '网关中继目标主机不合法');
  }
  return normalized;
}

function relayAddressMatchesEntry(targetHost: string, entryValue: string): boolean {
  const entry = entryValue.trim();
  const targetFamily = net.isIP(targetHost);
  if (!targetFamily) return false;
  if (net.isIP(entry) === targetFamily && entry.toLowerCase() === targetHost.toLowerCase()) return true;
  try {
    const blockList = new net.BlockList();
    const [base, prefix] = entry.split('/');
    const family = net.isIP(base);
    if (!family || prefix === undefined) return false;
    blockList.addSubnet(base, Number(prefix), family === 6 ? 'ipv6' : 'ipv4');
    return blockList.check(targetHost, family === 6 ? 'ipv6' : 'ipv4');
  } catch {
    return false;
  }
}

function parseJsonFrame(line: string, name: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new AppError('AUTH_FORBIDDEN', `网关中继 ${name} 帧不是合法 JSON`);
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
}

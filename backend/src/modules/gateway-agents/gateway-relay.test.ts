import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  GATEWAY_RELAY_PROTOCOL,
  exportRawEd25519PublicKeyHex,
  loadOrCreateGatewayRelayIdentity,
  openGatewayRelayTunnel,
  type GatewayRelayIdentity,
} from './gateway-relay.js';

test('中继身份首次创建并持久化复用', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gcac-relay-identity-'));
  const identity = await loadOrCreateGatewayRelayIdentity(dir);
  assert.ok(identity.privateKeyPem.includes('PRIVATE KEY'), '私钥应为 PEM');
  assert.match(identity.publicKeyHex, /^[0-9a-f]{64}$/u, '公钥应为 32 字节 hex');
  const second = await loadOrCreateGatewayRelayIdentity(dir);
  assert.equal(second.publicKeyHex, identity.publicKeyHex, '同一目录应复用同一身份');
  assert.equal(second.privateKeyPem, identity.privateKeyPem);
});

test('openGatewayRelayTunnel 完成私有密钥握手并双向转发字节', async () => {
  const identityDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gcac-relay-identity-'));
  const identity = await loadOrCreateGatewayRelayIdentity(identityDir);
  const rawPublicKey = exportRawEd25519PublicKeyHex(crypto.createPublicKey(identity.privateKeyPem));
  const echoServer = await startEchoServer();
  const fakeGateway = await startFakeRelayGateway(identity, '127.0.0.1', echoServer.port, 'ok');

  const tunnel = await openGatewayRelayTunnel({
    gatewayHost: '127.0.0.1',
    gatewayPort: fakeGateway.port,
    targetHost: '127.0.0.1',
    targetPort: echoServer.port,
    identity,
  });
  assert.ok(tunnel.socket, '应返回可用 socket');
  assert.equal(tunnel.sessionId, 'relay-test');

  const echoed = await roundTrip(tunnel.socket, 'hello-gateway-relay\n');
  assert.equal(echoed, 'hello-gateway-relay\n');
  tunnel.socket.end();

  await Promise.all([fakeGateway.close(), echoServer.close()]);
  assert.equal(rawPublicKey.length, 64);
});

test('openGatewayRelayTunnel 收到拒绝响应时抛 AUTH_FORBIDDEN', async () => {
  const identityDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gcac-relay-identity-'));
  const identity = await loadOrCreateGatewayRelayIdentity(identityDir);
  const fakeGateway = await startFakeRelayGateway(identity, '127.0.0.1', 1, 'deny');

  await assert.rejects(
    openGatewayRelayTunnel({
      gatewayHost: '127.0.0.1',
      gatewayPort: fakeGateway.port,
      targetHost: '127.0.0.1',
      targetPort: 443,
      identity,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { errorCode?: string }).errorCode, 'AUTH_FORBIDDEN');
      assert.match(error.message, /网关中继拒绝转发/u);
      return true;
    },
  );
  await fakeGateway.close();
});

test('openGatewayRelayTunnel 目标端口非法时直接拒绝', async () => {
  const identityDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gcac-relay-identity-'));
  const identity = await loadOrCreateGatewayRelayIdentity(identityDir);
  await assert.rejects(
    openGatewayRelayTunnel({
      gatewayHost: '127.0.0.1',
      gatewayPort: 18934,
      targetHost: '127.0.0.1',
      targetPort: 0,
      identity,
    }),
    /目标端口不合法/u,
  );
});

interface FakeGatewayHandle {
  port: number;
  close(): Promise<void>;
}

interface EchoServerHandle {
  port: number;
  close(): Promise<void>;
}

async function startEchoServer(): Promise<EchoServerHandle> {
  const server = net.createServer((socket) => {
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => socket.write(chunk));
    socket.on('end', () => socket.end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** 模拟网关中继服务端：发 hello -> 验签 -> 回 ok（或拒绝）-> 转发到目标。 */
async function startFakeRelayGateway(
  identity: GatewayRelayIdentity,
  targetHost: string,
  targetPort: number,
  mode: 'ok' | 'deny',
): Promise<FakeGatewayHandle> {
  const publicKey = crypto.createPublicKey(identity.privateKeyPem);
  const server = net.createServer((clientSocket) => {
    clientSocket.on('error', () => undefined);
    const challenge = crypto.randomBytes(32).toString('hex');
    clientSocket.write(`${JSON.stringify({ v: GATEWAY_RELAY_PROTOCOL, challenge, session: 'relay-test' })}\n`);
    let buffer = Buffer.alloc(0);
    const reject = () => {
      clientSocket.write(`${JSON.stringify({ ok: false, error: 'AUTH_FAILED', message: '签名校验失败' })}\n`);
      clientSocket.end();
    };
    clientSocket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const line = buffer.subarray(0, newline).toString('utf8').trim();
      const rest = buffer.subarray(newline + 1);
      const request = JSON.parse(line) as { v: string; sig: string; host: string; port: number };
      if (mode === 'deny') {
        reject();
        return;
      }
      const signed = Buffer.from(`${challenge}:${request.host}:${request.port}`, 'utf8');
      const valid = crypto.verify(null, signed, publicKey, Buffer.from(request.sig, 'hex'));
      if (!valid) {
        reject();
        return;
      }
      const upstream = net.connect({ host: targetHost, port: targetPort }, () => {
        clientSocket.write(`${JSON.stringify({ ok: true })}\n`);
        // 握手结束：停止帧解析，握手帧之后剩余的字节退回给管道转发。
        clientSocket.removeAllListeners('data');
        if (rest.length > 0) clientSocket.unshift(rest);
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
      });
      upstream.on('error', () => clientSocket.end());
      clientSocket.on('end', () => upstream.end());
      upstream.on('end', () => clientSocket.end());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function roundTrip(socket: net.Socket, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('隧道回显超时')), 5_000);
    socket.once('data', (chunk) => {
      clearTimeout(timeout);
      resolve(chunk.toString('utf8'));
    });
    socket.write(payload);
  });
}

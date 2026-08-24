import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import type { AgentRegistration } from '../schema/agents.schema.js';
import { AgentManagementClient, signAgentUpgradeEnvelope, type AgentUpgradeEnvelope } from './agent-management-client.js';

test('AgentManagementClient 发送签名 UpgradeEnvelope 并校验事务身份', async () => {
  const requests: Array<{
    method?: string;
    url?: string;
    body: AgentUpgradeEnvelope;
  }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as AgentUpgradeEnvelope,
      });
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          success: true,
          accepted: true,
          transactionId: 'txn-client-1',
          status: 'accepted',
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const { privateKey } = generateKeyPairSync('ed25519');
  const unsigned = {
    schemaVersion: 'management.upgrade.v1' as const,
    planId: 'plan-client-1',
    transactionId: 'txn-client-1',
    agentId: 'agent-client-1',
    release: {
      releaseId: 'release-client-1',
      productLine: 'windows-go-full' as const,
      version: '0.2.0',
      platform: 'windows' as const,
      architecture: 'amd64' as const,
      downloadUrl: 'https://release.invalid/agent.exe',
      artifactSha256: 'a'.repeat(64),
      artifactSize: 10,
      signatureKeyId: 'release-key',
      artifactSignature: 'signature',
    },
    policyRef: 'gcac.agent.upgrade',
    approvalRef: '',
    nonce: 'nonce-client-1',
    issuedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    authorityKeyId: 'upgrade-key',
  };
  const envelope = signAgentUpgradeEnvelope(unsigned, privateKey);
  const client = new AgentManagementClient(fetch, 5000);
  const response = await client.dispatchUpgrade(createAgent(`http://127.0.0.1:${address.port}`), envelope);
  assert.equal(response.accepted, true);
  assert.equal(requests[0]?.method, 'POST');
  assert.equal(requests[0]?.url, '/api/v1/control/upgrade');
  assert.equal(requests[0]?.body.controlPlaneSignature, envelope.controlPlaneSignature);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test('AgentManagementClient 默认支持明文管理端点', async () => {
  const client = new AgentManagementClient();
  await assert.rejects(
    () => client.dispatchUpgrade(createAgent('http://127.0.0.1:18930'), {} as AgentUpgradeEnvelope),
    (error: unknown) => error instanceof AppError && error.message === '调用 Agent 升级管理端点失败',
  );
});

test('AgentManagementClient 保留活动旧事务冲突响应，不误报为响应身份错误', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(409, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      errorCode: 'AGENT_UPGRADE_CONFLICT',
      errorMessage: '已有升级事务正在执行',
      transactionId: 'txn-old',
      status: 'running',
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const client = new AgentManagementClient(fetch, 5000);
  const response = await client.dispatchUpgrade(createAgent(`http://127.0.0.1:${address.port}`), {} as AgentUpgradeEnvelope);
  assert.equal(response.errorCode, 'AGENT_UPGRADE_CONFLICT');
  assert.equal(response.transactionId, 'txn-old');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

function createAgent(managementEndpoint: string): AgentRegistration {
  const now = new Date().toISOString();
  return {
    id: 'agent-client-1',
    tenantId: 'tenant-client-1',
    agentKey: 'agent-client-1',
    descriptor: {
      agentKey: 'agent-client-1',
      hostname: 'agent-client-1',
      version: '0.1.0',
      osType: 'WINDOWS',
      arch: 'amd64',
      labels: [],
      managementEndpoint,
    },
    status: 'ONLINE',
    registeredAt: now,
    updatedAt: now,
    version: 1,
  };
}

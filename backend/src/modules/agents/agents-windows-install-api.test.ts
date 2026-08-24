import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { configureTestAuth, testAuthHeaders } from '../../common/http/test-auth.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';

describe('Agent 安装材料接口安全合同', () => {
  it('Windows 只返回固定 Artifact、摘要、签名和 Agent v2 安装任务', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/install-materials',
      headers: requestHeaders('tenant_agent_install_materials', 'req_agent_install_materials'),
      body: {
        platform: 'windows_go',
        role: 'full_agent',
        zone: 'default',
        agentKey: 'windows-go-install-test',
      },
    });

    assert.equal(response.statusCode, 201);
    const body = response.body as InstallMaterialsResponse;
    assertInstallMaterials(body, 'windows_go', '0.1.9');
  });

  it('Linux 只返回固定 Artifact 引用，不返回二进制内容或安装命令', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/install-materials',
      headers: requestHeaders('tenant_linux_install_materials', 'req_linux_install_materials'),
      body: { platform: 'linux_go', role: 'gateway', zone: 'edge' },
    });

    assert.equal(response.statusCode, 201);
    const body = response.body as InstallMaterialsResponse;
    assertInstallMaterials(body, 'linux_go', '0.1.10');
  });

  it('enrollment secret 只在顶层返回一次，不能进入任务或材料', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/install-materials',
      headers: requestHeaders('tenant_install_secret_once', 'req_install_secret_once'),
      body: { platform: 'windows_compatibility', zone: 'default' },
    });

    assert.equal(response.statusCode, 201);
    const body = response.body as InstallMaterialsResponse;
    const enrollmentToken = body.enrollmentToken;
    assert.ok(enrollmentToken);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.split(enrollmentToken).length - 1, 1);
    assert.equal(JSON.stringify(body.task).includes(enrollmentToken), false);
    assert.equal(JSON.stringify(body.materials).includes(enrollmentToken), false);
  });

  it('拒绝 query、未知 body 字段，并且地址相关请求头不能改变 Artifact 材料', async () => {
    const app = await createTestApp();
    const hostileHeaders = requestHeaders('tenant_install_address_binding', 'req_install_address_binding', {
      host: 'attacker.invalid:9443',
      origin: 'https://attacker.invalid',
      referer: 'https://attacker.invalid/agents',
      'x-forwarded-host': 'attacker.invalid',
      'x-forwarded-proto': 'https',
      'x-public-base-url': 'https://attacker.invalid/control-plane',
      'x-proxy-control-plane': 'https://attacker.invalid/proxy-control-plane',
    });
    const hostile = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/install-materials',
      headers: hostileHeaders,
      body: { platform: 'windows_go', zone: 'default' },
    });
    assert.equal(hostile.statusCode, 201);
    const hostileBody = hostile.body as InstallMaterialsResponse;
    assertInstallMaterials(hostileBody, 'windows_go', '0.1.9');
    assert.doesNotMatch(JSON.stringify(hostileBody), /attacker\.invalid/i);

    const query = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/install-materials?baseUrl=https%3A%2F%2Fattacker.invalid',
      headers: requestHeaders('tenant_install_query_rejected', 'req_install_query_rejected'),
      body: { platform: 'windows_go' },
    });
    assert.ok(query.statusCode >= 400 && query.statusCode < 500);

    const unknownField = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/install-materials',
      headers: requestHeaders('tenant_install_body_rejected', 'req_install_body_rejected'),
      body: { platform: 'windows_go', baseUrl: 'https://attacker.invalid' },
    });
    assert.ok(unknownField.statusCode >= 400 && unknownField.statusCode < 500);
  });

  it('所有已删除的宿主脚本、解包和下载后执行入口均不存在', async () => {
    const app = await createTestApp();
    const oldPaths = [
      '/api/v1/agents/install-sessions/windows-powershell',
      '/api/v1/agents/install-sessions/linux-go',
      '/api/v1/agents/gateway-enable-sessions',
      '/agent-install.ps1',
      '/agent-install',
      '/agent-enable-gateway.ps1',
      '/agent-enable-gateway',
      '/api/v1/agents/install/windows/bootstrap.ps1',
      '/api/v1/agents/install/windows/manifest',
      '/api/v1/agents/install/linux/bootstrap.sh',
      '/api/v1/agents/install/linux/bundle.tar.gz',
    ];

    for (const path of oldPaths) {
      const response = await app.inject({
        method: 'GET',
        path,
        headers: requestHeaders('tenant_removed_agent_install_paths', `req_removed_${path.replaceAll('/', '_')}`),
      });
      assert.equal(response.statusCode, 404, path);
    }
  });
});

interface InstallMaterialsResponse {
  installationId: string;
  expiresAt: string;
  enrollmentToken: string;
  materials: Array<{
    platform: 'windows_go' | 'windows_compatibility' | 'linux_go';
    arch: 'amd64' | 'arm64';
    artifactRef: string;
    version: string;
    digest: string;
    signature: string;
    signatureAlgorithm: 'Ed25519';
    signingKeyId: string;
  }>;
  task: {
    type: 'agent.plan.execute';
    contractVersion: 'gcac.agent-security/v1';
    taskId: string;
    version: string;
    artifactRefs: string[];
    expiresAt: string;
    digest: string;
    signature: string;
    signatureAlgorithm: 'Ed25519';
    signingKeyId: string;
    input: Record<string, unknown>;
  };
}

function assertInstallMaterials(body: InstallMaterialsResponse, platform: InstallMaterialsResponse['materials'][number]['platform'], version: string): void {
  assert.equal(Object.keys(body).sort().join(','), 'enrollmentToken,expiresAt,installationId,materials,task');
  assert.equal(body.materials.length, 1);
  const material = body.materials[0]!;
  assert.equal(material.platform, platform);
  assert.equal(material.version, version);
  assert.match(material.artifactRef, /^artifact:\/\/gcac\/agents\//);
  assert.doesNotMatch(material.artifactRef, /^https?:/i);
  assert.match(material.digest, /^[a-f0-9]{64}$/);
  assert.match(material.signature, /^artifact:\/\/gcac\/signatures\//);
  assert.equal(material.signatureAlgorithm, 'Ed25519');
  assert.equal(material.signingKeyId, 'gcac-agent-release-v1');

  assert.equal(body.task.type, 'agent.plan.execute');
  assert.equal(body.task.contractVersion, 'gcac.agent-security/v1');
  assert.deepEqual(body.task.artifactRefs, [material.artifactRef]);
  assert.equal(body.task.version, material.version);
  assert.equal(body.task.signature, material.signature);
  assert.equal(body.task.signatureAlgorithm, material.signatureAlgorithm);
  assert.equal(body.task.signingKeyId, material.signingKeyId);
  assert.match(body.task.digest, /^[a-f0-9]{64}$/);
  assert.equal('enrollmentToken' in body.task.input, false);
  assert.equal('command' in body.task.input, false);
  assert.equal('script' in body.task.input, false);
  assert.equal('shell' in body.task.input, false);
  assert.equal('executable' in body.task.input, false);
  assert.doesNotMatch(JSON.stringify(body), /(?:https?:\/\/|curl|wget|invoke-webrequest|invoke-expression|powershell|pwsh|cmd(?:\.exe)?|bash|sh\s+-c|node(?:\.exe)?|installCommand|bootstrap|bundle|script)/i);
}

async function createTestApp() {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  return configureTestAuth(createApp({ db: database }));
}

function requestHeaders(tenantId: string, requestId: string, extra: Record<string, string> = {}): Record<string, string> {
  return testAuthHeaders('agent_install_test', tenantId, { 'x-request-id': requestId, ...extra });
}

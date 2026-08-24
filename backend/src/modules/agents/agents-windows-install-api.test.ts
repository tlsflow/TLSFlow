import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';

describe('Agent 安装会话安全约束', () => {
  it('Windows bootstrap 短码 10 分钟过期且只能使用一次', async () => {
    const app = createApp();
    const headers = {
      'x-tenant-id': 'tenant_agent_windows_install',
      'x-request-id': 'req_agent_windows_install',
      host: 'gcac.example.test',
      'x-forwarded-proto': 'https',
    };

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/install-sessions/windows-powershell',
      headers,
      body: { zone: 'default', startAfterInstall: true },
    });
    assert.equal(created.statusCode, 201);

    const createdBody = created.body as {
      bootstrapUrl: string;
      installCommand: string;
      enrollmentToken?: string;
      bootstrapTokenPreview: string;
      zone: string;
      serviceName: string;
      expiresAt: string;
    };

    assert.equal(createdBody.zone, 'default');
    assert.match(createdBody.serviceName, /^gcac-full-agent-ps/);
    assert.match(createdBody.bootstrapUrl, /^https:\/\/gcac\.example\.test\/api\/v1\/agents\/install\/windows\/bootstrap\.ps1\?token=/);
    assert.match(createdBody.installCommand, /irm 'https:\/\/gcac\.example\.test\/api\/v1\/agents\/install\/windows\/bootstrap\.ps1\?token=/);
    assert.ok(createdBody.enrollmentToken);
    assert.match(createdBody.bootstrapTokenPreview, /^[A-HJ-NP-Za-km-z2-9]{8}$/);

    const expiresAt = new Date(createdBody.expiresAt).getTime();
    const ttlMs = expiresAt - Date.now();
    assert.ok(ttlMs > 9 * 60 * 1000 && ttlMs <= 10 * 60 * 1000 + 10_000);

    const bootstrapToken = new URL(createdBody.bootstrapUrl).searchParams.get('token');
    assert.ok(bootstrapToken);

    const bootstrap = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/install/windows/bootstrap.ps1?token=${encodeURIComponent(bootstrapToken!)}`,
      headers,
    });
    assert.equal(bootstrap.statusCode, 200);
    assert.equal(bootstrap.headers['content-type'], 'text/plain; charset=utf-8');
    const bootstrapBody = String(bootstrap.body);
    assert.match(bootstrapBody, /\$manifest = @'/);
    assert.match(bootstrapBody, /config\\agent\.config\.template\.json/);
    assert.match(bootstrapBody, /install-service\.ps1/);
    assert.match(bootstrapBody, /bootstrap-selfcheck\.json/);
    assert.match(bootstrapBody, /bootstrap-register\.json/);
    assert.match(bootstrapBody, /-SelfCheck/);
    assert.match(bootstrapBody, /-RunOnce/);
    assert.match(bootstrapBody, /Start-Service -Name/);
    assert.doesNotMatch(bootstrapBody, /Invoke-RestMethod -Method Get -Uri/);
    assert.doesNotMatch(bootstrapBody, /manifest\?token=/);

    const secondBootstrap = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/install/windows/bootstrap.ps1?token=${encodeURIComponent(bootstrapToken!)}`,
      headers,
    });
    assert.equal(secondBootstrap.statusCode, 403);

    const manifestAfterBootstrap = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/install/windows/manifest?token=${encodeURIComponent(bootstrapToken!)}`,
      headers,
    });
    assert.equal(manifestAfterBootstrap.statusCode, 403);
  });

  it('Linux bootstrap 短码只能使用一次且脚本不再二次拉 manifest', async () => {
    const app = createApp();
    const headers = {
      'x-tenant-id': 'tenant_agent_linux_install',
      'x-request-id': 'req_agent_linux_install',
      host: 'gcac.example.test',
      'x-forwarded-proto': 'https',
    };

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/install-sessions/linux-go',
      headers,
      body: { zone: 'default' },
    });
    assert.equal(created.statusCode, 201);

    const createdBody = created.body as {
      bootstrapUrl: string;
      installCommand: string;
      bootstrapTokenPreview: string;
      expiresAt: string;
      bundleUrl?: string;
    };

    assert.match(createdBody.bootstrapTokenPreview, /^[A-HJ-NP-Za-km-z2-9]{8}$/);
    const expiresAt = new Date(createdBody.expiresAt).getTime();
    const ttlMs = expiresAt - Date.now();
    assert.ok(ttlMs > 9 * 60 * 1000 && ttlMs <= 10 * 60 * 1000 + 10_000);
    assert.match(createdBody.bootstrapUrl, /^https:\/\/gcac\.example\.test\/api\/v1\/agents\/install\/linux\/bootstrap\.sh\?token=/);
    assert.match(createdBody.installCommand, /curl -fsSL 'https:\/\/gcac\.example\.test\/api\/v1\/agents\/install\/linux\/bootstrap\.sh\?token=/);
    assert.equal(createdBody.bundleUrl, 'https://gcac.example.test/api/v1/agents/install/linux/bundle.tar.gz');

    const bootstrapToken = new URL(createdBody.bootstrapUrl).searchParams.get('token');
    assert.ok(bootstrapToken);

    const bootstrap = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/install/linux/bootstrap.sh?token=${encodeURIComponent(bootstrapToken!)}`,
      headers,
    });
    assert.equal(bootstrap.statusCode, 200);
    assert.equal(bootstrap.headers['content-type'], 'text/x-shellscript; charset=utf-8');
    const bootstrapBody = String(bootstrap.body);
    assert.match(bootstrapBody, /cat <<'JSON' > "\$WORKDIR\/manifest\.json"/);
    assert.match(bootstrapBody, /bundle\.tar\.gz/);
    assert.match(bootstrapBody, /BUNDLE_URL='https:\/\/gcac\.example\.test\/api\/v1\/agents\/install\/linux\/bundle\.tar\.gz'/);
    assert.match(bootstrapBody, /SERVICE_NAME='gcac-linux-agent'/);
    assert.doesNotMatch(bootstrapBody, /manifest\?token=/);
    assert.doesNotMatch(bootstrapBody, /MANIFEST_URL=/);
    assert.doesNotMatch(bootstrapBody, /process\.stdout\.write\(m\.bundleUrl\)/);
    assert.doesNotMatch(bootstrapBody, /process\.stdout\.write\(m\.displayName\)/);

    const secondBootstrap = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/install/linux/bootstrap.sh?token=${encodeURIComponent(bootstrapToken!)}`,
      headers,
    });
    assert.equal(secondBootstrap.statusCode, 403);
  });

  it('并发请求同一个 bootstrap token 时只能成功一次', async () => {
    const app = createApp();
    const headers = {
      'x-tenant-id': 'tenant_agent_atomic_consume',
      'x-request-id': 'req_agent_atomic_consume',
      host: 'gcac.example.test',
      'x-forwarded-proto': 'https',
    };

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/install-sessions/linux-go',
      headers,
      body: { zone: 'default' },
    });
    assert.equal(created.statusCode, 201);

    const createdBody = created.body as { bootstrapUrl: string };
    const bootstrapToken = new URL(createdBody.bootstrapUrl).searchParams.get('token');
    assert.ok(bootstrapToken);

    const [left, right] = await Promise.all([
      app.inject({
        method: 'GET',
        path: `/api/v1/agents/install/linux/bootstrap.sh?token=${encodeURIComponent(bootstrapToken!)}`,
        headers: { ...headers, 'x-request-id': 'req_agent_atomic_consume_left' },
      }),
      app.inject({
        method: 'GET',
        path: `/api/v1/agents/install/linux/bootstrap.sh?token=${encodeURIComponent(bootstrapToken!)}`,
        headers: { ...headers, 'x-request-id': 'req_agent_atomic_consume_right' },
      }),
    ]);

    const statusCodes = [left.statusCode, right.statusCode].sort((a, b) => a - b);
    assert.deepEqual(statusCodes, [200, 403]);
  });

  it('创建安装会话时优先使用显式公共基地址', async () => {
    const app = createApp();
    const headers = {
      'x-tenant-id': 'tenant_agent_public_base_url',
      'x-request-id': 'req_agent_public_base_url',
      host: '127.0.0.1:3003',
      'x-forwarded-proto': 'http',
      'x-public-base-url': 'http://10.255.0.85:5172',
    };

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/install-sessions/linux-go',
      headers,
      body: { zone: 'default' },
    });
    assert.equal(created.statusCode, 201);

    const createdBody = created.body as {
      bootstrapUrl: string;
      installCommand: string;
    };
    assert.equal(createdBody.bootstrapUrl.includes('10.255.0.85:5172'), true);
    assert.equal(createdBody.bootstrapUrl.includes('127.0.0.1:3003'), false);
    assert.equal(createdBody.installCommand.includes('10.255.0.85:5172'), true);

    const bootstrapToken = new URL(createdBody.bootstrapUrl).searchParams.get('token');
    assert.ok(bootstrapToken);

    const bootstrap = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/install/linux/bootstrap.sh?token=${encodeURIComponent(bootstrapToken!)}`,
      headers,
    });
    assert.equal(bootstrap.statusCode, 200);
    const bootstrapBody = String(bootstrap.body);
    assert.match(bootstrapBody, /BUNDLE_URL='http:\/\/10\.255\.0\.85:5172\/api\/v1\/agents\/install\/linux\/bundle\.tar\.gz'/);
    assert.doesNotMatch(bootstrapBody, /127\.0\.0\.1:3003/);
  });
});

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
    assert.match(createdBody.serviceName, /^gcac-windows-go-agent-/);
    assert.match(createdBody.bootstrapUrl, /^https:\/\/gcac\.example\.test\/agent-install\.ps1\?token=/);
    assert.match(createdBody.installCommand, /^irm https:\/\/gcac\.example\.test\/agent-install\.ps1\?token=.* \| iex$/);
    assert.match(String((created.body as { configDir?: string }).configDir ?? ''), /FullAgentGo\\config$/);
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
    assert.match(bootstrapBody, /\.env/);
    assert.match(bootstrapBody, /GCAC_CONTROL_PLANE_URL=/);
    assert.match(bootstrapBody, /\.controlPlaneUrl = \[string\]\$manifest\.controlPlaneUrl/);
    assert.match(bootstrapBody, /directControlEnabled/);
    assert.match(bootstrapBody, /directControlListenHost/);
    assert.match(bootstrapBody, /directControlListenPort/);
    assert.match(bootstrapBody, /directControlAdvertiseHost/);
    assert.match(bootstrapBody, /bootstrap-selfcheck\.json/);
    assert.match(bootstrapBody, /bootstrap-register\.json/);
    assert.match(bootstrapBody, /WriteAllBytes/);
    assert.match(bootstrapBody, /FromBase64String/);
    assert.match(bootstrapBody, /self-check --config=/);
    assert.match(bootstrapBody, /register-once --config=/);
    assert.match(bootstrapBody, /Start-Service -Name/);
    assert.match(bootstrapBody, /Join-Path \$manifest\.installRoot 'gcac-agent\.exe'/);
    assert.match(bootstrapBody, /WriteAllText\(\$selfCheckPath, \$selfCheckOutput, \$utf8Bom\)/);
    assert.doesNotMatch(bootstrapBody, /-StartAfterInstall/);
    assert.doesNotMatch(bootstrapBody, /Start-GcacFullAgent\.ps1/);
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

  it('Windows 短安装入口不要求安装端携带租户头', async () => {
    const app = createApp();
    const headers = {
      'x-tenant-id': 'tenant_agent_windows_short_public',
      'x-request-id': 'req_agent_windows_short_public',
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

    const bootstrapToken = new URL((created.body as { bootstrapUrl: string }).bootstrapUrl).searchParams.get('token');
    assert.ok(bootstrapToken);

    const bootstrap = await app.inject({
      method: 'GET',
      path: `/agent-install.ps1?token=${encodeURIComponent(bootstrapToken)}`,
      headers: {
        host: 'gcac.example.test',
        'x-forwarded-proto': 'https',
      },
    });

    assert.equal(bootstrap.statusCode, 200);
    assert.equal(bootstrap.headers['content-type'], 'text/plain; charset=utf-8');
    assert.match(String(bootstrap.body), /\$manifest = @'/);
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
    assert.match(createdBody.bootstrapUrl, /^https:\/\/gcac\.example\.test\/agent-install\?token=/);
    assert.match(createdBody.installCommand, /^curl -fsSL https:\/\/gcac\.example\.test\/agent-install\?token=.* \| sudo bash$/);
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
    assert.match(bootstrapBody, /directControlEnabled: true/);
    assert.match(bootstrapBody, /directControlListenHost: "0\.0\.0\.0"/);
    assert.match(bootstrapBody, /directControlListenPort: 18931/);
    assert.match(bootstrapBody, /directControlAdvertiseHost: ""/);
    assert.doesNotMatch(bootstrapBody, /manifest\?token=/);
    assert.doesNotMatch(bootstrapBody, /MANIFEST_URL=/);
    assert.doesNotMatch(bootstrapBody, /process\.stdout\.write\(m\.bundleUrl\)/);
    assert.doesNotMatch(bootstrapBody, /process\.stdout\.write\(m\.displayName\)/);

    const secondBootstrap = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/install/linux/bootstrap.sh?token=${encodeURIComponent(bootstrapToken!)}`,
      headers,
    });
    assert.equal(secondBootstrap.statusCode, 200);

    const shortBootstrap = await app.inject({
      method: 'GET',
      path: `/agent-install?token=${encodeURIComponent(bootstrapToken!)}`,
      headers,
    });
    assert.equal(shortBootstrap.statusCode, 200);
  });

  it('Gateway Agent 安装会话应生成可直接注册为 Gateway 的安装脚本', async () => {
    const app = createApp();
    const headers = {
      'x-tenant-id': 'tenant_gateway_install',
      'x-request-id': 'req_gateway_install',
      host: 'gcac.example.test',
      'x-forwarded-proto': 'https',
    };

    const linuxCreated = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/install-sessions/linux-go',
      headers,
      body: { zone: 'zone_gateway', role: 'gateway' },
    });
    assert.equal(linuxCreated.statusCode, 201);
    const linuxBody = linuxCreated.body as { role: string; bootstrapUrl: string; serviceName: string };
    assert.equal(linuxBody.role, 'gateway');
    assert.equal(linuxBody.serviceName, 'gcac-linux-gateway-agent');

    const linuxToken = new URL(linuxBody.bootstrapUrl).searchParams.get('token');
    assert.ok(linuxToken);
    const linuxBootstrap = await app.inject({
      method: 'GET',
      path: `/agent-install?token=${encodeURIComponent(linuxToken)}`,
      headers,
    });
    assert.equal(linuxBootstrap.statusCode, 200);
    const linuxScript = String(linuxBootstrap.body);
    assert.match(linuxScript, /role: manifest\.role/);
    assert.match(linuxScript, /gatewayEnabled: manifest\.gatewayEnabled === true/);
    assert.match(linuxScript, /SERVICE_NAME='gcac-linux-gateway-agent'/);

    const windowsCreated = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/install-sessions/windows-powershell',
      headers: { ...headers, 'x-request-id': 'req_gateway_install_windows' },
      body: { zone: 'zone_gateway', role: 'gateway', startAfterInstall: true },
    });
    assert.equal(windowsCreated.statusCode, 201);
    const windowsBody = windowsCreated.body as { role: string; bootstrapUrl: string; serviceName: string };
    assert.equal(windowsBody.role, 'gateway');
    assert.match(windowsBody.serviceName, /^gcac-gateway-agent-/);

    const windowsToken = new URL(windowsBody.bootstrapUrl).searchParams.get('token');
    assert.ok(windowsToken);
    const windowsBootstrap = await app.inject({
      method: 'GET',
      path: `/agent-install.ps1?token=${encodeURIComponent(windowsToken)}`,
      headers,
    });
    assert.equal(windowsBootstrap.statusCode, 200);
    const windowsScript = String(windowsBootstrap.body);
    assert.match(windowsScript, /NotePropertyName role/);
    assert.match(windowsScript, /NotePropertyName gatewayEnabled/);
  });

  it('现有 Agent 启用 Gateway 会话应返回直接可运行命令', async () => {
    const app = createApp();
    const headers = {
      'x-tenant-id': 'tenant_gateway_enable_command',
      'x-request-id': 'req_gateway_enable_register',
      host: 'gcac.example.test',
      'x-forwarded-proto': 'https',
    };

    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'agent-existing-gateway-enable',
        hostname: 'agent-existing-gateway-enable',
        version: '0.1.0',
        osType: 'linux',
        zone: 'default',
      },
    });
    assert.equal(registered.statusCode, 201);
    const agentId = (registered.body as { id: string }).id;

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/gateway-enable-sessions',
      headers: { ...headers, 'x-request-id': 'req_gateway_enable_command' },
      body: { platform: 'linux_go_systemd', agentId, zone: 'zone_gateway' },
    });
    assert.equal(created.statusCode, 201);
    const body = created.body as { enableCommand: string; enableUrl: string; zone: string; configPath: string };
    assert.equal(body.zone, 'zone_gateway');
    assert.equal(body.configPath, '/etc/gcac/linux-agent/agent.config.json');
    assert.match(body.enableCommand, /^curl -fsSL 'https:\/\/gcac\.example\.test\/agent-enable-gateway\?/);

    const url = new URL(body.enableUrl);
    const script = await app.inject({
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      headers,
    });
    assert.equal(script.statusCode, 200);
    assert.match(String(script.body), /config\.gatewayEnabled = true/);
    assert.match(String(script.body), /systemctl restart/);
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
    assert.deepEqual(statusCodes, [200, 200]);
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

describe('安装入口基地址兜底', () => {
  it('后端环境变量应优先覆盖所有请求头推断', async () => {
    const previous = process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL;
    process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL = 'http://10.255.0.85:5172';
    try {
      const app = createApp();
      const headers = {
        'x-tenant-id': 'tenant_agent_env_base_url',
        'x-request-id': 'req_agent_env_base_url',
        host: '127.0.0.1:3003',
        origin: 'http://wrong-host:9999',
        referer: 'http://wrong-host:9999/agents',
        'x-forwarded-proto': 'http',
        'x-public-base-url': 'http://wrong-host:9999',
      };

      const created = await app.inject({
        method: 'POST',
        path: '/api/v1/agents/install-sessions/linux-go',
        headers,
        body: { zone: 'default' },
      });
      assert.equal(created.statusCode, 201);
      const createdBody = created.body as { bootstrapUrl: string; bundleUrl: string; installCommand: string };
      assert.equal(createdBody.bootstrapUrl.includes('10.255.0.85:5172'), true);
      assert.equal(createdBody.bundleUrl, 'http://10.255.0.85:5172/api/v1/agents/install/linux/bundle.tar.gz');
      assert.equal(createdBody.installCommand.includes('10.255.0.85:5172'), true);
    } finally {
      if (previous === undefined) {
        delete process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL;
      } else {
        process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL = previous;
      }
    }
  });

  it('缺少自定义公共地址头时优先使用浏览器 Origin', async () => {
    const app = createApp();
    const headers = {
      'x-tenant-id': 'tenant_agent_origin_base_url',
      'x-request-id': 'req_agent_origin_base_url',
      host: '127.0.0.1:3003',
      origin: 'http://10.255.0.85:5172',
      'x-forwarded-proto': 'http',
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
      bundleUrl: string;
      installCommand: string;
    };
    assert.equal(createdBody.bootstrapUrl.includes('10.255.0.85:5172'), true);
    assert.equal(createdBody.bootstrapUrl.includes('127.0.0.1:3003'), false);
    assert.equal(createdBody.bundleUrl, 'http://10.255.0.85:5172/api/v1/agents/install/linux/bundle.tar.gz');
    assert.equal(createdBody.installCommand.includes('10.255.0.85:5172'), true);
  });
});

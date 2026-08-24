import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';

describe('Windows PowerShell Agent 安装闭环', () => {
  it('安装会话、bootstrap 和 manifest 可用', async () => {
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
      manifestUrl: string;
      installCommand: string;
      enrollmentToken?: string;
      zone: string;
      serviceName: string;
    };
    assert.equal(createdBody.zone, 'default');
    assert.match(createdBody.serviceName, /^gcac-full-agent-ps/);
    assert.match(createdBody.bootstrapUrl, /^https:\/\/gcac\.example\.test\/api\/v1\/agents\/install\/windows\/bootstrap\.ps1\?token=/);
    assert.match(createdBody.manifestUrl, /^https:\/\/gcac\.example\.test\/api\/v1\/agents\/install\/windows\/manifest\?token=/);
    assert.match(createdBody.installCommand, /irm 'https:\/\/gcac\.example\.test\/api\/v1\/agents\/install\/windows\/bootstrap\.ps1\?token=/);
    assert.ok(createdBody.enrollmentToken);

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
    assert.match(bootstrapBody, /Invoke-RestMethod -Method Get -Uri/);
    assert.match(bootstrapBody, /config\\agent\.config\.template\.json/);
    assert.match(bootstrapBody, /install-service\.ps1/);
    assert.doesNotMatch(bootstrapBody, /windows\\install-service\.ps1/);

    const manifest = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/install/windows/manifest?token=${encodeURIComponent(bootstrapToken!)}`,
      headers,
    });
    assert.equal(manifest.statusCode, 200);
    const manifestBody = manifest.body as {
      tenantId: string;
      agentKey: string;
      controlPlaneUrl: string;
      enrollmentToken: string;
      artifacts: Array<{ path: string; content: string }>;
    };
    assert.equal(manifestBody.tenantId, 'tenant_agent_windows_install');
    assert.ok(manifestBody.agentKey);
    assert.match(manifestBody.controlPlaneUrl, /^https:\/\/gcac\.example\.test$/);
    assert.equal(manifestBody.enrollmentToken, createdBody.enrollmentToken);
    const artifactPaths = manifestBody.artifacts.map((item) => item.path);
    assert.ok(artifactPaths.includes('Start-GcacFullAgent.ps1'));
    assert.ok(artifactPaths.includes('install-service.ps1'));
    assert.ok(artifactPaths.includes('service-control.ps1'));
    assert.ok(artifactPaths.includes('config/agent.config.template.json'));
    assert.ok(artifactPaths.includes('modules/Gcac.Agent.Service.psm1'));
    assert.ok(artifactPaths.includes('scripts/Test-Utf8Bom.ps1'));
    assert.ok(!artifactPaths.some((item) => item.startsWith('tmp/')));
  });
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { describe, it } from 'node:test';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../app.module.js';
import { configureTestAuth, testAuthHeaders } from '../../common/http/test-auth.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';

describe('Agent 一键安装会话', () => {
  it('Windows Go 安装会话返回一条短期一次性 PowerShell 安装命令', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/install-sessions/windows-go',
      headers: requestHeaders('tenant_windows_go_install_session', 'req_windows_go_install_session', {
        host: '127.0.0.1:3003',
        origin: 'http://10.255.0.85:5172',
      }),
      body: { zone: 'default' },
    });

    assert.equal(response.statusCode, 201, JSON.stringify(response.body));
    const body = response.body as InstallSessionResponse;
    assert.equal(body.platform, 'windows_go_service');
    assert.match(body.bootstrapUrl, /^http:\/\/10\.255\.0\.85:5172\/agent-install\.ps1\?token=/);
    assert.match(body.installCommand, /^irm 'http:\/\/10\.255\.0\.85:5172\/agent-install\.ps1\?token=\d{8}' \| iex$/);

    const token = new URL(body.bootstrapUrl).searchParams.get('token');
    assert.ok(token);
    assert.match(token, /^\d{8}$/);
    const bootstrap = await app.inject({
      method: 'GET',
      path: `/agent-install.ps1?token=${encodeURIComponent(token)}`,
      headers: requestHeaders('tenant_windows_go_install_session', 'req_windows_go_bootstrap', {
        host: '127.0.0.1:3003',
        origin: 'http://10.255.0.85:5172',
      }),
    });
    assert.equal(bootstrap.statusCode, 200, JSON.stringify(bootstrap.body));
    const script = String(bootstrap.body);
    assert.match(script, /gcac-agent\.exe/);
    assert.match(script, /register-once/);
    assert.match(script, /Agent registration or initial capability report failed/);
    assert.match(script, /function Remove-GoAgentService/);
    assert.match(script, /Existing Go Agent installation metadata is invalid/);
    assert.match(script, /Get-CimInstance -ClassName Win32_Service/);
    assert.match(script, /servicesUsingAgentBinary/);
    assert.match(script, /\[char\]34/);
    assert.match(script, /Go Agent service deletion timed out/);
    assert.match(script, /Agent log tail/);
    assert.match(script, /Get-NetFirewallRule -ErrorAction SilentlyContinue/);
    assert.match(script, /GCAC Go Full Agent Management TCP \$Port/);
    assert.doesNotMatch(script, /advfirewall firewall delete rule name=all \$programArgument/);
    assert.match(script, /no rules match\|没有规则匹配\|找不到规则/);
    assert.match(script, /GCAC Go Full Agent Management TCP 18930/);
    assert.match(script, /GCAC Agent Direct Control \(\*\)/);
    assert.match(script, /authorizationMaterialPath/);
    assert.match(script, /authorizationTrustKeySet/);
    assert.match(script, /agent-trust-material\.json/);
    assert.match(script, /Go Agent policy directory ACL configuration failed/);
    assert.match(script, /S-1-5-18/);
    assert.match(script, /\$pluginSource = Join-Path \$root "plugins\/windows-runtime-discovery\.exe"/);
    assert.match(script, /Windows Agent-side discovery plugin is missing from the bootstrap bundle/);
    assert.match(script, /\$pluginTarget = Join-Path \$manifest\.installRoot "plugins\/windows-runtime-discovery\.exe"/);
    assert.match(script, /Copy-Item -LiteralPath \$pluginSource -Destination \$pluginTarget -Force/);
    assert.ok(script.indexOf('Windows Agent-side discovery plugin is missing from the bootstrap bundle') < script.indexOf('foreach ($serviceName in $serviceNames) { Remove-GoAgentService'));
    assert.ok(script.indexOf('Copy-Item -LiteralPath $agentSource -Destination $agentTarget -Force') < script.indexOf('Copy-Item -LiteralPath $pluginSource -Destination $pluginTarget -Force'));
    assert.ok(script.indexOf('Copy-Item -LiteralPath $pluginSource -Destination $pluginTarget -Force') < script.indexOf('register-once'));
    assert.ok(script.indexOf('Remove-GoAgentLegacyFirewallRules') < script.indexOf('Configure-GoAgentFirewall -ProgramPath $agentTarget -Port 18930'));
    assert.ok(script.indexOf('foreach ($serviceName in $serviceNames) { Remove-GoAgentService') < script.indexOf('Copy-Item -LiteralPath $agentSource -Destination $agentTarget -Force'));
    assert.doesNotMatch(script, /GCAC\.WindowsCompatibilityAgent\.exe/);
    assertWindowsGoBootstrapUsesLatestAmd64Artifact(readWindowsBootstrapManifest(script));
  });

  it('Windows Go bootstrap 将安装固定的授权 KeySet 写入 manifest', async () => {
    const authorityDirectory = mkdtempSync(join(tmpdir(), 'gcac-windows-go-authority-'));
    const previous = process.env.GCAC_LOCAL_AGENT_AUTHORITY_DIR;
    const previousUpgradeKeys = process.env.GCAC_AGENT_UPGRADE_TRUST_KEYS_JSON;
    const previousReleaseKeys = process.env.GCAC_AGENT_RELEASE_TRUST_KEYS_JSON;
    process.env.GCAC_LOCAL_AGENT_AUTHORITY_DIR = authorityDirectory;
    process.env.GCAC_AGENT_UPGRADE_TRUST_KEYS_JSON = JSON.stringify({
      'upgrade-authority-v1': Buffer.alloc(32, 7).toString('base64'),
    });
    process.env.GCAC_AGENT_RELEASE_TRUST_KEYS_JSON = JSON.stringify({
      'gcac-agent-release-v1': Buffer.alloc(32, 8).toString('base64'),
    });
    try {
      const app = await createTestApp();
      const session = await app.inject({
        method: 'POST',
        path: '/api/v1/agents/install-sessions/windows-go',
        headers: requestHeaders('tenant_windows_go_trust_manifest', 'req_windows_go_trust_manifest', {
          host: '127.0.0.1:3003',
          origin: 'http://10.255.0.85:5172',
        }),
        body: { zone: 'default' },
      });
      assert.equal(session.statusCode, 201, JSON.stringify(session.body));
      const token = new URL((session.body as InstallSessionResponse).bootstrapUrl).searchParams.get('token');
      assert.ok(token);
      const bootstrap = await app.inject({
        method: 'GET',
        path: `/agent-install.ps1?token=${encodeURIComponent(token)}`,
        headers: requestHeaders('tenant_windows_go_trust_manifest', 'req_windows_go_trust_manifest_bootstrap', {
          host: '127.0.0.1:3003',
          origin: 'http://10.255.0.85:5172',
        }),
      });
      assert.equal(bootstrap.statusCode, 200, JSON.stringify(bootstrap.body));
      const manifest = readWindowsBootstrapManifest(String(bootstrap.body));
      const keySet = manifest.authorizationTrustKeySet;
      assert.ok(keySet && typeof keySet === 'object' && !Array.isArray(keySet));
      assert.ok(Object.values(keySet).some((value) => typeof value === 'string' && value.length > 0));
      assert.deepEqual(manifest.upgradeTrustKeySet, {
        'upgrade-authority-v1': Buffer.alloc(32, 7).toString('base64'),
      });
      assert.deepEqual(manifest.releaseTrustKeySet, {
        'gcac-agent-release-v1': Buffer.alloc(32, 8).toString('base64'),
      });
    } finally {
      if (previous === undefined) delete process.env.GCAC_LOCAL_AGENT_AUTHORITY_DIR;
      else process.env.GCAC_LOCAL_AGENT_AUTHORITY_DIR = previous;
      if (previousUpgradeKeys === undefined) delete process.env.GCAC_AGENT_UPGRADE_TRUST_KEYS_JSON;
      else process.env.GCAC_AGENT_UPGRADE_TRUST_KEYS_JSON = previousUpgradeKeys;
      if (previousReleaseKeys === undefined) delete process.env.GCAC_AGENT_RELEASE_TRUST_KEYS_JSON;
      else process.env.GCAC_AGENT_RELEASE_TRUST_KEYS_JSON = previousReleaseKeys;
      rmSync(authorityDirectory, { recursive: true, force: true });
    }
  });

  it('Windows Compatibility 安装会话返回专用 bootstrap，不调用 Go Agent register-once', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/install-sessions/windows-compatibility',
      headers: requestHeaders('tenant_windows_compat_install_session', 'req_windows_compat_install_session', {
        host: '127.0.0.1:3003',
        origin: 'http://10.255.0.85:5172',
      }),
      body: { zone: 'default' },
    });

    assert.equal(response.statusCode, 201, JSON.stringify(response.body));
    const body = response.body as InstallSessionResponse;
    assert.equal(body.platform, 'windows_compatibility_service');
    assert.equal(body.serviceName, 'GCACWindowsCompatibilityAgent');
    assert.match(body.bootstrapUrl, /^http:\/\/10\.255\.0\.85:5172\/agent-install\.ps1\?token=/);
    assert.match(body.installCommand, /^irm 'http:\/\/10\.255\.0\.85:5172\/agent-install\.ps1\?token=\d{8}' \| iex$/);

    const token = new URL(body.bootstrapUrl).searchParams.get('token');
    assert.ok(token);
    assert.match(token, /^\d{8}$/);
    const bootstrap = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/install/windows-compatibility/bootstrap.ps1?token=${encodeURIComponent(token)}`,
      headers: requestHeaders('tenant_windows_compat_install_session', 'req_windows_compat_bootstrap', {
        host: '127.0.0.1:3003',
        origin: 'http://10.255.0.85:5172',
      }),
    });
    assert.equal(bootstrap.statusCode, 200, JSON.stringify(bootstrap.body));
    const script = String(bootstrap.body);
    assert.match(script, /GCAC\.WindowsCompatibilityAgent\.exe/);
    assert.doesNotMatch(script, /GCAC\.WindowsCompatibilityAgent\.exe\.config/);
    assert.match(script, /plugins\/windows-runtime-discovery\.exe/);
    assert.match(script, /web-iis\/web-iis-agent-side-plugin\.exe/);
    assert.match(script, /gcac-agent-updater\.exe/);
    assert.match(script, /GCACWindowsCompatibilityAgent/);
    assert.match(script, /compatibility-agent\.go\.windows\.config\.v1/);
    assert.match(script, /GCAC Windows Compatibility Go Agent bootstrap completed/);
    assert.match(script, /GCAC Windows Compatibility Agent Management TCP 18932/);
    assert.match(script, /advfirewall firewall delete rule name="GCAC Windows Compatibility Agent Management TCP 18932" 2>\$null/);
    assert.doesNotMatch(script, /-notmatch.*没有规则匹配|Compatibility Agent firewall rule cleanup failed/);
    assert.doesNotMatch(script, /JavaScriptSerializer/);
    assert.doesNotMatch(script, /ConvertFrom-Json|ConvertTo-Json/);
    assert.doesNotMatch(script, /\$manifest\.(?:tenantId|agentKey|enrollmentToken|controlPlaneUrl|artifacts|startAfterInstall)/);
    assert.doesNotMatch(script, /\$manifest\.artifacts|\$artifact\.content/);
    assert.match(script, /Write-Host/);
    assert.match(script, /ConvertTo-CompatibilityJsonString/);
    assert.doesNotMatch(script, /register-once/);
    assert.doesNotMatch(script, /full-agent\.go\.windows\.config\.v1/);
    assertWindowsCompatibilityBootstrapUsesGoArtifacts(script);
  });

  it('Linux 安装会话返回一条短期一次性安装命令', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/install-sessions/linux-go',
      headers: requestHeaders('tenant_linux_install_session', 'req_linux_install_session', {
        host: '127.0.0.1:3003',
        origin: 'http://10.255.0.85:5172',
      }),
      body: { zone: 'default' },
    });

    assert.equal(response.statusCode, 201, JSON.stringify(response.body));
    const body = response.body as InstallSessionResponse;
    assert.equal(body.platform, 'linux_go_systemd');
    assert.match(body.bootstrapUrl, /^http:\/\/10\.255\.0\.85:5172\/agent-install\?token=/);
    assert.match(body.installCommand, /^curl -fsSL 'http:\/\/10\.255\.0\.85:5172\/agent-install\?token=.*' \| sudo bash$/);
    assert.equal(body.bundleUrl, 'http://10.255.0.85:5172/api/v1/agents/install/linux/bundle.tar.gz');
    assert.doesNotMatch(JSON.stringify(body), /enroll_[^.]+\.secret_/);

    const token = new URL(body.bootstrapUrl).searchParams.get('token');
    assert.ok(token);
    assert.match(token, /^\d{8}$/);
    const ttlMs = new Date(body.expiresAt).getTime() - Date.now();
    assert.ok(ttlMs > 9 * 60 * 1000 && ttlMs <= 10 * 60 * 1000 + 10_000);

    const bootstrap = await app.inject({
      method: 'GET',
      path: `/agent-install?token=${encodeURIComponent(token)}`,
      headers: requestHeaders('tenant_linux_install_session', 'req_linux_bootstrap', {
        host: '127.0.0.1:3003',
        origin: 'http://10.255.0.85:5172',
      }),
    });
    assert.equal(bootstrap.statusCode, 200, JSON.stringify(bootstrap.body));
    assert.equal(bootstrap.headers['content-type'], 'text/x-shellscript; charset=utf-8');
    const script = String(bootstrap.body);
    assert.match(script, /GCAC_SKIP_RELEASE_SIGNATURE_VERIFY=bootstrap-fixed-bundle/);
    assert.match(script, /agent\.config\.json/);
    assert.match(script, /bundle\.tar\.gz/);
    assert.match(script, /enrollmentToken/);
    assert.doesNotMatch(script, /manifest\?token=/);

    const secondBootstrap = await app.inject({
      method: 'GET',
      path: `/agent-install?token=${encodeURIComponent(token)}`,
      headers: requestHeaders('tenant_linux_install_session', 'req_linux_bootstrap_second'),
    });
    assert.equal(secondBootstrap.statusCode, 403);
  });

  it('环境变量公共基地址优先于 Host、Origin 和转发头', async () => {
    const previous = process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL;
    process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL = 'https://gcac.public.example';
    try {
      const app = await createTestApp();
      const response = await app.inject({
        method: 'POST',
        path: '/api/v1/agents/install-sessions/linux-go',
        headers: requestHeaders('tenant_install_base_env', 'req_install_base_env', {
          host: 'attacker.invalid',
          origin: 'https://attacker.invalid',
          'x-forwarded-host': 'attacker.invalid',
          'x-forwarded-proto': 'https',
          'x-public-base-url': 'https://attacker.invalid',
        }),
        body: { zone: 'default' },
      });

      assert.equal(response.statusCode, 201, JSON.stringify(response.body));
      const body = response.body as InstallSessionResponse;
      assert.match(body.installCommand, /https:\/\/gcac\.public\.example\/agent-install\?token=/);
      assert.doesNotMatch(body.installCommand, /attacker\.invalid/);
      assert.equal(body.bundleUrl, 'https://gcac.public.example/api/v1/agents/install/linux/bundle.tar.gz');
    } finally {
      if (previous === undefined) {
        delete process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL;
      } else {
        process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL = previous;
      }
    }
  });

  it('安装材料接口仍不接受地址字段或查询参数', async () => {
    const app = await createTestApp();
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

  it('Linux bundle 下载入口返回固定安装包', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'GET',
      path: '/api/v1/agents/install/linux/bundle.tar.gz',
      headers: requestHeaders('tenant_linux_bundle', 'req_linux_bundle'),
    });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal(response.headers['content-type'], 'application/gzip');
    assert.ok(Buffer.isBuffer(response.body));
    assert.ok((response.body as Buffer).length > 1024);
  });
});

interface InstallSessionResponse {
  platform: 'windows_go_service' | 'windows_compatibility_service' | 'linux_go_systemd';
  expiresAt: string;
  bootstrapUrl: string;
  installCommand: string;
  serviceName: string;
  bundleUrl?: string;
}

function readWindowsBootstrapManifest(script: string): Record<string, unknown> {
  const matched = script.match(/\$manifest = @'\r?\n([\s\S]*?)\r?\n'@ \| ConvertFrom-Json/);
  assert.ok(matched?.[1], 'Windows bootstrap 必须包含 JSON manifest');
  return JSON.parse(matched[1]) as Record<string, unknown>;
}

function assertWindowsGoBootstrapUsesLatestAmd64Artifact(manifest: Record<string, unknown>): void {
  const artifacts = manifest.artifacts;
  assert.ok(Array.isArray(artifacts), 'Windows bootstrap 必须包含安装文件');
  const agentArtifact = artifacts.find((artifact): artifact is Record<string, unknown> => {
    return Boolean(artifact) && typeof artifact === 'object' && (artifact as Record<string, unknown>).path === 'gcac-agent.exe';
  });
  assert.ok(agentArtifact, 'Windows bootstrap 缺少 Go Agent 可执行文件');
  assert.equal(agentArtifact.encoding, 'base64');
  assert.equal(typeof agentArtifact.content, 'string');

  const expectedPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../agents/windows-go-full-agent/dist/gcac-agent.windows-amd64.exe');
  const expectedHash = createHash('sha256').update(readFileSync(expectedPath)).digest('hex');
  const actualHash = createHash('sha256')
    .update(Buffer.from(agentArtifact.content as string, 'base64'))
    .digest('hex');
  assert.equal(actualHash, expectedHash, 'Windows bootstrap 必须分发当前 amd64 发布物');

  const runtimeDiscoveryArtifact = artifacts.find((artifact): artifact is Record<string, unknown> => {
    return Boolean(artifact) && typeof artifact === 'object' && (artifact as Record<string, unknown>).path === 'plugins/windows-runtime-discovery.exe';
  });
  assert.ok(runtimeDiscoveryArtifact, 'Windows bootstrap 缺少 runtime discovery Agent-side Plugin');
  assert.equal(runtimeDiscoveryArtifact.encoding, 'base64');
  assert.equal(typeof runtimeDiscoveryArtifact.content, 'string');

  const pluginExpectedPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../agents/windows-go-full-agent/dist/plugins/windows-runtime-discovery.windows-amd64.exe');
  const pluginExpectedHash = createHash('sha256').update(readFileSync(pluginExpectedPath)).digest('hex');
  const pluginActualHash = createHash('sha256')
    .update(Buffer.from(runtimeDiscoveryArtifact.content as string, 'base64'))
    .digest('hex');
  assert.equal(pluginActualHash, pluginExpectedHash, 'Windows bootstrap 必须分发当前 amd64 runtime discovery Plugin');

  const updaterArtifact = artifacts.find((artifact): artifact is Record<string, unknown> => {
    return Boolean(artifact) && typeof artifact === 'object' && (artifact as Record<string, unknown>).path === 'gcac-agent-updater.exe';
  });
  assert.ok(updaterArtifact, 'Windows bootstrap 缺少 Go Agent 升级器');
  assert.equal(updaterArtifact.encoding, 'base64');
  assert.equal(typeof updaterArtifact.content, 'string');

  const updaterExpectedPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../agents/windows-go-full-agent/dist/gcac-agent-updater.windows-amd64.exe');
  const updaterExpectedHash = createHash('sha256').update(readFileSync(updaterExpectedPath)).digest('hex');
  const updaterActualHash = createHash('sha256')
    .update(Buffer.from(updaterArtifact.content as string, 'base64'))
    .digest('hex');
  assert.equal(updaterActualHash, updaterExpectedHash, 'Windows bootstrap 必须分发当前 amd64 升级器');
}

function assertWindowsCompatibilityBootstrapUsesGoArtifacts(script: string): void {
  const artifacts = new Map<string, string>();
  const pattern = /\$artifactPath = Join-Path \$root '([^']+)'[\s\S]*?FromBase64String\('([^']+)'\)/gu;
  for (const match of script.matchAll(pattern)) {
    artifacts.set(match[1], match[2]);
  }
  const expected = [
    ['GCAC.WindowsCompatibilityAgent.exe', '../../../../agents/windows-compat-full-agent/dist/GCAC.WindowsCompatibilityAgent.exe'],
    ['gcac-agent-updater.exe', '../../../../agents/windows-compat-full-agent/dist/gcac-agent-updater.exe'],
    ['plugins/windows-runtime-discovery.exe', '../../../../agents/windows-compat-full-agent/dist/plugins/windows-runtime-discovery.exe'],
    ['web-iis/web-iis-agent-side-plugin.exe', '../../../../agents/windows-compat-full-agent/dist/web-iis/web-iis-agent-side-plugin.exe'],
  ] as const;
  assert.deepEqual([...artifacts.keys()].sort(), expected.map(([path]) => path).sort(), 'Compatibility Bootstrap 只能分发四个 Go 产物');
  for (const [relativePath, sourcePath] of expected) {
    const encoded = artifacts.get(relativePath);
    assert.ok(encoded, `Compatibility Bootstrap 缺少 ${relativePath}`);
    const expectedHash = createHash('sha256').update(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), sourcePath))).digest('hex');
    const actualHash = createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('hex');
    assert.equal(actualHash, expectedHash, `Compatibility Bootstrap 产物哈希不匹配: ${relativePath}`);
  }
}

async function createTestApp() {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  return configureTestAuth(createApp({ db: database }));
}

function requestHeaders(tenantId: string, requestId: string, extra: Record<string, string> = {}): Record<string, string> {
  return testAuthHeaders('agent_install_test', tenantId, {
    'x-request-id': requestId,
    ...extra,
  });
}

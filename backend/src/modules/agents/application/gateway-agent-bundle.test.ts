import assert from 'node:assert/strict';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { AgentsApplicationService } from './agents.application-service.js';
import type { AgentInstallSession } from '../schema/agents.schema.js';
import {
  buildGatewayAgentBundleTarGz,
  GATEWAY_AGENT_RELEASE_VERSION,
  getGatewayAgentInstallMaterials,
  getGatewayAgentBundleManifest,
  loadGatewayWindowsAgentArtifacts,
} from './gateway-agent-bundle.js';

test('Gateway Agent 固定版本 Artifact 引用与实际二进制摘要一致', () => {
  const linuxAmd64 = getGatewayAgentInstallMaterials('linux_go', 'amd64');
  assert.equal(linuxAmd64.version, GATEWAY_AGENT_RELEASE_VERSION);
  assert.equal(linuxAmd64.platform, 'linux_go');
  assert.equal(linuxAmd64.arch, 'amd64');
  assert.match(linuxAmd64.digest, /^[0-9a-f]{64}$/u);
  const windowsAmd64 = getGatewayAgentInstallMaterials('windows_go', 'amd64');
  assert.equal(windowsAmd64.platform, 'windows_go');
  assert.equal(windowsAmd64.arch, 'amd64');
});

test('Gateway Agent Linux bundle 可解压且包含独立二进制与 systemd 单元', () => {
  const bundle = buildGatewayAgentBundleTarGz();
  const tar = gunzipSync(bundle).toString('utf8');
  assert.ok(tar.includes('gcac-gateway-agent'), 'bundle 应包含独立网关二进制');
  assert.ok(tar.includes('linux/gcac-gateway-agent.service'), 'bundle 应包含网关 systemd 单元');
  assert.ok(tar.includes('gcac.gateway-agent.v1'), 'bundle 应包含网关配置模板');
  const manifest = getGatewayAgentBundleManifest();
  assert.equal(manifest.bundleName, 'gcac-gateway-agent-bundle.tar.gz');
  assert.ok(manifest.items.some((item) => item.path === 'gcac-gateway-agent' && item.mode === '0755'));
});

test('Gateway Agent Windows 安装材料包含独立 exe 与网关配置模板', async () => {
  const artifacts = await loadGatewayWindowsAgentArtifacts();
  const exe = artifacts.find((artifact) => artifact.path === 'gcac-gateway-agent.exe');
  assert.ok(exe, '应包含 gcac-gateway-agent.exe');
  assert.equal(exe?.encoding, 'base64');
  const template = artifacts.find((artifact) => artifact.path === 'config/agent.config.template.json');
  assert.ok(template?.content?.includes('gcac.gateway-agent.v1'), '配置模板应使用网关 schema');
});

test('gateway 角色安装材料使用独立 Gateway Agent 并注入中继配置', async () => {
  const service = new AgentsApplicationService();
  const result = await service.createAgentInstallMaterials('tenant-e2e', {
    platform: 'linux_go',
    role: 'gateway',
    zone: 'zone_dmz',
    relayAllowedTargets: ['target.example.test'],
    relayAllowedPorts: [443],
  }, 'req-gateway-materials');
  assert.equal(result.materials[0]?.version, GATEWAY_AGENT_RELEASE_VERSION);
  const taskInput = result.task.input as Record<string, unknown>;
  assert.equal(taskInput.relayEnabled, true);
  assert.equal(taskInput.relayPort, 18934);
  assert.equal(taskInput.relayListenAddress, '0.0.0.0');
  const keys = taskInput.relayClientPublicKeys as string[];
  assert.ok(Array.isArray(keys) && keys.length === 1, '应注入控制面中继公钥');
  assert.match(keys[0], /^[0-9a-f]{64}$/u);
});

test('gateway 角色 Linux manifest 携带独立 Gateway bundle 地址', async () => {
  const service = new AgentsApplicationService();
  const manifest = await service.buildLinuxGoInstallManifest(gatewaySession(), 'https://gcac.example.invalid');
  assert.equal(manifest.gatewayBundleUrl, 'https://gcac.example.invalid/api/v1/agents/install/gateway/bundle.tar.gz');
  assert.equal(manifest.gatewayBundleManifest?.bundleName, 'gcac-gateway-agent-bundle.tar.gz');
  assert.equal(manifest.relayPort, 18934);
  assert.equal(manifest.relayClientPublicKeys?.length, 1);
});

test('full_agent 角色 Linux manifest 仍使用 Full Agent bundle', async () => {
  const service = new AgentsApplicationService();
  const manifest = await service.buildLinuxGoInstallManifest({ ...gatewaySession(), role: 'full_agent' }, 'https://gcac.example.invalid');
  assert.equal(manifest.bundleUrl, 'https://gcac.example.invalid/api/v1/agents/install/linux/bundle.tar.gz');
  assert.equal(manifest.gatewayBundleUrl, undefined);
});

function gatewaySession(): AgentInstallSession {
  return {
    id: 'session-gateway-test',
    tenantId: 'tenant-test',
    platform: 'linux_go_systemd',
    bootstrapTokenHash: 'hash',
    bootstrapTokenPreview: 'preview',
    enrollmentToken: 'enrollment',
    agentKey: 'agent-key',
    controlPlaneUrl: 'https://gcac.example.invalid',
    zone: 'zone_dmz',
    role: 'gateway',
    startAfterInstall: true,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    serviceName: 'gcac-gateway-agent',
    displayName: 'GCAC Linux Gateway Agent',
    installRoot: '/opt/gcac/gateway',
    configDir: '/etc/gcac/gateway',
    dataDir: '/var/lib/gcac/gateway',
    logDir: '/var/log/gcac/gateway',
  };
}

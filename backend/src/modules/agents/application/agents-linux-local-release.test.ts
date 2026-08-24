import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AgentsApplicationService } from './agents.application-service.js';
import type { AgentRegistration, AgentUpgradePlan, AgentVersionRelease } from '../schema/agents.schema.js';

test('Linux Go 本地构建产物会自动登记并提供固定下载内容', async () => {
  const previousBaseUrl = process.env.GCAC_PUBLIC_BASE_URL;
  const previousReleaseBaseUrl = process.env.GCAC_AGENT_RELEASE_BASE_URL;
  process.env.GCAC_PUBLIC_BASE_URL = '';
  process.env.GCAC_AGENT_RELEASE_BASE_URL = 'http://127.0.0.1:3003';
  try {
    const now = new Date().toISOString();
    const agent: AgentRegistration = {
      id: 'agent-linux-local-release',
      tenantId: 'tenant-linux-local-release',
      agentKey: 'agent-linux-local-release',
      descriptor: {
        agentKey: 'agent-linux-local-release',
        hostname: 'agent-linux-local-release',
        version: '0.1.15',
        osType: 'LINUX',
        arch: 'amd64',
        labels: [],
      },
      status: 'ONLINE',
      registeredAt: now,
      updatedAt: now,
      version: 1,
    };
    const releases: AgentVersionRelease[] = [];
    const plans: AgentUpgradePlan[] = [];
    const repository = {
      getRegistration: async () => agent,
      publishVersion: async (release: AgentVersionRelease) => {
        const index = releases.findIndex((item) => item.id === release.id);
        if (index >= 0) releases[index] = release;
        else releases.push(release);
        return release;
      },
      listActiveVersions: async () => releases.filter((release) => release.status === 'active'),
      getVersion: async (releaseId: string) => releases.find((release) => release.id === releaseId),
      findUpgradePlanForAgent: async () => undefined,
      findUpgradePlanByIdempotencyKey: async () => undefined,
      listUpgradePlansForAgent: async () => plans,
      createUpgradePlan: async (plan: AgentUpgradePlan) => plan,
      updateUpgradePlan: async (_id: string, patch: Partial<AgentUpgradePlan>) => ({ ...plans[0], ...patch } as AgentUpgradePlan),
      getUpgradePlan: async () => undefined,
    };
    const service = new AgentsApplicationService(
      repository as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    const suggestion = await service.getUpgradeSuggestion(agent.tenantId, agent.id);
    assert.equal(suggestion.suggestion.status, 'available');
    if (suggestion.suggestion.status !== 'available') return;
    const buildScript = await readFile(new URL('../../../../../agents/linux-go-full-agent/build.sh', import.meta.url), 'utf8');
    const expectedTargetVersion = buildScript.match(/VERSION_VALUE="\$\{VERSION:-([^"}]+)\}"/u)?.[1];
    if (!expectedTargetVersion || !suggestion.suggestion.downloadUrl || !suggestion.suggestion.releaseId) throw new Error('Linux 本地 Release 建议缺少固定字段');
    assert.equal(suggestion.suggestion.targetVersion, expectedTargetVersion);
    assert.match(suggestion.suggestion.downloadUrl, /^http:\/\/127\.0\.0\.1:3003\/agent-releases\/agrel-local-linux-go-/u);
    assert.equal(releases.filter((release) => release.productLine === 'linux-go-full').length, 2);

    const artifact = await service.getReleaseArtifact(suggestion.suggestion.releaseId);
    assert.equal(artifact.content.length, artifact.release.artifactSize);
    assert.equal(artifact.release.checksumSha256.length, 64);
  } finally {
    if (previousBaseUrl === undefined) delete process.env.GCAC_PUBLIC_BASE_URL;
    else process.env.GCAC_PUBLIC_BASE_URL = previousBaseUrl;
    if (previousReleaseBaseUrl === undefined) delete process.env.GCAC_AGENT_RELEASE_BASE_URL;
    else process.env.GCAC_AGENT_RELEASE_BASE_URL = previousReleaseBaseUrl;
  }
});

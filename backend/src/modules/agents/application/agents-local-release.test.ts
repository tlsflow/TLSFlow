import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AgentsApplicationService } from './agents.application-service.js';
import type { AgentRegistration, AgentUpgradePlan, AgentVersionRelease } from '../schema/agents.schema.js';

test('Windows Go 本地构建产物会自动登记并提供固定下载内容', async () => {
  const previousBaseUrl = process.env.GCAC_PUBLIC_BASE_URL;
  const previousReleaseBaseUrl = process.env.GCAC_AGENT_RELEASE_BASE_URL;
  process.env.GCAC_PUBLIC_BASE_URL = '';
  process.env.GCAC_AGENT_RELEASE_BASE_URL = 'http://127.0.0.1:3003';
  try {
    const now = new Date().toISOString();
    const agent: AgentRegistration = {
      id: 'agent-local-release',
      tenantId: 'tenant-local-release',
      agentKey: 'agent-local-release',
      descriptor: {
        agentKey: 'agent-local-release',
        hostname: 'agent-local-release',
        version: '0.1.31',
        osType: 'WINDOWS',
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
    const agentSource = await readFile(new URL('../../../../../agents/windows-go-full-agent/main.go', import.meta.url), 'utf8');
    const expectedTargetVersion = agentSource.match(/\bagentVersion\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)"/u)?.[1];
    assert.ok(expectedTargetVersion);
    assert.equal(suggestion.suggestion.targetVersion, expectedTargetVersion);
    assert.ok(suggestion.suggestion.downloadUrl);
    assert.match(suggestion.suggestion.downloadUrl, /^http:\/\/127\.0\.0\.1:3003\/agent-releases\/agrel-local-windows-go-/);
    assert.equal(releases.filter((release) => release.productLine === 'windows-go-full').length, 2);
    const localReleaseIds = releases.filter((release) => release.productLine === 'windows-go-full').map((release) => release.id);

    assert.ok(suggestion.suggestion.releaseId);
    const artifact = await service.getReleaseArtifact(suggestion.suggestion.releaseId);
    assert.equal(artifact.content.length, artifact.release.artifactSize);
    assert.equal(artifact.release.checksumSha256.length, 64);

    await service.getUpgradeSuggestion(agent.tenantId, agent.id);
    assert.equal(releases.filter((release) => release.productLine === 'windows-go-full').length, 2);
    assert.deepEqual(releases.filter((release) => release.productLine === 'windows-go-full').map((release) => release.id), localReleaseIds);
  } finally {
    if (previousBaseUrl === undefined) delete process.env.GCAC_PUBLIC_BASE_URL;
    else process.env.GCAC_PUBLIC_BASE_URL = previousBaseUrl;
    if (previousReleaseBaseUrl === undefined) delete process.env.GCAC_AGENT_RELEASE_BASE_URL;
    else process.env.GCAC_AGENT_RELEASE_BASE_URL = previousReleaseBaseUrl;
  }
});

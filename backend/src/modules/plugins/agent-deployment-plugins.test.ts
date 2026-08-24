import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DeploymentStrategyResolver } from '../deployment-plans/application/deployment-strategy-resolver.js';
import { AgentActionDispatchRegistry } from '../executions/application/agent-action-dispatch-registry.js';
import { AgentDeploymentPluginsApplicationService } from './application/agent-deployment-plugins.application-service.js';
import { builtinAgentPluginManifests } from './builtin-agent-plugins/builtin-agent-plugins.js';
import { validateAgentDeploymentPluginManifest } from './schema/agent-deployment-plugins.schema.js';

describe('Agent 原子操作部署插件', () => {
  it('首批内置插件全部通过 Manifest 校验', () => {
    assert.equal(builtinAgentPluginManifests.length, 3);
    for (const manifest of builtinAgentPluginManifests) {
      const validated = validateAgentDeploymentPluginManifest(manifest);
      assert.equal(validated.apiVersion, 'gcac.agent-plugin/v1');
      assert.ok(validated.operations.length > 0);
      assert.ok((validated.rollback ?? []).length > 0);
    }
  });

  it('插件模式不要求 SiteAsset 和 ManagedTarget', () => {
    const resolved = new DeploymentStrategyResolver().resolve({
      applicationAsset: {
        id: 'asset-1',
        tenantId: 'tenant-1',
        displayName: 'custom-service',
        status: 'ACTIVE',
        tags: [],
        deploymentStrategy: {
          type: 'AGENT',
          agent: {
            mode: 'PLUGIN',
            agentId: 'agent-1',
            plugin: {
              mountId: 'mount-1',
              pluginPackageId: 'plugin-1',
              pluginVersionId: 'plugin-1',
              variableBindings: {},
              secretBindings: {},
              certificateArtifactBindings: {},
            },
          },
        },
      } as never,
      certificateBinding: { id: 'binding-1' } as never,
    });
    assert.equal(resolved.executionTargetId, 'agent-1');
    assert.deepEqual(resolved.requiredCapabilities, ['agent.atomic_plan.execute']);
    assert.equal(resolved.payload.agentDeploymentMode, 'PLUGIN');
  });

  it('原子计划动作优先走 Agent 直连派发', () => {
    const resolved = new AgentActionDispatchRegistry().resolve({ actionType: 'agent.atomic_plan.execute' });
    assert.equal(resolved?.mode, 'direct_preferred');
  });

  it('用户插件保存到 data/agent-plugins 约定目录且同版本不可覆盖', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'gcac-agent-plugins-'));
    const records = new Map<string, unknown>();
    const repository = {
      saveAgentPackage: async (record: { id: string }) => {
        records.set(record.id, record);
        return record;
      },
    };
    const service = new AgentDeploymentPluginsApplicationService(repository as never, {} as never, {} as never, rootDir);
    const manifest = {
      ...builtinAgentPluginManifests[0]!,
      pluginId: 'test.rabbitmq.pem',
      version: '1.0.0',
    };
    try {
      const uploaded = await service.uploadPackage({ manifest, packageContent: 'package-content' }, 'tenant-1');
      assert.equal(uploaded.storageKey, 'agent-plugins/test.rabbitmq.pem/1.0.0');
      assert.equal(await readFile(join(rootDir, 'test.rabbitmq.pem', '1.0.0', 'package.bin'), 'utf8'), 'package-content');
      const persistedManifest = JSON.parse(await readFile(join(rootDir, 'test.rabbitmq.pem', '1.0.0', 'manifest.json'), 'utf8'));
      assert.equal(persistedManifest.pluginId, 'test.rabbitmq.pem');
      await assert.rejects(
        () => service.uploadPackage({ manifest, packageContent: 'changed-content' }, 'tenant-1'),
        /不可覆盖/,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

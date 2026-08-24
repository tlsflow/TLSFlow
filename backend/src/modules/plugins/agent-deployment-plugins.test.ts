import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DeploymentStrategyResolver } from '../deployment-plans/application/deployment-strategy-resolver.js';
import { AgentActionDispatchRegistry } from '../executions/application/agent-action-dispatch-registry.js';
import { normalizeDeploymentStrategy } from '../assets/application/deployment-strategy.service.js';
import { WorkflowTemplatesApplicationService } from '../workflow-templates/application/workflow-templates.application-service.js';
import { AgentDeploymentPluginsApplicationService } from './application/agent-deployment-plugins.application-service.js';
import { builtinAgentPluginManifests } from './builtin-agent-plugins/builtin-agent-plugins.js';
import { validateAgentDeploymentPluginManifest } from './schema/agent-deployment-plugins.schema.js';

describe('Agent 原子操作部署插件', () => {
  it('首批内置插件全部通过 Manifest 校验', () => {
    assert.equal(builtinAgentPluginManifests.length, 5);
    assert.ok(builtinAgentPluginManifests.some((item) => item.pluginId === 'builtin.linux.nginx.pem'));
    assert.ok(builtinAgentPluginManifests.some((item) => item.pluginId === 'builtin.windows.iis.pfx'));
    for (const manifest of builtinAgentPluginManifests) {
      const validated = validateAgentDeploymentPluginManifest(manifest);
      assert.equal(validated.apiVersion, 'gcac.agent-plugin/v1');
      assert.ok(validated.operations.length > 0);
      assert.ok((validated.rollback ?? []).length > 0);
    }
  });

  it('NGINX 插件计划解析绑定输出和嵌套证书指纹', async () => {
    const manifest = builtinAgentPluginManifests.find((item) => item.pluginId === 'builtin.linux.nginx.pem')!;
    const packageRecord = {
      id: 'plugin-nginx', tenantId: 'tenant-1', manifest, packageHash: 'sha256:nginx', signatureStatus: 'trusted',
      installStatus: 'enabled', permissionApprovalStatus: 'approved', approvedPermissions: manifest.permissions.map((item) => item.name),
      storageKey: 'builtin', uploadedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const repository = {
      findAgentPackage: async () => packageRecord,
      findCatalogActivation: async () => ({ status: 'enabled' }),
    };
    const agents = compatibleAgentsService('LINUX');
    const service = new AgentDeploymentPluginsApplicationService(repository as never, agents as never, {} as never);
    const plan = await service.compileExecutionPlan({
      tenantId: 'tenant-1', agentId: 'agent-linux', executionRunId: 'run-1', executionStepId: 'step-1',
      binding: {
        pluginPackageId: packageRecord.id,
        pluginVersionId: packageRecord.id,
        variableBindings: {
          certificatePath: '/etc/nginx/tls/site.crt', privateKeyPath: '/etc/nginx/tls/site.key',
          nginxProgram: '/usr/sbin/nginx', serviceName: 'nginx', verifyHost: 'site.example.com', verifyPort: 443,
        },
        secretBindings: {},
        certificateArtifactBindings: {
          certificate: { certificateFormatId: 'pem', outputBindings: { value: 'certFile' } },
          privateKey: { certificateFormatId: 'pem', outputBindings: { value: 'keyFile' } },
        },
      },
      artifacts: {
        certificate: {
          fingerprintSha256: 'abc123',
          outputs: { certFile: { content: 'certificate-pem' } },
        },
        privateKey: { outputs: { keyFile: { content: 'private-key-pem' } } },
      },
    });
    const install = plan.operations.find((item) => item.id === 'nginx-cert-install');
    const verify = plan.operations.find((item) => item.id === 'nginx-tls-verify');
    assert.equal((install?.input.artifact as Record<string, unknown>).content, 'certificate-pem');
    assert.equal(verify?.input.expectedFingerprint, 'abc123');
  });

  it('IIS 插件计划保留 PFX 密码并生成 Binding 原子操作', async () => {
    const manifest = builtinAgentPluginManifests.find((item) => item.pluginId === 'builtin.windows.iis.pfx')!;
    const packageRecord = {
      id: 'plugin-iis', tenantId: 'tenant-1', manifest, packageHash: 'sha256:iis', signatureStatus: 'trusted',
      installStatus: 'enabled', permissionApprovalStatus: 'approved', approvedPermissions: manifest.permissions.map((item) => item.name),
      storageKey: 'builtin', uploadedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const service = new AgentDeploymentPluginsApplicationService({
      findAgentPackage: async () => packageRecord,
      findCatalogActivation: async () => ({ status: 'enabled' }),
    } as never, compatibleAgentsService('WINDOWS') as never, {} as never);
    const plan = await service.compileExecutionPlan({
      tenantId: 'tenant-1', agentId: 'agent-windows', executionRunId: 'run-2', executionStepId: 'step-2',
      binding: {
        pluginPackageId: packageRecord.id,
        pluginVersionId: packageRecord.id,
        variableBindings: {
          siteName: 'Default Web Site', bindingInformation: '*:443:site.example.com',
          verifyHost: 'site.example.com', verifyPort: 443,
        },
        secretBindings: {},
        certificateArtifactBindings: {
          certificate: { certificateFormatId: 'pfx', outputBindings: { value: 'bundleFile' } },
        },
      },
      artifacts: {
        certificate: {
          fingerprintSha256: 'def456',
          pfxPassword: 'pfx-password',
          outputs: { bundleFile: { contentBase64: 'cGZ4' } },
        },
      },
    });
    const importOperation = plan.operations.find((item) => item.id === 'iis-pfx-import');
    const updateOperation = plan.operations.find((item) => item.id === 'iis-binding-update');
    const artifact = importOperation?.input.artifact as Record<string, unknown>;
    assert.equal(artifact.contentBase64, 'cGZ4');
    assert.equal(artifact.pfxPassword, 'pfx-password');
    assert.equal(updateOperation?.operationType, 'windows.iis.binding.update_certificate');
    assert.deepEqual(updateOperation?.input.bindingSelector, { bindingInformation: '*:443:site.example.com' });
    assert.equal(Object.hasOwn(plan.operations.find((item) => item.id === 'iis-private-key-grant')?.input ?? {}, 'appPoolName'), false);
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

  it('新资产插件绑定不要求 mountId', () => {
    const normalized = normalizeDeploymentStrategy({
      type: 'AGENT',
      agent: {
        mode: 'PLUGIN',
        agentId: 'agent-1',
        plugin: {
          pluginPackageId: 'plugin-1',
          pluginVersionId: 'plugin-1',
          variableBindings: {},
          secretBindings: {},
          certificateArtifactBindings: {},
        },
      },
    }, {
      asset: { id: 'asset-1', metadata: {} } as never,
      actorId: 'user-1',
      now: '2026-07-22T00:00:00.000Z',
    });
    assert.equal(normalized.agent?.plugin?.mountId, undefined);
    assert.equal(normalized.agent?.plugin?.pluginPackageId, 'plugin-1');
  });

  it('原子计划动作优先走 Agent 直连派发', () => {
    const resolved = new AgentActionDispatchRegistry().resolve({ actionType: 'agent.atomic_plan.execute' });
    assert.equal(resolved?.mode, 'direct_preferred');
  });

  it('Agent 插件未手动启用时拒绝绑定预览', async () => {
    const manifest = builtinAgentPluginManifests.find((item) => item.pluginId === 'builtin.linux.nginx.pem')!;
    const packageRecord = {
      id: 'plugin-disabled', tenantId: 'tenant-1', manifest, packageHash: 'sha256:disabled', signatureStatus: 'trusted',
      installStatus: 'enabled', permissionApprovalStatus: 'approved', approvedPermissions: manifest.permissions.map((item) => item.name),
      storageKey: 'builtin', uploadedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const service = new AgentDeploymentPluginsApplicationService({
      findAgentPackage: async () => packageRecord,
      findCatalogActivation: async () => undefined,
    } as never, compatibleAgentsService('LINUX') as never, {} as never);
    await assert.rejects(() => service.previewBinding('tenant-1', 'agent-linux', {
      pluginPackageId: packageRecord.id,
      pluginVersionId: packageRecord.id,
      variableBindings: {
        certificatePath: '/etc/nginx/tls/site.crt', privateKeyPath: '/etc/nginx/tls/site.key',
        nginxProgram: '/usr/sbin/nginx', serviceName: 'nginx', verifyHost: 'site.example.com', verifyPort: 443,
      },
      secretBindings: {},
      certificateArtifactBindings: {
        certificate: { certificateFormatId: 'pem', outputBindings: { value: 'certFile' } },
        privateKey: { certificateFormatId: 'pem', outputBindings: { value: 'keyFile' } },
      },
    }), /未手动启用/);
  });

  it('手动启用 Agent 插件会写入目录启用状态', async () => {
    const manifest = builtinAgentPluginManifests.find((item) => item.pluginId === 'builtin.rabbitmq.pem')!;
    const packageRecord = {
      id: 'plugin-rabbitmq', tenantId: 'tenant-1', manifest, packageHash: 'sha256:rabbitmq', signatureStatus: 'trusted',
      installStatus: 'installed_disabled', permissionApprovalStatus: 'approved', approvedPermissions: manifest.permissions.map((item) => item.name),
      storageKey: 'builtin', uploadedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    let activation: Record<string, unknown> | undefined;
    const service = new AgentDeploymentPluginsApplicationService({
      findAgentPackage: async () => packageRecord,
      saveAgentPackage: async (record: unknown) => record,
      saveCatalogActivation: async (record: Record<string, unknown>) => {
        activation = record;
        return record;
      },
    } as never, {} as never, {} as never);
    const enabled = await service.enablePackage({ pluginPackageId: packageRecord.id });
    assert.equal(enabled.catalogEnabled, true);
    assert.equal(activation?.status, 'enabled');
    assert.equal(activation?.pluginId, packageRecord.id);
  });

  it('DSL 模板选择器只返回手动启用的模板', async () => {
    const files = [{ id: 'builtin/demo.json', source: 'builtin', fileName: 'demo.json', relativePath: 'demo.json', valid: true, updatedAt: '2026-07-22T00:00:00.000Z' }];
    let enabled = false;
    const service = new WorkflowTemplatesApplicationService({
      listFileTemplates: async () => files,
      createTemplateFromFile: async () => ({ id: 'workflow-1' }),
    } as never, {}, {
      listCatalogActivations: async () => enabled ? [{ catalogType: 'WORKFLOW_TEMPLATE', status: 'enabled', pluginId: files[0]!.id }] : [],
      findCatalogActivation: async () => enabled ? { status: 'enabled' } : undefined,
    } as never);
    assert.deepEqual(await service.listFileTemplates({ tenantId: 'tenant-1', enabledOnly: true }), []);
    await assert.rejects(() => service.createTemplateFromFile({ fileTemplateId: files[0]!.id }, 'tenant-1'), /未手动启用/);
    enabled = true;
    assert.equal((await service.listFileTemplates({ tenantId: 'tenant-1', enabledOnly: true })).length, 1);
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

  it('拒绝要求更高 GCAC 版本的 Agent 插件', async () => {
    const service = new AgentDeploymentPluginsApplicationService({} as never, {} as never, {} as never, tmpdir());
    await assert.rejects(
      () => service.uploadPackage({
        manifest: { ...builtinAgentPluginManifests[0]!, pluginId: 'future.agent.plugin', minGcacVersion: '999.0.0' },
        packageContent: 'future-package',
      }, 'tenant-1'),
      /当前版本不兼容/,
    );
  });
});

function compatibleAgentsService(platform: 'WINDOWS' | 'LINUX') {
  return {
    getAgentDetail: async () => ({
      agent: {
        status: 'ONLINE',
        descriptor: { osType: platform, arch: 'amd64' },
        directControl: { supportedActions: ['agent.atomic_plan.execute'] },
      },
      capabilitySnapshot: { capabilities: [{ capabilityKey: 'agent.atomic_plan.execute' }] },
    }),
  };
}

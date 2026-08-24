import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PluginsApplicationService } from './application/plugins.application-service.js';
import { getPluginsRouteContracts } from './controller/plugins.controller.js';
import type { PluginPackageManifest } from './dto/plugins.dto.js';

describe('spec024 插件管理与安全沙箱 mock-safe 闭环', () => {
  it('校验 manifest、hash 和 mock 签名后安装低风险插件', async () => {
    const service = new PluginsApplicationService();
    const manifest = createManifest();
    const packageContent = JSON.stringify({ manifest, files: ['plugin.json'] });
    const packageHash = service.calculateHash(packageContent);

    const record = await service.uploadPackage({
      manifest,
      packageContent,
      expectedHash: packageHash,
      signature: `mock-trusted:${packageHash}`,
    });

    assert.equal(record.packageHash, packageHash);
    assert.equal(record.signatureStatus, 'trusted');
    assert.equal(record.installStatus, 'installed_disabled');
    assert.equal(record.permissionApprovalStatus, 'not_required');
  });

  it('拒绝缺字段 metadata、hash 不匹配和无效签名', async () => {
    const service = new PluginsApplicationService();
    const manifest = createManifest();
    const content = 'package';

    await assert.rejects(
      () => service.uploadPackage({ manifest: { ...manifest, actions: [] }, packageContent: content }),
      (error: any) => error.errorCode === 'VALIDATION_FAILED',
    );
    await assert.rejects(
      () => service.uploadPackage({ manifest, packageContent: content, expectedHash: 'sha256:bad' }),
      (error: any) => error.errorCode === 'VALIDATION_FAILED',
    );
    await assert.rejects(
      () => service.uploadPackage({ manifest, packageContent: content, signature: 'bad-signature' }),
      (error: any) => error.errorCode === 'PLUGIN_SIGNATURE_INVALID',
    );
  });

  it('高风险权限未审批不能启用，审批不能超过声明', async () => {
    const service = new PluginsApplicationService();
    const record = await service.uploadPackage({
      manifest: createManifest({
        permissions: [
          { name: 'process.exec', risk: 'high', scope: 'process', values: ['gcac-plugin'] },
        ],
        actions: [
          { name: 'deploy', command: 'gcac-plugin', requiredPermissions: ['process.exec'], requiredSecretScopes: ['action.bound'] },
        ],
      }),
      packageContent: 'high-risk-package',
    });

    assert.equal(record.installStatus, 'pending_approval');
    await assert.rejects(() => service.enablePlugin({ pluginPackageId: record.id }), (error: any) => error.errorCode === 'PLUGIN_PERMISSION_DENIED');
    await assert.rejects(
      () => service.approvePermissions({ pluginPackageId: record.id, approvedBy: 'sec_1', approvedPermissions: ['process.exec', 'root'] }),
      (error: any) => error.errorCode === 'PLUGIN_PERMISSION_DENIED',
    );

    await service.approvePermissions({ pluginPackageId: record.id, approvedBy: 'sec_1', approvedPermissions: ['process.exec'] });
    const enabled = await service.enablePlugin({ pluginPackageId: record.id });
    assert.equal(enabled.installStatus, 'enabled');
  });

  it('process runtime 只做 mock：校验 command allowlist、Secret scope、timeout 和日志脱敏', async () => {
    const service = new PluginsApplicationService();
    const record = await service.uploadPackage({
      manifest: createManifest({
        runtime: { type: 'process', entry: 'gcac-plugin', timeoutSeconds: 30, allowedCommands: ['gcac-plugin'] },
        permissions: [
          { name: 'process.exec', risk: 'high', scope: 'process', values: ['gcac-plugin'] },
          { name: 'secret.read', risk: 'high', scope: 'secret', values: ['api_token'] },
        ],
        actions: [
          { name: 'deploy', command: 'gcac-plugin', requiredPermissions: ['process.exec', 'secret.read'], requiredSecretScopes: ['action.bound'] },
        ],
      }),
      packageContent: 'runtime-package',
    });
    await service.approvePermissions({ pluginPackageId: record.id, approvedBy: 'sec_1', approvedPermissions: ['process.exec', 'secret.read'] });
    await service.enablePlugin({ pluginPackageId: record.id });

    await assert.rejects(
      () => service.execute({ pluginPackageId: record.id, action: 'deploy', command: 'rm', secretRefs: [], allowedSecretRefs: [] }),
      (error: any) => error.errorCode === 'PLUGIN_PERMISSION_DENIED',
    );
    await assert.rejects(
      () => service.execute({ pluginPackageId: record.id, action: 'deploy', command: 'gcac-plugin', secretRefs: ['secret://api_token/2#v1'], allowedSecretRefs: ['secret://api_token/1#v1'] }),
      (error: any) => error.errorCode === 'SECRET_REF_INVALID',
    );

    const timeout = await service.execute({ pluginPackageId: record.id, action: 'deploy', command: 'gcac-plugin', timeoutSeconds: 60 });
    assert.equal(timeout.status, 'timeout');
    assert.equal(timeout.errorCode, 'EXECUTION_TIMEOUT');

    const result = await service.execute({
      pluginPackageId: record.id,
      action: 'deploy',
      command: 'gcac-plugin',
      secretRefs: ['secret://api_token/1#v1'],
      allowedSecretRefs: ['secret://api_token/1#v1'],
      mockStdout: 'token="super-secret-token"',
    });
    assert.equal(result.status, 'success');
    assert.match(result.stdout, /REDACTED/);
    assert.ok(result.redactionMatches > 0);
  });

  it('container wasm http runtime 只返回预留 descriptor，不执行真实运行时', async () => {
    const service = new PluginsApplicationService();
    const record = await service.uploadPackage({
      manifest: createManifest({
        runtime: { type: 'wasm', entry: 'plugin.wasm', timeoutSeconds: 10, wasm: { module: 'plugin.wasm' } },
      }),
      packageContent: 'wasm-package',
    });
    await service.enablePlugin({ pluginPackageId: record.id });

    const result = await service.execute({ pluginPackageId: record.id, action: 'deploy', command: 'plugin.wasm' });
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'PLUGIN_RUNTIME_UNSUPPORTED');
    assert.equal(result.runtimeDescriptor?.type, 'wasm');
  });

  it('输出 capability、step draft、permission summary 和 OpenAPI route contracts', async () => {
    const service = new PluginsApplicationService();
    const record = await service.uploadPackage({ manifest: createManifest(), packageContent: 'cap-package' });
    assert.deepEqual(await service.publishCapabilities(record.id), []);
    await service.enablePlugin({ pluginPackageId: record.id });

    const capabilities = await service.publishCapabilities(record.id);
    assert.equal(capabilities[0]?.key, 'provider.nginx.deploy');
    const stepDraft = await service.getStepDraft(record.id, 'deploy');
    assert.deepEqual(stepDraft.requiredPermissions, ['process.exec']);
    const permissionSummary = await service.getPermissionSummary(record.id);
    assert.equal(permissionSummary.canEnable, true);

    const contracts = getPluginsRouteContracts();
    assert.ok(contracts.some((contract) => contract.operationId === 'uploadPluginPackage'));
    assert.ok(contracts.some((contract) => contract.operationId === 'executePluginMockRuntime'));
  });

  it('拒绝要求更高 GCAC 版本的用户插件', async () => {
    const service = new PluginsApplicationService();
    await assert.rejects(
      () => service.uploadPackage({
        manifest: createManifest({ minGcacVersion: '999.0.0' }),
        packageContent: 'future-package',
      }),
      /当前版本不兼容/,
    );
  });

  it('历史用户插件缺少最低版本时按 0.0.0 处理', async () => {
    const service = new PluginsApplicationService();
    const manifest = createManifest();
    delete manifest.minGcacVersion;
    const record = await service.uploadPackage({ manifest, packageContent: 'legacy-package' });
    assert.equal(record.manifest.minGcacVersion, '0.0.0');
  });
});

function createManifest(patch: Partial<PluginPackageManifest> = {}): PluginPackageManifest {
  return {
    apiVersion: 'gcac.plugin/v1',
    kind: 'Plugin',
    pluginId: 'example-nginx-provider',
    name: 'Example NGINX Provider',
    publisher: 'example-inc',
    version: '1.0.0',
    minGcacVersion: '0.1.0',
    runtime: { type: 'process', entry: 'gcac-plugin', timeoutSeconds: 30, allowedCommands: ['gcac-plugin'] },
    actions: [
      { name: 'deploy', command: 'gcac-plugin', requiredPermissions: ['process.exec'], requiredSecretScopes: [] },
    ],
    permissions: [
      { name: 'process.exec', risk: 'low', scope: 'process', values: ['gcac-plugin'] },
    ],
    capabilities: [
      { key: 'provider.nginx.deploy', level: 'L1', riskLevel: 'low', requires: ['process.exec'], os: ['linux'] },
    ],
    ...patch,
  };
}

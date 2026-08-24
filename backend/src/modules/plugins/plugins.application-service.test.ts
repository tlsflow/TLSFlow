import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PluginsApplicationService } from './application/plugins.application-service.js';
import { getPluginsRouteContracts } from './controller/plugins.controller.js';
import type { PluginPackageManifest } from './dto/plugins.dto.js';

describe('spec024 插件管理与安全沙箱 mock-safe 闭环', () => {
  it('校验 manifest、hash 和 mock 签名后安装低风险插件', () => {
    const service = new PluginsApplicationService();
    const manifest = createManifest();
    const packageContent = JSON.stringify({ manifest, files: ['plugin.json'] });
    const packageHash = service.calculateHash(packageContent);

    const record = service.uploadPackage({
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

  it('拒绝缺字段 metadata、hash 不匹配和无效签名', () => {
    const service = new PluginsApplicationService();
    const manifest = createManifest();
    const content = 'package';

    assert.throws(
      () => service.uploadPackage({ manifest: { ...manifest, actions: [] }, packageContent: content }),
      (error: any) => error.errorCode === 'VALIDATION_FAILED',
    );
    assert.throws(
      () => service.uploadPackage({ manifest, packageContent: content, expectedHash: 'sha256:bad' }),
      (error: any) => error.errorCode === 'VALIDATION_FAILED',
    );
    assert.throws(
      () => service.uploadPackage({ manifest, packageContent: content, signature: 'bad-signature' }),
      (error: any) => error.errorCode === 'PLUGIN_SIGNATURE_INVALID',
    );
  });

  it('高风险权限未审批不能启用，审批不能超过声明', () => {
    const service = new PluginsApplicationService();
    const record = service.uploadPackage({
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
    assert.throws(() => service.enablePlugin({ pluginPackageId: record.id }), (error: any) => error.errorCode === 'PLUGIN_PERMISSION_DENIED');
    assert.throws(
      () => service.approvePermissions({ pluginPackageId: record.id, approvedBy: 'sec_1', approvedPermissions: ['process.exec', 'root'] }),
      (error: any) => error.errorCode === 'PLUGIN_PERMISSION_DENIED',
    );

    service.approvePermissions({ pluginPackageId: record.id, approvedBy: 'sec_1', approvedPermissions: ['process.exec'] });
    const enabled = service.enablePlugin({ pluginPackageId: record.id });
    assert.equal(enabled.installStatus, 'enabled');
  });

  it('process runtime 只做 mock：校验 command allowlist、Secret scope、timeout 和日志脱敏', () => {
    const service = new PluginsApplicationService();
    const record = service.uploadPackage({
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
    service.approvePermissions({ pluginPackageId: record.id, approvedBy: 'sec_1', approvedPermissions: ['process.exec', 'secret.read'] });
    service.enablePlugin({ pluginPackageId: record.id });

    assert.throws(
      () => service.execute({ pluginPackageId: record.id, action: 'deploy', command: 'rm', secretRefs: [], allowedSecretRefs: [] }),
      (error: any) => error.errorCode === 'PLUGIN_PERMISSION_DENIED',
    );
    assert.throws(
      () => service.execute({ pluginPackageId: record.id, action: 'deploy', command: 'gcac-plugin', secretRefs: ['secret://api_token/2#v1'], allowedSecretRefs: ['secret://api_token/1#v1'] }),
      (error: any) => error.errorCode === 'SECRET_REF_INVALID',
    );

    const timeout = service.execute({ pluginPackageId: record.id, action: 'deploy', command: 'gcac-plugin', timeoutSeconds: 60 });
    assert.equal(timeout.status, 'timeout');
    assert.equal(timeout.errorCode, 'EXECUTION_TIMEOUT');

    const result = service.execute({
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

  it('container wasm http runtime 只返回预留 descriptor，不执行真实运行时', () => {
    const service = new PluginsApplicationService();
    const record = service.uploadPackage({
      manifest: createManifest({
        runtime: { type: 'wasm', entry: 'plugin.wasm', timeoutSeconds: 10, wasm: { module: 'plugin.wasm' } },
      }),
      packageContent: 'wasm-package',
    });
    service.enablePlugin({ pluginPackageId: record.id });

    const result = service.execute({ pluginPackageId: record.id, action: 'deploy', command: 'plugin.wasm' });
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'PLUGIN_RUNTIME_UNSUPPORTED');
    assert.equal(result.runtimeDescriptor?.type, 'wasm');
  });

  it('输出 capability、step draft、permission summary 和 OpenAPI route contracts', () => {
    const service = new PluginsApplicationService();
    const record = service.uploadPackage({ manifest: createManifest(), packageContent: 'cap-package' });
    assert.deepEqual(service.publishCapabilities(record.id), []);
    service.enablePlugin({ pluginPackageId: record.id });

    assert.equal(service.publishCapabilities(record.id)[0]?.key, 'provider.nginx.deploy');
    assert.deepEqual(service.getStepDraft(record.id, 'deploy').requiredPermissions, ['process.exec']);
    assert.equal(service.getPermissionSummary(record.id).canEnable, true);

    const contracts = getPluginsRouteContracts();
    assert.ok(contracts.some((contract) => contract.operationId === 'uploadPluginPackage'));
    assert.ok(contracts.some((contract) => contract.operationId === 'executePluginMockRuntime'));
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

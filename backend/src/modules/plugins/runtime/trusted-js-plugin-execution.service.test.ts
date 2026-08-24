import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import { TrustedJsPluginExecutionService, type TrustedJsExecutionInput } from './trusted-js-plugin-execution.service.js';
import type { UnifiedPluginsApplicationService } from '../application/unified-plugins.application-service.js';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import type { PluginRunnerLaunchSpec } from '../runner/plugin-runner-client.js';
import type { PluginRunnerExecuteResult } from '../runner/protocol/protocol.types.js';

const hash = `sha256:${'a'.repeat(64)}`;
const emptyResourceHash = `sha256:${createHash('sha256').update('[]', 'utf8').digest('hex')}`;

test('Trusted JS 服务不包含宿主加载、Provider 目录或版本选择旁路', async () => {
  const source = await readFile(join(process.cwd(), 'src/modules/plugins/runtime/trusted-js-plugin-execution.service.ts'), 'utf8');
  assert.doesNotMatch(source, /pathToFileURL|materializePlugin|resolvePluginFactory|latestByProvider|selectProviderPluginVersion|providerDefinitionFromPluginVersion/);
  assert.doesNotMatch(source, /supportedProducts|supportedOperations|frameworkType|newId\(/);
  assert.doesNotMatch(source, /\bimport\s*\(/);
  assert.doesNotMatch(source, /\b(?:plugin|loaded|instance)\.(?:testConnection|discover|deployCertificate|rollbackCertificate)\s*\(/);
  assert.match(source, /runnerSupervisor\.start\(spec\)/);
  assert.match(source, /client\.execute\(/);
});

test('Provider 目录 API 全部失败关闭', async () => {
  const service = newService({ getVersionForTenant: async () => { throw new Error('not used'); } });
  for (const operation of [
    () => service.listProviders('tenant-1'),
    () => service.requireProvider('tenant-1', 'opaque'),
    () => service.listCapabilities('tenant-1'),
  ]) {
    await assert.rejects(operation, (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.errorCode, 'PLUGIN_CAPABILITY_EXECUTION_FAILED');
      return true;
    });
  }
});

test('缺少真实 PluginVersion 绑定时失败关闭且不生成版本标识', async () => {
  let lookedUp = false;
  const service = newService({
    getVersionForTenant: async () => {
      lookedUp = true;
      throw new Error('must not be called');
    },
  });
  await assert.rejects(
    () => service.execute({
      pluginVersionId: '', pluginId: 'plugin.test', pluginVersion: '1.0.0', tenantId: 'tenant-1',
      packageHash: hash, manifestHash: hash, resourceHash: emptyResourceHash, capability: 'test.echo',
      executionId: 'execution-1', executionStepId: 'step-1', input: {}, grantRefs: [], writeEffect: false,
    }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'PLUGIN_CONTRACT_INVALID',
  );
  assert.equal(lookedUp, false);
});

test('Trusted JS 只按显式绑定启动 Runner 并完整透传身份、摘要、Capability、租户和 GrantRefs', async () => {
  const version = buildVersion();
  let capturedSpec: Record<string, unknown> | undefined;
  let capturedRequest: Record<string, unknown> | undefined;
  const runnerResult: PluginRunnerExecuteResult = {
    protocolVersion: 'gcac.plugin-runner/v1', messageType: 'execute_result', requestId: 'request-1', sentAt: new Date(0).toISOString(),
    pluginVersionId: version.id, tenantId: 'tenant-1', executionId: 'execution-1', executionStepId: 'step-1',
    success: true, status: 'SUCCESS', summary: { ok: true }, normalizedObjects: [], warnings: [],
  };
  const service = newService({ getVersionForTenant: async () => version }, {
    supervisor: {
      start: async (spec: PluginRunnerLaunchSpec) => {
        capturedSpec = spec as unknown as Record<string, unknown>;
        return {
          execute: async (request: Record<string, unknown>) => {
            capturedRequest = request;
            return runnerResult;
          },
        } as never;
      },
    },
  });
  const request: TrustedJsExecutionInput = {
    pluginVersionId: version.id, pluginId: version.pluginId, pluginVersion: version.version, tenantId: 'tenant-1',
    packageHash: hash, manifestHash: hash, resourceHash: emptyResourceHash, capability: 'test.echo',
    executionId: 'execution-1', executionStepId: 'step-1', input: { value: 'hello' }, grantRefs: ['grant-1'], writeEffect: false,
  };

  const result = await service.execute(request);
  assert.equal(result.status, 'SUCCESS');
  assert.equal((capturedSpec as { pluginVersionId: string }).pluginVersionId, version.id);
  assert.equal((capturedSpec as { pluginId: string }).pluginId, version.pluginId);
  assert.equal((capturedSpec as { pluginVersion: string }).pluginVersion, version.version);
  assert.equal((capturedSpec as { tenantId: string }).tenantId, 'tenant-1');
  assert.equal((capturedSpec as { packageHash: string }).packageHash, hash);
  assert.equal((capturedSpec as { manifestHash: string }).manifestHash, hash);
  assert.equal((capturedSpec as { resourceHash: string }).resourceHash, emptyResourceHash);
  assert.equal((capturedRequest as { tenantId: string }).tenantId, 'tenant-1');
  assert.equal((capturedRequest as { executionId: string }).executionId, 'execution-1');
  assert.equal((capturedRequest as { executionStepId: string }).executionStepId, 'step-1');
  assert.equal((capturedRequest as { capability: string }).capability, 'test.echo');
  assert.deepEqual((capturedRequest as { input: Record<string, unknown> }).input, { value: 'hello' });
  assert.deepEqual((capturedRequest as { grantRefs: string[] }).grantRefs, ['grant-1']);
  assert.equal((capturedRequest as { idempotencyKey: string }).idempotencyKey, 'execution-1');
  assert.equal((capturedRequest as { writeEffect: boolean }).writeEffect, false);
  await assert.rejects(() => service.execute({ ...request, grantRefs: ['grant-1', 'grant-1'] }), /重复引用/);
});

test('真实版本的制品摘要不匹配时禁止启动 Runner', async () => {
  const version = buildVersion();
  let started = false;
  const service = newService({ getVersionForTenant: async () => version }, {
    supervisor: { start: async () => { started = true; return undefined as never; } },
  });
  await assert.rejects(
    () => service.execute({
      pluginVersionId: version.id, pluginId: version.pluginId, pluginVersion: version.version, tenantId: 'tenant-1',
      packageHash: `sha256:${'b'.repeat(64)}`, manifestHash: hash, resourceHash: emptyResourceHash, capability: 'test.echo',
      executionId: 'execution-2', executionStepId: 'step-2', input: {}, grantRefs: [], writeEffect: false,
    }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'PLUGIN_RUNNER_VERSION_MISMATCH',
  );
  assert.equal(started, false);
});

function buildVersion(): UnifiedPluginVersionRecord {
  return {
    id: 'plugin-version-1', tenantId: 'SYSTEM', pluginId: 'plugin.test', version: '1.0.0', source: 'BUILTIN',
    runtime: 'TRUSTED_JS', scope: 'BOTH', trust: 'OFFICIAL_SIGNED', support: 'OFFICIAL',
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: 'plugin.test', version: '1.0.0',
      displayNameKey: 'plugins.test', publisher: 'GCAC', runtime: 'TRUSTED_JS', source: 'BUILTIN', scope: 'BOTH',
      trust: 'OFFICIAL_SIGNED', support: 'OFFICIAL', permissions: [],
      capabilities: [{ key: 'test.echo', contractVersion: 'v1', actionContractId: 'test.echo/v1', riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'] }],
      resources: {},
    },
    packageSha256: hash, manifestSha256: hash, resourceSha256: {}, resources: {}, status: 'ENABLED',
    permissionApprovalStatus: 'NOT_REQUIRED', approvedPermissions: [],
    validationReport: { valid: true, errors: [], warnings: [], manifestSha256: hash, resourceSha256: {} },
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  };
}

function newService(
  plugins: Pick<UnifiedPluginsApplicationService, 'getVersionForTenant'>,
  runner: { supervisor?: { start: (spec: PluginRunnerLaunchSpec) => Promise<unknown> } } = {},
): TrustedJsPluginExecutionService {
  return new TrustedJsPluginExecutionService({
    db: {} as never,
    unifiedPlugins: plugins as UnifiedPluginsApplicationService,
    cloudAccounts: { get: async () => { throw new Error('not used'); } },
    credentials: {} as never,
    secrets: {} as never,
    audit: {} as never,
    ...(runner.supervisor ? {
      runner: {
        executablePath: 'C:\\runner', workingDirectory: 'C:\\runner',
        args: ['runner-server.js', '--executor-module', 'C:\\executor'], executorModulePath: 'C:\\executor',
        runnerVersion: '1.0.0', sdkVersion: '1.0.0', supervisor: runner.supervisor as never,
      },
    } : {}),
  });
}

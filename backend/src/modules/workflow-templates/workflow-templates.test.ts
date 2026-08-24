import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { App } from '../../common/http/app.js';
import { AppError } from '../../common/errors/app-error.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import { WorkflowTemplatesApplicationService } from './application/workflow-templates.application-service.js';
import { createWorkflowStepDispatcher } from './application/workflow-step-dispatcher.js';
import { WorkflowTemplatesController } from './controller/workflow-templates.controller.js';
import { WorkflowTemplatesDomainService } from './domain/workflow-templates.domain-service.js';
import type { WorkflowDslV1, WorkflowRunProgress, WorkflowTemplate, WorkflowTemplateVersion } from './dto/workflow-templates.dto.js';
import { workflowTemplatesSchemaRegistry } from './schema/workflow-templates.schema.js';
import type { PluginWorkflowBindingRecord } from '../plugins/dto/plugin-workflow-bindings.dto.js';
import type { PluginWorkflowBindingsRepositoryPort } from '../plugins/repository/plugin-workflow-bindings.repository.js';
import type { ResolvedDeploymentInputV1 } from '../deployment-inputs/dto/resolved-deployment-input.dto.js';
import type { DeploymentAssetContextV1 } from '../deployment-inputs/dto/deployment-asset-context.dto.js';
import type { DeploymentInputContractV1 } from '../deployment-inputs/dto/deployment-input-contract.dto.js';

function workflowInputContract(extraVariables: DeploymentInputContractV1['variables'] = {}): DeploymentInputContractV1 {
  const requiredVariable = (type: 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array' | 'file', defaultValue?: unknown) => ({
    type,
    required: defaultValue === undefined,
    configurationMode: defaultValue === undefined ? 'required' as const : 'advanced' as const,
    source: defaultValue === undefined ? { kind: 'binding' as const } : { kind: 'default' as const },
    lifecycle: 'pre_execution' as const,
    bindingPolicy: defaultValue === undefined ? 'required_binding' as const : 'default_overridable' as const,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
  });
  const connectionField = (type: 'string' | 'number', defaultValue?: string | number) => ({
    type, required: true, configurationMode: defaultValue === undefined ? 'required' as const : 'advanced' as const,
    source: defaultValue === undefined ? { kind: 'binding' as const } : { kind: 'default' as const },
    lifecycle: 'pre_execution' as const,
    bindingPolicy: defaultValue === undefined ? 'required_binding' as const : 'default_overridable' as const,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
  });
  return {
    apiVersion: 'gcac.deployment-input/v1',
    variables: {
      deviceHost: requiredVariable('string'),
      shouldUpload: requiredVariable('boolean', true),
      ...extraVariables,
    },
    connections: {
      management: { transport: 'http', host: connectionField('string'), port: connectionField('number', 443), credentialSlot: 'credential' },
      targetSsh: { transport: 'ssh', host: connectionField('string'), port: connectionField('number', 22), username: connectionField('string'), credentialSlot: 'credential', hostKey: { policy: 'strict' } },
    },
    credentials: {
      credential: { allowedKinds: ['USERNAME_PASSWORD', 'SSH_KEY'], required: true, configurationMode: 'required', lifecycle: 'pre_execution' },
      apiCredential: { allowedKinds: ['BEARER_TOKEN'], required: false, configurationMode: 'advanced', lifecycle: 'pre_execution' },
      sshCredential: { allowedKinds: ['USERNAME_PASSWORD', 'SSH_KEY'], required: false, configurationMode: 'advanced', lifecycle: 'pre_execution' },
    },
    artifacts: {
      cert: { kind: 'certificate', required: true, configurationMode: 'required', lifecycle: 'pre_execution', artifactContract: { outputs: { pem: { role: 'public_certificate', required: true }, privateKey: { role: 'private_key', required: true, sensitive: true }, fingerprintSha256: { role: 'fingerprint_sha256', required: true } } } },
    },
  };
}

function resolvedWorkflowInput(input: Partial<Pick<ResolvedDeploymentInputV1, 'variables' | 'connections' | 'credentials' | 'artifacts' | 'assetContext'>> = {}): ResolvedDeploymentInputV1 {
  const assetContext: DeploymentAssetContextV1 = input.assetContext ?? {
    apiVersion: 'gcac.deployment-asset-context/v1',
    application: { id: 'asset_test', address: 'edge-01.example.com', serverName: 'edge-01.example.com', port: 443, protocol: 'https' },
    deployment: { targets: [], certificateResourceName: 'certificate-edge-01' },
  };
  return {
    apiVersion: 'gcac.resolved-deployment-input/v1',
    contractVersion: 'gcac.deployment-input/v1',
    assetContext,
    variables: input.variables ?? {},
    connections: {
      management: { transport: 'http', host: 'edge-01.example.com', port: 443, tls: { verifyPeer: true } },
      targetSsh: {
        transport: 'ssh',
        host: 'edge-01.example.com',
        port: 22,
        username: 'admin',
        credentialSlot: 'credential',
        hostKey: { policy: 'strict', expectedFingerprint: 'aabbccddeeff0011' },
      },
      ...(input.connections ?? {}),
    },
    credentials: {
      credential: { credentialId: 'cred_fixture', kind: 'USERNAME_PASSWORD', secretRefs: { password: 'secret://password/sec_fixture#current' } },
      ...(input.credentials ?? {}),
    },
    artifacts: input.artifacts ?? {},
    provenance: {},
    sensitivePaths: [
      ...Object.keys(input.credentials ?? {}).map((name) => `credentials.${name}`),
      ...Object.entries(input.artifacts ?? {}).flatMap(([name, artifact]) => Object.keys((artifact as { outputs?: Record<string, unknown> }).outputs ?? {}).map((output) => `artifacts.${name}.outputs.${output}`)),
      ...Object.keys(input.variables ?? {}).filter((name) => /token|password|secret/i.test(name)).map((name) => `variables.${name}`),
    ],
    issues: [],
    executable: true,
    resolvedSha256: 'test-resolved-input',
  };
}

function withResolvedVariables(base: ResolvedDeploymentInputV1, variables: Record<string, unknown>): ResolvedDeploymentInputV1 {
  return {
    ...base,
    variables: { ...base.variables, ...variables },
    sensitivePaths: [
      ...base.sensitivePaths,
      ...Object.keys(variables).filter((name) => /token|password|secret/i.test(name)).map((name) => `variables.${name}`),
    ],
  };
}

function resolvedInputWithTargets(targets: Array<{ host: string }>): ResolvedDeploymentInputV1 {
  const base = resolvedWorkflowInput();
  return {
    ...base,
    assetContext: {
      ...base.assetContext,
      deployment: {
        ...base.assetContext.deployment,
        targets: targets.map((target, index) => ({ id: `target_${index}`, name: target.host, serverName: target.host, metadata: {} })),
      },
    },
  };
}

function templateFixture(): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'edge-cert-update', category: 'load_balancer' },
    inputContract: workflowInputContract(),
    steps: [
      {
        name: 'login',
        type: 'http',
        request: {
          method: 'POST',
          connectionRef: 'management',
          url: 'https://{{variables.deviceHost}}/api/login',
          auth: { type: 'basic', username: '{{credentials.credential.username}}', credential: '{{credentials.credential}}' },
          body: { user: '{{credentials.credential.username}}' },
        },
        extract: [{ name: 'token', type: 'jsonPath', path: '$.token', sensitive: true }],
        assert: [{ type: 'statusCode', equals: 200 }],
      },
      {
        name: 'upload',
        type: 'http',
        when: { variable: 'variables.shouldUpload', equals: true },
        retry: { count: 1, intervalSeconds: 1 },
        request: {
          method: 'PUT',
          connectionRef: 'management',
          url: 'https://{{variables.deviceHost}}/api/cert',
          body: { cert: '{{artifacts.cert.outputs.pem}}', key: '{{artifacts.cert.outputs.privateKey}}', token: '{{steps.login.extracted.token}}' },
        },
        extract: { remoteFingerprint: { type: 'jsonPath', path: '$.fingerprint' } },
        assert: [
          { type: 'jsonPath', path: '$.success', equals: true },
          { type: 'certificateFingerprint', actual: '{{steps.upload.extracted.remoteFingerprint}}', expected: '{{artifacts.cert.outputs.fingerprintSha256}}' },
        ],
      },
      {
        name: 'reload',
        type: 'ssh',
        when: { variable: 'variables.shouldUpload', equals: true },
        ssh: {
          mode: 'command',
          connectionRef: 'targetSsh',
          command: 'reload cert {{steps.upload.extracted.remoteFingerprint}}',
        },
        assert: [{ type: 'contains', value: 'ok' }],
      },
      { name: 'waitForApply', type: 'wait', seconds: 5 },
      { name: 'manualVerify', type: 'manual', instruction: '请人工确认 {{variables.deviceHost}} 证书已更新' },
    ],
    rollback: [
      {
        name: 'restoreOldCert',
        type: 'ssh',
        ssh: {
          mode: 'script',
          connectionRef: 'targetSsh',
          script: 'restore previous-cert',
        },
      },
    ],
  };
}

function runtimeInput(versionId: string) {
  return {
    templateVersionId: versionId,
    mode: 'mock' as const,
    resolvedInput: resolvedWorkflowInput({
      variables: { deviceHost: 'edge-01.example.com', shouldUpload: true },
      credentials: {
        credential: { credentialId: 'cred_device_login', kind: 'USERNAME_PASSWORD', username: 'admin', secretRefs: { password: 'secret://password/sec_device_login#current' } },
        apiCredential: { credentialId: 'cred_device_api', kind: 'BEARER_TOKEN', secretRefs: { token: 'secret://api_token/sec_device_api#current' } },
      },
      artifacts: { cert: { outputs: { pem: '-----BEGIN CERTIFICATE-----mock-----END CERTIFICATE-----', privateKey: 'super-private-key', fingerprintSha256: 'ff'.repeat(32) } } },
    }),
    mockResponses: {
      login: { statusCode: 200, body: { token: 'runtime-token-secret' } },
      upload: { statusCode: 500, body: { success: false, fingerprint: '00'.repeat(32) } },
      reload: { exitCode: 0, stdout: 'ok' },
    },
  };
}

describe('WorkflowTemplates', () => {
  it('校验 DSL v1 schema，拒绝未知字段、缺失引用、类型错误、明文 Secret 和私钥', async () => {
    workflowTemplatesSchemaRegistry.validate(templateFixture());
    assert.throws(() => workflowTemplatesSchemaRegistry.validate({ ...templateFixture(), extra: true }), /未知字段/);

    const invalidPluginVersion = templateFixture();
    invalidPluginVersion.metadata.version = 'v1';
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(invalidPluginVersion), /SemVer/);

    const unsafeLocalLogo = templateFixture();
    unsafeLocalLogo.metadata.logoUrl = '../private/logo.svg';
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(unsafeLocalLogo), /不能包含/);

    const versionedPrevious = { ...templateFixture(), metadata: { ...templateFixture().metadata, version: '1.0.0' } };
    const versionedService = new WorkflowTemplatesApplicationService();
    const versionedTemplate = await versionedService.createTemplate({ content: versionedPrevious });
    const versionedNext = { ...versionedPrevious, steps: [...versionedPrevious.steps, { name: 'new_wait', type: 'wait', seconds: 1 }] } as WorkflowDslV1;
    await assert.rejects(() => versionedService.createDraftVersion({ templateId: versionedTemplate.template.id, content: versionedNext }), /必须递进 metadata.version/);
    await versionedService.createDraftVersion({ templateId: versionedTemplate.template.id, content: { ...versionedNext, metadata: { ...versionedNext.metadata, version: '1.0.1' } } });

    const missingReference = templateFixture();
    missingReference.steps[0] = {
      ...missingReference.steps[0]!,
      type: 'http',
      request: { connectionRef: 'management', method: 'GET', url: 'https://{{missingHost}}/api' },
    };
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(missingReference), /变量引用不存在|missingHost/);

    const wrongType = templateFixture();
    wrongType.inputContract.variables.deviceHost = {
      ...wrongType.inputContract.variables.deviceHost,
      type: 'number',
      configurationMode: 'advanced',
      source: { kind: 'default' },
      bindingPolicy: 'default_overridable',
      default: 'bad',
    } as never;
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(wrongType), /必须是数字|number/);

    const plainSecret = templateFixture();
    plainSecret.steps[0] = {
      ...plainSecret.steps[0]!,
      type: 'http',
      request: { connectionRef: 'management', method: 'POST', url: 'https://edge/api', body: { password: 'password=clear-text' } },
    };
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(plainSecret), /Secret|明文/);

    const privateKey = templateFixture();
    privateKey.steps[1] = {
      ...privateKey.steps[1]!,
      type: 'http',
      request: { connectionRef: 'management', method: 'PUT', url: 'https://edge/api', body: '-----BEGIN PRIVATE KEY-----bad-----END PRIVATE KEY-----' },
    };
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(privateKey), /私钥/);

    const invalidFirstOf = templateFixture();
    const firstStep = invalidFirstOf.steps[0];
    if (firstStep?.type === 'http') firstStep.extract = [{ name: 'accessToken', type: 'firstOf', paths: [] }];
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(invalidFirstOf), /paths/);
  });

  it('拒绝把 Credential 和 Certificate 继续声明为普通变量', () => {
    for (const legacyType of ['credential', 'certificate']) {
      const content = templateFixture();
      content.inputContract.variables.legacyInput = { type: legacyType, required: true } as never;
      assert.throws(() => workflowTemplatesSchemaRegistry.validate(content), /type 不支持/);
    }
  });

  it('Workflow 变量固定默认值使用 standard default Source，拒绝旧 dsl Source', () => {
    const content = templateFixture();
    content.inputContract.variables.deviceHost = {
      ...content.inputContract.variables.deviceHost,
      configurationMode: 'advanced',
      source: { kind: 'default' },
      lifecycle: 'pre_execution',
      bindingPolicy: 'default_overridable',
      default: 'edge.example.com',
    };
    content.inputContract.variables.shouldUpload = {
      ...content.inputContract.variables.shouldUpload,
      configurationMode: 'advanced',
      source: { kind: 'default' },
      lifecycle: 'pre_execution',
      bindingPolicy: 'default_overridable',
    };
    content.inputContract.variables.fixed = {
      type: 'string',
      required: true,
      default: 'fixed-value',
      source: { kind: 'default' },
      configurationMode: 'advanced',
      lifecycle: 'pre_execution',
      bindingPolicy: 'default_overridable',
    };
    assert.doesNotThrow(() => workflowTemplatesSchemaRegistry.validate(content));

    const legacy = templateFixture() as unknown as { inputContract: { variables: Record<string, Record<string, unknown>> } };
    legacy.inputContract.variables.fixed = {
      type: 'string',
      required: true,
      configurationMode: 'advanced',
      default: 'fixed-value',
      source: { kind: 'dsl', value: 'fixed-value' },
      lifecycle: 'pre_execution',
      bindingPolicy: 'default_overridable',
    };
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(legacy), /source.kind 不支持/);
  });

  it('模板版本不可变：新内容生成新 version/hash，发布不会覆盖旧版本', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const created = await service.createTemplate({ content: templateFixture(), changeSummary: '初始版本' });
    const changed = templateFixture();
    changed.metadata.displayName = '第二版';

    const version2 = await service.createDraftVersion({ templateId: created.template.id, content: changed, changeSummary: '改展示名' });
    assert.notEqual(version2.id, created.version.id);
    assert.notEqual(version2.contentHash, created.version.contentHash);
    const createdDraftTemplate = (await service.listTemplates()).find((item) => item.id === created.template.id);
    assert.equal(createdDraftTemplate?.status, 'draft');
    assert.equal(createdDraftTemplate?.currentVersionLabel, 'V2');

    const edited = templateFixture();
    edited.metadata.displayName = '第二版编辑后';
    const updatedDraft = await service.updateCurrentDraftVersion({ templateId: created.template.id, content: edited, changeSummary: '编辑当前草稿' });
    assert.equal(updatedDraft.id, version2.id);
    assert.equal(updatedDraft.version, 2);
    assert.equal(updatedDraft.changeSummary, '编辑当前草稿');
    assert.equal((await service.listVersions(created.template.id)).length, 2);

    const published = await service.publishVersion(created.version.id);
    assert.equal(published.status, 'published');
    assert.equal((await service.getVersion(version2.id)).status, 'draft');
    const draftTemplate = (await service.listTemplates()).find((item) => item.id === created.template.id);
    assert.equal(draftTemplate?.status, 'draft');
    assert.equal(draftTemplate?.currentVersionLabel, 'V1');

    const switched = await service.publishVersion(version2.id);
    assert.equal(switched.status, 'published');
    assert.equal((await service.getVersion(created.version.id)).status, 'published');
    const publishedTemplate = (await service.listTemplates()).find((item) => item.id === created.template.id);
    assert.equal(publishedTemplate?.status, 'published');
    assert.equal(publishedTemplate?.currentVersionLabel, 'V2');
    await assert.rejects(() => service.updateCurrentDraftVersion({ templateId: created.template.id, content: edited }), /no draft version/);
    await assert.rejects(() => service.createDraftVersion({ templateId: created.template.id, content: edited }), /duplicate workflow version content/);
  });

  it('HTTP 列表接口返回真实数组，不能把 Promise 泄漏进 items', async () => {
    const app = new App();
    const service = new WorkflowTemplatesApplicationService();
    new WorkflowTemplatesController(service).register(app.router);
    const createdBody = await service.createTemplate({ content: templateFixture(), changeSummary: '初始版本' });

    const templates = await app.inject({ method: 'GET', path: '/api/v1/workflow-templates' });
    assert.equal(templates.statusCode, 200);
    const templatePage = templates.body as { items: unknown };
    assert.equal(Array.isArray(templatePage.items), true);
    assert.equal((templatePage.items as Array<{ id: string }>).some((item) => item.id === createdBody.template.id), true);
    assert.equal((templatePage.items as Array<{ id: string; currentVersionLabel?: string }>).find((item) => item.id === createdBody.template.id)?.currentVersionLabel, 'V1');

    const versions = await app.inject({ method: 'GET', path: `/api/v1/workflow-template-versions?templateId=${createdBody.template.id}` });
    assert.equal(versions.statusCode, 200);
    assert.equal(Array.isArray((versions.body as { items: unknown }).items), true);
  });

  it('正式工作流列表同时返回用户和插件内置来源，插件草稿目标仍只允许用户工作流', async () => {
    const app = new App();
    const currentBindings: PluginWorkflowBindingRecord[] = [];
    const service = new WorkflowTemplatesApplicationService(undefined, {}, workflowBindingsRepository(currentBindings));
    new WorkflowTemplatesController(service).register(app.router);

    const legacy = await service.createTemplate({ content: { ...templateFixture(), metadata: { ...templateFixture().metadata, name: 'legacy-workflow' } } });
    const current = await service.createWorkflow({ content: { ...templateFixture(), metadata: { ...templateFixture().metadata, name: 'current-workflow' } } });
    const derived = await service.createPluginDerivedWorkflow({ content: { ...templateFixture(), metadata: { ...templateFixture().metadata, name: 'derived-workflow' } } });
    const legacyId = legacy.template.id;
    const currentId = current.template.id;
    const derivedId = derived.template.id;
    assert.equal((await app.inject({ method: 'POST', path: '/api/v1/workflow-templates', body: {} })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', path: '/api/v1/workflows', body: {} })).statusCode, 404);

    const compatibilityList = await app.inject({ method: 'GET', path: '/api/v1/workflow-templates' });
    const workflowList = await app.inject({ method: 'GET', path: '/api/v1/workflows' });
    const compatibilityIds = (compatibilityList.body as { items: Array<{ id: string }> }).items.map((item) => item.id);
    const workflowIds = (workflowList.body as { items: Array<{ id: string }> }).items.map((item) => item.id);

    assert.equal(compatibilityIds.includes(legacyId), true);
    assert.equal(compatibilityIds.includes(currentId), true);
    assert.equal(workflowIds.includes(legacyId), true);
    assert.equal(workflowIds.includes(currentId), true);
    assert.equal(workflowIds.includes(derivedId), true);

    const pluginWorkflow = await service.createPluginTemplate({
      content: { ...templateFixture(), metadata: { ...templateFixture().metadata, name: 'current-plugin-workflow' } },
    });
    const duplicatePluginWorkflow = await service.createPluginTemplate({
      content: { ...templateFixture(), metadata: { ...templateFixture().metadata, name: 'current-plugin-workflow' } },
    });
    await service.publishPluginVersion(pluginWorkflow.version.id);
    await service.publishPluginVersion(duplicatePluginWorkflow.version.id);
    currentBindings.push({
      pluginVersionId: 'uplgv_current',
      pluginId: 'builtin.workflow.current-plugin-workflow',
      capabilityKey: 'certificate.deploy',
      workflowResourcePath: 'workflows/deploy.json',
      workflowTemplateId: pluginWorkflow.template.id,
      workflowVersionId: pluginWorkflow.version.id,
      workflowContentSha256: pluginWorkflow.version.contentHash,
      createdAt: pluginWorkflow.template.createdAt,
    });
    currentBindings.push({
      pluginVersionId: 'uplgv_previous',
      pluginId: 'builtin.workflow.current-plugin-workflow',
      capabilityKey: 'certificate.deploy',
      workflowResourcePath: 'workflows/deploy.json',
      workflowTemplateId: duplicatePluginWorkflow.template.id,
      workflowVersionId: duplicatePluginWorkflow.version.id,
      workflowContentSha256: duplicatePluginWorkflow.version.contentHash,
      createdAt: duplicatePluginWorkflow.template.createdAt,
    });
    const workflowListWithPlugin = await app.inject({ method: 'GET', path: '/api/v1/workflows' });
    const workflowItemsWithPlugin = (workflowListWithPlugin.body as { items: Array<{ id: string; origin?: string }> }).items;
    const mergedPluginRows = workflowItemsWithPlugin.filter((item) => item.origin === 'plugin_internal' && item.id !== legacyId && item.id !== currentId && item.id !== derivedId);
    assert.equal(mergedPluginRows.length, 1);
    assert.equal((await service.listVersions(mergedPluginRows[0]!.id)).length, 2);
    assert.equal(workflowItemsWithPlugin.some((item) => item.id === legacyId), true);
  });

  it('HTTP 重命名接口只修改工作流记录，不改写历史版本', async () => {
    const app = new App();
    const service = new WorkflowTemplatesApplicationService();
    new WorkflowTemplatesController(service).register(app.router);
    const createdBody = await service.createWorkflow({ content: templateFixture(), changeSummary: '初始版本' });

    const renamed = await app.inject({
      method: 'POST',
      path: '/api/v1/workflow-templates/rename',
      body: { templateId: createdBody.template.id, name: '  edge-cert-renamed  ' },
    });
    assert.equal(renamed.statusCode, 200);
    assert.equal((renamed.body as { name: string }).name, 'edge-cert-renamed');

    const versions = await app.inject({ method: 'GET', path: `/api/v1/workflow-template-versions?templateId=${createdBody.template.id}` });
    const version = (versions.body as { items: Array<{ id: string; contentHash: string; content: WorkflowDslV1 }> }).items[0];
    assert.equal(version?.id, createdBody.version.id);
    assert.equal(version?.contentHash, createdBody.version.contentHash);
    assert.equal(version?.content.metadata.name, 'edge-cert-update');
  });

  it('HTTP 版本备注接口只更新备注，不改写版本内容', async () => {
    const app = new App();
    const service = new WorkflowTemplatesApplicationService();
    new WorkflowTemplatesController(service).register(app.router);
    const createdBody = await service.createWorkflow({ content: templateFixture(), changeSummary: '初始版本' });

    const noted = await app.inject({
      method: 'POST',
      path: '/api/v1/workflow-template-versions/note',
      body: { versionId: createdBody.version.id, changeSummary: '补充发布备注' },
    });
    assert.equal(noted.statusCode, 200);
    assert.equal((noted.body as { changeSummary?: string }).changeSummary, '补充发布备注');
    assert.equal((noted.body as { contentHash: string }).contentHash, createdBody.version.contentHash);

    const versions = await app.inject({ method: 'GET', path: `/api/v1/workflow-template-versions?templateId=${createdBody.template.id}` });
    assert.equal((versions.body as { items: Array<{ changeSummary?: string }> }).items[0]?.changeSummary, '补充发布备注');
  });

  it('HTTP 删除接口会禁用模板和版本，并让列表不再返回该记录', async () => {
    const app = new App();
    const service = new WorkflowTemplatesApplicationService();
    new WorkflowTemplatesController(service).register(app.router);
    const createdBody = await service.createWorkflow({ content: templateFixture(), changeSummary: '初始版本' });

    const deleted = await app.inject({
      method: 'POST',
      path: '/api/v1/workflow-templates/delete',
      body: { id: createdBody.template.id },
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal((deleted.body as { status: string }).status, 'disabled');

    const templates = await app.inject({ method: 'GET', path: '/api/v1/workflow-templates' });
    assert.equal(templates.statusCode, 200);
    assert.equal((templates.body as { items: Array<{ id: string }> }).items.some((item) => item.id === createdBody.template.id), false);

    const versions = await app.inject({ method: 'GET', path: `/api/v1/workflow-template-versions?templateId=${createdBody.template.id}` });
    assert.equal(versions.statusCode, 200);
    assert.equal((versions.body as { items: Array<{ status: string }> }).items.every((item) => item.status === 'disabled'), true);
  });

  it('变量解析、凭据、证书材料占位和预览脱敏生效', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const { version } = await service.createTemplate({ content: templateFixture() });
    const run = await service.preview(runtimeInput(version.id));
    const text = JSON.stringify(run);

    assert.equal(run.mode, 'render_only');
    assert.equal(run.plannedOnly, true);
    assert.match(text, /edge-01\.example\.com/);
    assert.doesNotMatch(text, /token-secret-value|super-private-key|runtime-token-secret/);
    assert.match(text, /\[REDACTED\]/);
  });

  it('dry-run 不应吞掉缺失的部署输入变量', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const { version } = await service.createTemplate({ content: templateFixture() });
    const input = runtimeInput(version.id);
    input.resolvedInput = {
      ...input.resolvedInput,
      variables: { shouldUpload: true },
    };

    await assert.rejects(
      () => service.preview(input),
      (error: unknown) => error instanceof AppError
        && error.errorCode === 'VALIDATION_FAILED'
        && error.message === '变量缺失：variables.deviceHost'
        && (error.details as { key?: unknown } | undefined)?.key === 'variables.deviceHost',
    );
  });

  it('上游输出可以提取成运行时变量并供下游节点引用，同时对外脱敏', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content: WorkflowDslV1 = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'runtime_output_flow', displayName: '运行时输出传递' },
      inputContract: workflowInputContract(),
      steps: [
        {
          name: 'prepare_auth',
          type: 'http',
          stage: 'prepare',
          request: { connectionRef: 'management', method: 'POST', url: 'https://{{variables.deviceHost}}/api/login' },
          extract: [{ name: 'accessToken', type: 'outputPath', path: '$.body.token', sensitive: true }],
          assert: [{ type: 'statusCode', equals: 200 }],
        },
        {
          name: 'reload_with_token',
          type: 'ssh',
          stage: 'refresh',
          ssh: {
            mode: 'command',
            connectionRef: 'targetSsh',
            command: 'echo {{steps.prepare_auth.extracted.accessToken}} {{steps.prepare_auth.extracted.accessToken}} {{steps.prepare_auth.output.body.token}}',
          },
        },
      ],
    };
    const { version } = await service.createTemplate({ content });
    let renderedSshCommand = '';
    const progressSnapshots: WorkflowRunProgress[] = [];
    const run = await service.runWithDispatcher({
      templateVersionId: version.id,
      mode: 'mock',
      resolvedInput: resolvedWorkflowInput({
        variables: { deviceHost: 'edge-01.example.com' },
        credentials: { credential: { credentialId: 'cred_device_login', kind: 'USERNAME_PASSWORD', username: 'admin', secretRefs: { password: 'secret://password/sec_device_login#current' } } },
      }),
    }, async ({ step, renderedPlan }) => {
      if (step.name === 'prepare_auth') {
        return {
          success: true,
          statusCode: 200,
          body: { token: 'runtime-token-secret' },
          logs: ['curl:token:runtime-token-secret'],
        };
      }
      if (step.name === 'reload_with_token') {
        renderedSshCommand = (renderedPlan as { command?: string }).command ?? '';
        return {
          success: true,
          exitCode: 0,
          stdout: 'runtime-token-secret',
          body: { success: true },
          logs: ['ssh:stdout:runtime-token-secret'],
        };
      }
      return { success: true, body: { success: true } };
    }, async (progress) => {
      progressSnapshots.push(progress);
    });
    const visible = JSON.stringify(run);
    const visibleProgress = JSON.stringify(progressSnapshots);

    assert.equal(run.status, 'success');
    assert.equal(renderedSshCommand, 'echo runtime-token-secret runtime-token-secret runtime-token-secret');
    assert.equal(run.stepResults[0]!.extracted.accessToken, '[REDACTED]');
    assert.equal(progressSnapshots.length, 6);
    assert.deepEqual(progressSnapshots[0]!.steps.map((step) => step.status), ['queued', 'queued']);
    assert.deepEqual(progressSnapshots[1]!.steps.map((step) => step.status), ['running', 'queued']);
    assert.deepEqual(progressSnapshots[2]!.steps.map((step) => step.status), ['success', 'queued']);
    assert.deepEqual(progressSnapshots[3]!.steps.map((step) => step.status), ['success', 'running']);
    assert.deepEqual(progressSnapshots[4]!.steps.map((step) => step.status), ['success', 'success']);
    assert.equal(progressSnapshots[5]!.status, 'success');
    assert.equal(progressSnapshots[5]!.completedSteps, 2);
    assert.equal(progressSnapshots[5]!.totalSteps, 2);
    assert.ok(progressSnapshots[2]!.steps[0]!.startedAt);
    assert.ok(progressSnapshots[2]!.steps[0]!.finishedAt);
    assert.ok(progressSnapshots[4]!.steps[1]!.startedAt);
    assert.ok(progressSnapshots[4]!.steps[1]!.finishedAt);
    assert.doesNotMatch(visible, /runtime-token-secret/);
    assert.doesNotMatch(visibleProgress, /runtime-token-secret/);
    assert.match(visible, /\[REDACTED\]/);
  });

  it('extract 可以把多个响应字段映射为多个运行时变量', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content: WorkflowDslV1 = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'flexible_auth_fields_flow', displayName: '灵活认证字段提取' },
      inputContract: workflowInputContract(),
      steps: [
        {
          name: 'prepare_auth',
          type: 'http',
          stage: 'prepare',
          request: { connectionRef: 'management', method: 'POST', url: 'https://{{variables.deviceHost}}/api/login' },
          extract: [
            {
              name: 'accessToken',
              type: 'firstOf',
              paths: ['$.body.token', '$.body.access_token', '$.body.data.token'],
              sensitive: true,
            },
            {
              name: 'sessionId',
              type: 'firstOf',
              paths: ['$.headers.x-session-id', '$.body.sessionId', '$.body.data.session.id'],
              sensitive: true,
            },
            {
              name: 'tenantId',
              type: 'outputPath',
              path: '$.body.data.tenant.id',
            },
          ],
        },
        {
          name: 'install_certificate',
          type: 'http',
          stage: 'install',
          request: {
            method: 'PUT',
            connectionRef: 'management',
            url: 'https://{{variables.deviceHost}}/api/certificate',
            headers: {
              Authorization: 'Bearer {{steps.prepare_auth.extracted.accessToken}}',
              'X-Session-Id': '{{steps.prepare_auth.extracted.sessionId}}',
              'X-Tenant-Id': '{{steps.prepare_auth.extracted.tenantId}}',
            },
            body: { session: '{{steps.prepare_auth.extracted.sessionId}}', tenant: '{{steps.prepare_auth.extracted.tenantId}}', changed: true },
          },
        },
      ],
    };
    const { version } = await service.createTemplate({ content });
    const run = await service.testRun({
      templateVersionId: version.id,
      mode: 'mock',
      resolvedInput: resolvedWorkflowInput({
        variables: { deviceHost: 'edge-01.example.com' },
        credentials: { credential: { credentialId: 'cred_device_login', kind: 'USERNAME_PASSWORD', username: 'admin', secretRefs: { password: 'secret://password/sec_device_login#current' } } },
      }),
      mockResponses: {
        prepare_auth: {
          statusCode: 200,
          headers: { 'x-session-id': 'session-secret-value' },
          body: { data: { token: 'candidate-token-secret', tenant: { id: 'tenant-a' } } },
        },
        install_certificate: { statusCode: 200, body: { success: true } },
      },
    });
    const installPlan = run.stepResults[1]!.plan as { curlRequest: { template: { headers: Record<string, string> } } };
    const installBody = (run.stepResults[1]!.plan as { curlRequest: { template: { body: Record<string, unknown> } } }).curlRequest.template.body;
    const visible = JSON.stringify(run);

    assert.equal(run.status, 'success');
    assert.equal(installPlan.curlRequest.template.headers.Authorization, '[REDACTED]');
    assert.equal(installPlan.curlRequest.template.headers['X-Session-Id'], '[REDACTED]');
    assert.equal(installPlan.curlRequest.template.headers['X-Tenant-Id'], 'tenant-a');
    assert.deepEqual(installBody, { session: '[REDACTED]', tenant: 'tenant-a', changed: true });
    assert.equal(run.stepResults[0]!.extracted.accessToken, '[REDACTED]');
    assert.equal(run.stepResults[0]!.extracted.sessionId, '[REDACTED]');
    assert.equal(run.stepResults[0]!.extracted.tenantId, 'tenant-a');
    assert.doesNotMatch(visible, /candidate-token-secret/);
    assert.doesNotMatch(visible, /session-secret-value/);
  });

  it('extract 必需变量失败时返回 step、extractor 和提取规则', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content: WorkflowDslV1 = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'extract_failure_detail', displayName: '提取失败详情' },
      inputContract: workflowInputContract(),
      steps: [
        {
          name: 'prepare_auth',
          type: 'http',
          stage: 'prepare',
          request: { connectionRef: 'management', method: 'POST', url: 'https://{{variables.deviceHost}}/api/login' },
          extract: [{ name: 'sessionId', type: 'jsonPath', path: '$.data.sid' }],
        },
      ],
    };
    const { version } = await service.createTemplate({ content });

    await assert.rejects(async () => {
      await service.runWithDispatcher({
        templateVersionId: version.id,
        mode: 'mock',
        resolvedInput: resolvedWorkflowInput({ variables: { deviceHost: 'edge-01.example.com' } }),
      }, async () => ({
        success: true,
        statusCode: 200,
        body: { data: { token: 'runtime-token-secret' } },
        logs: ['curl:ok'],
      }));
    }, (error) => {
      assert.equal(error instanceof AppError, true);
      const appError = error as AppError;
      assert.equal(appError.errorCode, 'WORKFLOW_ASSERTION_FAILED');
      assert.match(appError.message, /step=prepare_auth/);
      assert.match(appError.message, /extractor=sessionId/);
      assert.match(appError.message, /\$\.data\.sid/);
      const details = appError.details as Record<string, unknown>;
      assert.equal(details.step, 'prepare_auth');
      assert.equal(details.stepType, 'http');
      assert.equal(details.extractor, 'sessionId');
      assert.equal(details.extractorType, 'jsonPath');
      assert.equal(details.path, '$.data.sid');
      assert.equal(details.outputStatusCode, 200);
      assert.deepEqual(details.outputBodyShape, {
        type: 'object',
        keys: ['data'],
        children: { data: { type: 'object', keys: ['token'] } },
      });
      assert.doesNotMatch(JSON.stringify(appError.details), /runtime-token-secret/);
      return true;
    });
  });

  it('支持单节点模拟运行，并返回脱敏后的执行计划和结果', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content = templateFixture();
    const run = await service.testStep({
      content,
      stepName: 'reload',
      mode: 'mock',
      resolvedInput: withResolvedVariables(runtimeInput('single').resolvedInput, { remoteFingerprint: 'SHA256:single-node' }),
      stepOutputs: { upload: { extracted: { remoteFingerprint: 'SHA256:single-node' } } },
      mockResponses: { reload: { exitCode: 0, stdout: 'single node ok' } },
    });

    assert.equal(run.stepResult.name, 'reload');
    assert.equal(run.stepResult.status, 'success');
    assert.equal((run.stepResult.plan as { executor: string }).executor, '015.SSH');
    assert.match(run.logs.join('\n'), /step:reload/);
  });

  it('支持单节点真实试跑，并返回当前节点输出', async () => {
    const service = new WorkflowTemplatesApplicationService(
      new WorkflowTemplatesDomainService(),
      {
        stepDispatcher: async ({ step }) => {
          assert.equal(step.name, 'reload');
          return {
            success: true,
            exitCode: 0,
            stdout: 'real ssh ok',
            body: { stdout: 'real ssh ok', stderr: '', exitCode: 0 },
            logs: ['ssh:stdout:real ssh ok'],
          };
        },
      },
    );
    const content = templateFixture();
    const run = await service.testStep({
      content,
      stepName: 'reload',
      mode: 'real_test',
      resolvedInput: withResolvedVariables(runtimeInput('single').resolvedInput, { remoteFingerprint: 'SHA256:single-node' }),
      stepOutputs: { upload: { extracted: { remoteFingerprint: 'SHA256:single-node' } } },
    });

    assert.equal(run.mode, 'real_test');
    assert.equal(run.stepResult.name, 'reload');
    assert.equal(run.stepResult.status, 'success');
    assert.equal((run.stepOutput as { stdout?: string }).stdout, 'real ssh ok');
  });

  it('同一 SSH 节点连续真实试跑会使用不同幂等键', async () => {
    const idempotencyKeys: string[] = [];
    const dispatcher = createWorkflowStepDispatcher({
      sshExecutor: {
        execute: async (request: { idempotencyKey: string }) => {
          idempotencyKeys.push(request.idempotencyKey);
          return {
            success: true,
            exitCode: 0,
            mode: 'real_ssh',
            commandResult: { stdout: 'ok', stderr: '', exitCode: 0 },
          };
        },
      } as never,
    });
    const service = new WorkflowTemplatesApplicationService(
      new WorkflowTemplatesDomainService(),
      { stepDispatcher: dispatcher },
    );
    const input = {
      content: templateFixture(),
      stepName: 'reload',
      mode: 'real_test' as const,
      resolvedInput: withResolvedVariables(runtimeInput('single').resolvedInput, { remoteFingerprint: 'SHA256:single-node' }),
      stepOutputs: { upload: { extracted: { remoteFingerprint: 'SHA256:single-node' } } },
    };

    const first = await service.testStep(input);
    const second = await service.testStep(input);

    assert.equal(first.stepResult.status, 'success');
    assert.equal(second.stepResult.status, 'success');
    assert.equal(idempotencyKeys.length, 2);
    assert.notEqual(idempotencyKeys[0], idempotencyKeys[1]);
    assert.match(idempotencyKeys[0]!, /^workflow-step:wfstep_/);
    assert.match(idempotencyKeys[1]!, /^workflow-step:wfstep_/);
  });

  it('同一 CURL 节点连续真实试跑会使用不同幂等键', async () => {
    const idempotencyKeys: string[] = [];
    const dispatcher = createWorkflowStepDispatcher({
      curlExecutor: {
        execute: async (request: { idempotencyKey: string }) => {
          idempotencyKeys.push(request.idempotencyKey);
          return {
            success: true,
            statusCode: 200,
            headers: {},
            bodyJson: { token: 'runtime-token-secret' },
            bodyText: '{"token":"runtime-token-secret"}',
            logs: ['curl:ok'],
          };
        },
      } as never,
    });
    const service = new WorkflowTemplatesApplicationService(
      new WorkflowTemplatesDomainService(),
      { stepDispatcher: dispatcher },
    );
    const input = {
      content: templateFixture(),
      stepName: 'login',
      mode: 'real_test' as const,
      resolvedInput: runtimeInput('single').resolvedInput,
    };

    const first = await service.testStep(input);
    const second = await service.testStep(input);

    assert.equal(first.stepResult.status, 'success');
    assert.equal(second.stepResult.status, 'success');
    assert.equal(idempotencyKeys.length, 2);
    assert.notEqual(idempotencyKeys[0], idempotencyKeys[1]);
    assert.match(idempotencyKeys[0]!, /^workflow-step:wfstep_.*:login:curl:1$/);
    assert.match(idempotencyKeys[1]!, /^workflow-step:wfstep_.*:login:curl:1$/);
  });

  it('单节点真实试跑 SSH 连接失败时返回结构化错误详情', async () => {
    const dispatcher = createWorkflowStepDispatcher({
      sshExecutor: {
        execute: async () => {
          throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'SSH 连接失败', {
            sshErrorCode: 'SSH_CONNECT_FAILED',
            stage: 'connect',
            target: '10.255.0.127:22',
            category: 'network',
            cause: 'connect ECONNREFUSED 10.255.0.127:22',
            suggestion: '检查网络、端口、防火墙和 SSH 服务端配置',
          });
        },
      } as never,
    });
    const service = new WorkflowTemplatesApplicationService(
      new WorkflowTemplatesDomainService(),
      { stepDispatcher: dispatcher },
    );
    const content = templateFixture();
    const reload = content.steps.find((step) => step.name === 'reload');
    if (reload?.type === 'ssh') reload.extract = [{ name: 'remoteStatus', type: 'regex', pattern: 'status=(\\w+)' }];
    const run = await service.testStep({
      content,
      stepName: 'reload',
      mode: 'real_test',
      resolvedInput: withResolvedVariables(runtimeInput('single').resolvedInput, { remoteFingerprint: 'SHA256:single-node' }),
      stepOutputs: { upload: { extracted: { remoteFingerprint: 'SHA256:single-node' } } },
    });

    assert.equal(run.stepResult.status, 'failed');
    assert.equal(run.stepResult.errorCode, 'SSH_CONNECT_FAILED');
    assert.equal(run.stepResult.errorMessage, 'SSH 连接失败');
    assert.deepEqual(run.stepResult.extracted, {});
    assert.deepEqual(run.stepResult.assertions, []);
    assert.match(run.logs.join('\n'), /ssh:target:10\.255\.0\.127:22/);
    assert.match(JSON.stringify(run.stepOutput), /connect ECONNREFUSED 10\.255\.0\.127:22/);
    assert.match(JSON.stringify(run.stepOutput), /检查网络、端口、防火墙和 SSH 服务端配置/);
  });

  it('单节点真实试跑 Host Key 被拒绝时保留主机校验错误码', async () => {
    const dispatcher = createWorkflowStepDispatcher({
      sshExecutor: {
        execute: async () => {
          throw new AppError('VALIDATION_FAILED', 'SSH Host Key 需要人工审批', {
            sshErrorCode: 'HOST_KEY_APPROVAL_REQUIRED',
            stage: 'host_key',
            target: '10.255.0.127:22',
            category: 'approval',
            cause: 'Host denied (verification failed)',
            suggestion: '审批或预置目标主机 Host Key 后重试',
          });
        },
      } as never,
    });
    const service = new WorkflowTemplatesApplicationService(
      new WorkflowTemplatesDomainService(),
      { stepDispatcher: dispatcher },
    );
    const content = templateFixture();
    const run = await service.testStep({
      content,
      stepName: 'reload',
      mode: 'real_test',
      resolvedInput: withResolvedVariables(runtimeInput('single').resolvedInput, { remoteFingerprint: 'SHA256:single-node' }),
      stepOutputs: { upload: { extracted: { remoteFingerprint: 'SHA256:single-node' } } },
    });

    assert.equal(run.stepResult.status, 'failed');
    assert.equal(run.stepResult.errorCode, 'HOST_KEY_APPROVAL_REQUIRED');
    assert.equal(run.stepResult.errorMessage, 'SSH Host Key 需要人工审批');
    assert.match(JSON.stringify(run.stepOutput), /host_key/);
    assert.match(JSON.stringify(run.stepOutput), /审批或预置目标主机 Host Key 后重试/);
  });

  it('condition 判断节点按变量结果决定成功或失败', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content = templateFixture();
    content.steps = [
      {
        name: 'isLinux',
        type: 'condition',
        condition: { variable: 'variables.deviceOs', equals: 'linux' },
        description: '只允许 Linux 目标继续',
      },
    ];
    content.inputContract.variables = {
      deviceOs: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
    };
    content.rollback = undefined;

    const passed = await service.testStep({ content, stepName: 'isLinux', mode: 'mock', resolvedInput: resolvedWorkflowInput({ variables: { deviceOs: 'linux' } }) });
    assert.equal(passed.stepResult.status, 'success');
    assert.equal((passed.stepResult.plan as { executor: string }).executor, 'workflow.condition');

    const failed = await service.testStep({ content, stepName: 'isLinux', mode: 'mock', resolvedInput: resolvedWorkflowInput({ variables: { deviceOs: 'windows' } }) });
    assert.equal(failed.stepResult.status, 'failed');
  });

  it('按 stage 固定顺序执行，并在结果中保留阶段', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content = templateFixture();
    content.steps = [
      { name: 'verifyFirstInArray', type: 'manual', stage: 'verify', instruction: 'verify' },
      { name: 'prepareSecondInArray', type: 'http', stage: 'prepare', request: { connectionRef: 'management', method: 'GET', url: 'https://{{variables.deviceHost}}/login' } },
      { name: 'refreshThirdInArray', type: 'ssh', stage: 'refresh', ssh: { mode: 'command', connectionRef: 'targetSsh', commands: ['echo one', 'echo two'] } },
    ];
    content.rollback = undefined;
    const { version } = await service.createTemplate({ content });
    const run = await service.testRun({
      ...runtimeInput(version.id),
      mockResponses: { prepareSecondInArray: { statusCode: 200, body: { ok: true } }, refreshThirdInArray: { exitCode: 0, stdout: 'ok' } },
    });

    assert.deepEqual(run.stepResults.map((step) => step.name), ['prepareSecondInArray', 'refreshThirdInArray', 'verifyFirstInArray']);
    assert.deepEqual(run.stepResults.map((step) => step.stage), ['prepare', 'refresh', 'verify']);
    assert.deepEqual((run.stepResults[1]!.plan as { commands: string[] }).commands, ['echo one', 'echo two']);
  });

  it('HTTP 和 SSH step adapter 只生成 017/015 请求形状，不访问真实网络或 SSH', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const { version } = await service.createTemplate({ content: templateFixture() });
    const run = await service.testRun({
      ...runtimeInput(version.id),
      mockResponses: {
        login: { statusCode: 200, body: { token: 'runtime-token-secret' } },
        upload: { statusCode: 200, body: { success: true, fingerprint: 'ff'.repeat(32) } },
        reload: { exitCode: 0, stdout: 'mock ssh reload ok' },
      },
    });

    assert.equal(run.status, 'success');
    assert.equal((run.stepResults[0]!.plan as { executor: string }).executor, '017.CURL_HTTP');
    assert.equal((run.stepResults[0]!.plan as { curlRequest: { template: { method: string; url: string } } }).curlRequest.template.method, 'POST');
    assert.equal((run.stepResults[2]!.plan as { executor: string }).executor, '015.SSH');
    assert.equal((run.stepResults[2]!.plan as { realSsh: boolean }).realSsh, false);
    assert.equal((run.stepResults[0]!.plan as { realNetwork: boolean }).realNetwork, false);
  });

  it('SFTP 和 SCP step 生成正式文件传输请求，不再伪装成 SSH 命令', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content = templateFixture();
    content.steps = [
      {
        name: 'uploadCertBySftp',
        type: 'sftp',
        stage: 'install',
        sftp: {
          direction: 'upload',
          connectionRef: 'targetSsh',
          remotePath: '/etc/gcac-test/certs/test.crt',
          contentRef: '{{artifacts.cert.outputs.pem}}',
          mode: '0644',
          timeoutSeconds: 60,
        },
        extract: [{ name: 'certHash', type: 'jsonPath', path: '$.transferResults[0].hash' }],
      },
      {
        name: 'uploadKeyByScp',
        type: 'scp',
        stage: 'install',
        scp: {
          direction: 'upload',
          connectionRef: 'targetSsh',
          remotePath: '/etc/gcac-test/certs/test.key',
          contentRef: '{{artifacts.cert.outputs.privateKey}}',
          mode: '0600',
          timeoutSeconds: 60,
        },
      },
    ];
    content.rollback = undefined;
    const { version } = await service.createTemplate({ content });
    const run = await service.testRun({
      ...runtimeInput(version.id),
      mockResponses: {
        uploadCertBySftp: {
          exitCode: 0,
          body: { transferResults: [{ hash: 'b'.repeat(64), protocol: 'sftp', remotePath: '/etc/gcac-test/certs/test.crt' }] },
        },
        uploadKeyByScp: {
          exitCode: 0,
          body: { transferResults: [{ hash: 'c'.repeat(64), protocol: 'scp', remotePath: '/etc/gcac-test/certs/test.key' }] },
        },
      },
    });

    const sftpPlan = run.stepResults[0]!.plan as {
      sshRequest: { sftp: Array<{ remotePath: string; content: string; mode: string }> };
      protocol: string;
    };
    const scpPlan = run.stepResults[1]!.plan as {
      sshRequest: { scp: Array<{ remotePath: string; content: string; mode: string }> };
      protocol: string;
    };
    assert.equal(run.status, 'success');
    assert.equal(sftpPlan.protocol, 'sftp');
    assert.equal(sftpPlan.sshRequest.sftp[0]!.remotePath, '/etc/gcac-test/certs/test.crt');
    assert.equal(sftpPlan.sshRequest.sftp[0]!.content, '[REDACTED]');
    assert.equal(sftpPlan.sshRequest.sftp[0]!.mode, '0644');
    assert.equal(scpPlan.protocol, 'scp');
    assert.equal(scpPlan.sshRequest.scp[0]!.remotePath, '/etc/gcac-test/certs/test.key');
    assert.equal(scpPlan.sshRequest.scp[0]!.content, '[REDACTED]');
    assert.equal(scpPlan.sshRequest.scp[0]!.mode, '0600');
    assert.equal(run.stepResults[0]!.extracted.certHash, 'b'.repeat(64));
  });

  it('connectionRef 会为 SSH、SFTP、SCP 和 rollback 解析同一结构化连接', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content: WorkflowDslV1 = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'connection-ref-runtime' },
      inputContract: workflowInputContract(),
      steps: [
        { name: 'sshStep', type: 'ssh', stage: 'prepare', ssh: { mode: 'command', connectionRef: 'targetSsh', command: 'echo ok' } },
        { name: 'sftpStep', type: 'sftp', stage: 'install', sftp: { direction: 'download', connectionRef: 'targetSsh', remotePath: '/tmp/a', localPath: '/tmp/local-a' } },
        { name: 'scpStep', type: 'scp', stage: 'install', scp: { direction: 'download', connectionRef: 'targetSsh', remotePath: '/tmp/b', localPath: '/tmp/local-b' } },
      ],
      rollback: [
        { name: 'rollbackStep', type: 'ssh', stage: 'refresh', ssh: { mode: 'command', connectionRef: 'targetSsh', command: 'echo rollback' } },
      ],
    };
    const input = {
      content,
      mode: 'render_only' as const,
      resolvedInput: resolvedWorkflowInput({
        connections: { targetSsh: { transport: 'ssh', host: '10.255.0.127', port: 2222, username: 'root', credentialSlot: 'sshCredential' } },
        credentials: { sshCredential: { credentialId: 'cred_ssh', kind: 'SSH_KEY', secretRefs: { privateKey: 'secret://ssh_key/sec_ssh#current' } } },
      }),
    };
    for (const stepName of ['sshStep', 'sftpStep', 'scpStep', 'rollbackStep']) {
      const result = await service.testStep({ ...input, stepName });
      const plan = result.stepResult.plan as { connection: { host: string; port: number; username: string }; sshRequest?: { connection: { host: string; port: number; username: string } } };
      const connection = plan.sshRequest?.connection ?? plan.connection;
      assert.equal(connection.host, '10.255.0.127');
      assert.equal(connection.port, 2222);
      assert.equal(connection.username, 'root');
    }
  });

  it('HTTP connectionRef 使用统一连接快照的 TLS 配置并拒绝 SSH Transport', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content: WorkflowDslV1 = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'http-connection-ref-runtime' },
      inputContract: workflowInputContract(),
      steps: [{ name: 'probe', type: 'http', request: { method: 'GET', url: 'https://api.example.com/health', connectionRef: 'management' } }],
    };
    const result = await service.testStep({
      content,
      stepName: 'probe',
      mode: 'render_only',
      resolvedInput: resolvedWorkflowInput({
        connections: { management: { transport: 'http', host: 'api.example.com', port: 8443, tls: { verifyPeer: false, serverName: 'adc.example.com' } } },
      }),
    });
    const plan = result.stepResult.plan as { curlRequest: { template: { tls: { verify: boolean; sni?: string } } } };
    assert.deepEqual(plan.curlRequest.template.tls, { verify: false, sni: 'adc.example.com' });

    await assert.rejects(() => service.testStep({
      content,
      stepName: 'probe',
      mode: 'render_only',
      resolvedInput: resolvedWorkflowInput({
        connections: { management: { transport: 'ssh', host: 'api.example.com', port: 22, username: 'root', credentialSlot: 'sshCredential' } },
        credentials: { sshCredential: { credentialId: 'cred_ssh', kind: 'SSH_KEY', secretRefs: { privateKey: 'secret://ssh_key/sec_ssh#current' } } },
      }),
    }), /必须引用 HTTP 连接/);
  });

  it('HTTP adapter 映射 DSL query/form/multipart/auth/tls/retry 到 CurlExecutor 请求', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content = templateFixture();
    content.steps = [
      {
        name: 'submit',
        type: 'http',
        retry: { count: 2, intervalSeconds: 1, retryOnStatus: [500, 503], retryOnNetworkError: true },
        request: {
          method: 'POST',
          connectionRef: 'management',
          url: 'https://{{variables.deviceHost}}/api/submit',
          query: { dryRun: true },
          headers: { Accept: 'application/json' },
          headerRefs: { 'X-Trace-Secret': 'secret://trace/id' },
          bodyType: 'multipart',
          multipart: {
            cert: { value: '{{artifacts.cert.outputs.pem}}', filename: 'cert.pem', contentType: 'application/x-pem-file' },
            key: { secretRef: 'secret://cert/key' },
          },
          auth: { type: 'bearer', credential: '{{credentials.apiCredential}}' },
          tls: { verify: true, caSecretRef: 'secret://ca/root' },
          timeoutSeconds: 12,
          maxResponseBytes: 4096,
          successStatusCodes: [200, 202],
        },
        extract: [{ name: 'status', type: 'jsonPath', path: '$.status' }],
        assert: [{ type: 'statusCode', equals: 202 }],
      },
    ];
    content.rollback = undefined;
    const { version } = await service.createTemplate({ content });
    const run = await service.testRun({
      ...runtimeInput(version.id),
      mockResponses: { submit: { statusCode: 202, body: { status: 'accepted' } } },
    });

    const plan = run.stepResults[0]!.plan as {
      curlRequest: {
        template: {
          query: Record<string, unknown>;
          headerRefs: Record<string, string>;
          bodyType: string;
          multipart: Record<string, unknown>;
          auth: { type: string; secretRef: string };
          tls: { verify: boolean; caSecretRef: string };
          timeoutMs: number;
          maxResponseBytes: number;
        };
        retryPolicy: { maxAttempts: number; retryOnStatus: number[]; retryOnNetworkError: boolean };
      };
    };
    assert.equal(run.status, 'success');
    assert.deepEqual(plan.curlRequest.template.query, { dryRun: true });
    assert.equal(plan.curlRequest.template.headerRefs['X-Trace-Secret'], '[REDACTED]');
    assert.equal(plan.curlRequest.template.bodyType, 'multipart');
    assert.equal(plan.curlRequest.template.auth.type, 'bearer');
    assert.equal(plan.curlRequest.template.auth.secretRef, '[REDACTED]');
    assert.equal(plan.curlRequest.template.tls.caSecretRef, '[REDACTED]');
    assert.equal(plan.curlRequest.template.timeoutMs, 12_000);
    assert.equal(plan.curlRequest.template.maxResponseBytes, 4096);
    assert.equal(plan.curlRequest.retryPolicy.maxAttempts, 3);
    assert.deepEqual(plan.curlRequest.retryPolicy.retryOnStatus, [500, 503]);
  });

  it('HTTP formCredentialRefs 会转换成内部 formSecretRefs 并在计划中脱敏', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content = templateFixture();
    content.steps = [
      {
        name: 'login_form',
        type: 'http',
        stage: 'prepare',
        request: {
          method: 'POST',
          connectionRef: 'management',
          url: 'https://{{variables.deviceHost}}/webapi/entry.cgi',
          bodyType: 'form',
          form: { account: '{{credentials.apiCredential.username}}', method: 'login' },
          formCredentialRefs: { passwd: '{{credentials.apiCredential}}' },
        },
        extract: [{ name: 'sid', type: 'jsonPath', path: '$.data.sid', sensitive: true }],
      },
    ];
    content.rollback = undefined;
    const { version } = await service.createTemplate({ content });
    const run = await service.testRun({
      ...runtimeInput(version.id),
      resolvedInput: resolvedWorkflowInput({
        variables: { deviceHost: 'edge-01.example.com' },
        credentials: { apiCredential: { credentialId: 'cred_device_login', kind: 'USERNAME_PASSWORD', username: 'admin', secretRefs: { password: 'secret://password/sec_device_login#current' } } },
      }),
      mockResponses: { login_form: { statusCode: 200, body: { data: { sid: 'sid-secret-value' } } } },
    });

    const plan = run.stepResults[0]!.plan as {
      curlRequest: {
        template: {
          form: Record<string, unknown>;
          formSecretRefs: unknown;
        };
      };
    };
    const visible = JSON.stringify(run);
    assert.equal(run.status, 'success');
    assert.deepEqual(plan.curlRequest.template.form, { account: 'admin', method: 'login' });
    assert.equal(plan.curlRequest.template.formSecretRefs, '[REDACTED]');
    assert.equal(run.stepResults[0]!.extracted.sid, '[REDACTED]');
    assert.doesNotMatch(visible, /sid-secret-value/);
    assert.doesNotMatch(visible, /sec_device_login/);
  });

  it('transform step 可以用 JSONata 生成上下文变量并供后续步骤引用', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content = templateFixture();
    content.inputContract.variables.previousServices = { type: 'object', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' };
    content.steps = [
      {
        name: 'build_bindings',
        type: 'transform',
        stage: 'refresh',
        transform: {
          engine: 'jsonata',
          input: {
            previousCertificateServices: '{{variables.previousServices.services}}',
            previousCertificateId: 'old-cert',
            newCertificateId: 'new-cert',
          },
          outputs: {
            serviceBindingsJson: {
              expression: '[$map(previousCertificateServices, function($service){{"service":$service,"old_id":previousCertificateId,"id":newCertificateId}})]',
              format: 'jsonString',
            },
          },
          timeoutMs: 1000,
          maxInputBytes: 4096,
          maxOutputBytes: 4096,
        },
      },
      {
        name: 'submit_bindings',
        type: 'http',
        stage: 'refresh',
        request: {
          method: 'POST',
          connectionRef: 'management',
          url: 'https://{{variables.deviceHost}}/api/cert-service',
          bodyType: 'form',
          form: { settings: '{{steps.build_bindings.extracted.serviceBindingsJson}}' },
        },
      },
    ];
    content.rollback = undefined;
    const { version } = await service.createTemplate({ content });
    const run = await service.testRun({
      ...runtimeInput(version.id),
      resolvedInput: withResolvedVariables(runtimeInput(version.id).resolvedInput, { previousServices: { services: ['DSM', 'WebStation'] } }),
      mockResponses: {
        submit_bindings: { statusCode: 200, body: { success: true } },
      },
    });

    const expectedSettings = JSON.stringify([
      { service: 'DSM', old_id: 'old-cert', id: 'new-cert' },
      { service: 'WebStation', old_id: 'old-cert', id: 'new-cert' },
    ]);
    const submitPlan = run.stepResults[1]!.plan as { curlRequest: { template: { form: Record<string, string> } } };
    assert.equal(run.status, 'success');
    assert.equal(run.stepResults[0]!.extracted.serviceBindingsJson, expectedSettings);
    assert.equal(submitPlan.curlRequest.template.form.settings, expectedSettings);
  });

  it('transform step 拒绝危险函数、超长表达式和超限输入输出', async () => {
    const invalidFunction = templateFixture();
    invalidFunction.steps = [{
      name: 'bad_transform',
      type: 'transform',
      transform: {
        engine: 'jsonata',
        outputs: { value: { expression: '$error("bad")' } },
      },
    }];
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(invalidFunction), /禁用函数/);

    const tooLong = templateFixture();
    tooLong.steps = [{
      name: 'long_transform',
      type: 'transform',
      transform: {
        engine: 'jsonata',
        outputs: { value: { expression: 'a'.repeat(4097) } },
      },
    }];
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(tooLong), /4096/);

    const service = new WorkflowTemplatesApplicationService();
    const oversizedInput = templateFixture();
    oversizedInput.inputContract.variables.largeValue = { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' };
    oversizedInput.steps = [{
      name: 'oversized_input',
      type: 'transform',
      transform: {
        engine: 'jsonata',
        input: { value: '{{variables.largeValue}}' },
        outputs: { value: { expression: '$.value' } },
        maxInputBytes: 8,
      },
    }];
    oversizedInput.rollback = undefined;
    const oversizedInputTemplate = await service.createTemplate({ content: oversizedInput });
    await assert.rejects(() => service.testRun({
      ...runtimeInput(oversizedInputTemplate.version.id),
      resolvedInput: withResolvedVariables(runtimeInput('unused').resolvedInput, { largeValue: '0123456789abcdef' }),
    }), /transform input 超过大小限制/);

    const oversizedOutput = templateFixture();
    oversizedOutput.steps = [{
      name: 'oversized_output',
      type: 'transform',
      transform: {
        engine: 'jsonata',
        outputs: { value: { expression: '"0123456789abcdef"' } },
        timeoutMs: 1000,
        maxOutputBytes: 8,
      },
    }];
    oversizedOutput.rollback = undefined;
    const oversizedOutputTemplate = await service.createTemplate({ content: oversizedOutput });
    await assert.rejects(() => service.testRun(runtimeInput(oversizedOutputTemplate.version.id)), /transform output value 超过大小限制/);
  });

  it('transform step 的 JSONata 执行超时会终止隔离 worker', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content = templateFixture();
    content.steps = [{
      name: 'timeout_transform',
      type: 'transform',
      transform: {
        engine: 'jsonata',
        outputs: { value: { expression: '$sum([1..1000000])' } },
        timeoutMs: 1,
      },
    }];
    content.rollback = undefined;
    const { version } = await service.createTemplate({ content });

    await assert.rejects(() => service.testRun(runtimeInput(version.id)), /JSONata 转换执行超时/);
  });

  it('Synology DSM 模板不要求手工填写证书 ID 和服务绑定 JSON', async () => {
    const raw = await readFile('src/modules/workflow-templates/builtin-workflows/synology-dsm-cert-import.json', 'utf8');
    const content = workflowTemplatesSchemaRegistry.validate(JSON.parse(raw));
    assert.equal(content.inputContract.variables.previousCertificateId?.required, false);
    assert.equal(content.inputContract.variables.newCertificateId?.required, false);
    assert.equal(content.inputContract.variables.serviceBindingsJson?.required, false);

    const service = new WorkflowTemplatesApplicationService();
    const { version } = await service.createTemplate({ content });
    const run = await service.testRun({
      templateVersionId: version.id,
      mode: 'mock',
      resolvedInput: resolvedWorkflowInput({
        variables: {
          deviceBaseUrl: 'https://nas.example.com:5001',
          certificateDescription: 'GCAC active certificate',
          verifyUrl: 'https://nas.example.com:5001/',
          hostHeader: 'nas.example.com',
        },
        credentials: { synologyCredential: { credentialId: 'cred_synology_login', kind: 'USERNAME_PASSWORD', username: 'admin', secretRefs: { password: 'secret://password/sec_synology_login#current' } } },
        artifacts: { serverCert: { outputs: {
            certFile: { content: '-----BEGIN CERTIFICATE-----mock-----END CERTIFICATE-----' },
            keyFile: { content: '-----BEGIN PRIVATE KEY-----mock-----END PRIVATE KEY-----' },
            chainFile: { content: '-----BEGIN CERTIFICATE-----chain-----END CERTIFICATE-----' },
        } } },
      }),
      mockResponses: {
        prepare_synology_login: { statusCode: 200, body: { success: true, data: { sid: 'sid-secret', synotoken: 'token-secret' } } },
        list_synology_certificates_before_import: {
          statusCode: 200,
          body: { success: true, data: [{ id: 'old-cert', desc: 'old', is_default: true, services: ['DSM', 'WebStation'] }] },
        },
        install_synology_certificate_as_new_default: { statusCode: 200, body: { success: true } },
        list_synology_certificates_after_import: {
          statusCode: 200,
          body: {
            success: true,
            data: [
              { id: 'old-cert', desc: 'old', is_default: false, services: [] },
              { id: 'new-cert', desc: 'GCAC active certificate', is_default: true, services: ['DSM'] },
            ],
          },
        },
        apply_synology_service_bindings: { statusCode: 200, body: { success: true } },
        logout_synology_session: { statusCode: 200, body: { success: true } },
        verify_synology_https: { statusCode: 200, body: 'ok' },
      },
    });

    const applyStep = run.stepResults.find((step) => step.name === 'apply_synology_service_bindings');
    const applyPlan = applyStep?.plan as { curlRequest: { template: { form: Record<string, string> } } } | undefined;
    assert.equal(run.status, 'success');
    assert.equal(applyPlan?.curlRequest.template.form.settings, JSON.stringify([
      { service: 'DSM', old_id: 'old-cert', id: 'new-cert' },
      { service: 'WebStation', old_id: 'old-cert', id: 'new-cert' },
    ]));
  });

  it('提取器、断言、条件、retry、rollback 和 testRun 模式形成最小闭环', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const { version } = await service.createTemplate({ content: templateFixture() });

    const rollbackRun = await service.testRun(runtimeInput(version.id));
    assert.equal(rollbackRun.status, 'rolled_back');
    assert.equal(rollbackRun.stepResults[1]!.attempts, 2);
    assert.equal(rollbackRun.rollbackResults[0]!.name, 'restoreOldCert');
    assert.ok(rollbackRun.stepResults[1]!.assertions.some((item) => item.passed === false));

    const skippedRun = await service.testRun({
      ...runtimeInput(version.id),
      resolvedInput: withResolvedVariables(runtimeInput(version.id).resolvedInput, { shouldUpload: false }),
      mockResponses: { login: { statusCode: 200, body: { token: 'runtime-token-secret' } } },
    });
    assert.equal(skippedRun.stepResults[1]!.status, 'skipped');

    const realPlan = await service.testRun({ ...runtimeInput(version.id), mode: 'real_test' });
    assert.equal(realPlan.mode, 'real_test');
    assert.equal(realPlan.plannedOnly, false);
  });

  it('显式执行 rollback 分支时复用同一 WorkflowVersion，不把回滚追加到 deploy 结果', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const { version } = await service.createTemplate({ content: templateFixture() });

    const rollbackRun = await service.testRun({
      ...runtimeInput(version.id),
      executionBranch: 'rollback',
      mockResponses: {
        restoreOldCert: { statusCode: 200, body: { restored: true } },
      },
    });

    assert.equal(rollbackRun.executionBranch, 'rollback');
    assert.equal(rollbackRun.status, 'success');
    assert.equal(rollbackRun.stepResults.length, 0);
    assert.equal(rollbackRun.rollbackResults.length, 1);
    assert.equal(rollbackRun.rollbackResults[0]?.name, 'restoreOldCert');

    const withoutRollback = structuredClone(templateFixture());
    withoutRollback.rollback = undefined;
    const noRollback = await service.createTemplate({ content: withoutRollback });
    await assert.rejects(
      () => service.testRun({ ...runtimeInput(noRollback.version.id), executionBranch: 'rollback' }),
      (error: any) => error.errorCode === 'VALIDATION_FAILED' && /rollback 分支/.test(error.message),
    );
  });

  it('contains 断言会渲染变量并忽略大小写差异', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const { version } = await service.createTemplate({
      content: {
        apiVersion: 'gcac.workflow/v1',
        kind: 'CurlSshWorkflow',
        metadata: { name: 'contains-render' },
        inputContract: workflowInputContract({
          expectedResponseContains: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
        }),
        steps: [{
          name: 'verify_body',
          type: 'http',
          request: { connectionRef: 'management', method: 'GET', url: 'https://example.com/' },
          assert: [{ type: 'contains', value: '{{variables.expectedResponseContains}}' }],
        }],
      },
    });

    const run = await service.testRun({
      templateVersionId: version.id,
      mode: 'mock',
      resolvedInput: resolvedWorkflowInput({ variables: { expectedResponseContains: 'apache test ok' } }),
      mockResponses: {
        verify_body: { statusCode: 200, body: 'Apache test ok' },
      },
    });

    assert.equal(run.status, 'success');
    assert.equal(run.stepResults[0]!.assertions[0]!.passed, true);
  });

  it('foreach 顺序执行动态集合并恢复循环变量作用域', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const { version } = await service.createTemplate({
      content: {
        apiVersion: 'gcac.workflow/v1',
        kind: 'CurlSshWorkflow',
        metadata: { name: 'foreach-sequential' },
        inputContract: workflowInputContract({
          apiToken: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding', sensitive: true },
        }),
        steps: [{
          name: 'deploy_targets',
          type: 'foreach',
          foreach: {
            itemsPath: 'asset.deployment.targets',
            itemVariable: 'target',
            indexVariable: 'targetIndex',
            maxItems: 10,
            steps: [{
              name: 'deploy_target',
              type: 'http',
              request: {
                method: 'POST',
                connectionRef: 'management',
                url: 'https://{{target.serverName}}/deploy/{{targetIndex}}',
                headers: { Authorization: 'Bearer {{variables.apiToken}}' },
              },
            }],
          },
        }],
      },
    });
    const urls: string[] = [];
    const executionNames: string[] = [];
    const run = await service.runWithDispatcher({
      templateVersionId: version.id,
      mode: 'mock',
      resolvedInput: withResolvedVariables(resolvedInputWithTargets([{ host: 'adc-a.example.com' }, { host: 'adc-b.example.com' }]), { apiToken: 'foreach-secret-token' }),
    }, async ({ renderedPlan, step }) => {
      const plan = renderedPlan as { curlRequest: { template: { url: string } } };
      urls.push(plan.curlRequest.template.url);
      executionNames.push(step.name);
      return { success: true, statusCode: 200, body: { ok: true }, logs: ['token=foreach-secret-token'] };
    });

    assert.equal(run.status, 'success');
    assert.deepEqual(urls, ['https://adc-a.example.com/deploy/0', 'https://adc-b.example.com/deploy/1']);
    assert.deepEqual(executionNames, ['deploy_targets[0].deploy_target', 'deploy_targets[1].deploy_target']);
    assert.equal(run.stepResults[0]!.type, 'foreach');
    assert.match(run.stepResults[0]!.logs[0]!, /count:2:completed:2:status:success/);
    assert.doesNotMatch(JSON.stringify(run), /foreach-secret-token/);
  });

  it('foreach 超限时拒绝执行，子步骤失败时立即停止', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const { version } = await service.createTemplate({
      content: {
        apiVersion: 'gcac.workflow/v1',
        kind: 'CurlSshWorkflow',
        metadata: { name: 'foreach-fail-fast' },
        inputContract: workflowInputContract(),
        steps: [{
          name: 'probe_targets',
          type: 'foreach',
          foreach: {
            itemsPath: 'asset.deployment.targets',
            itemVariable: 'target',
            maxItems: 2,
            steps: [{
              name: 'probe_target',
              type: 'http',
              request: { connectionRef: 'management', method: 'GET', url: 'https://{{target.serverName}}/health' },
            }],
          },
        }],
      },
    });

    await assert.rejects(() => service.testRun({
      templateVersionId: version.id,
      mode: 'mock',
      resolvedInput: resolvedInputWithTargets([{ host: 'a' }, { host: 'b' }, { host: 'c' }]),
    }), /超过允许上限/);

    let attempts = 0;
    const failed = await service.runWithDispatcher({
      templateVersionId: version.id,
      mode: 'mock',
      resolvedInput: resolvedInputWithTargets([{ host: 'a' }, { host: 'b' }]),
    }, async () => {
      attempts += 1;
      return attempts === 1
        ? { success: false, statusCode: 500, errorCode: 'REMOTE_FAILED', errorMessage: 'remote failed' }
        : { success: true, statusCode: 200 };
    });

    assert.equal(failed.status, 'failed');
    assert.equal(attempts, 1);
    assert.equal(failed.stepResults[0]!.errorCode, 'REMOTE_FAILED');
  });

  it('foreach continueOnError 跳过失败元素并继续后续元素', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const { version } = await service.createTemplate({
      content: {
        apiVersion: 'gcac.workflow/v1',
        kind: 'CurlSshWorkflow',
        metadata: { name: 'foreach-best-effort' },
        inputContract: workflowInputContract(),
        steps: [{
          name: 'probe_targets',
          type: 'foreach',
          foreach: {
            itemsPath: 'asset.deployment.targets',
            itemVariable: 'target',
            continueOnError: true,
            steps: [{
              name: 'probe_target',
              type: 'http',
              request: { connectionRef: 'management', method: 'GET', url: 'https://{{target.serverName}}/health' },
            }],
          },
        }],
      },
    });
    let attempts = 0;
    const result = await service.runWithDispatcher({
      templateVersionId: version.id,
      mode: 'mock',
      resolvedInput: resolvedInputWithTargets([{ host: 'a' }, { host: 'b' }]),
    }, async () => {
      attempts += 1;
      return attempts === 1
        ? { success: false, statusCode: 500, errorCode: 'REMOTE_FAILED', errorMessage: 'remote failed' }
        : { success: true, statusCode: 200 };
    });

    assert.equal(result.status, 'success');
    assert.equal(attempts, 2);
    assert.equal(result.stepResults[0]!.children?.[0]?.status, 'failed');
    assert.equal(result.stepResults[0]!.children?.[1]?.status, 'success');
  });

  it('foreach schema 拒绝超过三层的嵌套', () => {
    const leaf = { name: 'leaf', type: 'wait', seconds: 1 } as const;
    const nested = (name: string, child: WorkflowDslV1['steps'][number]): WorkflowDslV1['steps'][number] => ({
      name,
      type: 'foreach',
      foreach: { itemsPath: 'asset.items', itemVariable: `${name}Item`, steps: [child] },
    });
    const content: WorkflowDslV1 = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'foreach-depth' },
      inputContract: workflowInputContract(),
      steps: [nested('level1', nested('level2', nested('level3', nested('level4', leaf))))],
    };

    assert.throws(() => workflowTemplatesSchemaRegistry.validate(content), /不能超过 3 层/);
  });

  it('checkpoint 生成规范化哈希并拒绝捕获敏感变量', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const { version } = await service.createTemplate({
      content: {
        apiVersion: 'gcac.workflow/v1',
        kind: 'CurlSshWorkflow',
        metadata: { name: 'checkpoint-capture' },
        inputContract: workflowInputContract({
          remoteState: { type: 'object', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
          apiToken: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding', sensitive: true },
        }),
        steps: [{
          name: 'before_write',
          type: 'checkpoint',
          stage: 'backup',
          checkpoint: {
            name: 'before-write',
            capture: { remoteState: 'variables.remoteState' },
            normalizedHash: true,
            requiredForRollback: true,
          },
        }],
      },
    });
    const run = await service.testRun({
      templateVersionId: version.id,
      mode: 'mock',
      resolvedInput: resolvedWorkflowInput({ variables: { remoteState: { etag: 'v1' }, apiToken: 'hidden-token' } }),
    });
    const plan = run.stepResults[0]!.plan as { captureHash: string; capture: Record<string, unknown> };
    assert.match(plan.captureHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(plan.capture, { remoteState: { etag: 'v1' } });

    const unsafe = { ...version.content, steps: [{
      name: 'unsafe_checkpoint',
      type: 'checkpoint',
      checkpoint: { name: 'unsafe', capture: { apiToken: 'variables.apiToken' }, requiredForRollback: true },
    }] } as WorkflowDslV1;
    const unsafeTemplate = await service.createTemplate({ content: unsafe });
    await assert.rejects(() => service.testRun({
      templateVersionId: unsafeTemplate.version.id,
      mode: 'mock',
      resolvedInput: resolvedWorkflowInput({ variables: { remoteState: {}, apiToken: 'hidden-token' } }),
    }), /不允许捕获敏感变量/);
  });
});

function workflowBindingsRepository(records: PluginWorkflowBindingRecord[]): PluginWorkflowBindingsRepositoryPort {
  return {
    save: async (record) => record,
    find: async () => undefined,
    findByResource: async () => undefined,
    findLatestByPluginResource: async () => undefined,
    listCurrent: async () => [...records],
    list: async () => [...records],
    listAll: async () => [...records],
  };
}

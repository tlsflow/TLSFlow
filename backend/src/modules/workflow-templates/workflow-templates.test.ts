import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '../../common/http/app.js';
import { AppError } from '../../common/errors/app-error.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import { WorkflowTemplatesApplicationService } from './application/workflow-templates.application-service.js';
import { createWorkflowStepDispatcher } from './application/workflow-step-dispatcher.js';
import { WorkflowTemplatesController } from './controller/workflow-templates.controller.js';
import { WorkflowTemplatesDomainService } from './domain/workflow-templates.domain-service.js';
import { WorkflowTemplateFileLibrary } from './domain/workflow-template-file-library.js';
import type { WorkflowDslV1, WorkflowTemplate, WorkflowTemplateVersion } from './dto/workflow-templates.dto.js';
import { workflowTemplatesSchemaRegistry } from './schema/workflow-templates.schema.js';

function templateFixture(): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'edge-cert-update', category: 'load_balancer' },
    variables: {
      deviceHost: { type: 'string', required: true },
      cert: { type: 'certificate', required: true },
      credential: { type: 'credential', required: true },
      shouldUpload: { type: 'boolean', default: true },
    },
    steps: [
      {
        name: 'login',
        type: 'http',
        request: {
          method: 'POST',
          url: 'https://{{deviceHost}}/api/login',
          auth: { type: 'basic', username: '{{credential.username}}', credential: '{{credential}}' },
          body: { user: '{{credential.username}}' },
        },
        extract: [{ name: 'token', type: 'jsonPath', path: '$.token', sensitive: true }],
        assert: [{ type: 'statusCode', equals: 200 }],
      },
      {
        name: 'upload',
        type: 'http',
        when: { variable: 'shouldUpload', equals: true },
        retry: { count: 1, intervalSeconds: 1 },
        request: {
          method: 'PUT',
          url: 'https://{{deviceHost}}/api/cert',
          body: { cert: '{{cert.pem}}', key: '{{cert.privateKey}}', token: '{{token}}' },
        },
        extract: { remoteFingerprint: { type: 'jsonPath', path: '$.fingerprint' } },
        assert: [
          { type: 'jsonPath', path: '$.success', equals: true },
          { type: 'certificateFingerprint', actual: '{{remoteFingerprint}}', expected: '{{cert.fingerprintSha256}}' },
        ],
      },
      {
        name: 'reload',
        type: 'ssh',
        when: { variable: 'shouldUpload', equals: true },
        ssh: {
          mode: 'command',
          connection: {
            host: '{{deviceHost}}',
            username: 'admin',
            credential: '{{credential}}',
            expectedHostKeyFingerprint: 'aabbccddeeff0011',
          },
          command: 'reload cert {{remoteFingerprint}}',
        },
        assert: [{ type: 'contains', value: 'ok' }],
      },
      { name: 'waitForApply', type: 'wait', seconds: 5 },
      { name: 'manualVerify', type: 'manual', instruction: '请人工确认 {{deviceHost}} 证书已更新' },
    ],
    rollback: [
      {
        name: 'restoreOldCert',
        type: 'ssh',
        ssh: {
          mode: 'script',
          connection: {
            host: '{{deviceHost}}',
            username: 'admin',
            credential: '{{credential}}',
            expectedHostKeyFingerprint: 'aabbccddeeff0011',
          },
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
    userVariables: {
      deviceHost: 'edge-01.example.com',
      credential: { id: 'sec_device_login', kind: 'username_password', type: 'password', username: 'admin' },
    },
    certificateMaterials: {
      cert: {
        pem: '-----BEGIN CERTIFICATE-----mock-----END CERTIFICATE-----',
        privateKey: 'super-private-key',
        fingerprintSha256: 'ff'.repeat(32),
      },
    },
    mockResponses: {
      login: { statusCode: 200, body: { token: 'runtime-token-secret' } },
      upload: { statusCode: 500, body: { success: false, fingerprint: '00'.repeat(32) } },
      reload: { exitCode: 0, stdout: 'ok' },
    },
  };
}

function createIsolatedWorkflowService(rootDirs: { builtinRootDir?: string; userRootDir: string } | string) {
  const db = new PgliteDatabase();
  const templates = new PgDocumentRepository<WorkflowTemplate>(db, 'workflow.templates');
  const versions = new PgDocumentRepository<WorkflowTemplateVersion>(db, 'workflow.template_versions');
  return new WorkflowTemplatesApplicationService(
    new WorkflowTemplatesDomainService(templates, versions, new WorkflowTemplateFileLibrary(rootDirs)),
  );
}

describe('WorkflowTemplates', () => {
  it('校验 DSL v1 schema，拒绝未知字段、缺失引用、类型错误、明文 Secret 和私钥', () => {
    workflowTemplatesSchemaRegistry.validate(templateFixture());
    assert.throws(() => workflowTemplatesSchemaRegistry.validate({ ...templateFixture(), extra: true }), /未知字段/);

    const missingReference = templateFixture();
    missingReference.steps[0] = {
      ...missingReference.steps[0]!,
      type: 'http',
      request: { method: 'GET', url: 'https://{{missingHost}}/api' },
    };
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(missingReference), /变量引用不存在|missingHost/);

    const wrongType = templateFixture();
    wrongType.variables.deviceHost = { type: 'number', default: 'bad' } as never;
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(wrongType), /必须是数字|number/);

    const plainSecret = templateFixture();
    plainSecret.steps[0] = {
      ...plainSecret.steps[0]!,
      type: 'http',
      request: { method: 'POST', url: 'https://edge/api', body: { password: 'password=clear-text' } },
    };
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(plainSecret), /Secret|明文/);

    const privateKey = templateFixture();
    privateKey.steps[1] = {
      ...privateKey.steps[1]!,
      type: 'http',
      request: { method: 'PUT', url: 'https://edge/api', body: '-----BEGIN PRIVATE KEY-----bad-----END PRIVATE KEY-----' },
    };
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(privateKey), /私钥/);

    const invalidFirstOf = templateFixture();
    const firstStep = invalidFirstOf.steps[0];
    if (firstStep?.type === 'http') firstStep.extract = [{ name: 'accessToken', type: 'firstOf', paths: [] }];
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(invalidFirstOf), /paths/);
  });

  it('校验 certificate 变量的证书产物合同', () => {
    const valid = templateFixture();
    valid.variables.serverCert = {
      type: 'certificate',
      required: true,
      sensitive: true,
      artifactContract: {
        outputs: {
          certFile: { role: 'public_certificate', required: true, format: 'pem', encoding: 'utf8' },
          keyFile: { role: 'private_key', required: true, format: 'pem', encoding: 'utf8' },
        },
      },
    };
    workflowTemplatesSchemaRegistry.validate(valid);

    const onStringVariable = templateFixture();
    onStringVariable.variables.deviceHost = {
      type: 'string',
      artifactContract: { outputs: { certFile: { role: 'public_certificate' } } },
    } as never;
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(onStringVariable), /artifactContract 只能用于 certificate/);

    const emptyOutputs = templateFixture();
    emptyOutputs.variables.cert = { type: 'certificate', artifactContract: { outputs: {} } } as never;
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(emptyOutputs), /artifactContract\.outputs/);

    const missingRole = templateFixture();
    missingRole.variables.cert = {
      type: 'certificate',
      artifactContract: { outputs: { certFile: { required: true } } },
    } as never;
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(missingRole), /output\.role/);
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

  it('可以扫描内置与用户导入文件模板，并支持基于模板新建或覆盖现有工作流', async () => {
    const builtinRootDir = await mkdtemp(join(tmpdir(), 'gcac-workflow-builtin-files-'));
    const userRootDir = await mkdtemp(join(tmpdir(), 'gcac-workflow-user-files-'));
    await mkdir(join(builtinRootDir, 'apache'), { recursive: true });
    await mkdir(join(userRootDir, 'apache'), { recursive: true });
    const validDsl = {
      ...templateFixture(),
      metadata: {
        ...templateFixture().metadata,
        name: 'file_template_create',
        displayName: '文件模板新建',
      },
      steps: [
        {
          name: 'prepare_login',
          type: 'http',
          stage: 'prepare',
          request: { method: 'GET', url: 'https://{{deviceHost}}/ping' },
        },
      ],
      rollback: [
        {
          name: 'rollback_manual',
          type: 'manual',
          instruction: '回退文件模板',
        },
      ],
    } satisfies WorkflowDslV1;
    const overwriteDsl = {
      ...validDsl,
      metadata: {
        ...validDsl.metadata,
        name: 'file_template_overwrite',
        displayName: '文件模板覆盖',
      },
      steps: [
        {
          name: 'verify_manual',
          type: 'manual',
          stage: 'verify',
          instruction: '验证覆盖内容',
        },
      ],
    } satisfies WorkflowDslV1;
    await writeFile(join(builtinRootDir, 'apache', 'valid-create.json'), `${JSON.stringify(validDsl, null, 2)}\n`, 'utf8');
    await writeFile(join(userRootDir, 'apache', 'valid-overwrite.json'), `${JSON.stringify(overwriteDsl, null, 2)}\n`, 'utf8');
    await writeFile(join(userRootDir, 'broken.json'), '{ bad json', 'utf8');

    const service = createIsolatedWorkflowService({ builtinRootDir, userRootDir });
    const files = await service.listFileTemplates();

    assert.equal(files.length, 3);
    assert.equal(files.some((item) => item.id === 'builtin/apache/valid-create.json' && item.source === 'builtin' && item.valid), true);
    assert.equal(files.some((item) => item.id === 'user/broken.json' && item.source === 'user' && item.valid === false), true);

    const createdFromFile = await service.createTemplateFromFile({
      fileTemplateId: 'builtin/apache/valid-create.json',
      changeSummary: '从文件模板创建',
    });
    assert.equal(createdFromFile.template.name, 'file_template_create');
    assert.equal(createdFromFile.version.content.metadata.displayName, '文件模板新建');

    const target = await service.createTemplate({
      content: {
        apiVersion: 'gcac.workflow/v1',
        kind: 'CurlSshWorkflow',
        metadata: { name: 'existing_workflow', displayName: '现有工作流' },
        variables: { deviceHost: { type: 'string', required: true } },
        steps: [{ name: 'wait_one', type: 'wait', seconds: 1 }],
      },
      changeSummary: '初始空白工作流',
    });
    const applied = await service.applyFileTemplateToTemplate({
      templateId: target.template.id,
      fileTemplateId: 'apache/valid-overwrite.json',
      changeSummary: '文件模板覆盖',
    });

    assert.equal(applied.content.metadata.name, 'existing_workflow');
    assert.equal(applied.content.metadata.displayName, '文件模板覆盖');
    assert.deepEqual(applied.content.steps.map((step) => step.name), ['verify_manual']);
    assert.deepEqual(applied.content.rollback?.map((step) => step.name), ['rollback_manual']);

    const appliedAgain = await service.applyFileTemplateToTemplate({
      templateId: target.template.id,
      fileTemplateId: 'apache/valid-overwrite.json',
      changeSummary: '重复套用同一文件模板',
    });
    const targetVersions = await service.listVersions(target.template.id);
    const currentTarget = (await service.listTemplates()).find((item) => item.id === target.template.id);

    assert.equal(applied.version, 2);
    assert.equal(appliedAgain.version, 3);
    assert.notEqual(appliedAgain.id, applied.id);
    assert.equal(appliedAgain.status, 'draft');
    assert.equal(appliedAgain.contentHash, applied.contentHash);
    assert.equal(targetVersions.length, 3);
    assert.equal(currentTarget?.status, 'draft');
    assert.equal(currentTarget?.currentVersionLabel, 'V3');
  });

  it('HTTP 列表接口返回真实数组，不能把 Promise 泄漏进 items', async () => {
    const app = new App();
    new WorkflowTemplatesController(new WorkflowTemplatesApplicationService()).register(app.router);

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/workflow-templates',
      body: { content: templateFixture(), changeSummary: '初始版本' },
    });
    assert.equal(created.statusCode, 201);
    const createdBody = created.body as { template: { id: string } };

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

  it('HTTP 版本备注接口只更新备注，不改写版本内容', async () => {
    const app = new App();
    new WorkflowTemplatesController(new WorkflowTemplatesApplicationService()).register(app.router);

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/workflow-templates',
      body: { content: templateFixture(), changeSummary: '初始版本' },
    });
    assert.equal(created.statusCode, 201);
    const createdBody = created.body as { template: { id: string }; version: { id: string; contentHash: string } };

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
    new WorkflowTemplatesController(new WorkflowTemplatesApplicationService()).register(app.router);

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/workflow-templates',
      body: { content: templateFixture(), changeSummary: '初始版本' },
    });
    assert.equal(created.statusCode, 201);
    const createdBody = created.body as { template: { id: string }; version: { id: string } };

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

  it('上游输出可以提取成运行时变量并供下游节点引用，同时对外脱敏', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content: WorkflowDslV1 = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'runtime_output_flow', displayName: '运行时输出传递' },
      variables: {
        deviceHost: { type: 'string', required: true },
        credential: { type: 'credential', required: true, sensitive: true },
      },
      steps: [
        {
          name: 'prepare_auth',
          type: 'http',
          stage: 'prepare',
          request: { method: 'POST', url: 'https://{{deviceHost}}/api/login' },
          extract: [{ name: 'accessToken', type: 'outputPath', path: '$.body.token', sensitive: true }],
          assert: [{ type: 'statusCode', equals: 200 }],
        },
        {
          name: 'reload_with_token',
          type: 'ssh',
          stage: 'refresh',
          ssh: {
            mode: 'command',
            connection: {
              host: '{{deviceHost}}',
              username: '{{credential.username}}',
              credential: '{{credential}}',
              hostKeyPolicy: 'trust_on_first_use',
            },
            command: 'echo {{accessToken}} {{previous.extracted.accessToken}} {{steps.prepare_auth.output.body.token}}',
          },
        },
      ],
    };
    const { version } = await service.createTemplate({ content });
    let renderedSshCommand = '';
    const run = await service.runWithDispatcher({
      templateVersionId: version.id,
      mode: 'mock',
      userVariables: {
        deviceHost: 'edge-01.example.com',
        credential: { id: 'sec_device_login', kind: 'username_password', type: 'password', username: 'admin' },
      },
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
    });
    const visible = JSON.stringify(run);

    assert.equal(run.status, 'success');
    assert.equal(renderedSshCommand, 'echo runtime-token-secret runtime-token-secret runtime-token-secret');
    assert.equal(run.stepResults[0]!.extracted.accessToken, '[REDACTED]');
    assert.doesNotMatch(visible, /runtime-token-secret/);
    assert.match(visible, /\[REDACTED\]/);
  });

  it('extract 可以把多个响应字段映射为多个运行时变量', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content: WorkflowDslV1 = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'flexible_auth_fields_flow', displayName: '灵活认证字段提取' },
      variables: {
        deviceHost: { type: 'string', required: true },
        credential: { type: 'credential', required: true, sensitive: true },
      },
      steps: [
        {
          name: 'prepare_auth',
          type: 'http',
          stage: 'prepare',
          request: { method: 'POST', url: 'https://{{deviceHost}}/api/login' },
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
            url: 'https://{{deviceHost}}/api/certificate',
            headers: {
              Authorization: 'Bearer {{accessToken}}',
              'X-Session-Id': '{{sessionId}}',
              'X-Tenant-Id': '{{tenantId}}',
            },
            body: { session: '{{sessionId}}', tenant: '{{tenantId}}', changed: true },
          },
        },
      ],
    };
    const { version } = await service.createTemplate({ content });
    const run = await service.testRun({
      templateVersionId: version.id,
      mode: 'mock',
      userVariables: {
        deviceHost: 'edge-01.example.com',
        credential: { id: 'sec_device_login', kind: 'username_password', type: 'password', username: 'admin' },
      },
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

  it('支持单节点模拟运行，并返回脱敏后的执行计划和结果', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content = templateFixture();
    const run = await service.testStep({
      content,
      stepName: 'reload',
      mode: 'mock',
      userVariables: { ...runtimeInput('single').userVariables, remoteFingerprint: 'SHA256:single-node' },
      certificateMaterials: runtimeInput('single').certificateMaterials,
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
      userVariables: { ...runtimeInput('single').userVariables, remoteFingerprint: 'SHA256:single-node' },
      certificateMaterials: runtimeInput('single').certificateMaterials,
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
      userVariables: { ...runtimeInput('single').userVariables, remoteFingerprint: 'SHA256:single-node' },
      certificateMaterials: runtimeInput('single').certificateMaterials,
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
      userVariables: runtimeInput('single').userVariables,
      certificateMaterials: runtimeInput('single').certificateMaterials,
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
      userVariables: { ...runtimeInput('single').userVariables, remoteFingerprint: 'SHA256:single-node' },
      certificateMaterials: runtimeInput('single').certificateMaterials,
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
      userVariables: { ...runtimeInput('single').userVariables, remoteFingerprint: 'SHA256:single-node' },
      certificateMaterials: runtimeInput('single').certificateMaterials,
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
    content.variables.apiCredential = {
      type: 'credential',
      required: true,
      default: { id: 'sec_device_api', kind: 'curl_bearer', type: 'api_token' },
      sensitive: true,
    };
    content.steps = [
      {
        name: 'isLinux',
        type: 'condition',
        condition: { variable: 'deviceOs', equals: 'linux' },
        description: '只允许 Linux 目标继续',
      },
    ];
    content.variables = { deviceOs: { type: 'string', required: true } };
    content.rollback = undefined;

    const passed = await service.testStep({ content, stepName: 'isLinux', mode: 'mock', userVariables: { deviceOs: 'linux' } });
    assert.equal(passed.stepResult.status, 'success');
    assert.equal((passed.stepResult.plan as { executor: string }).executor, 'workflow.condition');

    const failed = await service.testStep({ content, stepName: 'isLinux', mode: 'mock', userVariables: { deviceOs: 'windows' } });
    assert.equal(failed.stepResult.status, 'failed');
  });

  it('按 stage 固定顺序执行，并在结果中保留阶段', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content = templateFixture();
    content.steps = [
      { name: 'verifyFirstInArray', type: 'manual', stage: 'verify', instruction: 'verify' },
      { name: 'prepareSecondInArray', type: 'http', stage: 'prepare', request: { method: 'GET', url: 'https://{{deviceHost}}/login' } },
      { name: 'refreshThirdInArray', type: 'ssh', stage: 'refresh', ssh: { mode: 'command', connection: { host: '{{deviceHost}}', username: 'admin', credential: '{{credential}}' }, commands: ['echo one', 'echo two'] } },
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
          connection: {
            host: '{{deviceHost}}',
            username: 'admin',
            credential: '{{credential}}',
            hostKeyPolicy: 'manual_approval_required',
          },
          remotePath: '/etc/gcac-test/certs/test.crt',
          contentRef: '{{cert.pem}}',
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
          connection: {
            host: '{{deviceHost}}',
            username: 'admin',
            credential: '{{credential}}',
            hostKeyPolicy: 'manual_approval_required',
          },
          remotePath: '/etc/gcac-test/certs/test.key',
          contentRef: '{{cert.privateKey}}',
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

  it('HTTP adapter 映射 DSL query/form/multipart/auth/tls/retry 到 CurlExecutor 请求', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content = templateFixture();
    content.variables.apiCredential = {
      type: 'credential',
      required: true,
      default: { id: 'sec_device_api', kind: 'curl_bearer', type: 'api_token' },
      sensitive: true,
    };
    content.steps = [
      {
        name: 'submit',
        type: 'http',
        retry: { count: 2, intervalSeconds: 1, retryOnStatus: [500, 503], retryOnNetworkError: true },
        request: {
          method: 'POST',
          url: 'https://{{deviceHost}}/api/submit',
          query: { dryRun: true },
          headers: { Accept: 'application/json' },
          headerRefs: { 'X-Trace-Secret': 'secret://trace/id' },
          bodyType: 'multipart',
          multipart: {
            cert: { value: '{{cert.pem}}', filename: 'cert.pem', contentType: 'application/x-pem-file' },
            key: { secretRef: 'secret://cert/key' },
          },
          auth: { type: 'bearer', credential: '{{apiCredential}}' },
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
    content.variables.apiCredential = {
      type: 'credential',
      required: true,
      default: { id: 'sec_device_login', kind: 'username_password', type: 'password', username: 'admin' },
      sensitive: true,
    };
    content.steps = [
      {
        name: 'login_form',
        type: 'http',
        stage: 'prepare',
        request: {
          method: 'POST',
          url: 'https://{{deviceHost}}/webapi/entry.cgi',
          bodyType: 'form',
          form: { account: '{{apiCredential.username}}', method: 'login' },
          formCredentialRefs: { passwd: '{{apiCredential}}' },
        },
        extract: [{ name: 'sid', type: 'jsonPath', path: '$.data.sid', sensitive: true }],
      },
    ];
    content.rollback = undefined;
    const { version } = await service.createTemplate({ content });
    const run = await service.testRun({
      ...runtimeInput(version.id),
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
    assert.deepEqual(plan.curlRequest.template.form, { account: '[REDACTED]', method: 'login' });
    assert.equal(plan.curlRequest.template.formSecretRefs, '[REDACTED]');
    assert.equal(run.stepResults[0]!.extracted.sid, '[REDACTED]');
    assert.doesNotMatch(visible, /sid-secret-value/);
    assert.doesNotMatch(visible, /sec_device_login/);
  });

  it('transform step 可以用 JSONata 生成上下文变量并供后续步骤引用', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content = templateFixture();
    content.variables.previousServices = { type: 'object', required: true };
    content.steps = [
      {
        name: 'build_bindings',
        type: 'transform',
        stage: 'refresh',
        transform: {
          engine: 'jsonata',
          input: {
            previousCertificateServices: '{{previousServices.services}}',
            previousCertificateId: 'old-cert',
            newCertificateId: 'new-cert',
          },
          outputs: {
            serviceBindingsJson: {
              expression: '[$map(previousCertificateServices, function($service){{"service":$service,"old_id":previousCertificateId,"id":newCertificateId}})]',
              format: 'jsonString',
            },
          },
          timeoutMs: 500,
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
          url: 'https://{{deviceHost}}/api/cert-service',
          bodyType: 'form',
          form: { settings: '{{serviceBindingsJson}}' },
        },
      },
    ];
    content.rollback = undefined;
    const { version } = await service.createTemplate({ content });
    const run = await service.testRun({
      ...runtimeInput(version.id),
      userVariables: {
        ...runtimeInput(version.id).userVariables,
        previousServices: { services: ['DSM', 'WebStation'] },
      },
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
    oversizedInput.variables.largeValue = { type: 'string', required: true };
    oversizedInput.steps = [{
      name: 'oversized_input',
      type: 'transform',
      transform: {
        engine: 'jsonata',
        input: { value: '{{largeValue}}' },
        outputs: { value: { expression: '$.value' } },
        maxInputBytes: 8,
      },
    }];
    oversizedInput.rollback = undefined;
    const oversizedInputTemplate = await service.createTemplate({ content: oversizedInput });
    await assert.rejects(() => service.testRun({
      ...runtimeInput(oversizedInputTemplate.version.id),
      userVariables: { ...runtimeInput('unused').userVariables, largeValue: '0123456789abcdef' },
    }), /transform input 超过大小限制/);

    const oversizedOutput = templateFixture();
    oversizedOutput.steps = [{
      name: 'oversized_output',
      type: 'transform',
      transform: {
        engine: 'jsonata',
        outputs: { value: { expression: '"0123456789abcdef"' } },
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
    assert.equal(content.variables.previousCertificateId?.required, false);
    assert.equal(content.variables.newCertificateId?.required, false);
    assert.equal(content.variables.serviceBindingsJson?.required, false);

    const service = new WorkflowTemplatesApplicationService();
    const { version } = await service.createTemplate({ content });
    const run = await service.testRun({
      templateVersionId: version.id,
      mode: 'mock',
      userVariables: {
        synologyCredential: { id: 'sec_synology_login', kind: 'username_password', type: 'password', username: 'admin' },
      },
      certificateMaterials: {
        serverCert: {
          outputs: {
            certFile: { content: '-----BEGIN CERTIFICATE-----mock-----END CERTIFICATE-----' },
            keyFile: { content: '-----BEGIN PRIVATE KEY-----mock-----END PRIVATE KEY-----' },
            chainFile: { content: '-----BEGIN CERTIFICATE-----chain-----END CERTIFICATE-----' },
          },
        },
      },
      mockResponses: {
        prepare_synology_login: { statusCode: 200, body: { success: true, data: { sid: 'sid-secret', synotoken: 'token-secret' } } },
        list_synology_certificates_before_import: {
          statusCode: 200,
          body: { success: true, data: { certificates: [{ id: 'old-cert', desc: 'old', is_default: true, services: ['DSM', 'WebStation'] }] } },
        },
        install_synology_certificate_as_new_default: { statusCode: 200, body: { success: true } },
        list_synology_certificates_after_import: {
          statusCode: 200,
          body: {
            success: true,
            data: {
              certificates: [
                { id: 'old-cert', desc: 'old', is_default: false, services: [] },
                { id: 'new-cert', desc: 'GCAC active certificate', is_default: true, services: ['DSM'] },
              ],
            },
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
      userVariables: { ...runtimeInput(version.id).userVariables, shouldUpload: false },
      mockResponses: { login: { statusCode: 200, body: { token: 'runtime-token-secret' } } },
    });
    assert.equal(skippedRun.stepResults[1]!.status, 'skipped');

    const realPlan = await service.testRun({ ...runtimeInput(version.id), mode: 'real_test' });
    assert.equal(realPlan.mode, 'real_test');
    assert.equal(realPlan.plannedOnly, false);
  });

  it('contains 断言会渲染变量并忽略大小写差异', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const { version } = await service.createTemplate({
      content: {
        apiVersion: 'gcac.workflow/v1',
        kind: 'CurlSshWorkflow',
        metadata: { name: 'contains-render' },
        variables: {
          expectedResponseContains: { type: 'string', required: true },
        },
        steps: [{
          name: 'verify_body',
          type: 'http',
          request: { method: 'GET', url: 'https://example.com/' },
          assert: [{ type: 'contains', value: '{{expectedResponseContains}}' }],
        }],
      },
    });

    const run = await service.testRun({
      templateVersionId: version.id,
      mode: 'mock',
      userVariables: { expectedResponseContains: 'apache test ok' },
      mockResponses: {
        verify_body: { statusCode: 200, body: 'Apache test ok' },
      },
    });

    assert.equal(run.status, 'success');
    assert.equal(run.stepResults[0]!.assertions[0]!.passed, true);
  });
});

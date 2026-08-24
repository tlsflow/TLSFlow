import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { App } from '../../common/http/app.js';
import { WorkflowTemplatesApplicationService } from './application/workflow-templates.application-service.js';
import { WorkflowTemplatesController } from './controller/workflow-templates.controller.js';
import type { WorkflowDslV1 } from './dto/workflow-templates.dto.js';
import { workflowTemplatesSchemaRegistry } from './schema/workflow-templates.schema.js';

function templateFixture(): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'edge-cert-update', category: 'load_balancer' },
    variables: {
      deviceHost: { type: 'string', required: true },
      cert: { type: 'certificate', required: true },
      credential: { type: 'secret', required: true },
      shouldUpload: { type: 'boolean', default: true },
    },
    steps: [
      {
        name: 'login',
        type: 'http',
        request: {
          method: 'POST',
          url: 'https://{{deviceHost}}/api/login',
          headers: { Authorization: 'Bearer {{credential.token}}' },
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
            credentialSecretRef: 'secret://ssh/device',
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
            credentialSecretRef: 'secret://ssh/device',
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
      credential: 'secret://device/login',
    },
    certificateMaterials: {
      cert: {
        pem: '-----BEGIN CERTIFICATE-----mock-----END CERTIFICATE-----',
        privateKey: 'super-private-key',
        fingerprintSha256: 'ff'.repeat(32),
      },
    },
    secretRefs: {
      'secret://device/login': { username: 'admin', token: 'token-secret-value' },
    },
    mockResponses: {
      login: { statusCode: 200, body: { token: 'runtime-token-secret' } },
      upload: { statusCode: 500, body: { success: false, fingerprint: '00'.repeat(32) } },
      reload: { exitCode: 0, stdout: 'ok' },
    },
  };
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
  });

  it('模板版本不可变：新内容生成新 version/hash，发布不会覆盖旧版本', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const created = await service.createTemplate({ content: templateFixture(), changeSummary: '初始版本' });
    const changed = templateFixture();
    changed.metadata.displayName = '第二版';

    const version2 = await service.createDraftVersion({ templateId: created.template.id, content: changed, changeSummary: '改展示名' });
    assert.notEqual(version2.id, created.version.id);
    assert.notEqual(version2.contentHash, created.version.contentHash);

    const published = await service.publishVersion(created.version.id);
    assert.equal(published.status, 'published');
    assert.equal((await service.getVersion(version2.id)).status, 'draft');
    await assert.rejects(() => service.createDraftVersion({ templateId: created.template.id, content: changed }), /duplicate workflow version content/);
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

    const versions = await app.inject({ method: 'GET', path: `/api/v1/workflow-template-versions?templateId=${createdBody.template.id}` });
    assert.equal(versions.statusCode, 200);
    assert.equal(Array.isArray((versions.body as { items: unknown }).items), true);
  });

  it('变量解析、SecretRef、证书材料占位和预览脱敏生效', async () => {
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

  it('支持单节点模拟运行，并返回脱敏后的执行计划和结果', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content = templateFixture();
    const run = await service.testStep({
      content,
      stepName: 'reload',
      mode: 'mock',
      userVariables: { ...runtimeInput('single').userVariables, remoteFingerprint: 'SHA256:single-node' },
      certificateMaterials: runtimeInput('single').certificateMaterials,
      secretRefs: runtimeInput('single').secretRefs,
      mockResponses: { reload: { exitCode: 0, stdout: 'single node ok' } },
    });

    assert.equal(run.stepResult.name, 'reload');
    assert.equal(run.stepResult.status, 'success');
    assert.equal((run.stepResult.plan as { executor: string }).executor, '015.SSH');
    assert.match(run.logs.join('\n'), /step:reload/);
  });

  it('condition 判断节点按变量结果决定成功或失败', async () => {
    const service = new WorkflowTemplatesApplicationService();
    const content = templateFixture();
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
      { name: 'refreshThirdInArray', type: 'ssh', stage: 'refresh', ssh: { mode: 'command', connection: { host: '{{deviceHost}}', username: 'admin', credentialSecretRef: 'secret://ssh/device' }, commands: ['echo one', 'echo two'] } },
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
          url: 'https://{{deviceHost}}/api/submit',
          query: { dryRun: true },
          headers: { Accept: 'application/json' },
          headerRefs: { 'X-Trace-Secret': 'secret://trace/id' },
          bodyType: 'multipart',
          multipart: {
            cert: { value: '{{cert.pem}}', filename: 'cert.pem', contentType: 'application/x-pem-file' },
            key: { secretRef: 'secret://cert/key' },
          },
          auth: { type: 'bearer', secretRef: 'secret://device/login' },
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
});

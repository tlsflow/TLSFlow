import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WorkflowTemplatesApplicationService } from './application/workflow-templates.application-service.js';
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

describe('spec025 CURL/SSH 模板工作流 DSL', () => {
  it('校验 DSL v1 schema，拒绝未知字段、缺失引用、类型错误、明文 Secret 和私钥', () => {
    workflowTemplatesSchemaRegistry.validate(templateFixture());
    assert.throws(() => workflowTemplatesSchemaRegistry.validate({ ...templateFixture(), extra: true }), /未知字段/);
    const missingReference = templateFixture();
    missingReference.steps[0] = {
      ...missingReference.steps[0]!,
      type: 'http',
      request: { method: 'GET', url: 'https://{{missingHost}}/api' },
    };
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(missingReference), /变量引用不存在/);
    const wrongType = templateFixture();
    wrongType.variables.deviceHost = { type: 'number', default: 'bad' };
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(wrongType), /必须是数字/);
    const plainSecret = templateFixture();
    plainSecret.steps[0] = {
      ...plainSecret.steps[0]!,
      type: 'http',
      request: { method: 'POST', url: 'https://edge/api', body: { password: 'password=clear-text' } },
    };
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(plainSecret), /明文 Secret/);
    const privateKey = templateFixture();
    privateKey.steps[1] = {
      ...privateKey.steps[1]!,
      type: 'http',
      request: { method: 'PUT', url: 'https://edge/api', body: '-----BEGIN PRIVATE KEY-----bad-----END PRIVATE KEY-----' },
    };
    assert.throws(() => workflowTemplatesSchemaRegistry.validate(privateKey), /私钥/);
  });

  it('模板版本不可变：新内容生成新 version/hash，发布不会覆盖旧版本', () => {
    const service = new WorkflowTemplatesApplicationService();
    const created = service.createTemplate({ content: templateFixture(), changeSummary: '初始版本' });
    const changed = templateFixture();
    changed.metadata.displayName = '第二版';
    const version2 = service.createDraftVersion({ templateId: created.template.id, content: changed, changeSummary: '改展示名' });
    assert.notEqual(version2.id, created.version.id);
    assert.notEqual(version2.contentHash, created.version.contentHash);
    const published = service.publishVersion(created.version.id);
    assert.equal(published.status, 'published');
    assert.equal(service.getVersion(version2.id).status, 'draft');
    assert.throws(() => service.createDraftVersion({ templateId: created.template.id, content: changed }), /重复版本|相同内容/);
  });

  it('变量解析、SecretRef、证书材料占位和预览脱敏生效', () => {
    const service = new WorkflowTemplatesApplicationService();
    const { version } = service.createTemplate({ content: templateFixture() });
    const run = service.preview(runtimeInput(version.id));
    const text = JSON.stringify(run);
    assert.equal(run.mode, 'render_only');
    assert.equal(run.plannedOnly, true);
    assert.match(text, /edge-01\.example\.com/);
    assert.doesNotMatch(text, /token-secret-value|super-private-key|runtime-token-secret/);
    assert.match(text, /\[REDACTED\]/);
  });

  it('HTTP 和 SSH step adapter 只生成 017/015 请求形状，不访问真实网络或 SSH', () => {
    const service = new WorkflowTemplatesApplicationService();
    const { version } = service.createTemplate({ content: templateFixture() });
    const run = service.testRun({
      ...runtimeInput(version.id),
      mockResponses: {
        login: { statusCode: 200, body: { token: 'runtime-token-secret' } },
        upload: { statusCode: 200, body: { success: true, fingerprint: 'ff'.repeat(32) } },
        reload: { exitCode: 0, stdout: 'mock ssh reload ok' },
      },
    });
    assert.equal(run.status, 'success');
    assert.equal(run.stepResults[0]!.plan && (run.stepResults[0]!.plan as { executor: string }).executor, '017.CURL_HTTP');
    assert.equal((run.stepResults[2]!.plan as { executor: string }).executor, '015.SSH');
    assert.equal((run.stepResults[2]!.plan as { realSsh: boolean }).realSsh, false);
    assert.equal((run.stepResults[0]!.plan as { realNetwork: boolean }).realNetwork, false);
  });

  it('提取器、断言、条件、retry、rollback 和 testRun 模式形成最小闭环', () => {
    const service = new WorkflowTemplatesApplicationService();
    const { version } = service.createTemplate({ content: templateFixture() });
    const rollbackRun = service.testRun(runtimeInput(version.id));
    assert.equal(rollbackRun.status, 'rolled_back');
    assert.equal(rollbackRun.stepResults[1]!.attempts, 2);
    assert.equal(rollbackRun.rollbackResults[0]!.name, 'restoreOldCert');
    assert.ok(rollbackRun.stepResults[1]!.assertions.some((item) => item.passed === false));

    const skippedRun = service.testRun({
      ...runtimeInput(version.id),
      userVariables: { ...runtimeInput(version.id).userVariables, shouldUpload: false },
      mockResponses: { login: { statusCode: 200, body: { token: 'runtime-token-secret' } } },
    });
    assert.equal(skippedRun.stepResults[1]!.status, 'skipped');

    const realPlan = service.testRun({ ...runtimeInput(version.id), mode: 'real_test' });
    assert.equal(realPlan.mode, 'real_test');
    assert.equal(realPlan.plannedOnly, true);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import jsonata from 'jsonata';

const packageRoot = new URL('./builtin-plugins/device-synology-dsm/', import.meta.url);
const sidExpression = '{{steps.authenticate.extracted.sid}}';

function readWorkflow(name: string): Record<string, any> {
  return JSON.parse(readFileSync(new URL(`workflows/${name}.json`, packageRoot), 'utf8')) as Record<string, any>;
}

test('Synology 证书部署和回滚工作流先登录 DSM 再调用证书 API', () => {
  const cases = [
    ['deploy', ['readCurrentCertificate', 'importCertificateWithChain', 'importCertificateWithoutChain', 'bindCertificateToServiceWithChain', 'bindCertificateToServiceWithoutChain']],
    ['rollback', ['readCurrentCertificate', 'restoreCertificate', 'verifyRollback']],
  ] as const;

  for (const [name, certificateSteps] of cases) {
    const workflow = readWorkflow(name);
    assert.equal(workflow.metadata?.version, '1.1.1');
    const steps = workflow.steps as Array<Record<string, any>>;
    assert.equal(steps[0]?.name, 'authenticate');
    assert.equal(steps[0]?.request?.form?.api, 'SYNO.API.Auth');
    assert.equal(steps[0]?.extract?.[0]?.path, '$.data.sid');
    assert.equal(steps[0]?.extract?.[1]?.path, '$.data.synotoken');

    for (const stepName of certificateSteps) {
      const step = steps.find((item) => item.name === stepName);
      assert.ok(step, `${name}.${stepName} 不存在`);
      if (step?.type !== 'http') continue;
      assert.equal(step.request.url.includes(`_sid=${sidExpression}`), true);
      assert.equal(step.request.tls?.sni, '{{connections.management.tls.serverName}}');
      if (stepName === 'readCurrentCertificate' || stepName === 'verifyRollback') {
        assert.equal(step.request.url.includes('api=SYNO.Core.Certificate.CRT'), true);
      }
    }
  }
});

test('Synology TLS 校验开关同时满足连接校验和宿主 TLS 例外授权声明', () => {
  for (const name of ['connection-test', 'discover', 'deploy', 'rollback']) {
    const workflow = readWorkflow(name);
    const allowInsecureTls = workflow.inputContract?.variables?.allowInsecureTls;
    assert.equal(allowInsecureTls?.type, 'boolean', `${name} 必须声明 allowInsecureTls 类型`);
    assert.equal(allowInsecureTls?.required, true, `${name} 必须要求 allowInsecureTls 绑定`);
    assert.deepEqual(allowInsecureTls?.source, { kind: 'binding' });
    assert.equal(allowInsecureTls?.bindingPolicy, 'required_binding');

    const requests: Array<Record<string, any>> = [];
    const visit = (steps: unknown): void => {
      if (!Array.isArray(steps)) return;
      for (const step of steps) {
        if (!step || typeof step !== 'object') continue;
        const item = step as Record<string, any>;
        if (item.request?.tls) requests.push(item.request);
        visit(item.foreach?.steps);
      }
    };
    visit(workflow.steps);
    assert.ok(requests.length > 0, `${name} 至少应包含一个 HTTP 请求`);
    for (const request of requests) {
      assert.equal(request.tls.verify, '{{connections.management.tls.verifyPeer}}');
      assert.equal(request.tls.allowInsecure, true, `${name}.${request.url ?? 'request'} 必须声明 TLS 例外意图`);
    }
  }
});

test('Synology 接入表单将 HTTPS 协议和证书错误例外拆成两个独立选项', () => {
  const form = JSON.parse(readFileSync(new URL('./builtin-plugins/device-synology-dsm/forms/device.json', import.meta.url), 'utf8')) as Record<string, any>;
  const fields = (form.sections as Array<Record<string, any>>).flatMap((section) => section.fields as Array<Record<string, any>>);
  const https = fields.find((field) => field.key === 'httpsEnabled');
  const ignore = fields.find((field) => field.key === 'ignoreCertificateErrors');
  assert.equal(https?.type, 'switch');
  assert.equal(https?.defaultValue, true);
  assert.equal(https?.standardField, 'tls.enabled');
  assert.equal(ignore?.type, 'switch');
  assert.equal(ignore?.defaultValue, false);
  assert.equal(ignore?.standardField, 'tls.ignoreCertificateErrors');
  assert.deepEqual(ignore?.enabledWhen, { field: 'httpsEnabled', operator: 'truthy' });
  assert.equal(fields.some((field) => field.key === 'tlsVerify'), false, '表单不应再用单一 tlsVerify 开关代替两个选项');

  for (const name of ['connection-test', 'discover', 'deploy', 'rollback']) {
    const workflow = readWorkflow(name);
    const connection = workflow.inputContract?.connections?.management;
    assert.deepEqual(connection?.allowedProtocols, ['http', 'https']);
    assert.equal(connection?.tls?.enabled?.type, 'boolean');
    const requests: Array<Record<string, any>> = [];
    const visit = (steps: unknown): void => {
      if (!Array.isArray(steps)) return;
      for (const step of steps) {
        if (!step || typeof step !== 'object') continue;
        const item = step as Record<string, any>;
        if (item.request?.connectionRef === 'management') requests.push(item.request);
        visit(item.foreach?.steps);
      }
    };
    visit(workflow.steps);
    assert.ok(requests.length > 0, `${name} 至少应包含一个管理 HTTP 请求`);
    assert.ok(requests.every((request) => String(request.url).startsWith('/')));
  }
});

test('Synology DSM 工作流优先使用 DSM 默认服务键，并保留目标展示名兼容回退', async () => {
  const deploy = readWorkflow('deploy');
  const deploySteps = deploy.steps as Array<Record<string, any>>;
  const select = deploySteps.find((item) => item.name === 'selectCurrentCertificate');
  assert.match(select?.transform?.outputs?.previousCertificateId?.expression ?? '', /service = 'default'/);
  assert.match(select?.transform?.outputs?.previousCertificateId?.expression ?? '', /display_name = \$target/);

  const certificates = {
    data: {
      certificates: [
        { id: 'old-unbound', services: [] },
        {
          id: 'dsm-default',
          services: [{ display_name: 'DSM Desktop Service', service: 'default', multiple_cert: true, user_setable: true }],
        },
      ],
    },
  };
  const transformInput = { target: 'Synology DSM', certificates };
  assert.equal(
    await jsonata(select?.transform?.outputs?.previousCertificateId?.expression).evaluate(transformInput),
    'dsm-default',
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(await jsonata(select?.transform?.outputs?.previousCertificateServices?.expression).evaluate(transformInput))),
    [{ display_name: 'DSM Desktop Service', service: 'default', multiple_cert: true, user_setable: true }],
  );

  const rollback = readWorkflow('rollback');
  const rollbackSteps = rollback.steps as Array<Record<string, any>>;
  const settings = rollbackSteps.find((item) => item.name === 'buildRollbackSettings');
  assert.match(settings?.transform?.outputs?.settings?.expression ?? '', /service = 'default'/);
  assert.match(settings?.transform?.outputs?.settings?.expression ?? '', /display_name = \$target/);
  const rollbackSettings = await jsonata(settings?.transform?.outputs?.settings?.expression).evaluate({
      target: 'Synology DSM',
      previous: { data: { certificates: [{ id: 'old', services: certificates.data.certificates[1].services }] } },
      current: { data: { certificates: [{ id: 'new', services: certificates.data.certificates[1].services }] } },
    });
  assert.deepEqual(
    JSON.parse(JSON.stringify(rollbackSettings)),
    [{
      service: { display_name: 'DSM Desktop Service', service: 'default', multiple_cert: true, user_setable: true },
      old_id: 'new',
      id: 'old',
    }],
  );
});

test('Synology DSM 部署创建 DSM 证书后只使用 DSM 返回的内部 ID 绑定服务', () => {
  const deploy = readWorkflow('deploy');
  const steps = deploy.steps as Array<Record<string, any>>;
  const withChain = steps.find((item) => item.name === 'importCertificateWithChain');
  const withoutChain = steps.find((item) => item.name === 'importCertificateWithoutChain');
  const withChainBinding = steps.find((item) => item.name === 'buildServiceSettingsWithChain');
  const withoutChainBinding = steps.find((item) => item.name === 'buildServiceSettingsWithoutChain');

  for (const importStep of [withChain, withoutChain]) {
    assert.equal(importStep?.request?.multipart?.id?.value, '');
    assert.deepEqual(importStep?.extract, [{ name: 'newCertificateId', type: 'jsonPath', path: '$.data.id' }]);
  }
  assert.equal(withChainBinding?.transform?.input?.newId, '{{steps.importCertificateWithChain.extracted.newCertificateId}}');
  assert.equal(withoutChainBinding?.transform?.input?.newId, '{{steps.importCertificateWithoutChain.extracted.newCertificateId}}');
});

test('Synology DSM 切换管理站点证书后重新登录，由宿主进行最终 TLS 核验', () => {
  const deploy = readWorkflow('deploy');
  const steps = deploy.steps as Array<Record<string, any>>;
  const verifyAuthentication = steps.find((item) => item.name === 'authenticateForVerification');

  assert.equal(verifyAuthentication?.request?.form?.session, 'GCAC-verify');
  assert.equal(verifyAuthentication?.stage, 'verify');
  assert.equal(steps.some((item) => item.name === 'verifyCertificate'), false);
});

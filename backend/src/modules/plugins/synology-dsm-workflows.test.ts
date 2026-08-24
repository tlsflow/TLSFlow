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
    assert.equal(workflow.metadata?.version, '1.0.18');
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
    await jsonata(select?.transform?.outputs?.previousCertificateService?.expression).evaluate(transformInput),
    { display_name: 'DSM Desktop Service', service: 'default', multiple_cert: true, user_setable: true },
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

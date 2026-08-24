import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProviderSdk } from '../application/provider-sdk.js';
import {
  CustomBindingAcceptanceService,
  CustomProvider,
  CustomProviderAdapter,
  CustomRiskAnalyzer,
  TemplateRenderService,
  type CustomProviderTemplate,
  type ManualBinding,
} from './custom.provider.js';

function templateFixture(): CustomProviderTemplate {
  return {
    id: 'tpl-java',
    name: '私有 Java 服务模板',
    version: '1.0.0',
    serviceType: 'custom-java',
    platforms: ['linux'],
    status: 'published',
    variables: [
      { name: 'domain', type: 'string', required: true, allowedPattern: '^[a-z0-9.-]+$', sensitive: false },
      { name: 'certPath', type: 'path', required: true, allowedPattern: '^/etc/private-app/[a-z0-9./_-]+$', sensitive: false },
      { name: 'keyPath', type: 'path', required: true, allowedPattern: '^/etc/private-app/[a-z0-9./_-]+$', sensitive: false },
      { name: 'backupDir', type: 'path', required: true, allowedPattern: '^/var/backups/[a-z0-9./_-]+$', sensitive: false },
      { name: 'keystorePasswordRef', type: 'secret', required: true, sensitive: true },
    ],
    paths: {
      certificatePath: '{{ certPath }}',
      privateKeyPath: '{{ keyPath }}',
      backupPath: '{{ backupDir }}/{{ domain }}',
    },
    files: [{
      name: 'tls-env',
      destinationPathTemplate: '/etc/private-app/tls.env',
      contentTemplate: 'TLS_CERT={{ certPath }}\nTLS_KEY={{ keyPath }}\nTLS_PASSWORD={{ keystorePasswordRef }}',
      requiredCapabilities: ['file.write'],
      riskLevel: 'high',
    }],
    commands: [
      {
        phase: 'install',
        name: 'reload-config',
        shell: 'bash',
        commandTemplate: 'appctl reload --cert {{ certPath }} --key {{ keyPath }} --domain {{ domain }}',
        timeoutSeconds: 30,
        expectedExitCodes: [0],
        requiredCapabilities: ['process.exec'],
        riskLevel: 'high',
      },
    ],
    httpPlans: [{
      name: 'notify',
      method: 'POST',
      urlTemplate: 'https://ops.example.test/hooks/{{ domain }}',
      headers: { Authorization: '{{ keystorePasswordRef }}' },
      bodyTemplate: '{"domain":"{{ domain }}"}',
      requiredCapabilities: ['http.request'],
      riskLevel: 'medium',
    }],
    verification: [{
      type: 'tls',
      target: { host: '{{ domain }}', port: 443 },
      assertions: [{ field: 'fingerprint', equals: 'certificate.current' }],
      timeoutSeconds: 10,
      requiredCapabilities: ['certificate.verify'],
    }],
    rollback: [{
      phase: 'rollback',
      name: 'restore',
      shell: 'bash',
      commandTemplate: 'appctl restore --from {{ backupDir }}/{{ domain }}',
      timeoutSeconds: 60,
      expectedExitCodes: [0],
      requiredCapabilities: ['process.exec', 'file.read'],
      riskLevel: 'high',
    }],
    riskPolicy: {
      allowAutoDeploy: true,
      deploymentMode: 'L4',
    },
  };
}

function bindingFixture(overrides: Partial<ManualBinding> = {}): ManualBinding {
  return {
    id: 'mb-001',
    hostId: 'host-001',
    hostname: 'legacy-host',
    serviceName: 'legacy-app',
    serviceType: 'custom-java',
    certificateFormat: 'pem',
    certificatePath: '/etc/private-app/certs/site.pem',
    privateKeyPath: '/etc/private-app/certs/site.key',
    listenHost: 'legacy.example.test',
    listenPort: 443,
    domains: ['Legacy.Example.Test'],
    deploymentPolicy: {
      mode: 'manual-only',
      allowAutoDeploy: false,
      requiresManualApproval: true,
    },
    verificationPolicy: [{
      type: 'manual',
      target: { evidence: 'operator-screen' },
      assertions: [{ field: 'fingerprint', exists: true }],
      timeoutSeconds: 0,
      requiredCapabilities: ['manual.check'],
      manual: true,
    }],
    riskLevel: 'high',
    status: 'pending_acceptance',
    createdBy: 'operator-a',
    updatedAt: '2026-06-08T00:00:00.000Z',
    renderedPlan: {
      commands: [],
      files: [],
      httpPlans: [],
      rollback: [],
    },
    ...overrides,
  };
}

describe('spec023 Custom Provider', () => {
  it('渲染模板并拒绝未声明变量，Secret 只保留 SecretRef', () => {
    const renderer = new TemplateRenderService();
    const rendered = renderer.render(templateFixture(), {
      domain: 'legacy.example.test',
      certPath: '/etc/private-app/certs/site.pem',
      keyPath: '/etc/private-app/certs/site.key',
      backupDir: '/var/backups/private-app',
      keystorePasswordRef: { secretRef: 'secret://tenant/custom/keystore#current' },
    }, bindingFixture({ id: 'mb-from-template' }));

    assert.equal(rendered.binding.certificatePath, '/etc/private-app/certs/site.pem');
    assert.equal(rendered.binding.renderedPlan?.files[0]?.content.includes('secret://tenant/custom/keystore#current'), true);
    assert.deepEqual(rendered.variableSnapshot.keystorePasswordRef, { secretRef: 'secret://tenant/custom/keystore#current' });

    assert.throws(() => renderer.render(templateFixture(), {
      domain: 'legacy.example.test',
      certPath: '/etc/private-app/certs/site.pem',
      keyPath: '/etc/private-app/certs/site.key',
      backupDir: '/var/backups/private-app',
      keystorePasswordRef: { secretRef: 'secret://tenant/custom/keystore#current' },
      extra: 'bad',
    }, bindingFixture()), /未声明/);

    assert.throws(() => renderer.render(templateFixture(), {
      domain: 'legacy.example.test',
      certPath: '/tmp/site.pem',
      keyPath: '/etc/private-app/certs/site.key',
      backupDir: '/var/backups/private-app',
      keystorePasswordRef: { secretRef: 'secret://tenant/custom/keystore#current' },
    }, bindingFixture()), /白名单/);

    assert.throws(() => renderer.render(templateFixture(), {
      domain: 'legacy.example.test',
      certPath: '/etc/private-app/certs/site.pem',
      keyPath: '/etc/private-app/certs/site.key',
      backupDir: '/var/backups/private-app',
      keystorePasswordRef: 'plain-password',
    }, bindingFixture()), /SecretRef/);
  });

  it('从手工绑定输出标准 DiscoveryResult，并生成 backup 到 verify 的 DAG', async () => {
    const provider = new CustomProviderAdapter();
    const result = await provider.discover({ tenantId: 'tenant-custom' }, {
      source: 'MANUAL',
      scope: { hostname: 'legacy-host' },
      payload: { binding: bindingFixture() },
    });

    assert.equal(result.providerId, 'custom-provider');
    assert.equal(result.providerType, 'CUSTOM');
    assert.equal(result.hosts.length, 1);
    assert.equal(result.services[0]?.providerType, 'CUSTOM');
    assert.equal(result.endpoints[0]?.hostName, 'legacy.example.test');
    assert.equal(result.serviceAssets?.length, 1);
    assert.equal(result.serviceAssets?.[0]?.address, 'legacy.example.test');
    assert.equal(result.bindings[0]?.domainName, 'legacy.example.test');

    const bundle = provider.toDeploymentDraft(result);
    assert.equal(bundle.steps[0]?.action, 'BACKUP');
    assert.equal(bundle.steps.some((step) => step.action === 'MANUAL_APPROVAL'), true);
    assert.equal(bundle.steps.some((step) => step.action === 'MANUAL_CHECK'), true);
    assert.equal(bundle.steps.every((step) => step.idempotencyKey), true);
    new ProviderSdk().assertDraftBundle(bundle);
  });

  it('从模板 payload 输出 DiscoveryResult，并规划 command/file/http/verify 草案', async () => {
    const provider = new CustomProvider();
    const result = await provider.discover({ tenantId: 'tenant-custom' }, {
      source: 'MANUAL',
      scope: { hostname: 'legacy-host' },
      payload: {
        template: templateFixture(),
        values: {
          domain: 'legacy.example.test',
          certPath: '/etc/private-app/certs/site.pem',
          keyPath: '/etc/private-app/certs/site.key',
          backupDir: '/var/backups/private-app',
          keystorePasswordRef: { secretRef: 'secret://tenant/custom/keystore#current' },
        },
        bindingSeed: bindingFixture({ id: 'mb-template', deploymentPolicy: undefined }),
      },
    });
    const bundle = provider.toDeploymentDraft(result);
    assert.equal(bundle.steps.some((step) => step.action === 'RENDER_FILE'), true);
    assert.equal(bundle.steps.some((step) => step.action === 'RENDER_COMMAND'), true);
    assert.equal(bundle.steps.some((step) => step.action === 'HTTP_REQUEST'), true);
    assert.equal(bundle.steps.some((step) => step.action === 'VERIFY_BINDING'), true);
    assert.equal(bundle.steps.some((step) => JSON.stringify(step.inputs).includes('secret://')), false);
    new ProviderSdk().assertDraftBundle(bundle);
  });

  it('风险分析覆盖缺验证、人工能力、明文风险、不可回滚和危险命令', () => {
    const notices = new CustomRiskAnalyzer().analyze(bindingFixture({
      verificationPolicy: [],
      renderedPlan: {
        commands: [{
          phase: 'install',
          name: 'bad',
          shell: 'bash',
          command: 'rm -rf /opt/app && echo password=123',
          timeoutSeconds: 10,
          expectedExitCodes: [0],
          requiredCapabilities: ['process.exec'],
          riskLevel: 'critical',
        }],
        files: [],
        httpPlans: [],
        rollback: [],
      },
    }));
    assert.equal(notices.some((notice) => notice.code === 'missing_verification'), true);
    assert.equal(notices.some((notice) => notice.code === 'manual_capability'), true);
    assert.equal(notices.some((notice) => notice.code === 'plaintext_secret'), true);
    assert.equal(notices.some((notice) => notice.code === 'no_rollback'), true);
    assert.equal(notices.some((notice) => notice.code === 'dangerous_command'), true);
  });

  it('人工绑定验收必须保留证据、操作人、审计引用和观测指纹', () => {
    const service = new CustomBindingAcceptanceService();
    const accepted = service.accept(bindingFixture(), {
      evidenceRef: 'evidence://manual/mb-001',
      operator: 'operator-a',
      auditRef: 'audit://custom/mb-001',
      observedFingerprint: 'SHA256:ABC',
      status: 'accepted',
    });
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.acceptance?.operator, 'operator-a');
    assert.equal(accepted.acceptance?.observedFingerprint, 'SHA256:ABC');

    assert.throws(() => service.accept(bindingFixture(), {
      evidenceRef: '',
      operator: 'operator-a',
      auditRef: 'audit://custom/mb-001',
      status: 'accepted',
    }), /evidenceRef/);
  });

  it('Provider SDK fixture 校验 Custom provider，并拒绝敏感字段草案', async () => {
    const provider = new CustomProvider();
    const sdk = new ProviderSdk();
    const report = await sdk.runFixture(provider, {
      name: 'custom-manual-binding',
      context: { tenantId: 'tenant-custom-fixture', requestId: 'req-custom' },
      input: {
        providerId: 'custom-provider',
        source: 'MANUAL',
        scope: { hostname: 'legacy-host' },
        payload: { binding: bindingFixture() },
      },
      expected: { hostCount: 1, serviceCount: 1, endpointCount: 1, bindingCount: 1, minStepCount: 3 },
    });
    assert.equal(report.passed, true);

    assert.throws(() => sdk.assertDraftBundle({
      steps: [{
        id: 'bad-custom',
        title: 'bad',
        action: 'RENDER_COMMAND',
        providerType: 'CUSTOM',
        target: {},
        inputs: { command: 'deploy --token=plain' },
        dependsOn: [],
        requiredCapabilities: ['process.exec'],
        idempotencyKey: 'bad-custom',
      }],
    }), /敏感/);
  });
});

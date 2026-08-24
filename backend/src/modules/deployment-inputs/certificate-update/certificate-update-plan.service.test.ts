import assert from 'node:assert/strict';
import test from 'node:test';
import { computeAgentPlanDigest, validateAgentPlan } from '../../agents/security/agent-security.contract.js';
import { compileCertificateUpdatePlanTemplate } from './certificate-update-plan.service.js';
import {
  certificateUpdatePluginIds,
  createResolvedCertificateUpdateInput,
  createCertificateUpdateSnapshot,
  loadCertificateUpdateResource,
} from './certificate-update.test-fixtures.js';

test('六个 Agent Plan 模板都能展开为绑定固定版本和资源摘要的计划', () => {
  for (const pluginId of certificateUpdatePluginIds) {
    const snapshot = createCertificateUpdateSnapshot(pluginId);
    const result = compileCertificateUpdatePlanTemplate({
      templateText: loadCertificateUpdateResource(pluginId, 'agent-plans/deploy.json'),
      snapshot,
      pluginVersionId: `${pluginId}-version-1`,
      agentId: 'agent-1',
      tenantId: 'tenant-1',
      workflowVersionId: 'workflow-version-1',
      resourceHash: snapshot.resourceHash,
    });

    assert.equal(result.plan.pluginId, pluginId);
    assert.equal(result.plan.pluginVersionId, `${pluginId}-version-1`);
    assert.equal(result.plan.capability, 'certificate.deploy');
    assert.equal(result.plan.writeEffect, true);
    assert.ok(result.plan.operations.length >= snapshot.paths.length);
    assert.ok(result.plan.operations
      .filter((operation) => operation.operationType !== 'command.execute_allowlisted')
      .every((operation) => operation.input.inputSnapshotSha256 === snapshot.resolvedInputSha256));
    assert.ok(result.plan.operations
      .filter((operation) => operation.operationType !== 'command.execute_allowlisted')
      .every((operation) => operation.input.configFingerprint === snapshot.configFingerprint));
    assert.ok(result.plan.operations
      .filter((operation) => operation.operationType !== 'command.execute_allowlisted')
      .every((operation) => operation.input.workflowVersionId === 'workflow-version-1'));
    for (let index = 1; index < result.plan.operations.length; index += 1) {
      assert.deepEqual(
        result.plan.operations[index]?.dependsOn,
        result.plan.operations.slice(0, index).map((operation) => operation.operationId),
        `${pluginId} 的证书操作必须按声明顺序串行执行`,
      );
    }
    const configCheck = result.plan.operations.find((operation) => operation.operationType === 'command.execute_allowlisted');
    assert.equal(configCheck?.input.executablePath, snapshot.programPath);
    assert.equal(configCheck?.input.executableSha256, snapshot.programSha256);
    assert.deepEqual(configCheck?.input.args, snapshot.configCheckArgs);
    assert.deepEqual(configCheck?.input.argumentTemplate, snapshot.configCheckArgsTemplate);
    assert.equal(configCheck?.input.workingDirectory, snapshot.workingDirectory);
    assert.deepEqual(Object.keys(configCheck?.input ?? {}).sort(), [
      'args',
      'argumentTemplate',
      'artifactDigest',
      'childProcessPolicy',
      'environmentAllowlist',
      'executablePath',
      'executableSha256',
      'networkScopes',
      'outputLimitBytes',
      'timeoutSeconds',
      'workingDirectory',
    ].sort());
    assert.deepEqual(result.authorization.allowedServices, [snapshot.serviceName]);
    assert.deepEqual(result.authorization.artifactDigests, [snapshot.artifactDigest, snapshot.programSha256]);
    assert.equal(result.authorization.lifetimeSeconds, 300);
  }
});

test('六个回滚计划先恢复同一次账本，再检查配置、刷新服务和验证状态', () => {
  for (const pluginId of certificateUpdatePluginIds) {
    const result = compileCertificateUpdatePlanTemplate({
      templateText: loadCertificateUpdateResource(pluginId, 'agent-plans/rollback.json'),
      snapshot: createCertificateUpdateSnapshot(pluginId),
      pluginVersionId: `${pluginId}-version-1`,
      agentId: 'agent-1',
      tenantId: 'tenant-1',
    });
    const restore = result.plan.operations[0];
    const next = result.plan.operations[1];
    assert.equal(restore?.operationType, 'filesystem.restore');
    assert.equal(restore?.stage, 'prepare');
    assert.equal(restore?.input.ledgerRef, 'execution-recovery-ledger');
    assert.deepEqual(next?.dependsOn, [restore?.operationId]);
    assert.equal(new Set(result.plan.operations.map((operation) => operation.idempotencyKey)).size, result.plan.operations.length);
  }
});

test('PEM 路径按文件集合展开，KeyStore 只展开一个整体路径', () => {
  const pem = compileCertificateUpdatePlanTemplate({
    templateText: loadCertificateUpdateResource('web.nginx.linux', 'agent-plans/deploy.json'),
    snapshot: createCertificateUpdateSnapshot('web.nginx.linux'),
    pluginVersionId: 'web-nginx-linux-version-1',
    agentId: 'agent-1',
    tenantId: 'tenant-1',
  });
  assert.equal(pem.plan.operations.filter((operation) => operation.operationId.startsWith('atomic-replace-')).length, 3);

  const keystore = compileCertificateUpdatePlanTemplate({
    templateText: loadCertificateUpdateResource('app.tomcat.linux', 'agent-plans/deploy.json'),
    snapshot: createCertificateUpdateSnapshot('app.tomcat.linux'),
    pluginVersionId: 'app-tomcat-linux-version-1',
    agentId: 'agent-1',
    tenantId: 'tenant-1',
  });
  assert.equal(keystore.plan.operations.filter((operation) => operation.operationId.startsWith('atomic-replace-')).length, 1);
  const materialValidation = keystore.plan.operations.find((operation) => operation.operationId === 'validate-material-1');
  assert.equal(materialValidation?.input.keystoreType, 'PKCS12');
  assert.equal(materialValidation?.input.keyAlias, 'server');
  assert.equal(materialValidation?.input.secretRef, 'secret://certificate/tomcat-password');
});

test('证书 Artifact 内容按固定路径槽位进入校验和原子替换操作', () => {
  for (const pluginId of certificateUpdatePluginIds) {
    const resolvedInput = createResolvedCertificateUpdateInput(pluginId);
    const result = compileCertificateUpdatePlanTemplate({
      templateText: loadCertificateUpdateResource(pluginId, 'agent-plans/deploy.json'),
      snapshot: createCertificateUpdateSnapshot(pluginId),
      resolvedInput,
      pluginVersionId: `${pluginId}-version-1`,
      agentId: 'agent-1',
      tenantId: 'tenant-1',
    });
    const material = result.plan.operations.filter((operation) => operation.operationType === 'certificate.material.validate');
    const replacements = result.plan.operations.filter((operation) => operation.operationType === 'filesystem.atomic_replace');
    // 部署计划会在 prepare 和 verify 各校验一次同一槽位，真正写入只发生一次。
    assert.equal(material.length, replacements.length * 2);
    assert.ok(material.every((operation) => typeof operation.input.contentBase64 === 'string'));
    assert.ok(replacements.every((operation) => typeof operation.input.contentBase64 === 'string'));
  }
});

test('错误模板和越权引用失败关闭且不产生计划', () => {
  const snapshot = createCertificateUpdateSnapshot('web.apache.linux');
  assert.throws(
    () => compileCertificateUpdatePlanTemplate({
      templateText: loadCertificateUpdateResource('web.apache.linux', 'agent-plans/deploy.json').replace('"pluginId": "web.apache.linux"', '"pluginId": "web.nginx.linux"'),
      snapshot,
      pluginVersionId: 'web-apache-linux-version-1',
      agentId: 'agent-1',
      tenantId: 'tenant-1',
    }),
    /模板与输入快照插件不一致/,
  );

  assert.throws(
    () => compileCertificateUpdatePlanTemplate({
      templateText: JSON.stringify({
        apiVersion: 'gcac.certificate-update-plan/v1',
        pluginId: snapshot.pluginId,
        capability: 'certificate.deploy',
        planId: 'bad-plan',
        writeEffect: true,
        operations: [{ operationId: 'bad', operationType: 'filesystem.atomic_replace', stage: 'execute', input: { $ref: 'paths.missing' } }],
      }),
      snapshot,
      pluginVersionId: 'web-apache-linux-version-1',
      agentId: 'agent-1',
      tenantId: 'tenant-1',
    }),
    /模板引用不存在/,
  );
});

test('生成的证书 Agent Plan 满足现有 Agent v2 输入白名单', () => {
  const snapshot = createCertificateUpdateSnapshot('web.nginx.linux');
  const result = compileCertificateUpdatePlanTemplate({
    templateText: loadCertificateUpdateResource('web.nginx.linux', 'agent-plans/deploy.json'),
    snapshot,
    pluginVersionId: 'web-nginx-linux-version-1',
    agentId: 'agent-1',
    tenantId: 'tenant-1',
    workflowVersionId: 'workflow-version-1',
    resourceHash: snapshot.resourceHash,
  });

  assert.doesNotThrow(() => validateAgentPlan(result.plan));
});

test('dry-run 计划可以切换为 validate 且不保留写入标志', () => {
  const snapshot = createCertificateUpdateSnapshot('web.apache.windows');
  const result = compileCertificateUpdatePlanTemplate({
    templateText: loadCertificateUpdateResource('web.apache.windows', 'agent-plans/deploy.json'),
    snapshot,
    pluginVersionId: 'web-apache-windows-version-1',
    agentId: 'agent-1',
    tenantId: 'tenant-1',
  });
  const dryRunPlan = { ...result.plan, writeEffect: false, planDigest: '' };
  dryRunPlan.planDigest = computeAgentPlanDigest(dryRunPlan);
  assert.equal(dryRunPlan.writeEffect, false);
  assert.doesNotThrow(() => validateAgentPlan(dryRunPlan));
});

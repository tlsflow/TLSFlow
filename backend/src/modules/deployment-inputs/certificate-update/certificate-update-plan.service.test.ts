import assert from 'node:assert/strict';
import test from 'node:test';
import { computeAgentPlanDigest, validateAgentPlan } from '../../agents/security/agent-security.contract.js';
import { bindCertificateUpdatePlanEphemeralSecrets, compileCertificateUpdatePlanTemplate } from './certificate-update-plan.service.js';
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
    if (pluginId !== 'web.iis') {
      assert.ok(result.plan.operations
        .filter((operation) => operation.operationType !== 'command.execute_allowlisted')
        .every((operation) => operation.input.inputSnapshotSha256 === snapshot.resolvedInputSha256));
      assert.ok(result.plan.operations
        .filter((operation) => operation.operationType !== 'command.execute_allowlisted')
        .every((operation) => operation.input.configFingerprint === snapshot.configFingerprint));
      assert.ok(result.plan.operations
        .filter((operation) => operation.operationType !== 'command.execute_allowlisted')
        .every((operation) => operation.input.workflowVersionId === 'workflow-version-1'));
    }
    for (let index = 1; index < result.plan.operations.length; index += 1) {
      assert.deepEqual(
        result.plan.operations[index]?.dependsOn,
        result.plan.operations.slice(0, index).map((operation) => operation.operationId),
        `${pluginId} 的证书操作必须按声明顺序串行执行`,
      );
    }
    const configCheck = result.plan.operations.find((operation) => operation.operationType === 'command.execute_allowlisted');
    if (pluginId === 'web.iis') {
      assert.deepEqual(result.authorization.allowedPaths, []);
      continue;
    }
    if (pluginId === 'app.tomcat.windows' || pluginId === 'app.tomcat.linux') {
      assert.equal(configCheck, undefined);
      assert.deepEqual(result.authorization.commandRules, []);
      assert.deepEqual(result.authorization.allowedServices, [snapshot.serviceName]);
      continue;
    }
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
    assert.deepEqual(result.authorization.allowedServices, snapshot.serviceName ? [snapshot.serviceName] : []);
  assert.deepEqual(result.authorization.artifactDigests, [snapshot.artifactDigest, snapshot.programSha256]);
  const commandRules = result.authorization.commandRules as Array<Record<string, unknown>>;
  assert.equal(commandRules.length, result.plan.operations.filter((operation) => operation.operationType === 'command.execute_allowlisted').length);
  assert.deepEqual(commandRules[0], {
    executablePath: snapshot.programPath,
    executableSha256: snapshot.programSha256,
    argumentTemplate: snapshot.configCheckArgsTemplate,
    environmentAllowlist: [],
    workingDirectory: snapshot.workingDirectory,
    networkScopes: [],
    childProcessPolicy: 'deny',
    timeoutSeconds: 60,
    outputLimitBytes: 65536,
  });
    assert.equal(result.authorization.lifetimeSeconds, 300);
  }
});

test('Windows Nginx 非 SCM 计划不生成服务授权或 service.status 操作', () => {
  const pluginId = 'web.nginx.windows';
  const snapshot = createCertificateUpdateSnapshot(pluginId, { location: { serviceName: undefined } });
  const result = compileCertificateUpdatePlanTemplate({
    templateText: loadCertificateUpdateResource(pluginId, 'agent-plans/deploy.json'),
    snapshot,
    pluginVersionId: `${pluginId}-version-1`,
    agentId: 'agent-1',
    tenantId: 'tenant-1',
  });

  assert.deepEqual(result.authorization.allowedServices, []);
  assert.equal(result.plan.operations.some((operation) => operation.operationType === 'service.status'), false);
});

test('证书目标内容会同时绑定到备份和替换操作，供 Agent 判断幂等 no-op', () => {
  const pluginId = 'web.apache.linux';
  const resolvedInput = createResolvedCertificateUpdateInput(pluginId);
  const snapshot = createCertificateUpdateSnapshot(pluginId);
  const result = compileCertificateUpdatePlanTemplate({
    templateText: loadCertificateUpdateResource(pluginId, 'agent-plans/deploy.json'),
    snapshot,
    resolvedInput,
    pluginVersionId: `${pluginId}-version-1`,
    agentId: 'agent-1',
    tenantId: 'tenant-1',
  });
  const backups = result.plan.operations.filter((operation) => operation.operationType === 'filesystem.backup');
  const replacements = result.plan.operations.filter((operation) => operation.operationType === 'filesystem.atomic_replace');
  assert.equal(backups.length, replacements.length);
  assert.ok(backups.every((operation) => typeof operation.input.contentBase64 === 'string' && operation.input.contentBase64.length > 0));
  assert.ok(replacements.every((operation) => typeof operation.input.contentBase64 === 'string' && operation.input.contentBase64.length > 0));
});

test('六个回滚计划先恢复同一次账本，再按平台刷新服务和验证状态', () => {
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
    if (pluginId === 'web.iis') {
      assert.equal(restore?.operationType, 'certificate.iis.binding.rollback');
      assert.equal(next?.operationType, 'certificate.iis.binding.verify');
      continue;
    }
    assert.equal(restore?.operationType, 'filesystem.restore');
    assert.equal(restore?.stage, 'prepare');
    assert.equal(restore?.input.ledgerRef, 'execution-recovery-ledger');
    assert.deepEqual(next?.dependsOn, [restore?.operationId]);
    assert.equal(new Set(result.plan.operations.map((operation) => operation.idempotencyKey)).size, result.plan.operations.length);
    if (pluginId === 'app.tomcat.windows') {
      assert.equal(result.plan.operations.some((operation) => operation.operationType === 'command.execute_allowlisted'), false);
      assert.equal(next?.operationType, 'service.restart');
    }
    if (pluginId === 'app.tomcat.linux') {
      assert.equal(result.plan.operations.some((operation) => operation.operationType === 'command.execute_allowlisted'), false);
      assert.equal(next?.operationType, 'service.stop');
    }
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

test('Windows/Linux Tomcat 原子替换操作绑定目标 KeyStore 上下文', () => {
  for (const pluginId of ['app.tomcat.windows', 'app.tomcat.linux'] as const) {
    const snapshot = createCertificateUpdateSnapshot(pluginId);
    const result = compileCertificateUpdatePlanTemplate({
      templateText: loadCertificateUpdateResource(pluginId, 'agent-plans/deploy.json'),
      snapshot,
      resolvedInput: createResolvedCertificateUpdateInput(pluginId),
      pluginVersionId: `${pluginId}-version-1`,
      agentId: 'agent-1',
      tenantId: 'tenant-1',
    });
    const replacement = result.plan.operations.find((operation) => operation.operationType === 'filesystem.atomic_replace');
    assert.ok(replacement, `${pluginId} 缺少原子替换操作`);
    assert.equal(replacement.input.keystoreType, snapshot.keystoreType);
    assert.equal(replacement.input.configPath, snapshot.sourceConfigPath);
    assert.equal(replacement.input.keyAlias, snapshot.keyAlias);
    assert.equal(replacement.input.storageKind, 'KEYSTORE');
  }
});

test('显式 keystorePassword 只在执行期注入并覆盖 SecretRef', () => {
  const pluginId = 'app.tomcat.linux';
  const snapshot = createCertificateUpdateSnapshot(pluginId);
  const result = compileCertificateUpdatePlanTemplate({
    templateText: loadCertificateUpdateResource(pluginId, 'agent-plans/deploy.json'),
    snapshot,
    resolvedInput: createResolvedCertificateUpdateInput(pluginId),
    pluginVersionId: `${pluginId}-version-1`,
    agentId: 'agent-1',
    tenantId: 'tenant-1',
  });
  const withPassword = result.plan;
  const injected = withPassword.operations.filter((operation) => operation.operationType === 'certificate.material.validate');
  assert.ok(injected.every((operation) => operation.input.keystorePassword === undefined));

  const explicit = compileCertificateUpdatePlanTemplate({
    templateText: loadCertificateUpdateResource(pluginId, 'agent-plans/deploy.json'),
    snapshot,
    resolvedInput: createResolvedCertificateUpdateInput(pluginId),
    pluginVersionId: `${pluginId}-version-1`,
    agentId: 'agent-1',
    tenantId: 'tenant-1',
  });
  // 通过公开绑定函数模拟执行期编译；普通 resolvedInput 仍只包含 SecretRef。
  const bound = bindCertificateUpdatePlanEphemeralSecrets(explicit.plan, snapshot, {
    keystorePassword: 'tomcat-current-password',
    sourceKeyStorePassword: 'artifact-default-password',
  });
  const material = bound.operations.filter((operation) => operation.operationType === 'certificate.material.validate');
  const replacement = bound.operations.filter((operation) => operation.operationType === 'filesystem.atomic_replace');
  assert.ok(material.length > 0);
  assert.ok(material.every((operation) => operation.input.keystorePassword === 'tomcat-current-password'));
  assert.ok(material.every((operation) => operation.input.sourceKeyStorePassword === 'artifact-default-password'));
  assert.ok(replacement.length > 0);
  assert.ok(replacement.every((operation) => operation.input.keystorePassword === 'tomcat-current-password'));
  assert.ok(replacement.every((operation) => operation.input.sourceKeyStorePassword === 'artifact-default-password'));
  assert.ok(material.every((operation) => !('secretRef' in operation.input)));
  assert.ok(bound.planDigest.length > 0);
  assert.doesNotThrow(() => validateAgentPlan(bound));
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

test('IIS 原生绑定格式和带空格站点名不会污染 Agent bindingKey 合同', () => {
  const snapshot = createCertificateUpdateSnapshot('web.iis');
  snapshot.targetId = '*:443:iis.example.test';
  snapshot.bindingKey = '*:443:iis.example.test';
  snapshot.siteName = 'Default Web Site';
  const result = compileCertificateUpdatePlanTemplate({
    templateText: loadCertificateUpdateResource('web.iis', 'agent-plans/deploy.json'),
    snapshot,
    pluginVersionId: 'web-iis-version-1',
    agentId: 'agent-1',
    tenantId: 'tenant-1',
  });
  const iisOperations = result.plan.operations.filter((operation) => operation.operationType.startsWith('certificate.iis.binding.'));
  assert.ok(iisOperations.length > 0);
  assert.ok(iisOperations.every((operation) => String(operation.input.bindingKey).startsWith('iis-binding-')));
  assert.ok(iisOperations.every((operation) => /^[A-Za-z0-9._:-]{1,256}$/.test(String(operation.input.bindingKey))));
  assert.ok(iisOperations.every((operation) => operation.input.siteName === 'Default Web Site'));
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

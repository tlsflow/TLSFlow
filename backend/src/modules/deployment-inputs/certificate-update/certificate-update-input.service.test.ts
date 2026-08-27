import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCertificateUpdatePlanBinding,
  resolveCertificateUpdateSnapshot,
} from './certificate-update-input.service.js';
import { validateCertificateUpdateInputContract } from './certificate-update.contract.js';
import {
  certificateUpdatePluginIds,
  createResolvedCertificateUpdateInput,
  loadCertificateUpdateContract,
} from './certificate-update.test-fixtures.js';

test('六个插件都能从同一类 Agent 事实生成不可变快照', () => {
  for (const pluginId of certificateUpdatePluginIds) {
    const contract = loadCertificateUpdateContract(pluginId);
    const resolved = createResolvedCertificateUpdateInput(pluginId);
    const snapshot = resolveCertificateUpdateSnapshot(resolved, contract, {
      pluginVersionId: `${pluginId}-version-1`,
      resourceHash: `sha256:${'e'.repeat(64)}`,
    });

    assert.equal(snapshot.pluginId, pluginId);
    assert.equal(snapshot.frameworkType, contract.frameworkType);
    assert.equal(snapshot.platform, contract.platform);
    assert.equal(snapshot.artifactKind, contract.artifactKind);
    assert.equal(snapshot.configFingerprint, 'a'.repeat(64));
    assert.equal(snapshot.pluginVersionId, `${pluginId}-version-1`);
    assert.equal(snapshot.resourceHash, `sha256:${'e'.repeat(64)}`);
    assert.equal(snapshot.provenance['variables.configPath']?.source, 'asset');
    if (pluginId !== 'web.iis') assert.ok(snapshot.paths.length >= 1);
  }
});

test('Windows Nginx 非 SCM 进程没有 serviceName 仍可生成快照', () => {
  const pluginId = 'web.nginx.windows';
  const resolved = createResolvedCertificateUpdateInput(pluginId, { location: { serviceName: undefined } });
  const snapshot = resolveCertificateUpdateSnapshot(resolved, loadCertificateUpdateContract(pluginId));

  assert.equal(snapshot.serviceName, undefined);
  assert.doesNotThrow(() => assertCertificateUpdatePlanBinding({
    pluginId,
    capability: 'certificate.verify',
    operations: [{
      operationType: 'certificate.material.validate',
      input: {
        path: snapshot.paths[0],
        configFingerprint: snapshot.configFingerprint,
        artifactDigest: snapshot.artifactDigest,
      },
    }],
  }, snapshot));
  assert.throws(() => assertCertificateUpdatePlanBinding({
    pluginId,
    capability: 'certificate.verify',
    operations: [{
      operationType: 'service.status',
      input: { serviceName: 'nginx' },
    }],
  }, snapshot), /无服务事实的计划不得包含 service 操作/);
});

test('六个平台合同优先读取固定 certificateArtifact 槽位，不受通用资源名影响', () => {
  for (const pluginId of certificateUpdatePluginIds) {
    const resolved = createResolvedCertificateUpdateInput(pluginId);
    resolved.assetContext.deployment.certificateResourceName = `certificate-${pluginId}`;

    const snapshot = resolveCertificateUpdateSnapshot(
      resolved,
      loadCertificateUpdateContract(pluginId),
    );

    assert.equal(snapshot.artifactDigest, 'c'.repeat(64));
  }
});

test('PEM 文件集合和 Tomcat KeyStore 的路径边界不同且不丢失', () => {
  const pem = resolveCertificateUpdateSnapshot(
    createResolvedCertificateUpdateInput('web.nginx.linux'),
    loadCertificateUpdateContract('web.nginx.linux'),
  );
  assert.equal(pem.paths.length, 3);
  assert.ok(pem.paths.every((path) => path.startsWith('/opt/gcac/')));

  const keystore = resolveCertificateUpdateSnapshot(
    createResolvedCertificateUpdateInput('app.tomcat.windows'),
    loadCertificateUpdateContract('app.tomcat.windows'),
  );
  assert.deepEqual(keystore.paths.length, 1);
  assert.equal(keystore.keystoreType, 'PKCS12');
  assert.equal(keystore.keyAlias, 'server');
  assert.deepEqual(keystore.secretRefs, ['secret://certificate/tomcat-password']);
});

test('Target 缺少 bindingKey 时使用 SiteAsset.bindingInformation 作为 tls.binding 事实', () => {
  const resolved = createResolvedCertificateUpdateInput('web.apache.windows');
  const target = resolved.assetContext.target!;
  delete target.bindingKey;
  delete target.metadata.bindingKey;
  delete target.metadata['tls.binding'];
  resolved.assetContext.site = {
    ...(resolved.assetContext.site ?? { id: 'site-1', metadata: {} }),
    bindingInformation: '*:8444:apache.test.local',
  };

  const snapshot = resolveCertificateUpdateSnapshot(
    resolved,
    loadCertificateUpdateContract('web.apache.windows'),
  );

  assert.equal(snapshot.bindingKey, '*:8444:apache.test.local');
});

test('Target.bindingKey 作为规范稳定标识时忽略历史 metadata 的异义 bindingKey', () => {
  const resolved = createResolvedCertificateUpdateInput('web.apache.windows');
  resolved.assetContext.target!.bindingKey = 'target-binding';
  resolved.assetContext.target!.metadata.bindingKey = 'metadata-binding';

  const snapshot = resolveCertificateUpdateSnapshot(
    resolved,
    loadCertificateUpdateContract('web.apache.windows'),
  );
  assert.equal(snapshot.bindingKey, 'target-binding');
});

test('Target 缺少规范 bindingKey 时 metadata 内部来源冲突仍失败关闭', () => {
  const resolved = createResolvedCertificateUpdateInput('web.apache.windows');
  delete resolved.assetContext.target!.bindingKey;
  resolved.assetContext.target!.metadata.bindingKey = 'metadata-binding';
  resolved.assetContext.target!.metadata['tls.binding'] = 'legacy-binding';

  assert.throws(
    () => resolveCertificateUpdateSnapshot(
      resolved,
      loadCertificateUpdateContract('web.apache.windows'),
    ),
    /tls\.binding 的快照来源不一致/,
  );
});

test('Target 证书位置缺少程序摘要时可读取同一 Framework rawFacts 补齐的 programSha256', () => {
  const resolved = createResolvedCertificateUpdateInput('web.apache.windows');
  delete resolved.assetContext.target!.metadata.programSha256;
  resolved.assetContext.target!.certificateLocation!.programSha256 = 'd'.repeat(64);

  const snapshot = resolveCertificateUpdateSnapshot(
    resolved,
    loadCertificateUpdateContract('web.apache.windows'),
  );

  assert.equal(snapshot.programSha256, 'd'.repeat(64));
});

test('programSha256 不是 64 位十六进制摘要时拒绝输入', () => {
  const resolved = createResolvedCertificateUpdateInput('web.apache.windows', {
    targetMetadata: { programSha256: 'C:/GCAC-Lab/Apache24/bin/httpd.exe' },
  });

  assert.throws(
    () => resolveCertificateUpdateSnapshot(resolved, loadCertificateUpdateContract('web.apache.windows')),
    /programSha256 必须是 SHA-256 摘要/,
  );
});

test('workingDirectory 可从证书位置事实读取并必须保持绝对路径', () => {
  const resolved = createResolvedCertificateUpdateInput('web.apache.windows');
  delete resolved.assetContext.target!.metadata.workingDirectory;
  resolved.assetContext.target!.certificateLocation!.workingDirectory = 'C:/GCAC-Lab/Apache24';

  const snapshot = resolveCertificateUpdateSnapshot(
    resolved,
    loadCertificateUpdateContract('web.apache.windows'),
  );

  assert.equal(snapshot.workingDirectory, 'C:/GCAC-Lab/Apache24');

  resolved.assetContext.target!.certificateLocation!.workingDirectory = 'Apache24';
  assert.throws(
    () => resolveCertificateUpdateSnapshot(resolved, loadCertificateUpdateContract('web.apache.windows')),
    /workingDirectory 必须是绝对路径/,
  );
});

test('Apache、Nginx 和 Tomcat 的 Linux/Windows 合同统一读取证书位置工作目录', () => {
  for (const pluginId of certificateUpdatePluginIds) {
    const resolved = createResolvedCertificateUpdateInput(pluginId);
    delete resolved.assetContext.target!.metadata.workingDirectory;

    const snapshot = resolveCertificateUpdateSnapshot(
      resolved,
      loadCertificateUpdateContract(pluginId),
    );

    assert.equal(snapshot.workingDirectory, resolved.assetContext.target!.certificateLocation!.workingDirectory);
  }
});

test('Tomcat JKS 只接受 JKS 整体 Artifact，并固定 password SecretRef', () => {
  const resolved = createResolvedCertificateUpdateInput('app.tomcat.linux', {
    location: { keystoreType: 'JKS' },
  });
  delete resolved.artifacts.certificateArtifact.outputs.pfxBase64;
  const snapshot = resolveCertificateUpdateSnapshot(
    resolved,
    loadCertificateUpdateContract('app.tomcat.linux'),
  );

  assert.equal(snapshot.keystoreType, 'JKS');
  assert.deepEqual(snapshot.secretRefs, ['secret://certificate/tomcat-password']);
});

test('Tomcat 未绑定显式密码 Credential 时保留空 SecretRef，交由 Agent 按 configPath 自动读取', () => {
  const resolved = createResolvedCertificateUpdateInput('app.tomcat.linux', { secretRefs: {} });
  delete resolved.credentials.keystorePassword;
  resolved.sensitivePaths = [];

  const snapshot = resolveCertificateUpdateSnapshot(
    resolved,
    loadCertificateUpdateContract('app.tomcat.linux'),
  );

  assert.deepEqual(snapshot.secretRefs, []);
  assert.equal(snapshot.keyAlias, 'server');
  assert.equal(JSON.stringify(snapshot).includes('tomcat-password'), false);
});

test('Tomcat 输入合同拒绝把密码放进 Artifact 输出', () => {
  const contract = loadCertificateUpdateContract('app.tomcat.linux');
  const outputs = contract.deploymentInputContract.artifacts.certificateArtifact!.artifactContract!.outputs;
  const invalid = structuredClone(contract) as typeof contract;
  invalid.deploymentInputContract.artifacts.certificateArtifact!.artifactContract!.outputs = {
    ...outputs,
    pfxPassword: {
      role: 'keystore_password',
      required: false,
      format: 'text',
      sensitive: true,
    },
  };
  assert.throws(
    () => validateCertificateUpdateInputContract(invalid),
    /Artifact 不得输出密码/,
  );
});

test('平台、框架、指纹和 confidence=UNKNOWN 在副作用前失败关闭', () => {
  const contract = loadCertificateUpdateContract('web.nginx.linux');
  const cases = [
    createResolvedCertificateUpdateInput('web.nginx.linux', { platform: 'windows' }),
    createResolvedCertificateUpdateInput('web.nginx.linux', { frameworkType: 'web.apache' }),
    createResolvedCertificateUpdateInput('web.nginx.linux', { confidence: 'UNKNOWN' }),
    createResolvedCertificateUpdateInput('web.nginx.linux', { configFingerprint: 'f'.repeat(64), targetMetadata: { configFingerprint: 'a'.repeat(64) } }),
  ];
  for (const resolved of cases) {
    assert.throws(
      () => resolveCertificateUpdateSnapshot(resolved, contract),
      /证书更新输入门禁失败/,
    );
  }
});

test('路径越权、脚本程序、Shell 参数和 KeyStore SecretRef 缺失均拒绝', () => {
  const pathTraversal = createResolvedCertificateUpdateInput('web.nginx.linux', {
    location: { certificatePath: '/opt/gcac/../etc/nginx/server.crt' },
  });
  assert.throws(
    () => resolveCertificateUpdateSnapshot(pathTraversal, loadCertificateUpdateContract('web.nginx.linux')),
    /证书更新输入门禁失败/,
  );

  const scriptProgram = createResolvedCertificateUpdateInput('web.nginx.linux', {
    location: { programPath: '/bin/sh' },
  });
  assert.throws(
    () => resolveCertificateUpdateSnapshot(scriptProgram, loadCertificateUpdateContract('web.nginx.linux')),
    /Shell、脚本或通用解释器/,
  );

  const shellArgument = createResolvedCertificateUpdateInput('web.nginx.linux', {
    targetMetadata: { configCheckArgs: ['-t;id'], configCheckArgsTemplate: ['-t;id'] },
  });
  assert.throws(
    () => resolveCertificateUpdateSnapshot(shellArgument, loadCertificateUpdateContract('web.nginx.linux')),
    /Shell 控制字符/,
  );

  const missingSecret = createResolvedCertificateUpdateInput('app.tomcat.linux', { secretRefs: {} });
  delete (missingSecret.credentials.keystorePassword as { secretRefs?: Record<string, string> }).secretRefs;
  assert.throws(
    () => resolveCertificateUpdateSnapshot(missingSecret, loadCertificateUpdateContract('app.tomcat.linux')),
    /KeyStore 类型、Alias 或 SecretRef 缺失|KeyStore 凭据缺少 SecretRef 映射/,
  );

  const malformedArtifact = createResolvedCertificateUpdateInput('web.nginx.linux');
  malformedArtifact.artifacts.certificateArtifact.outputs.leafPem = 'CERTIFICATE_PEM';
  assert.throws(
    () => resolveCertificateUpdateSnapshot(malformedArtifact, loadCertificateUpdateContract('web.nginx.linux')),
    /不是有效 PEM/,
  );

  const pemWithCredential = createResolvedCertificateUpdateInput('web.nginx.linux');
  pemWithCredential.credentials = {
    unexpected: { credentialId: 'credential-2', secretRefs: { password: 'secret://unexpected/password' } },
  };
  assert.throws(
    () => resolveCertificateUpdateSnapshot(pemWithCredential, loadCertificateUpdateContract('web.nginx.linux')),
    /不得携带凭据|未声明的凭据槽位/,
  );

  const wrongSecretSlot = createResolvedCertificateUpdateInput('app.tomcat.linux', {
    secretRefs: { username: 'secret://certificate/not-a-password' },
  });
  assert.throws(
    () => resolveCertificateUpdateSnapshot(wrongSecretSlot, loadCertificateUpdateContract('app.tomcat.linux')),
    /必须提供 password SecretRef/,
  );
});

test('计划绑定只接受快照路径、指纹、Artifact、服务和配置检查程序事实', () => {
  const contract = loadCertificateUpdateContract('web.apache.windows');
  const snapshot = resolveCertificateUpdateSnapshot(
    createResolvedCertificateUpdateInput('web.apache.windows'),
    contract,
  );
  const plan = {
    pluginId: snapshot.pluginId,
    capability: 'certificate.deploy',
    operations: [
      { operationType: 'filesystem.atomic_replace', input: { path: snapshot.paths[0], configFingerprint: snapshot.configFingerprint, artifactDigest: snapshot.artifactDigest, ledgerRef: 'execution-recovery-ledger' } },
      {
        operationType: 'command.execute_allowlisted',
        input: {
          executablePath: snapshot.programPath,
          executableSha256: snapshot.programSha256,
          args: snapshot.configCheckArgs,
          argumentTemplate: snapshot.configCheckArgsTemplate,
          workingDirectory: snapshot.workingDirectory,
        },
      },
      {
        operationType: 'service.reload',
        input: { serviceName: snapshot.serviceName },
      },
    ],
  };
  assert.doesNotThrow(() => assertCertificateUpdatePlanBinding(plan, snapshot));
  assert.throws(
    () => assertCertificateUpdatePlanBinding({
      ...plan,
      operations: plan.operations.map((operation) => operation.operationType === 'command.execute_allowlisted'
        ? { ...operation, input: { ...operation.input, workingDirectory: 'relative/runtime' } }
        : operation),
    }, snapshot),
    /配置检查计划未绑定程序路径、程序摘要或工作目录/,
  );
  assert.throws(
    () => assertCertificateUpdatePlanBinding({
      ...plan,
      operations: [
        { ...plan.operations[0], input: { ...plan.operations[0].input, path: '/tmp/other.crt' } },
        plan.operations[1],
      ],
    }, snapshot),
    /计划包含不在输入快照中的路径/,
  );
});

test('不包含配置检查命令的 Tomcat 变更计划不要求程序事实，但仍必须绑定恢复账本', () => {
  const snapshot = resolveCertificateUpdateSnapshot(
    createResolvedCertificateUpdateInput('app.tomcat.windows'),
    loadCertificateUpdateContract('app.tomcat.windows'),
  );
  const basePlan = {
    pluginId: snapshot.pluginId,
    capability: 'certificate.deploy',
    operations: [
      {
        operationType: 'certificate.material.validate',
        input: {
          path: snapshot.paths[0],
          configFingerprint: snapshot.configFingerprint,
          artifactDigest: snapshot.artifactDigest,
        },
      },
      {
        operationType: 'filesystem.atomic_replace',
        input: {
          path: snapshot.paths[0],
          configFingerprint: snapshot.configFingerprint,
          artifactDigest: snapshot.artifactDigest,
          ledgerRef: 'execution-recovery-ledger',
        },
      },
      {
        operationType: 'service.restart',
        input: { serviceName: snapshot.serviceName },
      },
    ],
  };
  assert.doesNotThrow(() => assertCertificateUpdatePlanBinding(basePlan, snapshot));
  assert.throws(
    () => assertCertificateUpdatePlanBinding({
      ...basePlan,
      operations: basePlan.operations.map((operation) => operation.operationType === 'filesystem.atomic_replace'
        ? { ...operation, input: { ...operation.input, ledgerRef: undefined } }
        : operation),
    }, snapshot),
    /变更计划未绑定执行恢复账本/,
  );
});

test('包含配置检查命令的变更计划仍必须绑定程序路径、摘要和工作目录', () => {
  const snapshot = resolveCertificateUpdateSnapshot(
    createResolvedCertificateUpdateInput('web.apache.windows'),
    loadCertificateUpdateContract('web.apache.windows'),
  );
  assert.throws(
    () => assertCertificateUpdatePlanBinding({
      pluginId: snapshot.pluginId,
      capability: 'certificate.deploy',
      operations: [
        {
          operationType: 'filesystem.atomic_replace',
          input: {
            path: snapshot.paths[0],
            configFingerprint: snapshot.configFingerprint,
            artifactDigest: snapshot.artifactDigest,
            ledgerRef: 'execution-recovery-ledger',
          },
        },
        {
          operationType: 'command.execute_allowlisted',
          input: {
            executablePath: snapshot.programPath,
            executableSha256: snapshot.programSha256,
          },
        },
        {
          operationType: 'service.reload',
          input: { serviceName: snapshot.serviceName },
        },
      ],
    }, snapshot),
    /配置检查计划未绑定程序路径、程序摘要或工作目录/,
  );
});

test('Verify 计划也必须绑定路径、指纹、Artifact 和服务事实', () => {
  const snapshot = resolveCertificateUpdateSnapshot(
    createResolvedCertificateUpdateInput('web.nginx.linux'),
    loadCertificateUpdateContract('web.nginx.linux'),
  );
  assert.doesNotThrow(() => assertCertificateUpdatePlanBinding({
    pluginId: snapshot.pluginId,
    capability: 'certificate.verify',
    operations: [
      {
        operationType: 'certificate.material.validate',
        input: {
          path: snapshot.paths[0],
          configFingerprint: snapshot.configFingerprint,
          artifactDigest: snapshot.artifactDigest,
        },
      },
      { operationType: 'service.status', input: { serviceName: snapshot.serviceName } },
    ],
  }, snapshot));
  assert.throws(() => assertCertificateUpdatePlanBinding({
    pluginId: snapshot.pluginId,
    capability: 'certificate.verify',
    operations: [{ operationType: 'service.status', input: { serviceName: snapshot.serviceName } }],
  }, snapshot), /计划未绑定路径/);
});

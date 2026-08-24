import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import {
  buildWorkflowAssetContext,
  buildWorkflowBindingProjection,
  resolveWorkflowConnection,
} from './domain/workflow-variable-resolver.js';
import type { WorkflowDslV1 } from './dto/workflow-templates.dto.js';

describe('WorkflowVariableResolver', () => {
  it('只把 required 和 advanced 投影到配置面板，runtime 完全隐藏', () => {
    const content = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'projection-test' },
      variables: {
        address: {
          type: 'string', configurationMode: 'required', source: { kind: 'dsl', value: '10.0.0.7' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding',
        },
        port: {
          type: 'number', configurationMode: 'advanced', source: { kind: 'dsl', value: 22 }, lifecycle: 'pre_execution', bindingPolicy: 'fixed', default: 22,
        },
        output: {
          type: 'string', configurationMode: 'runtime', source: { kind: 'step_output', step: 'login', output: 'token' }, lifecycle: 'step_output', bindingPolicy: 'fixed',
        },
      },
      steps: [],
    } as unknown as WorkflowDslV1;
    const projection = buildWorkflowBindingProjection({ content, assetContext: { asset: { address: '10.0.0.7' } }, phase: 'configure' });
    assert.deepEqual(projection.required.map((item) => item.name), ['address']);
    assert.deepEqual(projection.advanced.map((item) => item.name), ['port']);
    assert.deepEqual(projection.runtime.map((item) => item.name), ['output']);
    assert.equal(projection.required[0]?.value, '10.0.0.7');
  });

  it('资产托管字段不进入工作流变量面板，旧绑定也不能覆盖目标信息', () => {
    const content = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'asset-owned-test' },
      variables: {
        protocol: {
          type: 'enum', configurationMode: 'required', source: { kind: 'asset_ssl', path: 'target.protocol' }, lifecycle: 'pre_execution', bindingPolicy: 'fixed',
        },
        deviceBaseUrl: {
          type: 'string', configurationMode: 'advanced', source: { kind: 'derived', resolver: 'endpoint_url' }, lifecycle: 'pre_execution', bindingPolicy: 'fixed',
        },
        credential: {
          type: 'credential', configurationMode: 'required', source: { kind: 'credential', slot: 'credential' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding',
        },
      },
      steps: [],
    } as unknown as WorkflowDslV1;
    const projection = buildWorkflowBindingProjection({
      content,
      assetContext: { asset: { address: 'cloud.jacksonz.cn', port: 5001, protocol: 'HTTPS' }, target: { protocol: 'HTTPS', port: 5001 } },
      parameterBindings: { protocol: 'HTTP', deviceBaseUrl: 'https://wrong.example.com:1', credential: 'sec_1' },
      phase: 'configure',
    });
    assert.deepEqual(projection.required.map((item) => item.name), ['credential']);
    assert.deepEqual(projection.advanced.map((item) => item.name), []);
    assert.equal(projection.required[0]?.value, 'sec_1');
    assert.deepEqual(projection.missingAssetFields, []);
  });

  it('步骤产物变量显式声明 runtime 后不会进入配置分组', () => {
    const content = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'runtime-output-test' },
      variables: {
        previousCertificateId: {
          type: 'string', configurationMode: 'runtime', source: { kind: 'step_output', step: 'build_context', output: 'previousCertificateId' }, lifecycle: 'step_output', bindingPolicy: 'fixed',
        },
        certificateDescription: {
          type: 'string', configurationMode: 'advanced', source: { kind: 'dsl', value: 'GCAC active certificate' }, lifecycle: 'pre_execution', bindingPolicy: 'default_overridable', default: 'GCAC active certificate',
        },
      },
      steps: [],
    } as unknown as WorkflowDslV1;
    const projection = buildWorkflowBindingProjection({ content, phase: 'configure' });
    assert.deepEqual(projection.runtime.map((item) => item.name), ['previousCertificateId']);
    assert.deepEqual(projection.advanced.map((item) => item.name), ['certificateDescription']);
  });

  it('Synology V9 只向普通用户暴露凭据，厂商描述保留在进阶配置', async () => {
    const content = JSON.parse(await readFile(
      new URL('./builtin-workflows/synology-dsm-cert-import.json', import.meta.url),
      'utf8',
    )) as WorkflowDslV1;
    const projection = buildWorkflowBindingProjection({
      content,
      assetContext: {
        asset: { address: 'cloud.jacksonz.cn', port: 5001, protocol: 'HTTPS' },
        target: {
          frameworkType: 'CUSTOM',
          siteName: 'Synology DSM',
          bindingInformation: '*:5001:cloud.jacksonz.cn',
          hostHeader: 'cloud.jacksonz.cn',
          port: 5001,
          protocol: 'HTTPS',
          verifyUrl: 'https://cloud.jacksonz.cn:5001/',
          sniName: 'cloud.jacksonz.cn',
        },
      },
      parameterBindings: { synologyCredential: 'sec_synology' },
      phase: 'configure',
    });
    assert.deepEqual(projection.required.map((item) => item.name), ['synologyCredential']);
    assert.deepEqual(projection.advanced.map((item) => item.name), ['certificateDescription']);
    assert.deepEqual(projection.runtime.map((item) => item.name).sort(), [
      'newCertificateId',
      'previousCertificateId',
      'serverCert',
      'serviceBindingsJson',
    ]);
  });

  it('Apache 新模板只显示 SSH 基础连接，部署路径归入进阶配置', async () => {
    const content = JSON.parse(await readFile(
      new URL('./builtin-workflows/apache-8444-cert-switch.json', import.meta.url),
      'utf8',
    )) as WorkflowDslV1;
    const projection = buildWorkflowBindingProjection({
      content,
      assetContext: {
        asset: { address: 'test03.jacksonz.cn', port: 8444, protocol: 'HTTPS' },
        target: {
          frameworkType: 'APACHE',
          siteName: 'Apache 8444',
          bindingInformation: '*:8444:test03.jacksonz.cn',
          hostHeader: 'test03.jacksonz.cn',
          port: 8444,
          protocol: 'HTTPS',
          verifyUrl: 'https://test03.jacksonz.cn:8444/',
          sniName: 'test03.jacksonz.cn',
        },
      },
      connectionBindings: {
        targetSsh: {
          host: '10.255.0.127',
          username: 'root',
          credentialRef: 'sec_ssh',
          credential: { credentialId: 'cred_ssh', kind: 'SSH_KEY', secretRefs: { privateKey: 'secret://ssh_key/sec_ssh#current' } },
        },
      },
      parameterBindings: {
        apacheSiteConfigPath: '/etc/apache2/sites-available/gcac-test.conf',
        certificateFilePath: '/etc/gcac-test/certs/apache/apache-test.crt',
        certificateKeyFilePath: '/etc/gcac-test/certs/apache/apache-test.key',
      },
      phase: 'configure',
    });
    assert.deepEqual(projection.required.map((item) => item.name), []);
    assert.deepEqual(projection.basicConnections.map((item) => item.name), ['targetSsh']);
    assert.equal(projection.basicConnections[0]?.status, 'resolved');
    assert.equal(projection.basicConnections[0]?.port, 22);
    assert.equal(projection.basicConnections[0]?.fieldModes.port, 'advanced');
    assert.deepEqual(projection.advanced.map((item) => item.name), [
      'targetPlatform',
      'apacheServiceName',
      'apacheSiteConfigPath',
      'certificateFilePath',
      'certificateKeyFilePath',
      'backupRoot',
      'expectedResponseContains',
    ]);
    assert.deepEqual(projection.runtime.map((item) => item.name), ['serverCert']);
    assert.deepEqual(projection.missingAssetFields, []);
  });

  it('构建资产上下文时不会用未定义的顶层字段覆盖目标信息', () => {
    const context = buildWorkflowAssetContext({
      asset: { address: 'cloud.jacksonz.cn' },
      target: { hostHeader: 'cloud.jacksonz.cn', verifyUrl: 'https://cloud.jacksonz.cn:5001/' },
      port: 5001,
      protocol: 'HTTPS',
    });
    assert.equal((context.target as Record<string, unknown>).hostHeader, 'cloud.jacksonz.cn');
    assert.equal((context.target as Record<string, unknown>).verifyUrl, 'https://cloud.jacksonz.cn:5001/');
  });

  it('SSH 默认端口为 22，连接地址只来自连接绑定或资产上下文', () => {
    const connection = resolveWorkflowConnection({
      protocol: 'ssh',
      host: { configurationMode: 'required', source: 'binding' },
      port: { configurationMode: 'advanced', source: 'dsl_default', default: 22 },
    }, undefined, { asset: { address: '10.255.0.127' } });
    assert.equal(connection.host, undefined);
    assert.equal(connection.port, 22);
    const bound = resolveWorkflowConnection({
      protocol: 'ssh',
      host: { configurationMode: 'required', source: 'binding' },
      port: { configurationMode: 'advanced', source: 'dsl_default', default: 22 },
    }, { host: '10.255.0.127', port: 2222 }, {});
    assert.equal(bound.host, '10.255.0.127');
    assert.equal(bound.port, 2222);
  });
});

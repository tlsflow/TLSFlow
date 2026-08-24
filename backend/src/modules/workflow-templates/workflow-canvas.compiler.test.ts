import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileWorkflowCanvas, validateWorkflowCanvasInput } from './domain/workflow-canvas.compiler.js';

describe('Workflow Canvas 正式输入契约', () => {
  it('使用 inputContract 和 connectionRef 编译 HTTP、SSH 与文件传输节点', () => {
    const result = compileWorkflowCanvas({ canvas: canvasFixture() });

    assert.equal(result.content.inputContract.apiVersion, 'gcac.deployment-input/v1');
    assert.deepEqual(Object.keys(result.content.inputContract.credentials), ['sshCredential']);
    assert.deepEqual(Object.keys(result.content.inputContract.artifacts), ['serverCert']);
    assert.equal(result.content.steps[0]?.type, 'http');
    assert.equal(result.content.steps[0]?.type === 'http' ? result.content.steps[0].request.connectionRef : undefined, 'management');
    const ssh = result.content.steps.find((step) => step.type === 'ssh');
    const sftp = result.content.steps.find((step) => step.type === 'sftp');
    const scp = result.content.steps.find((step) => step.type === 'scp');
    assert.equal(ssh?.type === 'ssh' ? ssh.ssh.connectionRef : undefined, 'targetSsh');
    assert.equal(sftp?.type === 'sftp' ? sftp.sftp.connectionRef : undefined, 'targetSsh');
    assert.equal(scp?.type === 'scp' ? scp.scp.connectionRef : undefined, 'targetSsh');
  });

  it('拒绝旧 variables/connections 根字段，不再推导兼容契约', () => {
    const legacy = { ...canvasFixture(), inputContract: undefined, variables: {}, connections: {} };
    const validation = validateWorkflowCanvasInput({ canvas: legacy });

    assert.ok(validation.issues.some((issue) => issue.id === 'legacy-input-contract' && issue.severity === 'error'));
    assert.ok(validation.issues.some((issue) => issue.id === 'input-contract-required' && issue.severity === 'error'));
    assert.throws(() => compileWorkflowCanvas({ canvas: legacy }), /工作流画布校验失败/);
  });

  it('拒绝节点引用未声明的连接槽位', () => {
    const canvas = canvasFixture();
    const invalid = {
      ...canvas,
      nodes: canvas.nodes.map((node) => node.id === 'ssh_1'
        ? { ...node, config: { ...node.config, connectionRef: 'missingSsh' } }
        : node),
    };

    assert.throws(() => compileWorkflowCanvas({ canvas: invalid }), /未声明的连接槽位/);
  });

  it('Canvas plugin.action 节点编译后保留 Action 合同且可被 DSL Schema 接收', () => {
    const canvas = canvasFixture() as unknown as { nodes: Array<Record<string, unknown>> };
    canvas.nodes.push({
      id: 'plugin_action_1',
      type: 'plugin.action',
      config: {
        pluginId: 'test.echo',
        capability: 'test.echo',
        actionId: 'test.echo.v1',
        actionContractVersion: 'v1',
        input: '{"value":"{{variables.verifyUrl}}"}',
        inputSchemaSha256: `sha256:${'a'.repeat(64)}`,
        outputSchemaSha256: `sha256:${'b'.repeat(64)}`,
        timeoutSeconds: 30,
        writeEffect: 'false',
        idempotencyKeyRef: '{{variables.verifyUrl}}',
      },
      ui: { stage: 'prepare' },
    });

    const result = compileWorkflowCanvas({ canvas });
    const action = result.content.steps.find((step) => step.type === 'plugin.action');
    assert.deepEqual(action, {
      name: 'plugin_action_2_plugin_action_1',
      type: 'plugin.action',
      stage: 'prepare',
      pluginId: 'test.echo',
      capability: 'test.echo',
      actionId: 'test.echo.v1',
      actionContractVersion: 'v1',
      input: { value: '{{variables.verifyUrl}}' },
      inputSchemaSha256: `sha256:${'a'.repeat(64)}`,
      outputSchemaSha256: `sha256:${'b'.repeat(64)}`,
      timeoutSeconds: 30,
      writeEffect: false,
      idempotencyKeyRef: '{{variables.verifyUrl}}',
    });
  });
});

function canvasFixture() {
  const requiredField = (type: 'string' | 'number') => ({
    type,
    required: true,
    configurationMode: 'required' as const,
    source: { kind: 'binding' as const },
    lifecycle: 'pre_execution' as const,
    bindingPolicy: 'required_binding' as const,
  });
  return {
    schemaVersion: 'gcac.workflow.canvas/v1',
    dslVersion: 'gcac.workflow/v1',
    metadata: { name: 'canvas_contract_test' },
    inputContract: {
      apiVersion: 'gcac.deployment-input/v1' as const,
      variables: {
        verifyUrl: {
          type: 'string' as const,
          required: true,
          configurationMode: 'required' as const,
          source: { kind: 'binding' as const },
          lifecycle: 'pre_execution' as const,
          bindingPolicy: 'required_binding' as const,
        },
      },
      connections: {
        management: { transport: 'http' as const, host: requiredField('string'), port: requiredField('number') },
        targetSsh: {
          transport: 'ssh' as const,
          host: requiredField('string'),
          port: requiredField('number'),
          username: requiredField('string'),
          credentialSlot: 'sshCredential',
          hostKey: { policy: 'trust_on_first_use' as const },
        },
      },
      credentials: {
        sshCredential: {
          allowedKinds: ['USERNAME_PASSWORD', 'SSH_KEY'] as const,
          required: true,
          configurationMode: 'required' as const,
          lifecycle: 'pre_execution' as const,
        },
      },
      artifacts: {
        serverCert: {
          kind: 'certificate' as const,
          required: true,
          configurationMode: 'required' as const,
          lifecycle: 'runtime_injected' as const,
          artifactContract: {
            outputs: {
              certFile: { role: 'public_certificate', required: true, format: 'pem' },
              keyFile: { role: 'private_key', required: true, format: 'pem', sensitive: true },
            },
          },
        },
      },
    },
    nodes: [
      { id: 'http_1', type: 'http' as const, config: { method: 'GET', connectionRef: 'management', url: '{{variables.verifyUrl}}', timeoutSeconds: 30 }, ui: { stage: 'prepare' } },
      { id: 'ssh_1', type: 'ssh' as const, config: { connectionRef: 'targetSsh', program: 'systemctl', args: ['service-main'], argumentTemplate: 'systemctl.reload', timeoutSeconds: 30 }, ui: { stage: 'backup' } },
      { id: 'sftp_1', type: 'sftp' as const, config: { direction: 'upload', connectionRef: 'targetSsh', remotePath: '/tmp/cert.pem', contentRef: '{{artifacts.serverCert.outputs.certFile.content}}', timeoutSeconds: 30 }, ui: { stage: 'install' } },
      { id: 'scp_1', type: 'scp' as const, config: { direction: 'upload', connectionRef: 'targetSsh', remotePath: '/tmp/key.pem', contentRef: '{{artifacts.serverCert.outputs.keyFile.content}}', timeoutSeconds: 30 }, ui: { stage: 'install' } },
      { id: 'verify_1', type: 'verify' as const, config: { verifyType: 'httpStatus', connectionRef: 'management', inputRef: '{{variables.verifyUrl}}', expected: '200', timeoutSeconds: 30 }, ui: { stage: 'verify' } },
    ],
    edges: [],
  };
}

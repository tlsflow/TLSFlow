import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CurlExecutor } from '../executors/curl/curl.executor.js';
import type { CurlHttpClient } from '../executors/curl/curl.http-client.js';
import type { CurlExecutionRequest } from '../executors/curl/curl.executor.js';
import { SSHExecutor } from '../executors/ssh/ssh.executor.js';
import type { SshConnectionManager } from '../executors/ssh/ssh.connection-manager.js';
import type { SSHExecutionRequest } from '../executors/ssh/ssh.executor.js';
import { createWorkflowStepDispatcher } from './application/workflow-step-dispatcher.js';
import type { WorkflowExecutorDispatchInput } from './dto/workflow-templates.dto.js';

describe('WorkflowStepDispatcher 旧执行器无回退边界', () => {
  it('保留 dryRun=true，并且 Curl/SSH 均不产生外部副作用', async () => {
    let httpRequests = 0;
    const httpClient: CurlHttpClient = {
      async send() {
        httpRequests += 1;
        throw new Error('dryRun 不得发送 HTTP 请求');
      },
    };
    const curlExecutor = new CurlExecutor({ httpClient });

    let sshConnections = 0;
    const connectionManager = {
      async connect() {
        sshConnections += 1;
        throw new Error('dryRun 不得建立 SSH 连接');
      },
    } as unknown as SshConnectionManager;
    const sshExecutor = new SSHExecutor({ connectionManager });
    const dispatcher = createWorkflowStepDispatcher({ curlExecutor, sshExecutor });

    const curlResult = await dispatcher(dispatchInput({
      executor: '017.CURL_HTTP',
      dryRun: true,
      curlRequest: {
        template: { method: 'GET', url: 'https://example.com/health' },
        dryRun: false,
      },
    }, { dryRun: false }));
    const sshResult = await dispatcher(dispatchInput({
      executor: '015.SSH',
      dryRun: true,
      connection: sshConnection(),
      program: 'systemctl',
      args: ['service-main'],
      argumentTemplate: 'systemctl.reload',
    }, { dryRun: false, stepType: 'ssh' }));

    assert.equal(curlResult.success, true);
    assert.equal(sshResult.success, true);
    assert.equal(httpRequests, 0);
    assert.equal(sshConnections, 0);
    assert.match(curlResult.logs?.join('\n') ?? '', /request:dry_run/);
    assert.match(sshResult.logs?.join('\n') ?? '', /ssh:mode:dry_run/);
  });

  it('把调用方 dryRun 上下文传给旧执行器，不能由 dispatcher 强制改成 false', async () => {
    const curlCalls: Array<{ dryRun?: boolean; forceDryRun: boolean }> = [];
    const sshCalls: Array<{ dryRun?: boolean; forceDryRun: boolean }> = [];
    const dispatcher = createWorkflowStepDispatcher({
      curlExecutor: {
        async execute(request: CurlExecutionRequest, forceDryRun: boolean) {
          curlCalls.push({ dryRun: request.dryRun, forceDryRun });
          return { success: true, statusCode: 200, logs: [] };
        },
      } as never,
      sshExecutor: {
        async execute(request: SSHExecutionRequest, forceDryRun: boolean) {
          sshCalls.push({ dryRun: request.dryRun, forceDryRun });
          return { success: true, exitCode: 0, mode: 'dry_run', dryRun: true, plannedActions: [], hostKeyDecision: 'verified', backupManifest: [] };
        },
      } as never,
    });

    await dispatcher(dispatchInput({
      executor: '017.CURL_HTTP',
      curlRequest: { template: { method: 'GET', url: 'https://example.com' }, dryRun: false },
    }, { dryRun: true }));
    await dispatcher(dispatchInput({
      executor: '015.SSH',
      connection: sshConnection(),
      program: 'systemctl',
      args: ['service-main'],
      argumentTemplate: 'systemctl.reload',
    }, { dryRun: true, stepType: 'ssh' }));

    assert.deepEqual(curlCalls, [{ dryRun: true, forceDryRun: true }]);
    assert.deepEqual(sshCalls, [{ dryRun: true, forceDryRun: true }]);
  });

  it('未知 executor 和缺少受控执行能力均失败关闭，不返回 plannedOnly 成功', async () => {
    const dispatcher = createWorkflowStepDispatcher();

    const unknown = await dispatcher(dispatchInput({ executor: 'workflow.unknown' }));
    const missing = await dispatcher(dispatchInput({
      executor: '017.CURL_HTTP',
      curlRequest: { template: { method: 'GET', url: 'https://example.com' } },
    }));

    assert.equal(unknown.success, false);
    assert.equal(unknown.errorCode, 'WORKFLOW_EXECUTOR_NOT_REGISTERED');
    assert.equal((unknown.body as { plannedOnly?: boolean } | undefined)?.plannedOnly, undefined);
    assert.equal(missing.success, false);
    assert.equal(missing.errorCode, 'CAPABILITY_MISSING');
    assert.equal((missing.body as { plannedOnly?: boolean } | undefined)?.plannedOnly, undefined);
  });

  it('缺少 executor 失败关闭，已知控制节点才允许显式 plannedOnly', async () => {
    const dispatcher = createWorkflowStepDispatcher();
    const required = await dispatcher(dispatchInput({}));
    const control = await dispatcher(dispatchInput({ executor: 'workflow.wait', seconds: 1 }));

    assert.equal(required.success, false);
    assert.equal(required.errorCode, 'WORKFLOW_EXECUTOR_REQUIRED');
    assert.equal(control.success, true);
    assert.deepEqual(control.body, { plannedOnly: true, executor: 'workflow.wait' });
  });

  it('PluginWorkflow 或 Plugin Runner 计划不得进入旧 Curl/SSH 执行器', async () => {
    let curlCalls = 0;
    let sshCalls = 0;
    const dispatcher = createWorkflowStepDispatcher({
      curlExecutor: { execute: async () => { curlCalls += 1; throw new Error('不应调用 Curl'); } } as never,
      sshExecutor: { execute: async () => { sshCalls += 1; throw new Error('不应调用 SSH'); } } as never,
    });

    const pluginWorkflow = await dispatcher(dispatchInput({
      kind: 'PluginWorkflow',
      executor: '017.CURL_HTTP',
      curlRequest: { template: { method: 'GET', url: 'https://example.com' } },
    }));
    const pluginRunner = await dispatcher(dispatchInput({
      executionMode: 'PLUGIN_RUNNER',
      executor: '015.SSH',
      connection: sshConnection(),
      program: 'systemctl',
      args: ['service-main'],
      argumentTemplate: 'systemctl.reload',
    }, { stepType: 'ssh' }));

    assert.equal(pluginWorkflow.success, false);
    assert.equal(pluginWorkflow.errorCode, 'PLUGIN_WORKFLOW_LEGACY_EXECUTOR_FORBIDDEN');
    assert.equal(pluginRunner.success, false);
    assert.equal(pluginRunner.errorCode, 'PLUGIN_WORKFLOW_LEGACY_EXECUTOR_FORBIDDEN');
    assert.equal(curlCalls, 0);
    assert.equal(sshCalls, 0);
  });
});

function dispatchInput(
  renderedPlan: Record<string, unknown>,
  options: { dryRun?: boolean; stepType?: 'http' | 'ssh' } = {},
): WorkflowExecutorDispatchInput {
  return {
    runId: 'run-dispatcher-test',
    step: { name: 'step-dispatcher-test', type: options.stepType ?? 'http' } as never,
    renderedPlan,
    attempt: 1,
    rollback: false,
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
  };
}

function sshConnection() {
  return {
    host: 'web-01',
    username: 'deploy',
    credentialSecretRef: 'secret://ssh/web-01#current',
    expectedHostKeyFingerprint: 'aabbccddeeff0011',
  };
}

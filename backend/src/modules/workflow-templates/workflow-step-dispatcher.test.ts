import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CurlExecutor } from '../executors/curl/curl.executor.js';
import type { CurlHttpClient } from '../executors/curl/curl.http-client.js';
import type { CurlExecutionRequest } from '../executors/curl/curl.executor.js';
import { SSHExecutor } from '../executors/ssh/ssh.executor.js';
import type { SshConnectionManager } from '../executors/ssh/ssh.connection-manager.js';
import type { SSHExecutionRequest } from '../executors/ssh/ssh.executor.js';
import type { ExecutionGrantEntity } from '../../persistence/entities/execution-grant.entity.js';
import type { ExecutionGrantService } from '../executions/execution-grant.service.js';
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

  it('显式注入 CurlExecutor 时 017.CURL_HTTP 真实发出请求并映射结果', async () => {
    const requests: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    const httpClient: CurlHttpClient = {
      async send(input) {
        requests.push({ url: input.url, method: input.method, headers: input.headers });
        return { statusCode: 200, body: { errorcode: 0 } };
      },
    };
    const curlExecutor = new CurlExecutor({ httpClient });
    const dispatcher = createWorkflowStepDispatcher({ curlExecutor });

    const result = await dispatcher(dispatchInput({
      executor: '017.CURL_HTTP',
      curlRequest: {
        template: {
          method: 'GET',
          url: 'https://10.0.0.1:8443/nitro/v1/config/nsversion',
          headers: { Accept: 'application/json' },
        },
        responsePolicy: { successStatusCodes: [200] },
      },
    }, { runId: 'run-curl-real' }));

    assert.equal(result.success, true);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(requests, [{
      url: 'https://10.0.0.1:8443/nitro/v1/config/nsversion',
      method: 'GET',
      headers: { Accept: 'application/json' },
    }]);
    assert.deepEqual(result.body, { errorcode: 0 });
    assert.equal((result.body as { plannedOnly?: boolean }).plannedOnly, undefined);
  });

  it('工作流优先使用 Curl 原始运行时响应，不能把脱敏 JWT 传给后续步骤', async () => {
    let executeCalls = 0;
    let executeForWorkflowCalls = 0;
    const runtimeToken = 'runtime-workflow-jwt';
    const dispatcher = createWorkflowStepDispatcher({
      curlExecutor: {
        async execute() {
          executeCalls += 1;
          throw new Error('新版 CurlExecutor 不应回退到脱敏 execute()');
        },
        async executeForWorkflow() {
          executeForWorkflowCalls += 1;
          return {
            result: {
              success: true,
              rendered: { method: 'POST', url: 'http://npm.example.test/api/tokens', headerNames: [], hasBody: true, bodyType: 'form', timeoutMs: 30_000, tlsVerify: false },
              statusCode: 200,
              bodyJson: { token: '[REDACTED]' },
              bodyText: '{"token":"[REDACTED]"}',
              attempts: 1,
              assertions: [],
              extracted: { token: '[SECRET_CAPTURED]' },
              logs: [],
            },
            runtimeResponse: {
              statusCode: 200,
              bodyJson: { token: runtimeToken },
              bodyText: JSON.stringify({ token: runtimeToken }),
            },
          };
        },
      } as never,
    });

    const result = await dispatcher(dispatchInput({
      executor: '017.CURL_HTTP',
      curlRequest: {
        template: { method: 'POST', url: '/api/tokens', bodyType: 'form' },
        responsePolicy: { successStatusCodes: [200] },
      },
    }, { runId: 'run-runtime-response' }));

    assert.equal(result.success, true);
    assert.equal((result.body as { token?: string }).token, runtimeToken);
    assert.equal(executeForWorkflowCalls, 1);
    assert.equal(executeCalls, 0);
  });

  it('把宿主租户与 WorkflowVersion 上下文透传给旧 Curl/SSH 执行器', async () => {
    const curlContexts: Array<Record<string, unknown>> = [];
    const sshContexts: Array<Record<string, unknown>> = [];
    const dispatcher = createWorkflowStepDispatcher({
      curlExecutor: {
        async execute(request: CurlExecutionRequest, _forceDryRun: boolean, context: Record<string, unknown>) {
          curlContexts.push(context);
          return { success: true, statusCode: 200, logs: [] };
        },
      } as never,
      sshExecutor: {
        async execute(request: SSHExecutionRequest, _forceDryRun: boolean, context: Record<string, unknown>) {
          sshContexts.push(context);
          return { success: true, exitCode: 0, mode: 'dry_run', dryRun: true, plannedActions: [], hostKeyDecision: 'verified', backupManifest: [] };
        },
      } as never,
    });

    await dispatcher(dispatchInput({
      executor: '017.CURL_HTTP',
      curlRequest: { template: { method: 'GET', url: 'https://adc.example.test' } },
    }, { runId: 'run-tenant-ctx', tenantId: 'tenant-ctx-1', workflowVersionId: 'wf-ctx-1' }));
    await dispatcher(dispatchInput({
      executor: '015.SSH',
      connection: sshConnection(),
      program: 'systemctl',
      args: ['service-main'],
      argumentTemplate: 'systemctl.reload',
    }, { runId: 'run-tenant-ctx', stepType: 'ssh', tenantId: 'tenant-ctx-1', workflowVersionId: 'wf-ctx-1' }));

    assert.equal(curlContexts[0]?.tenantId, 'tenant-ctx-1');
    assert.equal(curlContexts[0]?.workflowVersionId, 'wf-ctx-1');
    assert.equal(curlContexts[0]?.actorId, 'workflow-step-test');
    assert.equal(sshContexts[0]?.tenantId, 'tenant-ctx-1');
    assert.equal(sshContexts[0]?.workflowVersionId, 'wf-ctx-1');
    assert.equal(sshContexts[0]?.actorId, 'workflow-step-test');
  });

  it('TLS 例外请求不再要求 approvalId，但仍绑定显式输入和 ExecutionGrant', async () => {
    const grantStore = new InMemoryExecutionGrantService();
    const grants = grantStore as unknown as ExecutionGrantService;
    const httpClient: CurlHttpClient = {
      async send() {
        return { statusCode: 200, body: { errorcode: 0 } };
      },
    };
    const curlExecutor = new CurlExecutor({ httpClient, executionGrantService: grants });
    const dispatcher = createWorkflowStepDispatcher({ curlExecutor, executionGrantService: grants });

    // 允许条件：渲染 verify=false + DSL 声明 allowInsecure + 宿主租户与 Grant 服务齐备。
    const authorized = await dispatcher(dispatchInput({
      executor: '017.CURL_HTTP',
      curlRequest: {
        template: {
          method: 'GET',
          url: 'https://10.0.0.1:443/nitro/v1/config/nsversion',
          tls: { verify: false, allowInsecure: true },
        },
        responsePolicy: { successStatusCodes: [200] },
      },
    }, {
      runId: 'run-tls-grant',
      tenantId: 'tenant-tls',
      workflowVersionId: 'wf-tls',
      mode: 'real_test',
      authorization: { approved: true, approvalId: 'approval-tls-grant' },
    }));

    assert.equal(authorized.success, true);
    assert.equal(grantStore.createdCount(), 1);
    assert.equal((await grantStore.get('grant-test-1'))?.approvalId, undefined);
    assert.equal(grantStore.activeCount(), 0, '执行结束后 Grant 必须立即撤销');

    const withoutApproval = await dispatcher(dispatchInput({
      executor: '017.CURL_HTTP',
      curlRequest: {
        template: {
          method: 'GET',
          url: 'https://10.0.0.1:443/nitro/v1/config/nsversion',
          tls: { verify: false, allowInsecure: true },
        },
      },
    }, { runId: 'run-tls-without-approval', tenantId: 'tenant-tls', workflowVersionId: 'wf-tls', mode: 'real_test' }));

    assert.equal(withoutApproval.success, true);
    assert.equal(grantStore.createdCount(), 2, '不携带 approvalId 也应签发本次工作流 Grant');
    assert.equal((await grantStore.get('grant-test-2'))?.approvalId, undefined);
    assert.equal(grantStore.activeCount(), 0, '执行结束后 Grant 必须立即撤销');

    // 未授权：没有租户上下文时不签发 Grant，CurlExecutor 自身 TLS 授权链失败关闭。
    const denied = await dispatcher(dispatchInput({
      executor: '017.CURL_HTTP',
      curlRequest: {
        template: {
          method: 'GET',
          url: 'https://10.0.0.1:443/nitro/v1/config/nsversion',
          tls: { verify: false, allowInsecure: true },
        },
      },
    }, { runId: 'run-tls-denied' }));

    assert.equal(denied.success, false);
    assert.equal(denied.errorCode, 'AUTH_FORBIDDEN');
    assert.match(denied.errorMessage ?? '', /ExecutionGrant/);
    assert.equal(grantStore.createdCount(), 2, '缺少租户上下文时不得签发 Grant');

    // 未授权：DSL 未声明 allowInsecure 时即使有租户也不签发 Grant。
    const undeclared = await dispatcher(dispatchInput({
      executor: '017.CURL_HTTP',
      curlRequest: {
        template: {
          method: 'GET',
          url: 'https://10.0.0.1:443/nitro/v1/config/nsversion',
          tls: { verify: false },
        },
      },
    }, { runId: 'run-tls-undeclared', tenantId: 'tenant-tls', workflowVersionId: 'wf-tls' }));

    assert.equal(undeclared.success, false);
    assert.equal(undeclared.errorCode, 'VALIDATION_FAILED');
    assert.equal(grantStore.createdCount(), 2, 'DSL 未声明 allowInsecure 意图时不得签发 Grant');
  });
});

function dispatchInput(
  renderedPlan: Record<string, unknown>,
  options: {
    dryRun?: boolean;
    stepType?: 'http' | 'ssh';
    runId?: string;
    tenantId?: string;
    workflowVersionId?: string;
    mode?: 'render_only' | 'mock' | 'real_test';
    authorization?: { approved?: boolean; approvalId?: string };
  } = {},
): WorkflowExecutorDispatchInput {
  return {
    runId: options.runId ?? 'run-dispatcher-test',
    step: { name: 'step-dispatcher-test', type: options.stepType ?? 'http' } as never,
    renderedPlan,
    attempt: 1,
    rollback: false,
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.tenantId ? { tenantId: options.tenantId } : {}),
    ...(options.workflowVersionId ? { workflowVersionId: options.workflowVersionId } : {}),
    ...(options.authorization ? { authorization: options.authorization } : {}),
  };
}

class InMemoryExecutionGrantService {
  private readonly grants = new Map<string, ExecutionGrantEntity>();
  private created = 0;

  async create(input: {
    tenantId: string;
    runId: string;
    stepId: string;
    workflowVersionId?: string;
    executorType: string;
    allowedSecretRefs: string[];
    allowedActions: string[];
    approvalId?: string;
    expiresAt: string;
  }): Promise<ExecutionGrantEntity> {
    this.created += 1;
    const grant: ExecutionGrantEntity = {
      id: `grant-test-${this.created}`,
      tenantId: input.tenantId,
      runId: input.runId,
      stepId: input.stepId,
      workflowVersionId: input.workflowVersionId,
      executorType: input.executorType,
      allowedSecretRefs: input.allowedSecretRefs,
      allowedActions: input.allowedActions,
      approvalId: input.approvalId,
      expiresAt: input.expiresAt,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.grants.set(grant.id, grant);
    return grant;
  }

  async validate(input: { grantId: string; tenantId?: string; runId: string; stepId: string; workflowVersionId?: string; executorType: string; action?: string }): Promise<ExecutionGrantEntity> {
    const grant = this.grants.get(input.grantId);
    if (!grant || grant.status !== 'active') throw new Error('grant invalid');
    if (grant.runId !== input.runId || grant.stepId !== input.stepId || grant.executorType !== input.executorType) {
      throw new Error('grant context mismatch');
    }
    if (input.tenantId !== undefined && grant.tenantId !== input.tenantId) throw new Error('grant tenant mismatch');
    if (input.workflowVersionId !== undefined && grant.workflowVersionId !== input.workflowVersionId) throw new Error('grant workflow version mismatch');
    if (input.action && !grant.allowedActions.includes(input.action)) throw new Error('action not allowed');
    return grant;
  }

  async get(id: string): Promise<ExecutionGrantEntity | undefined> {
    return this.grants.get(id);
  }

  async revoke(id: string): Promise<ExecutionGrantEntity> {
    const grant = this.grants.get(id);
    if (grant) {
      const updated = { ...grant, status: 'revoked' as const, updatedAt: new Date().toISOString() };
      this.grants.set(id, updated);
      return updated;
    }
    throw new Error('grant not found');
  }

  createdCount(): number {
    return this.created;
  }

  activeCount(): number {
    return [...this.grants.values()].filter((grant) => grant.status === 'active').length;
  }
}

function sshConnection() {
  return {
    host: 'web-01',
    username: 'deploy',
    credentialSecretRef: 'secret://ssh/web-01#current',
    expectedHostKeyFingerprint: 'aabbccddeeff0011',
  };
}

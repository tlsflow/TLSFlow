import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WorkflowTemplatesApplicationService } from '../workflow-templates/application/workflow-templates.application-service.js';
import type { WorkflowDslV1 } from '../workflow-templates/dto/workflow-templates.dto.js';
import { WorkflowExecutorAdapter, type Executor, type StepExecutionInput, type StepExecutionResult } from './application/executors.js';
import type { ExecutionStepEntity } from './schema/executions.schema.js';

function workflowFixture(): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'workflow-executor-adapter-test' },
    variables: {
      deviceHost: { type: 'string', required: true },
      cert: { type: 'certificate', required: true },
    },
    steps: [
      {
        name: 'uploadCert',
        type: 'http',
        request: {
          method: 'PUT',
          url: 'https://{{deviceHost}}/api/cert',
          body: { cert: '{{cert.pem}}' },
        },
        extract: { remoteFingerprint: { type: 'jsonPath', path: '$.fingerprint' } },
        assert: [{ type: 'statusCode', equals: 200 }],
      },
      {
        name: 'reloadService',
        type: 'ssh',
        ssh: {
          mode: 'command',
          connection: {
            host: '{{deviceHost}}',
            username: 'admin',
            credentialSecretRef: 'secret://ssh/device',
            expectedHostKeyFingerprint: 'aa:bb',
          },
          command: 'reload cert {{remoteFingerprint}}',
        },
        assert: [{ type: 'contains', value: 'ok' }],
      },
    ],
  };
}

async function createPublishedWorkflow(): Promise<{ workflows: WorkflowTemplatesApplicationService; versionId: string }> {
  const workflows = new WorkflowTemplatesApplicationService();
  const created = await workflows.createTemplate({ content: workflowFixture(), changeSummary: 'test' });
  const published = await workflows.publishVersion(created.version.id);
  return { workflows, versionId: published.id };
}

function workflowStep(versionId?: string): ExecutionStepEntity {
  return {
    id: 'step_workflow',
    tenantId: 'tenant_1',
    executionRunId: 'run_workflow',
    deploymentPlanTargetId: 'target_1',
    stepNo: 1,
    stepType: 'CUSTOM',
    name: 'workflow update',
    attemptCount: 0,
    maxAttempts: 1,
    inputSnapshot: {
      workflowRequest: versionId
        ? {
            workflowVersionId: versionId,
            variableBindings: { deviceHost: 'edge-01.example.com' },
          }
        : {},
      deploymentArtifact: {
        certificatePem: '-----BEGIN CERTIFICATE-----mock-----END CERTIFICATE-----',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----mock-----END PRIVATE KEY-----',
        expectedFingerprintSha256: 'ff'.repeat(32),
      },
    },
    status: 'PENDING',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    version: 1,
  };
}

class StubExecutor implements Executor {
  readonly calls: StepExecutionInput[] = [];

  constructor(readonly type: string, private readonly handler: (input: StepExecutionInput) => StepExecutionResult) {}

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    this.calls.push(input);
    return this.handler(input);
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

describe('WorkflowExecutorAdapter', () => {
  it('dry-run 只渲染工作流计划，不分发子执行器', async () => {
    const { workflows, versionId } = await createPublishedWorkflow();
    const curlExecutor = new StubExecutor('CURL', () => ({ success: true }));
    const sshExecutor = new StubExecutor('SSH', () => ({ success: true }));
    const adapter = new WorkflowExecutorAdapter({ workflows, curlExecutor: curlExecutor as never, sshExecutor: sshExecutor as never });

    const result = await adapter.executeStep({ step: workflowStep(versionId), runType: 'dry_run', dryRun: true });

    assert.equal(result.success, true);
    assert.equal(result.detail?.mode, 'workflow_plan');
    assert.equal(curlExecutor.calls.length, 0);
    assert.equal(sshExecutor.calls.length, 0);
  });

  it('apply 通过工作流运行时按 HTTP 和 SSH 节点分发真实执行器', async () => {
    const { workflows, versionId } = await createPublishedWorkflow();
    const timeline: string[] = [];
    const curlExecutor = new StubExecutor('CURL', (input) => {
      const curlRequest = readRecord(input.step.inputSnapshot.curlRequest);
      const template = readRecord(curlRequest.template);
      timeline.push(`curl:${template.method}`);
      return {
        success: true,
        detail: {
          response: {
            statusCode: 200,
            headers: {},
            bodyJson: { fingerprint: 'ff'.repeat(32) },
            bodyText: JSON.stringify({ fingerprint: 'ff'.repeat(32) }),
          },
        },
      };
    });
    const sshExecutor = new StubExecutor('SSH', (input) => {
      const sshRequest = readRecord(input.step.inputSnapshot.sshRequest);
      timeline.push(`ssh:${sshRequest.command}`);
      return { success: true, detail: { commandResult: { exitCode: 0, stdout: 'reload ok' } } };
    });
    const adapter = new WorkflowExecutorAdapter({ workflows, curlExecutor: curlExecutor as never, sshExecutor: sshExecutor as never });

    const result = await adapter.executeStep({ step: workflowStep(versionId), runType: 'apply', dryRun: false });

    assert.equal(result.success, true);
    assert.deepEqual(timeline, [`curl:PUT`, `ssh:reload cert ${'ff'.repeat(32)}`]);
    assert.equal(result.detail?.mode, 'workflow_runner');
    const workflowRun = result.detail?.workflowRun as { status?: string; plannedOnly?: boolean; renderedSteps?: Array<{ request?: Record<string, unknown> }> };
    assert.equal(workflowRun.status, 'success');
    assert.equal(workflowRun.plannedOnly, false);
    assert.equal(workflowRun.renderedSteps?.[1]?.request?.dryRun, false);
    assert.equal(workflowRun.renderedSteps?.[1]?.request?.realSsh, true);
  });

  it('缺少 workflowVersionId 时拒绝伪成功', async () => {
    const adapter = new WorkflowExecutorAdapter({ workflows: new WorkflowTemplatesApplicationService() });

    const result = await adapter.executeStep({ step: workflowStep(), runType: 'apply', dryRun: false });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'WORKFLOW_VERSION_REQUIRED');
  });

  it('引用不存在的工作流版本时返回资源不存在', async () => {
    const adapter = new WorkflowExecutorAdapter({ workflows: new WorkflowTemplatesApplicationService() });

    const result = await adapter.executeStep({ step: workflowStep('wftplv_missing'), runType: 'apply', dryRun: false });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'RESOURCE_NOT_FOUND');
  });
});

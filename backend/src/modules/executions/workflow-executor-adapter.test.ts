import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { CurlExecutor } from '../executors/curl/curl.executor.js';
import type { CurlHttpClientRequest } from '../executors/curl/curl.http-client.js';
import { CookieSessionStore } from '../executors/curl/cookie-session.js';
import { ExecutionGrantService } from './execution-grant.service.js';
import { WorkflowTemplatesApplicationService } from '../workflow-templates/application/workflow-templates.application-service.js';
import type { WorkflowDslV1 } from '../workflow-templates/dto/workflow-templates.dto.js';
import type { JsonSchema } from '../../common/validation/json-schema.js';
import { canonicalize } from '../../shared/canonical-json.js';
import { createDefaultExecutorRegistry, createDefaultExecutorRegistryWithDependencies, WorkflowExecutorAdapter, type Executor, type StepExecutionInput, type StepExecutionResult } from './application/executors.js';
import type { PluginActionBindingV1, PluginActionExecutionResult } from './application/plugin-runner-executor.adapter.js';
import type { ExecutionStepEntity } from './schema/executions.schema.js';
import type { ResolvedDeploymentInputV1 } from '../deployment-inputs/dto/resolved-deployment-input.dto.js';
import type { DeploymentInputContractV1 } from '../deployment-inputs/dto/deployment-input-contract.dto.js';

function workflowInputContract(): DeploymentInputContractV1 {
  const requiredField = (type: 'string' | 'number') => ({
    type, required: true, configurationMode: 'required' as const, source: { kind: 'binding' as const },
    lifecycle: 'pre_execution' as const, bindingPolicy: 'required_binding' as const,
  });
  return {
    apiVersion: 'gcac.deployment-input/v1',
    variables: {
      deviceHost: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
    },
    connections: {
      management: { transport: 'http', host: requiredField('string'), port: requiredField('number') },
      targetSsh: { transport: 'ssh', host: requiredField('string'), port: requiredField('number'), username: requiredField('string'), credentialSlot: 'credential', hostKey: { policy: 'strict' } },
    },
    credentials: {
      credential: { allowedKinds: ['USERNAME_PASSWORD', 'SSH_KEY'], required: true, configurationMode: 'required', lifecycle: 'pre_execution' },
    },
    artifacts: {
      cert: certificateArtifact({ pem: 'public_certificate', privateKey: 'private_key' }),
      certificate: certificateArtifact({ pem: 'public_certificate' }),
      serverCert: certificateArtifact({ certFile: 'public_certificate', keyFile: 'private_key' }),
    },
  };
}

function certificateArtifact(outputs: Record<string, string>): DeploymentInputContractV1['artifacts'][string] {
  return {
    kind: 'certificate', required: true, configurationMode: 'required', lifecycle: 'pre_execution',
    artifactContract: {
      outputs: Object.fromEntries(Object.entries(outputs).map(([name, role]) => [name, { role, required: true, sensitive: role === 'private_key' }])),
    },
  };
}

function workflowFixture(): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'workflow-executor-adapter-test', version: '1.0.0' },
    inputContract: workflowInputContract(),
    steps: [
      {
        name: 'uploadCert',
        type: 'http',
        request: {
          method: 'PUT',
          connectionRef: 'management',
          url: 'https://{{variables.deviceHost}}/api/cert',
          body: { cert: '{{artifacts.cert.outputs.pem}}' },
        },
        extract: { remoteFingerprint: { type: 'jsonPath', path: '$.fingerprint' } },
        assert: [{ type: 'statusCode', equals: 200 }],
      },
      {
        name: 'reloadService',
        type: 'ssh',
        ssh: {
          connectionRef: 'targetSsh',
          program: 'systemctl',
          args: ['nginx'],
          argumentTemplate: 'systemctl.reload',
        },
        assert: [{ type: 'contains', value: 'ok' }],
      },
    ],
  };
}

function sensitiveHttpChainWorkflowFixture(): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'workflow-sensitive-http-chain-test' },
    inputContract: workflowInputContract(),
    steps: [
      {
        name: 'login',
        type: 'http',
        request: {
          method: 'POST',
          connectionRef: 'management',
          url: 'https://{{variables.deviceHost}}/login',
        },
        extract: [{ name: 'sessionToken', type: 'jsonPath', path: '$.data.synotoken', sensitive: true }],
        assert: [{ type: 'contains', value: '"success":true' }],
      },
      {
        name: 'listCertificates',
        type: 'http',
        request: {
          method: 'GET',
          connectionRef: 'management',
          url: 'https://{{variables.deviceHost}}/certificates',
          query: { SynoToken: '{{steps.login.extracted.sessionToken}}' },
          headers: { 'X-SYNO-TOKEN': '{{steps.login.extracted.sessionToken}}' },
        },
        extract: [{ name: 'certificates', type: 'jsonPath', path: '$.data.certificates' }],
        assert: [{ type: 'contains', value: '"success":true' }],
      },
    ],
  };
}

function fileTransferWorkflowFixture(): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'workflow-file-transfer-adapter-test' },
    inputContract: workflowInputContract(),
    steps: [
      {
        name: 'uploadCert',
        type: 'sftp',
        stage: 'install',
        sftp: {
          direction: 'upload',
          connectionRef: 'targetSsh',
          remotePath: '/etc/gcac-test/certs/test.crt',
          contentRef: '{{artifacts.cert.outputs.pem}}',
          mode: '0644',
          timeoutSeconds: 30,
        },
        extract: [{ name: 'certHash', type: 'jsonPath', path: '$.transferResults[0].hash' }],
      },
      {
        name: 'uploadKey',
        type: 'scp',
        stage: 'install',
        scp: {
          direction: 'upload',
          connectionRef: 'targetSsh',
          remotePath: '/etc/gcac-test/certs/test.key',
          contentRef: '{{artifacts.cert.outputs.privateKey}}',
          mode: '0600',
          timeoutSeconds: 30,
        },
      },
    ],
  };
}

function checkpointWorkflowFixture(): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'workflow-checkpoint-dry-run-test', version: '1.0.0' },
    inputContract: workflowInputContract(),
    steps: [{
      name: 'deploymentCheckpoint',
      type: 'checkpoint',
      stage: 'backup',
      checkpoint: {
        name: 'before-certificate-deployment',
        capture: { deviceHost: 'variables.deviceHost' },
        normalizedHash: true,
        requiredForRollback: true,
      },
    }],
  };
}

function synologyInsecureTlsWorkflowFixture(): WorkflowDslV1 {
  const inputContract = workflowInputContract();
  inputContract.variables.allowInsecureTls = {
    type: 'boolean',
    required: true,
    configurationMode: 'required',
    source: { kind: 'binding' },
    lifecycle: 'pre_execution',
    bindingPolicy: 'required_binding',
  };
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'synology-dsm-cert-import-security-test', version: '1.2.4' },
    inputContract,
    steps: [{
      name: 'synology_login',
      type: 'http',
      request: {
        method: 'GET',
        connectionRef: 'management',
        url: 'https://{{variables.deviceHost}}/webapi/entry.cgi',
        tls: { verify: false },
      },
    }],
  };
}

function certificateAliasWorkflowFixture(): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'workflow-certificate-alias-test' },
    inputContract: workflowInputContract(),
    steps: [
      {
        name: 'uploadCert',
        type: 'sftp',
        stage: 'install',
        sftp: {
          direction: 'upload',
          connectionRef: 'targetSsh',
          remotePath: '/etc/gcac-test/certs/test.crt',
          contentRef: '{{artifacts.certificate.outputs.pem}}',
          mode: '0644',
          timeoutSeconds: 30,
        },
      },
    ],
  };
}

function certificateOutputsWorkflowFixture(): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'workflow-certificate-outputs-test' },
    inputContract: workflowInputContract(),
    steps: [
      {
        name: 'uploadCert',
        type: 'sftp',
        stage: 'install',
        sftp: {
          direction: 'upload',
          connectionRef: 'targetSsh',
          remotePath: '/etc/gcac-test/certs/server.crt',
          contentRef: '{{artifacts.serverCert.outputs.certFile.content}}',
          mode: '0644',
          timeoutSeconds: 30,
        },
      },
      {
        name: 'uploadKey',
        type: 'scp',
        stage: 'install',
        scp: {
          direction: 'upload',
          connectionRef: 'targetSsh',
          remotePath: '/etc/gcac-test/certs/server.key',
          contentRef: '{{artifacts.serverCert.outputs.keyFile.content}}',
          mode: '0600',
          timeoutSeconds: 30,
        },
      },
    ],
  };
}

function pluginActionWorkflowFixture(inputSchemaSha256: string, outputSchemaSha256: string): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'workflow-plugin-action-chain-test', version: '1.0.0' },
    inputContract: workflowInputContract(),
    steps: [
      {
        name: 'signRequest',
        type: 'plugin.action',
        stage: 'install',
        pluginId: 'cloud.example',
        capability: 'certificate.sign',
        actionId: 'certificate.sign.v1',
        actionContractVersion: 'v1',
        input: { payload: 'hello' },
        inputSchemaSha256,
        outputSchemaSha256,
        timeoutSeconds: 30,
        writeEffect: false,
        idempotencyKeyRef: '{{variables.deviceHost}}',
        extract: { signature: { type: 'jsonPath', path: '$.signature' } },
      },
      {
        name: 'buildSignedRequest',
        type: 'transform',
        stage: 'verify',
        transform: {
          engine: 'jsonata',
          input: { signature: '{{steps.signRequest.extracted.signature}}' },
          outputs: { request: { expression: "{'signature': signature}" } },
        },
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

async function createPublishedSensitiveHttpChainWorkflow(): Promise<{ workflows: WorkflowTemplatesApplicationService; versionId: string }> {
  const workflows = new WorkflowTemplatesApplicationService();
  const created = await workflows.createTemplate({ content: sensitiveHttpChainWorkflowFixture(), changeSummary: 'sensitive-http-chain-test' });
  const published = await workflows.publishVersion(created.version.id);
  return { workflows, versionId: published.id };
}

async function createPublishedFileTransferWorkflow(): Promise<{ workflows: WorkflowTemplatesApplicationService; versionId: string }> {
  const workflows = new WorkflowTemplatesApplicationService();
  const created = await workflows.createTemplate({ content: fileTransferWorkflowFixture(), changeSummary: 'file-transfer-test' });
  const published = await workflows.publishVersion(created.version.id);
  return { workflows, versionId: published.id };
}

async function createPublishedCertificateAliasWorkflow(): Promise<{ workflows: WorkflowTemplatesApplicationService; versionId: string }> {
  const workflows = new WorkflowTemplatesApplicationService();
  const created = await workflows.createTemplate({ content: certificateAliasWorkflowFixture(), changeSummary: 'certificate-alias-test' });
  const published = await workflows.publishVersion(created.version.id);
  return { workflows, versionId: published.id };
}

async function createPublishedCertificateOutputsWorkflow(): Promise<{ workflows: WorkflowTemplatesApplicationService; versionId: string }> {
  const workflows = new WorkflowTemplatesApplicationService();
  const created = await workflows.createTemplate({ content: certificateOutputsWorkflowFixture(), changeSummary: 'certificate-outputs-test' });
  const published = await workflows.publishVersion(created.version.id);
  return { workflows, versionId: published.id };
}

async function createPublishedCheckpointWorkflow(): Promise<{ workflows: WorkflowTemplatesApplicationService; versionId: string }> {
  const workflows = new WorkflowTemplatesApplicationService();
  const created = await workflows.createTemplate({ content: checkpointWorkflowFixture(), changeSummary: 'checkpoint-dry-run-test' });
  const published = await workflows.publishVersion(created.version.id);
  return { workflows, versionId: published.id };
}

async function createPublishedSynologyInsecureTlsWorkflow(): Promise<{ workflows: WorkflowTemplatesApplicationService; versionId: string }> {
  const workflows = new WorkflowTemplatesApplicationService();
  const created = await workflows.createTemplate({ content: synologyInsecureTlsWorkflowFixture(), changeSummary: 'synology-tls-authorization-test' });
  const published = await workflows.publishVersion(created.version.id);
  return { workflows, versionId: published.id };
}

function resolvedDeploymentInput(): ResolvedDeploymentInputV1 {
  return {
    apiVersion: 'gcac.resolved-deployment-input/v1',
    contractVersion: 'gcac.deployment-input/v1',
    assetContext: {
      apiVersion: 'gcac.deployment-asset-context/v1',
      application: { id: 'asset_workflow_adapter', address: 'edge-01.example.com', serverName: 'edge-01.example.com', port: 443, protocol: 'https' },
      deployment: { targets: [], certificateResourceName: 'certificate-edge-01' },
    },
    variables: { deviceHost: 'edge-01.example.com' },
    connections: {
      management: { transport: 'http', host: 'edge-01.example.com', port: 443, tls: { verifyPeer: true } },
      targetSsh: { transport: 'ssh', host: 'edge-01.example.com', port: 22, username: 'admin', credentialSlot: 'credential', hostKey: { policy: 'strict', expectedFingerprint: 'aa:bb' } },
    },
    credentials: {
      credential: { credentialId: 'cred_device', kind: 'USERNAME_PASSWORD', username: 'admin', secretRefs: { password: 'secret://password/sec_device#current' } },
    },
    artifacts: {
      cert: { outputs: { pem: '-----BEGIN CERTIFICATE-----mock-----END CERTIFICATE-----', privateKey: '-----BEGIN PRIVATE KEY-----mock-----END PRIVATE KEY-----' } },
      certificate: { outputs: { pem: '-----BEGIN CERTIFICATE-----mock-----END CERTIFICATE-----' } },
    },
    provenance: {},
    sensitivePaths: ['credentials.credential', 'artifacts.cert.outputs.privateKey'],
    issues: [],
    executable: true,
    resolvedSha256: 'workflow-adapter-resolved-input',
  };
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
        ? { workflowVersionId: versionId }
        : {},
      resolvedDeploymentInput: resolvedDeploymentInput(),
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
  it('工作流失败后在 finally 清理当前运行的 CookieSession', async () => {
    const workflows = new WorkflowTemplatesApplicationService();
    const created = await workflows.createTemplate({
      content: {
        apiVersion: 'gcac.workflow/v1',
        kind: 'CurlSshWorkflow',
        metadata: { name: 'cookie-cleanup-test', version: '1.0.0' },
        inputContract: workflowInputContract(),
        steps: [{
          name: 'login',
          type: 'http',
          request: { method: 'GET', connectionRef: 'management', url: '/login', cookieSessionRef: 'waf' },
        }],
      },
      changeSummary: 'cookie-cleanup-test',
    });
    const published = await workflows.publishVersion(created.version.id);
    const store = new CookieSessionStore();
    const curlExecutor = new CurlExecutor({
      cookieSessionStore: store,
      httpClient: {
        async send(_request) {
          return { statusCode: 401, setCookie: ['sid=must-clear; Path=/'], body: { ok: false } };
        },
      },
    });
    const executionGrants = {
      create: async () => ({ id: 'grant-cookie-cleanup' }),
      validate: async () => undefined,
      revoke: async () => undefined,
    } as unknown as ExecutionGrantService;
    const adapter = new WorkflowExecutorAdapter({ workflows, curlExecutor, executionGrants });
    const result = await adapter.executeStep({ step: workflowStep(published.id), runType: 'apply', dryRun: false });
    assert.equal(result.success, false);
    assert.equal(store.size(), 0);
  });

  it('TLS 例外 Grant 不依赖 approved 状态，仍绑定当前工作流步骤', async () => {
    const grants = new ExecutionGrantService();
    const grantInputs: Array<Record<string, unknown>> = [];
    const createGrant = grants.create.bind(grants);
    grants.create = async (input) => {
      grantInputs.push(input as unknown as Record<string, unknown>);
      return createGrant(input);
    };
    let networkCalls = 0;
    const curlExecutor = new CurlExecutor({
      executionGrantService: grants,
      httpClient: {
        async send(request) {
          networkCalls += 1;
          assert.equal(request.tls?.verify, false);
          return { statusCode: 200, body: { ok: true } };
        },
      },
    });
    const adapter = new WorkflowExecutorAdapter({ curlExecutor, executionGrants: grants });
    const step = workflowStep('workflow-tls-grant');
    step.inputSnapshot.executionAuthorization = {
      tenantId: 'tenant_1',
      planId: 'plan_tls',
      targetId: 'target_1',
      workflowVersionId: 'workflow-tls-grant',
      approvalId: 'stale-approval-must-not-flow',
      approved: false,
      allowInsecureTls: true,
    };
    const dispatch = adapter as unknown as {
      dispatchWorkflowStep(input: StepExecutionInput, plan: unknown, stepName: string, attempt: number): Promise<{ success: boolean; errorCode?: string }>;
    };

    const result = await dispatch.dispatchWorkflowStep({ step, runType: 'apply', dryRun: false }, {
      executor: '017.CURL_HTTP',
      curlRequest: {
        template: {
          method: 'GET',
          url: 'https://example.test/health',
          tls: { verify: false, allowInsecure: true },
        },
        responsePolicy: { successStatusCodes: [200] },
      },
    }, 'readSystem', 1);

    assert.equal(result.success, true);
    assert.equal(result.errorCode, undefined);
    assert.equal(networkCalls, 1);
    assert.equal(grantInputs.length, 1);
    assert.equal(grantInputs[0]?.approvalId, undefined, 'TLS 工作流 Grant 不得携带审批号');
  });

  it('DSL 执行到 plugin.action 后将结构化输出交回后续 DSL transform', async () => {
    const inputSchema: JsonSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['payload'],
      properties: { payload: { type: 'string' } },
    };
    const outputSchema: JsonSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['signature'],
      properties: { signature: { type: 'string' } },
    };
    const schemaHash = (schema: JsonSchema) => `sha256:${createHash('sha256').update(canonicalize(schema), 'utf8').digest('hex')}`;
    const inputSchemaSha256 = schemaHash(inputSchema);
    const outputSchemaSha256 = schemaHash(outputSchema);
    const workflows = new WorkflowTemplatesApplicationService();
    const created = await workflows.createTemplate({ content: pluginActionWorkflowFixture(inputSchemaSha256, outputSchemaSha256), changeSummary: 'plugin-action-chain-test' });
    const version = await workflows.publishVersion(created.version.id);
    const binding: PluginActionBindingV1 = {
      apiVersion: 'gcac.plugin-action-binding/v1',
      tenantId: 'tenant_1',
      workflowVersionId: version.id,
      workflowStepName: 'signRequest',
      pluginVersionId: 'plugin-version-cloud-example',
      pluginId: 'cloud.example',
      pluginVersion: '1.0.0',
      capability: 'certificate.sign',
      actionId: 'certificate.sign.v1',
      actionContractVersion: 'v1',
      inputSchema,
      outputSchema,
      inputSchemaSha256,
      outputSchemaSha256,
      packageHash: `sha256:${'a'.repeat(64)}`,
      manifestHash: `sha256:${'b'.repeat(64)}`,
      resourceHash: `sha256:${'c'.repeat(64)}`,
      planDigest: 'd'.repeat(64),
      writeEffect: false,
      hostPermissions: [],
    };
    let actionInput: Record<string, unknown> | undefined;
    const actionResult: PluginActionExecutionResult = {
      success: true,
      status: 'SUCCESS',
      output: { signature: 'signed-by-runner' },
      detail: {},
    };
    const pluginActionExecutor = {
      executeAction: async (input: { binding: PluginActionBindingV1; input: Record<string, unknown> }) => {
        actionInput = structuredClone(input.input);
        assert.equal(input.binding.workflowStepName, 'signRequest');
        return actionResult;
      },
    };
    const grants = {
      create: async () => ({ id: 'grant-plugin-action' }),
      revoke: async () => undefined,
    };
    const adapter = new WorkflowExecutorAdapter({
      workflows,
      executionGrants: grants as never,
      pluginActionExecutor: pluginActionExecutor as never,
    });
    const step = workflowStep(version.id);
    step.inputSnapshot.workflowRequest = {
      workflowVersionId: version.id,
      pluginActionBindings: { signRequest: binding },
    };

    const result = await adapter.executeStep({ step, runType: 'apply', dryRun: false });

    assert.equal(result.success, true);
    assert.deepEqual(actionInput, { payload: 'hello' });
    const workflowRun = result.detail?.workflowRun as { stepResults: Array<{ name: string; extracted?: Record<string, unknown> }> };
    assert.equal(workflowRun.stepResults.find((item) => item.name === 'signRequest')?.extracted?.signature, 'signed-by-runner');
    assert.deepEqual(workflowRun.stepResults.find((item) => item.name === 'buildSignedRequest')?.extracted?.request, { signature: 'signed-by-runner' });
  });

  it('dry-run 执行工作流结构与安全校验，但不执行 SSH 或真实网络', async () => {
    const { workflows, versionId } = await createPublishedWorkflow();
    const curlExecutor = new StubExecutor('CURL', () => ({ success: true }));
    const sshExecutor = new StubExecutor('SSH', () => ({ success: true }));
    const adapter = new WorkflowExecutorAdapter({ workflows, curlExecutor: curlExecutor as never, sshExecutor: sshExecutor as never });
    const progressDetails: Record<string, unknown>[] = [];
    const step = workflowStep(versionId);
    step.inputSnapshot.workflowRequest = {
      workflowVersionId: versionId,
      pluginId: 'builtin.workflow.apache-8444-cert-switch',
      pluginVersion: '1.2.6',
      pluginVersionId: 'uplgv_apache_1_2_6',
    };

    const result = await adapter.executeStep({
      step,
      runType: 'dry_run',
      dryRun: true,
      reportProgress: async (detail) => {
        progressDetails.push(detail);
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.detail?.mode, 'workflow_plan');
    assert.equal(curlExecutor.calls.length > 0, true);
    assert.equal(curlExecutor.calls.every((call) => call.dryRun), true);
    assert.equal(sshExecutor.calls.length > 0, true);
    assert.equal(sshExecutor.calls.every((call) => call.dryRun), true);
    assert.equal(progressDetails.length > 2, true);
    assert.equal(progressDetails.every((detail) => detail.mode === 'workflow_plan'), true);
    const progressSnapshots = progressDetails.map((detail) => detail.workflowProgress as {
      status: string;
      steps: Array<{ status: string }>;
    });
    assert.equal(progressSnapshots.some((progress) => progress.steps.some((step) => step.status === 'running')), true);
    assert.equal(progressSnapshots.at(-1)?.status, 'success');
    const dryRunChecks = result.detail?.dryRunChecks as Array<{ detail?: string }>;
    assert.equal(dryRunChecks.length > 0, true);
    assert.equal(dryRunChecks.some((check) => /响应策略包含|SSH 执行计划已解析/.test(check.detail ?? '')), true);
    const workflowIdentity = readRecord(result.detail?.workflowIdentity);
    assert.equal(workflowIdentity.pluginId, 'builtin.workflow.apache-8444-cert-switch');
    assert.equal(workflowIdentity.pluginVersion, '1.2.6');
    assert.equal(workflowIdentity.pluginVersionId, 'uplgv_apache_1_2_6');
    assert.equal(workflowIdentity.workflowVersionId, versionId);
    assert.equal(workflowIdentity.workflowVersion, 1);
    assert.equal(workflowIdentity.workflowName, 'workflow-executor-adapter-test');
    assert.equal(workflowIdentity.workflowDslVersion, '1.0.0');
    assert.equal(typeof workflowIdentity.workflowTemplateId, 'string');
  });

  it('Standalone 历史工作流计划可从应用资产上下文取得资源锁', async () => {
    const { workflows, versionId } = await createPublishedWorkflow();
    let resourceKey: string | undefined;
    const resourceLocks = {
      acquire: async (input: { resourceKey: string }) => {
        resourceKey = input.resourceKey;
        return {
          id: 'lock_standalone_test',
          tenantId: 'tenant_1',
          resourceKey: input.resourceKey,
          mode: 'WRITE',
          ownerRunId: 'run_workflow',
          ownerStepId: 'step_workflow',
          fencingToken: 1,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        } as never;
      },
      release: async () => undefined,
    };
    const recovery = {
      begin: async () => ({ id: 'ledger_standalone_test', tenantId: 'tenant_1' } as never),
      markStepCompleted: async () => undefined,
      finish: async () => undefined,
    };
    const curlExecutor = new StubExecutor('CURL', () => ({
      success: true,
      detail: { response: { statusCode: 200, bodyJson: { fingerprint: 'test-fingerprint' } } },
    }));
    const sshExecutor = new StubExecutor('SSH', () => ({ success: true, detail: { stdout: 'ok' } }));
    const adapter = new WorkflowExecutorAdapter({
      workflows,
      curlExecutor: curlExecutor as never,
      sshExecutor: sshExecutor as never,
      resourceLocks: resourceLocks as never,
      recovery: recovery as never,
    });
    const step = workflowStep(versionId);
    // 模拟旧部署计划：没有 standaloneStableKey，但仍保留统一部署输入快照。
    step.inputSnapshot.workflowRequest = {
      workflowVersionId: versionId,
      pluginVersionId: 'uplgv_legacy_standalone',
      capabilityKey: 'certificate.deploy',
    };

    const result = await adapter.executeStep({ step, runType: 'apply', dryRun: false });

    assert.equal(result.success, true);
    assert.equal(resourceKey, 'tenant:tenant_1:standalone:asset_workflow_adapter');
  });

  it('dry-run 校验 checkpoint 计划但不要求或写入正式恢复账本', async () => {
    const { workflows, versionId } = await createPublishedCheckpointWorkflow();
    const adapter = new WorkflowExecutorAdapter({ workflows });
    const step = workflowStep(versionId);
    step.inputSnapshot.workflowRequest = {
      workflowVersionId: versionId,
      pluginVersionId: 'uplgv_checkpoint_test',
      capabilityKey: 'certificate.deploy',
    };

    const result = await adapter.executeStep({ step, runType: 'dry_run', dryRun: true });

    assert.equal(result.success, true);
    const workflowRun = result.detail?.workflowRun as {
      status?: string;
      plannedOnly?: boolean;
      stepResults?: Array<{ plan?: Record<string, unknown>; logs?: string[] }>;
    };
    assert.equal(workflowRun.status, 'success');
    assert.equal(workflowRun.plannedOnly, true);
    assert.match(String(workflowRun.stepResults?.[0]?.plan?.captureHash), /^[a-f0-9]{64}$/);
    assert.ok(workflowRun.stepResults?.[0]?.logs?.includes('workflow:checkpoint:before-certificate-deployment:validated'));
  });

  it('dry-run 接受依赖运行时输出的延迟 checkpoint 且不伪造哈希', async () => {
    const adapter = new WorkflowExecutorAdapter();
    const dispatch = adapter as unknown as {
      dispatchWorkflowStep(
        input: StepExecutionInput,
        renderedPlan: unknown,
        workflowStepName: string,
        attempt: number,
      ): Promise<{ success: boolean; body?: unknown; logs?: string[]; errorCode?: string }>;
    };
    const plan = {
      executor: 'workflow.checkpoint',
      checkpointName: 'citrix-adc-certificate-deployment',
      deferredCapturePaths: {
        snapshot: 'steps.buildDeploymentSnapshot.extracted.deploymentSnapshot',
      },
      deferred: true,
      plannedOnly: true,
      requiredForRollback: true,
    };
    const step = workflowStep();

    const dryRun = await dispatch.dispatchWorkflowStep(
      { step, runType: 'dry_run', dryRun: true },
      plan,
      'deploymentCheckpoint',
      1,
    );
    const apply = await dispatch.dispatchWorkflowStep(
      { step, runType: 'apply', dryRun: false },
      plan,
      'deploymentCheckpoint',
      1,
    );

    assert.equal(dryRun.success, true);
    assert.ok(dryRun.logs?.includes('workflow:checkpoint:citrix-adc-certificate-deployment:validated:deferred'));
    assert.equal(apply.success, false);
    assert.equal(apply.errorCode, 'WORKFLOW_CHECKPOINT_INVALID');
  });

  it('Synology 工作流 dry-run 和正式执行都拒绝 DSL-only 的自签名 TLS 请求', async () => {
    const { workflows, versionId } = await createPublishedSynologyInsecureTlsWorkflow();
    const grants = new ExecutionGrantService();
    const curlExecutor = new CurlExecutor({
      executionGrantService: grants,
      httpClient: { async send() { throw new Error('正式执行不应在授权失败前访问网络'); } },
    });
    const step = workflowStep(versionId);
    step.inputSnapshot.resolvedDeploymentInput = {
      ...resolvedDeploymentInput(),
      variables: { deviceHost: 'nas.example.com', allowInsecureTls: true },
    };
    step.inputSnapshot.executionAuthorization = {
      planId: 'plan_synology_tls',
      targetId: 'target_1',
      workflowVersionId: versionId,
      snapshotHash: 'snapshot_synology_tls',
      approved: false,
      allowInsecureTls: true,
    };

    // 没有把 ExecutionGrantService 交给宿主适配器，模拟仅靠 DSL/输入声明放行。
    const adapter = new WorkflowExecutorAdapter({ workflows, curlExecutor });
    const dryRun = await adapter.executeStep({ step, runType: 'dry_run', dryRun: true });
    assert.equal(dryRun.success, false);
    assert.equal(dryRun.errorCode, 'AUTH_FORBIDDEN');
    assert.match(dryRun.errorMessage ?? '', /ExecutionGrant/);

    const apply = await adapter.executeStep({ step, runType: 'apply', dryRun: false });
    assert.equal(apply.success, false);
    assert.equal(apply.errorCode, 'AUTH_FORBIDDEN');
    assert.match(apply.errorMessage ?? '', /ExecutionGrant/);
  });

  it('Synology 工作流仅绑定 allowInsecureTls 和 ExecutionGrant 即可正式执行自签名 TLS', async () => {
    const { workflows, versionId } = await createPublishedSynologyInsecureTlsWorkflow();
    const grants = new ExecutionGrantService();
    let networkCalls = 0;
    const curlExecutor = new CurlExecutor({
      executionGrantService: grants,
      httpClient: {
        async send(request) {
          networkCalls += 1;
          assert.ok(request.tls);
          assert.equal(request.tls.verify, false);
          return { statusCode: 200, body: { success: true } };
        },
      },
    });
    const step = workflowStep(versionId);
    step.inputSnapshot.resolvedDeploymentInput = {
      ...resolvedDeploymentInput(),
      variables: { deviceHost: 'nas.example.com', allowInsecureTls: true },
    };
    step.inputSnapshot.executionAuthorization = {
      tenantId: 'tenant_1',
      planId: 'plan_synology_tls',
      targetId: 'target_1',
      workflowVersionId: versionId,
      snapshotHash: 'snapshot_synology_tls',
      approved: false,
      allowInsecureTls: true,
    };

    const adapter = new WorkflowExecutorAdapter({ workflows, curlExecutor, executionGrants: grants });
    const result = await adapter.executeStep({ step, runType: 'apply', dryRun: false });
    assert.equal(result.success, true);
    assert.equal(networkCalls, 1);
  });

  it('Synology 已绑定 allowInsecureTls 后 dry-run 会签发预检 ExecutionGrant 且不访问真实网络', async () => {
    const { workflows, versionId } = await createPublishedSynologyInsecureTlsWorkflow();
    const grants = new ExecutionGrantService();
    const curlExecutor = new CurlExecutor({
      executionGrantService: grants,
      httpClient: { async send() { throw new Error('dry-run 不应访问真实网络'); } },
    });
    const step = workflowStep(versionId);
    step.inputSnapshot.resolvedDeploymentInput = {
      ...resolvedDeploymentInput(),
      variables: { deviceHost: 'nas.example.com', allowInsecureTls: true },
    };
    step.inputSnapshot.executionAuthorization = {
      tenantId: 'tenant_1',
      planId: 'plan_synology_tls',
      targetId: 'target_1',
      approvalId: 'approval_synology_tls',
      workflowVersionId: versionId,
      snapshotHash: 'snapshot_synology_tls',
      approved: true,
      allowInsecureTls: true,
    };

    const adapter = new WorkflowExecutorAdapter({ workflows, curlExecutor, executionGrants: grants });
    const result = await adapter.executeStep({ step, runType: 'dry_run', dryRun: true });

    assert.equal(result.success, true);
    const workflowRun = result.detail?.workflowRun as {
      status?: string;
      plannedOnly?: boolean;
      logs?: string[];
    };
    assert.equal(workflowRun.status, 'success');
    assert.equal(workflowRun.plannedOnly, true);
    assert.ok(workflowRun.logs?.includes('curl:preflight:validated'));
  });

  it('生产默认执行器注册表注册原生 WORKFLOW DSL 适配器', () => {
    const registry = createDefaultExecutorRegistry();

    assert.equal(registry.get('WORKFLOW') instanceof WorkflowExecutorAdapter, true);
  });

  it('生产默认执行器注册表会把宿主 ExecutionGrantService 传递给 Synology dry-run', async () => {
    const { workflows, versionId } = await createPublishedSynologyInsecureTlsWorkflow();
    const grants = new ExecutionGrantService();
    const registry = createDefaultExecutorRegistryWithDependencies({
      workflows,
      executionGrants: grants,
    });
    const step = workflowStep(versionId);
    step.inputSnapshot.resolvedDeploymentInput = {
      ...resolvedDeploymentInput(),
      variables: { deviceHost: 'nas.example.com', allowInsecureTls: true },
    };
    step.inputSnapshot.executionAuthorization = {
      tenantId: 'tenant_1',
      planId: 'plan_synology_tls',
      targetId: 'target_1',
      workflowVersionId: versionId,
      snapshotHash: 'snapshot_synology_tls',
      approved: false,
      allowInsecureTls: true,
    };

    const workflowExecutor = registry.get('WORKFLOW');
    assert.equal(workflowExecutor instanceof WorkflowExecutorAdapter, true);
    const result = await workflowExecutor.executeStep({ step, runType: 'dry_run', dryRun: true });
    assert.equal(result.success, true);
    assert.equal((result.detail?.workflowRun as { status?: string }).status, 'success');
  });

  it('apply 在 HTTP 节点之间传递真实敏感变量，但结果中只保留脱敏值', async () => {
    const { workflows, versionId } = await createPublishedSensitiveHttpChainWorkflow();
    const runtimeToken = 'synology-runtime-token-value';
    const requests: CurlHttpClientRequest[] = [];
    const curlExecutor = new CurlExecutor({
      httpClient: {
        async send(request) {
          requests.push(request);
          if (requests.length === 1) {
            return { statusCode: 200, body: { success: true, data: { synotoken: runtimeToken } } };
          }
          return { statusCode: 200, body: { success: true, data: { certificates: [] } } };
        },
      },
    });
    const adapter = new WorkflowExecutorAdapter({ workflows, curlExecutor });
    const progressDetails: Record<string, unknown>[] = [];

    const result = await adapter.executeStep({
      step: workflowStep(versionId),
      runType: 'apply',
      dryRun: false,
      reportProgress: async (detail) => {
        progressDetails.push(detail);
      },
    });

    assert.equal(result.success, true);
    assert.equal(requests.length, 2);
    assert.equal(new URL(requests[1]!.url).searchParams.get('SynoToken'), runtimeToken);
    assert.equal(requests[1]!.headers['X-SYNO-TOKEN'], runtimeToken);
    assert.doesNotMatch(JSON.stringify(result.detail), new RegExp(runtimeToken));
    assert.equal(progressDetails.length, 6);
    assert.equal(progressDetails.every((detail) => detail.mode === 'workflow_runner'), true);
    const progressSnapshots = progressDetails.map((detail) => detail.workflowProgress as {
      status: string;
      steps: Array<{ status: string }>;
    });
    assert.deepEqual(progressSnapshots[1]!.steps.map((step) => step.status), ['running', 'queued']);
    assert.deepEqual(progressSnapshots[3]!.steps.map((step) => step.status), ['success', 'running']);
    assert.equal(progressSnapshots.at(-1)?.status, 'success');
    assert.doesNotMatch(JSON.stringify(progressDetails), new RegExp(runtimeToken));
    const workflowRun = result.detail?.workflowRun as { stepResults?: Array<{ extracted?: Record<string, unknown> }> };
    assert.deepEqual(workflowRun.stepResults?.[0]?.extracted, { sessionToken: '[REDACTED]' });
  });

  it('HTTP 业务断言失败时保留策略错误，不被必需 extractor 覆盖', async () => {
    const { workflows, versionId } = await createPublishedSensitiveHttpChainWorkflow();
    const curlExecutor = new CurlExecutor({
      httpClient: {
        async send(request) {
          if (new URL(request.url).pathname === '/login') {
            return { statusCode: 200, body: { success: true, data: { synotoken: 'runtime-token' } } };
          }
          return { statusCode: 200, headers: { 'x-request-error': 'unauth' }, body: { success: false, error: { code: 119 } } };
        },
      },
    });
    const adapter = new WorkflowExecutorAdapter({ workflows, curlExecutor });

    const result = await adapter.executeStep({ step: workflowStep(versionId), runType: 'apply', dryRun: false });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'HTTP_NON_SUCCESS_STATUS');
    assert.match(result.errorMessage ?? '', /listCertificates/);
    assert.doesNotMatch(result.errorMessage ?? '', /提取变量失败|extractor/);
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
      timeline.push(`ssh:${sshRequest.argumentTemplate}:${(sshRequest.args as string[]).join(' ')}`);
      return {
        success: true,
        detail: {
          exitCode: 0,
          stdout: 'reload ok',
          logs: ['ssh:reload'],
          commandResult: { exitCode: 99, stdout: 'legacy command result' },
          command: 'legacy command',
        },
      };
    });
    const adapter = new WorkflowExecutorAdapter({ workflows, curlExecutor: curlExecutor as never, sshExecutor: sshExecutor as never });

    const result = await adapter.executeStep({ step: workflowStep(versionId), runType: 'apply', dryRun: false });

    assert.equal(result.success, true, JSON.stringify(result));
    assert.deepEqual(timeline, [`curl:PUT`, `ssh:systemctl.reload:nginx`]);
    assert.equal(result.detail?.mode, 'workflow_runner');
    const workflowRun = result.detail?.workflowRun as { status?: string; plannedOnly?: boolean; renderedSteps?: Array<{ request?: Record<string, unknown> }> };
    assert.equal(workflowRun.status, 'success');
    assert.equal(workflowRun.plannedOnly, false);
    assert.equal(workflowRun.renderedSteps?.[1]?.request?.dryRun, false);
    assert.equal(workflowRun.renderedSteps?.[1]?.request?.realSsh, true);
    assert.equal(JSON.stringify(result.detail).includes('commandResult'), false);
    assert.equal(JSON.stringify(result.detail).includes('legacy command'), false);
  });

  it('apply workflow returns child executor failure detail', async () => {
    const { workflows, versionId } = await createPublishedWorkflow();
    const curlExecutor = new StubExecutor('CURL', () => ({
      success: true,
      detail: {
        response: {
          statusCode: 200,
          headers: {},
          bodyJson: { fingerprint: 'ff'.repeat(32) },
          bodyText: JSON.stringify({ fingerprint: 'ff'.repeat(32) }),
        },
      },
    }));
    const sshExecutor = new StubExecutor('SSH', () => ({
      success: false,
      errorCode: 'SSH_AUTH_FAILED',
      errorMessage: 'SSH 认证失败',
    }));
    const adapter = new WorkflowExecutorAdapter({ workflows, curlExecutor: curlExecutor as never, sshExecutor: sshExecutor as never });

    const result = await adapter.executeStep({ step: workflowStep(versionId), runType: 'apply', dryRun: false });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'SSH_AUTH_FAILED');
    assert.match(result.errorMessage ?? '', /工作流节点 reloadService 失败：SSH 认证失败/);
    assert.equal((result.detail?.failure as { stepName?: string } | undefined)?.stepName, 'reloadService');
    assert.equal((result.detail?.workflowRun as { status?: string } | undefined)?.status, 'failed');
  });

  it('apply 通过正式 SFTP 和 SCP step 分发到 SSH 文件传输请求', async () => {
    const { workflows, versionId } = await createPublishedFileTransferWorkflow();
    const seenContents: string[] = [];
    const curlExecutor = new StubExecutor('CURL', () => ({ success: true }));
    const sshExecutor = new StubExecutor('SSH', (input) => {
      const sshRequest = readRecord(input.step.inputSnapshot.sshRequest);
      const sftp = Array.isArray(sshRequest.sftp) ? sshRequest.sftp.map(readRecord) : [];
      const scp = Array.isArray(sshRequest.scp) ? sshRequest.scp.map(readRecord) : [];
      for (const item of [...sftp, ...scp]) {
        if (typeof item.content === 'string') seenContents.push(item.content);
      }
      return {
        success: true,
        detail: {
          transferResults: [
            {
              protocol: sftp.length ? 'sftp' : 'scp',
              direction: 'upload',
              remotePath: (sftp[0] ?? scp[0])?.remotePath,
              hash: sftp.length ? 'a'.repeat(64) : 'b'.repeat(64),
            },
          ],
        },
      };
    });
    const adapter = new WorkflowExecutorAdapter({ workflows, curlExecutor: curlExecutor as never, sshExecutor: sshExecutor as never });

    const result = await adapter.executeStep({ step: workflowStep(versionId), runType: 'apply', dryRun: false });

    assert.equal(result.success, true);
    assert.equal(sshExecutor.calls.length, 2);
    assert.deepEqual(seenContents, [
      '-----BEGIN CERTIFICATE-----mock-----END CERTIFICATE-----',
      '-----BEGIN PRIVATE KEY-----mock-----END PRIVATE KEY-----',
    ]);

    const sftpRequest = readRecord(sshExecutor.calls[0]?.step.inputSnapshot.sshRequest);
    const scpRequest = readRecord(sshExecutor.calls[1]?.step.inputSnapshot.sshRequest);
    assert.equal(readRecord((sftpRequest.sftp as unknown[])[0]).remotePath, '/etc/gcac-test/certs/test.crt');
    assert.equal(readRecord((sftpRequest.sftp as unknown[])[0]).mode, '0644');
    assert.equal(readRecord((scpRequest.scp as unknown[])[0]).remotePath, '/etc/gcac-test/certs/test.key');
    assert.equal(readRecord((scpRequest.scp as unknown[])[0]).mode, '0600');

    const detailText = JSON.stringify(result.detail);
    assert.equal(detailText.includes('-----BEGIN PRIVATE KEY-----mock-----END PRIVATE KEY-----'), false);
    assert.equal(detailText.includes('-----BEGIN CERTIFICATE-----mock-----END CERTIFICATE-----'), false);
    assert.match(detailText, /\[REDACTED\]/);
  });

  it('缺少 workflowVersionId 时拒绝伪成功', async () => {
    const adapter = new WorkflowExecutorAdapter({ workflows: new WorkflowTemplatesApplicationService() });

    const result = await adapter.executeStep({ step: workflowStep(), runType: 'apply', dryRun: false });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'WORKFLOW_VERSION_REQUIRED');
  });

  it('apply maps deployment artifacts to the certificate workflow variable alias', async () => {
    const { workflows, versionId } = await createPublishedCertificateAliasWorkflow();
    const seenContents: string[] = [];
    const sshExecutor = new StubExecutor('SSH', (input) => {
      const sshRequest = readRecord(input.step.inputSnapshot.sshRequest);
      const sftp = Array.isArray(sshRequest.sftp) ? sshRequest.sftp.map(readRecord) : [];
      for (const item of sftp) {
        if (typeof item.content === 'string') seenContents.push(item.content);
      }
      return {
        success: true,
        detail: { transferResults: [{ protocol: 'sftp', direction: 'upload', hash: 'a'.repeat(64) }] },
      };
    });
    const adapter = new WorkflowExecutorAdapter({ workflows, sshExecutor: sshExecutor as never });

    const result = await adapter.executeStep({ step: workflowStep(versionId), runType: 'apply', dryRun: false });

    assert.equal(result.success, true);
    assert.deepEqual(seenContents, ['-----BEGIN CERTIFICATE-----mock-----END CERTIFICATE-----']);
  });

  it('apply maps workflow certificate output slots into file transfer content', async () => {
    const { workflows, versionId } = await createPublishedCertificateOutputsWorkflow();
    const seenContents: string[] = [];
    const sshExecutor = new StubExecutor('SSH', (input) => {
      const sshRequest = readRecord(input.step.inputSnapshot.sshRequest);
      const sftp = Array.isArray(sshRequest.sftp) ? sshRequest.sftp.map(readRecord) : [];
      const scp = Array.isArray(sshRequest.scp) ? sshRequest.scp.map(readRecord) : [];
      for (const item of [...sftp, ...scp]) {
        if (typeof item.content === 'string') seenContents.push(item.content);
      }
      return {
        success: true,
        detail: { transferResults: [{ protocol: sftp.length ? 'sftp' : 'scp', direction: 'upload', hash: 'a'.repeat(64) }] },
      };
    });
    const adapter = new WorkflowExecutorAdapter({ workflows, sshExecutor: sshExecutor as never });
    const step = workflowStep(versionId);
    const resolvedInput = step.inputSnapshot.resolvedDeploymentInput as ResolvedDeploymentInputV1;
    resolvedInput.artifacts.serverCert = {
      outputs: {
        certFile: { key: 'public', role: 'public_certificate', format: 'pem', content: '-----BEGIN CERTIFICATE-----slot-cert-----END CERTIFICATE-----', contentEncoding: 'utf8' },
        keyFile: { key: 'private', role: 'private_key', format: 'pem', content: '-----BEGIN PRIVATE KEY-----slot-key-----END PRIVATE KEY-----', contentEncoding: 'utf8' },
      },
    };
    resolvedInput.sensitivePaths.push('artifacts.serverCert.outputs.keyFile.content');

    const result = await adapter.executeStep({ step, runType: 'apply', dryRun: false });

    assert.equal(result.success, true);
    assert.deepEqual(seenContents, [
      '-----BEGIN CERTIFICATE-----slot-cert-----END CERTIFICATE-----',
      '-----BEGIN PRIVATE KEY-----slot-key-----END PRIVATE KEY-----',
    ]);
    const detailText = JSON.stringify(result.detail);
    assert.equal(detailText.includes('-----BEGIN PRIVATE KEY-----slot-key-----END PRIVATE KEY-----'), false);
    assert.equal(detailText.includes('-----BEGIN CERTIFICATE-----slot-cert-----END CERTIFICATE-----'), false);
    assert.match(detailText, /\[REDACTED\]/);
  });

  it('引用不存在的工作流版本时返回资源不存在', async () => {
    const adapter = new WorkflowExecutorAdapter({ workflows: new WorkflowTemplatesApplicationService() });

    const result = await adapter.executeStep({ step: workflowStep('wftplv_missing'), runType: 'apply', dryRun: false });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'RESOURCE_NOT_FOUND');
  });
});

// @ts-nocheck
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe as baseDescribe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgAssetsRepository } from '../assets/repository/assets.repository.js';
import { PgBindingsRepository } from '../bindings/repository/bindings.repository.js';
import { PgCertificatesRepository } from '../certificates/repository/certificates.repository.js';
import { CertificatesApplicationService } from '../certificates/application/certificates.application-service.js';
import { createSecurityServices } from '../security/security.controller.js';
import { DeploymentPlansApplicationService } from './application/deployment-plans.application-service.js';
import { DeploymentPlansController } from './controller/deployment-plans.controller.js';
import { GatewaysApplicationService } from '../gateways/application/gateways.application-service.js';
import { DeploymentPlansRepository } from './repository/deployment-plans.repository.js';
import type { CreateDeploymentPlanInput } from './dto/deployment-plans.dto.js';
import { AgentExecutorAdapter } from '../executions/application/executors.js';
import { ExecutionsApplicationService } from '../executions/application/executions.application-service.js';
import type { WorkflowDslV1 } from '../workflow-templates/dto/workflow-templates.dto.js';

const userHeaders = { 'x-actor-id': 'user_1', 'x-tenant-id': 'tenant_1', 'x-request-id': 'req_test' };
const approverHeaders = { 'x-actor-id': 'approver_1', 'x-tenant-id': 'tenant_1', 'x-request-id': 'req_approve' };
const describe = (name: string, fn: () => void) => baseDescribe(name, { concurrency: false }, fn);

type DeploymentFixture = {
  agentId: string;
  hostId: string;
  serviceInstanceId: string;
  certificateVersionId: string;
  certificateFormatId: string;
  certificateFingerprintSha256: string;
  target_1: { applicationAssetId: string; siteAssetId: string; managedTargetId: string; bindingId: string; bindingKey: string; domain: string };
  binding_ok: { applicationAssetId: string; siteAssetId: string; managedTargetId: string; bindingId: string; bindingKey: string; domain: string };
  binding_blocked: { applicationAssetId: string; siteAssetId: string; managedTargetId: string; bindingId: string; bindingKey: string; domain: string };
};

async function createMigratedTestApp(options: { security?: ReturnType<typeof createSecurityServices> } = {}) {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const security = options.security ?? createSecurityServices();
  grantDeploymentFixturePolicies(security, 'tenant_1');
  const app = createApp({ db, corePersistence: { mode: 'memory' }, security });
  const fixture = await seedDeploymentFixture(app, 'tenant_1');
  return {
    db,
    security,
    app,
    fixture,
  };
}

async function createMigratedDeploymentService(options: {
  security?: ReturnType<typeof createSecurityServices>;
  gateways?: GatewaysApplicationService;
} = {}) {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const security = options.security ?? createSecurityServices();
  const repository = new DeploymentPlansRepository(db);
  const assets = new PgAssetsRepository(db);
  const bindings = new PgBindingsRepository(assets, db);
  const certificates = new PgCertificatesRepository(db);
  const certificatesApp = new CertificatesApplicationService({ db, repository: certificates, secrets: security.secrets, audit: security.audit });
  grantDeploymentFixturePolicies(security, 'tenant_1');
  const executions = new ExecutionsApplicationService({
    repository: undefined,
    deploymentPlansRepository: repository,
    queueDb: db,
    audit: security.audit,
  });
  const service = new DeploymentPlansApplicationService({
    repository,
    executions,
    assets,
    bindings,
    certificates,
    certificatesApp,
    audit: security.audit,
    approval: security.approvals,
    gateways: options.gateways,
  });
  const app = createApp({ db, corePersistence: { mode: 'memory' }, security, deploymentPlans: new DeploymentPlansController(service) });
  const fixture = await seedDeploymentFixture(app, 'tenant_1');
  return { db, security, repository, assets, bindings, certificates, service, fixture };
}

function createPlanBody(
  fixture: DeploymentFixture,
  idempotencyKey = 'idem_plan_1',
  riskLevel: 'low' | 'high' = 'low',
): Omit<CreateDeploymentPlanInput, 'actorId' | 'tenantId'> {
  return {
    name: '更新 nginx 证书',
    certificateVersionId: fixture.certificateVersionId,
    certificateFormatId: fixture.certificateFormatId,
    idempotencyKey,
    policy: { riskLevel, approvalRequired: riskLevel === 'high', failurePolicy: 'rollback' },
    targets: [
      {
        certificateBindingId: fixture.target_1.bindingId,
        executionTargetId: fixture.target_1.managedTargetId,
        executorType: 'AGENT',
      },
    ],
  };
}

async function createReadyLowRiskPlan(app: ReturnType<typeof createApp>, fixture: DeploymentFixture, idempotencyKey = 'idem_plan_low') {
  const created = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body: createPlanBody(fixture, idempotencyKey, 'low') });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const plan = created.body as { id: string };
  const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: plan.id } });
  assert.equal(submitted.statusCode, 200);
  return submitted.body as { id: string; status: string };
}

async function createApprovedHighRiskPlan(app: ReturnType<typeof createApp>, fixture: DeploymentFixture, idempotencyKey = 'idem_plan_high') {
  const created = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body: createPlanBody(fixture, idempotencyKey, 'high') });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const plan = created.body as { id: string };
  const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: plan.id } });
  assert.equal(submitted.statusCode, 200);
  const pending = submitted.body as { approvalId: string; status: string };
  assert.equal(pending.status, 'PENDING_APPROVAL');
  assert.ok(pending.approvalId);

  const decided = await app.inject({ method: 'POST', path: '/api/v1/approvals/decide', headers: approverHeaders, body: { approvalId: pending.approvalId, decision: 'approved' } });
  assert.equal(decided.statusCode, 200);
  return { planId: plan.id, approvalId: pending.approvalId };
}


describe('部署计划与执行编排 API', () => {
  it('创建部署计划成功，并展开 certificateBindingId 目标', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const response = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body: createPlanBody(fixture) });

    assert.equal(response.statusCode, 201, JSON.stringify(response.body));
    const plan = response.body as { status: string; targets: Array<{ certificateBindingId: string; deploymentPlanId: string }> };
    assert.equal(plan.status, 'DRAFT');
    assert.equal(plan.targets.length, 1);
    assert.equal(plan.targets[0].certificateBindingId, fixture.target_1.bindingId);
    assert.ok(plan.targets[0].deploymentPlanId);
  });

  it('按应用资产创建计划时会按 WORKFLOW 策略生成工作流执行目标', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db);
    const security = createSecurityServices();
    grantWildcardPolicy(security, 'user_1', 'tenant_1');
    const app = createApp({ db, corePersistence: { mode: 'memory' }, security });
    const fixture = await seedWorkflowStrategyFixture(app);
    const createdWorkflow = await app.inject({
      method: 'POST',
      path: '/api/v1/workflow-templates',
      headers: userHeaders,
      body: { content: workflowTemplateFixture('应用资产工作流部署') },
    });
    assert.equal(createdWorkflow.statusCode, 201, JSON.stringify(createdWorkflow.body));
    const workflow = createdWorkflow.body as { template: { id: string }; version: { id: string } };
    const published = await app.inject({
      method: 'POST',
      path: '/api/v1/workflow-template-versions/publish',
      headers: userHeaders,
      body: { versionId: workflow.version.id },
    });
    assert.equal(published.statusCode, 200, JSON.stringify(published.body));

    const strategy = await app.inject({
      method: 'PATCH',
      path: `/api/v1/service-assets/${fixture.applicationAssetId}/deployment-strategy`,
      headers: userHeaders,
      body: {
        deploymentStrategy: {
          type: 'WORKFLOW',
          workflow: {
            workflowId: workflow.template.id,
            workflowVersionId: workflow.version.id,
            runner: 'CONTROL_PLANE',
            credentialRefs: { ssh: 'secret://ssh/workflow-target' },
            variableBindings: { host: fixture.domain },
            certificateArtifactBindings: {
              serverCert: {
                certificateFormatId: fixture.certificateFormatId,
                outputBindings: { bundle: 'bundle' },
              },
            },
          },
        },
      },
    });
    assert.equal(strategy.statusCode, 200, JSON.stringify(strategy.body));

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/from-application-asset',
      headers: userHeaders,
      body: {
        applicationAssetId: fixture.applicationAssetId,
        selectionMode: 'EXPLICIT',
        targetCertificateVersionId: fixture.certificateVersionId,
        idempotencyKey: 'idem_workflow_strategy_plan',
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const plan = created.body as { certificateFormatId?: string; targets: Array<{ certificateBindingId?: string; executorType: string; strategyPayload?: any; requiredCapabilities: string[] }> };
    assert.equal(plan.targets.length, 1);
    assert.equal(plan.certificateFormatId, undefined);
    assert.equal(plan.targets[0].certificateBindingId, undefined);
    assert.equal(plan.targets[0].executorType, 'WORKFLOW');
    assert.deepEqual(plan.targets[0].requiredCapabilities, ['workflow.run']);
    assert.equal(plan.targets[0].strategyPayload.workflowRequest.workflowVersionId, workflow.version.id);
    assert.equal(plan.targets[0].strategyPayload.workflowRequest.runner, 'CONTROL_PLANE');
    assert.equal(plan.targets[0].strategyPayload.workflowRequest.certificateBindingId, undefined);
    assert.equal(plan.targets[0].strategyPayload.workflowRequest.certificateArtifactBindings.serverCert.certificateFormatId, fixture.certificateFormatId);
  });

  it('无 Agent 目标绑定的 WORKFLOW 应用资产也可以创建部署计划', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db);
    const security = createSecurityServices();
    grantWildcardPolicy(security, 'user_1', 'tenant_1');
    const app = createApp({ db, corePersistence: { mode: 'memory' }, security });
    const certificate = await importCertificateFormatFixture(app, 'tenant_1', 'workflow-only.example.com', 'workflow_only');
    const createdWorkflow = await app.inject({
      method: 'POST',
      path: '/api/v1/workflow-templates',
      headers: userHeaders,
      body: { content: workflowHttpCertificateFixture('无 Agent 绑定工作流') },
    });
    assert.equal(createdWorkflow.statusCode, 201, JSON.stringify(createdWorkflow.body));
    const workflow = createdWorkflow.body as { template: { id: string }; version: { id: string } };
    const published = await app.inject({
      method: 'POST',
      path: '/api/v1/workflow-template-versions/publish',
      headers: userHeaders,
      body: { versionId: workflow.version.id },
    });
    assert.equal(published.statusCode, 200, JSON.stringify(published.body));

    const asset = await app.inject({
      method: 'POST',
      path: '/api/v1/service-assets',
      headers: userHeaders,
      body: {
        address: 'workflow-only.example.com',
        addressType: 'DNS',
        port: 8443,
        protocol: 'HTTPS',
        platform: 'LINUX',
        verifyUrl: 'https://workflow-only.example.com:8443',
        displayName: 'Workflow Only Asset',
        deploymentStrategy: {
          type: 'WORKFLOW',
          workflow: {
            workflowId: workflow.template.id,
            workflowVersionId: workflow.version.id,
            runner: 'CONTROL_PLANE',
            variableBindings: { callbackUrl: 'https://workflow-only.example.com:8443/verify' },
            certificateArtifactBindings: {
              serverCert: {
                certificateFormatId: certificate.certificateFormatId,
                outputBindings: { bundle: 'bundle' },
              },
            },
          },
        },
      },
    });
    assert.equal(asset.statusCode, 201, JSON.stringify(asset.body));
    const applicationAssetId = (asset.body as { id: string }).id;

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/from-application-asset',
      headers: userHeaders,
      body: {
        applicationAssetId,
        selectionMode: 'EXPLICIT',
        targetCertificateVersionId: certificate.certificateVersionId,
        idempotencyKey: 'idem_workflow_only_asset_plan',
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const plan = created.body as { certificateFormatId?: string; targets: Array<{ certificateBindingId?: string; managedTargetId?: string; siteAssetId?: string; executionTargetId?: string; executorType: string; strategyPayload?: any }> };
    assert.equal(plan.certificateFormatId, undefined);
    assert.equal(plan.targets.length, 1);
    assert.equal(plan.targets[0].executorType, 'WORKFLOW');
    assert.equal(plan.targets[0].certificateBindingId, undefined);
    assert.equal(plan.targets[0].managedTargetId, undefined);
    assert.equal(plan.targets[0].siteAssetId, undefined);
    assert.equal(plan.targets[0].executionTargetId, applicationAssetId);
    assert.equal(plan.targets[0].strategyPayload.workflowRequest.applicationAssetId, applicationAssetId);
  });

  it('应用资产 WORKFLOW 策略经真实 HTTP 工作流执行后会回写绑定和资产状态', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db);
    const security = createSecurityServices();
    grantWildcardPolicy(security, 'user_1', 'tenant_1');
    const app = createApp({ db, corePersistence: { mode: 'memory' }, security });
    const fixture = await seedWorkflowStrategyFixture(app);
    const verifyServer = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ fingerprint: fixture.certificateFingerprintSha256, thumbprint: 'A'.repeat(40) }));
    });
    await new Promise<void>((resolve, reject) => {
      verifyServer.once('error', reject);
      verifyServer.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const address = verifyServer.address();
      assert.ok(address && typeof address === 'object');
      const workflowUrl = `http://127.0.0.1:${address.port}/verify`;
      const createdWorkflow = await app.inject({
        method: 'POST',
        path: '/api/v1/workflow-templates',
        headers: userHeaders,
        body: { content: workflowHttpCertificateFixture('应用资产工作流真实 HTTP 验收') },
      });
      assert.equal(createdWorkflow.statusCode, 201, JSON.stringify(createdWorkflow.body));
      const workflow = createdWorkflow.body as { template: { id: string }; version: { id: string } };
      const published = await app.inject({
        method: 'POST',
        path: '/api/v1/workflow-template-versions/publish',
        headers: userHeaders,
        body: { versionId: workflow.version.id },
      });
      assert.equal(published.statusCode, 200, JSON.stringify(published.body));

      const strategy = await app.inject({
        method: 'PATCH',
        path: `/api/v1/service-assets/${fixture.applicationAssetId}/deployment-strategy`,
        headers: userHeaders,
        body: {
          deploymentStrategy: {
            type: 'WORKFLOW',
            workflow: {
              workflowId: workflow.template.id,
              workflowVersionId: workflow.version.id,
              runner: 'CONTROL_PLANE',
              variableBindings: { callbackUrl: workflowUrl },
              certificateArtifactBindings: {
                serverCert: {
                  certificateFormatId: fixture.certificateFormatId,
                  outputBindings: { bundle: 'bundle' },
                },
              },
            },
          },
        },
      });
      assert.equal(strategy.statusCode, 200, JSON.stringify(strategy.body));

      const createdPlan = await app.inject({
        method: 'POST',
        path: '/api/v1/deployment-plans/from-application-asset',
        headers: userHeaders,
        body: {
          applicationAssetId: fixture.applicationAssetId,
          selectionMode: 'EXPLICIT',
          targetCertificateVersionId: fixture.certificateVersionId,
          idempotencyKey: 'idem_workflow_real_http_plan',
        },
      });
      assert.equal(createdPlan.statusCode, 201, JSON.stringify(createdPlan.body));
      const plan = createdPlan.body as { id: string; targets: Array<{ executorType: string }> };
      assert.equal(plan.targets[0]?.executorType, 'WORKFLOW');

      const submitted = await app.inject({
        method: 'POST',
        path: '/api/v1/deployment-plans/submit',
        headers: userHeaders,
        body: { planId: plan.id },
      });
      assert.equal(submitted.statusCode, 200, JSON.stringify(submitted.body));

      const dryRun = await app.inject({
        method: 'POST',
        path: '/api/v1/deployment-plans/dry-run',
        headers: userHeaders,
        body: { planId: plan.id, idempotencyKey: 'idem_workflow_real_http_dry_run' },
      });
      assert.equal(dryRun.statusCode, 200, JSON.stringify(dryRun.body));
      const dryRunBody = dryRun.body as { run: { id: string } };
      const executions = app.getResource('executionsService') as ExecutionsApplicationService;
      const dryRunResult = await executions.runDispatchedExecution(dryRunBody.run.id, 'user_1', 'tenant_1');
      assert.equal(dryRunResult.success, true, JSON.stringify(dryRunResult));

      const executed = await app.inject({
        method: 'POST',
        path: '/api/v1/deployment-plans/execute',
        headers: userHeaders,
        body: { planId: plan.id, idempotencyKey: 'idem_workflow_real_http_run' },
      });
      assert.equal(executed.statusCode, 200, JSON.stringify(executed.body));
      const executedBody = executed.body as { run: { id: string } };
      const runResult = await executions.runDispatchedExecution(executedBody.run.id, 'user_1', 'tenant_1');
      assert.equal(runResult.success, true, JSON.stringify(runResult));

      const steps = await app.inject({
        method: 'GET',
        path: `/api/v1/execution-steps?executionRunId=${executedBody.run.id}`,
        headers: userHeaders,
      });
      assert.equal(steps.statusCode, 200, JSON.stringify(steps.body));
      const workflowStep = (steps.body as { items: Array<{ status: string; inputSnapshot: any }> }).items
        .find((item) => item.inputSnapshot?.executorType === 'WORKFLOW' || item.inputSnapshot?.resultDetail?.workflowRun);
      assert.ok(workflowStep, JSON.stringify(steps.body));
      assert.equal(workflowStep.status, 'SUCCESS');
      assert.ok(workflowStep.inputSnapshot.resultDetail?.verify, JSON.stringify(workflowStep.inputSnapshot));
      assert.equal(workflowStep.inputSnapshot.resultDetail.verify.remoteCertificateSha256, fixture.certificateFingerprintSha256);

      const detail = await app.inject({
        method: 'GET',
        path: `/api/v1/service-assets/detail?serviceAssetId=${fixture.applicationAssetId}`,
        headers: userHeaders,
      });
      assert.equal(detail.statusCode, 200, JSON.stringify(detail.body));
      const assetDetail = detail.body as { targetBindingDetail?: { status?: string; metadata?: Record<string, unknown> } };
      assert.equal(assetDetail.targetBindingDetail?.status, 'ACTIVE');
      assert.equal(assetDetail.targetBindingDetail?.metadata?.lastDeploymentResultState, 'DEPLOY_SUCCESS');
    } finally {
      await new Promise<void>((resolve, reject) => verifyServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('编辑 DRAFT 应用资产部署计划会保留 planId 并替换证书版本、产物和目标', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const secondFixture = await importCertificateFormatFixture(app, 'tenant_1', 'iis-site.example.com', 'tenant_1_edit');
    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans',
      headers: userHeaders,
      body: createPlanBody(fixture, 'idem_edit_draft', 'low'),
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const plan = created.body as { id: string; certificateVersionId: string; certificateFormatId: string; targets: Array<{ certificateBindingId: string }> };
    assert.equal(plan.certificateVersionId, fixture.certificateVersionId);
    assert.equal(plan.certificateFormatId, fixture.certificateFormatId);
    assert.equal(plan.targets[0].certificateBindingId, fixture.target_1.bindingId);

    const updated = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/update-from-application-asset',
      headers: userHeaders,
      body: {
        planId: plan.id,
        applicationAssetId: fixture.target_1.applicationAssetId,
        targetCertificateVersionId: secondFixture.certificateVersionId,
        certificateFormatId: secondFixture.certificateFormatId,
        selectionMode: 'EXPLICIT',
      },
    });

    assert.equal(updated.statusCode, 200, JSON.stringify(updated.body));
    const updatedPlan = updated.body as { id: string; status: string; certificateVersionId: string; certificateFormatId: string; targets: Array<{ certificateBindingId: string }> };
    assert.equal(updatedPlan.id, plan.id);
    assert.equal(updatedPlan.status, 'DRAFT');
    assert.equal(updatedPlan.certificateVersionId, secondFixture.certificateVersionId);
    assert.equal(updatedPlan.certificateFormatId, secondFixture.certificateFormatId);
    assert.equal(updatedPlan.targets.length, 1);
    assert.equal(updatedPlan.targets[0].certificateBindingId, fixture.target_1.bindingId);
  });

  it('编辑已执行应用资产部署计划会直接更新原计划并保留执行记录', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const secondFixture = await importCertificateFormatFixture(app, 'tenant_1', 'iis-site.example.com', 'tenant_1_edit_success');
    const ready = await createReadyLowRiskPlan(app, fixture, 'idem_edit_success');
    const dryRun = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/dry-run',
      headers: userHeaders,
      body: { planId: ready.id, idempotencyKey: 'idem_edit_success_dry_run' },
    });
    assert.equal(dryRun.statusCode, 200, JSON.stringify(dryRun.body));
    const executed = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/execute',
      headers: userHeaders,
      body: { planId: ready.id, idempotencyKey: 'idem_edit_success_execute' },
    });
    assert.equal(executed.statusCode, 200, JSON.stringify(executed.body));

    const updated = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/update-from-application-asset',
      headers: userHeaders,
      body: {
        planId: ready.id,
        applicationAssetId: fixture.target_1.applicationAssetId,
        targetCertificateVersionId: secondFixture.certificateVersionId,
        certificateFormatId: secondFixture.certificateFormatId,
        selectionMode: 'EXPLICIT',
      },
    });

    assert.equal(updated.statusCode, 200, JSON.stringify(updated.body));
    const updatedPlan = updated.body as { id: string; status: string; certificateVersionId: string; certificateFormatId: string };
    assert.equal(updatedPlan.id, ready.id);
    assert.equal(updatedPlan.status, 'DRAFT');
    assert.equal(updatedPlan.certificateVersionId, secondFixture.certificateVersionId);
    assert.equal(updatedPlan.certificateFormatId, secondFixture.certificateFormatId);

    const runs = await app.inject({
      method: 'GET',
      path: `/api/v1/execution-runs?deploymentPlanId=${ready.id}`,
      headers: userHeaders,
    });
    assert.equal(runs.statusCode, 200, JSON.stringify(runs.body));
    assert.ok(((runs.body as { items: unknown[] }).items ?? []).length >= 2);
  });

  it('创建部署计划未手填 gatewayRoute 时自动调用 ZoneRouter 写入路由', async () => {
    const gateways = new GatewaysApplicationService();
    const gateway = await gateways.register('tenant_1', {
      agentId: 'agent_auto_route_001',
      zoneIds: ['zone_prod'],
      version: '1.0.0',
      adapters: ['ssh'],
      capabilities: ['certificate.backup', 'certificate.install', 'service.reload', 'tls.verify'],
      currentLoad: 0,
      maxConcurrentTasks: 4,
      successRate: 0.99,
    });
    const { service: deploymentService, fixture } = await createMigratedDeploymentService({ gateways });
    await gateways.probe('tenant_1', { gatewayId: gateway.id, targetId: fixture.hostId, zoneId: 'zone_prod', protocol: 'ssh', status: 'reachable', latencyMs: 12, ttlSeconds: 600 });
    const plan = await deploymentService.create({
      name: '自动路由部署计划',
      certificateVersionId: fixture.certificateVersionId,
      idempotencyKey: 'idem_auto_route_plan',
      actorId: 'user_1',
      tenantId: 'tenant_1',
      policy: { riskLevel: 'low', approvalRequired: false, failurePolicy: 'stop' },
      targets: [{
        certificateBindingId: fixture.target_1.bindingId,
        executionTargetId: fixture.hostId,
        executorType: 'GATEWAY_FORWARD',
        zoneId: 'zone_prod',
        protocols: ['ssh'],
      }],
    });

    const route = plan.targets[0].gatewayRoute;
    assert.equal(route?.gatewayId, gateway.id);
    assert.equal(route?.agentId, 'agent_auto_route_001');
    assert.equal(route?.gatewayAgentId, 'agent_auto_route_001');
    assert.equal(route?.zoneId, 'zone_prod');
    assert.equal(route?.adapter, 'ssh');
    assert.equal(route?.delegatedTargetId, fixture.hostId);
    assert.equal(route?.candidateGateways?.length, 1);
    assert.equal(route?.fallbackSuggestions, undefined);
    assert.equal(route?.missingCapabilities, undefined);
    assert.equal(route?.approvalRequired, false);
  });

  it('部署计划创建、dry-run、execute 保留 Gateway 路由元数据到目标和步骤快照', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans',
      headers: userHeaders,
      body: {
        ...createPlanBody(fixture, 'idem_gateway_route_metadata', 'low'),
        targets: [{
          certificateBindingId: fixture.target_1.bindingId,
          executionTargetId: fixture.target_1.managedTargetId,
          executorType: 'AGENT',
          gatewayId: 'gw_001',
          zoneId: 'zone_prod',
          adapter: 'ssh',
          delegatedTargetId: 'host_001',
          fallbackSuggestions: ['script_package', 'manual'],
        }],
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const plan = created.body as { id: string; targets: Array<{ gatewayRoute?: Record<string, unknown> }> };
    assert.deepEqual(plan.targets[0].gatewayRoute, {
      gatewayId: 'gw_001',
      zoneId: 'zone_prod',
      adapter: 'ssh',
      delegatedTargetId: 'host_001',
      fallbackSuggestions: ['script_package', 'manual'],
    });

    const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: plan.id } });
    assert.equal(submitted.statusCode, 200);
    const dryRun = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/dry-run', headers: userHeaders, body: { planId: plan.id, idempotencyKey: 'idem_gateway_route_dry' } });
    assert.equal(dryRun.statusCode, 200);
    const dryRunStep = (dryRun.body as { steps: Array<{ inputSnapshot: { gatewayRoute?: Record<string, unknown> } }> }).steps[0];
    assert.equal(dryRunStep.inputSnapshot.gatewayRoute?.gatewayId, 'gw_001');
    assert.equal(dryRunStep.inputSnapshot.gatewayRoute?.zoneId, 'zone_prod');
    assert.equal(dryRunStep.inputSnapshot.gatewayRoute?.adapter, 'ssh');

    const executed = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: userHeaders, body: { planId: plan.id, idempotencyKey: 'idem_gateway_route_exec' } });
    assert.equal(executed.statusCode, 200);
    const executeStep = (executed.body as { steps: Array<{ inputSnapshot: { gatewayRoute?: Record<string, unknown> } }> }).steps[0];
    assert.deepEqual(executeStep.inputSnapshot.gatewayRoute?.fallbackSuggestions, ['script_package', 'manual']);
  });

  it('部署目标必须引用 certificateBindingId，禁止直接部署到 Host', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const body = { ...createPlanBody(fixture, 'idem_missing_binding'), targets: [{ hostId: 'host_1', executorType: 'SSH' }] };
    const response = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body });

    assert.equal(response.statusCode, 400);
    assert.equal((response.body as { errorCode: string }).errorCode, 'VALIDATION_FAILED');
  });

  it('提交低风险计划进入 READY，高风险计划进入审批', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const ready = await createReadyLowRiskPlan(app, fixture, 'idem_submit_low');
    assert.equal(ready.status, 'READY');

    const createdHigh = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body: createPlanBody(fixture, 'idem_submit_high', 'high') });
    const highPlan = createdHigh.body as { id: string };
    const pending = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: highPlan.id } });
    assert.equal(pending.statusCode, 200);
    assert.equal((pending.body as { status: string }).status, 'PENDING_APPROVAL');
  });

  it('无审批执行高风险计划失败', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const created = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body: createPlanBody(fixture, 'idem_no_approval', 'high') });
    const plan = created.body as { id: string };

    const response = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: userHeaders, body: { planId: plan.id, idempotencyKey: 'idem_run_denied' } });

    assert.equal(response.statusCode, 422);
    assert.equal((response.body as { errorCode: string }).errorCode, 'DEPLOYMENT_APPROVAL_REQUIRED');
  });

  it('有审批执行高风险计划成功入队，并生成 ExecutionRun 和 ExecutionStep', async () => {
    const security = createSecurityServices();
    security.rbac.createPolicy({ subjectType: 'user', subjectId: 'approver_1', effect: 'allow', actions: ['approval.decide'], resourceTypes: ['approval'], scope: { tenantId: 'tenant_1' } });
    const { app, fixture } = await createMigratedTestApp({ security });
    const { planId, approvalId } = await createApprovedHighRiskPlan(app, fixture, 'idem_approved_high');

    const response = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: userHeaders, body: { planId, approvalId, idempotencyKey: 'idem_run_high' } });

    assert.equal(response.statusCode, 200);
    const body = response.body as { plan: { status: string }; run: { status: string; externalRunId: string }; steps: unknown[]; jobId: string };
    assert.equal(body.plan.status, 'RUNNING');
    assert.equal(body.run.status, 'DISPATCHED');
    assert.ok(body.jobId);
    assert.equal(body.steps.length, 4);
  });

  it('dry-run 创建执行运行，步骤全部标记 dryRun=true 且不推进计划到 RUNNING', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const plan = await createReadyLowRiskPlan(app, fixture, 'idem_dry_run_plan');

    const response = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/dry-run', headers: userHeaders, body: { planId: plan.id, idempotencyKey: 'idem_dry_run' } });

    assert.equal(response.statusCode, 200);
    const body = response.body as { plan: { status: string }; run: { type: string; status: string }; steps: Array<{ stepType: string; inputSnapshot: { dryRun?: boolean } }> };
    assert.equal(body.plan.status, 'READY');
    assert.equal(body.run.type, 'dry_run');
    assert.equal(body.run.status, 'DISPATCHED');
    assert.deepEqual(body.steps.map((step) => step.stepType), ['DISCOVER', 'VERIFY']);
    assert.equal(body.steps.every((step) => step.inputSnapshot.dryRun === true), true);
  });

  it('dry-run 返回时保留过程态，并在当前证书已一致时生成 warning', async () => {
    const { db, security, service: deploymentService, fixture, bindings } = await createMigratedDeploymentService();
    const app = createApp({ db, security, corePersistence: { mode: 'memory' }, deploymentPlans: new DeploymentPlansController(deploymentService) });
    await bindings.updateCertificateBinding('tenant_1', fixture.target_1.bindingId, {
      observedFingerprintSha256: fixture.certificateFingerprintSha256,
      metadata: {
        currentThumbprint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
    });
    const ready = await createReadyLowRiskPlan(app, fixture, 'idem_dry_run_warning_plan');

    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/dry-run',
      headers: userHeaders,
      body: { planId: ready.id, idempotencyKey: 'idem_dry_run_warning' },
    });

    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    const body = response.body as {
      run: { status: string };
      steps: Array<{ stepType: string; status: string; inputSnapshot: { resultDetail?: { dryRunChecks?: Array<{ key: string; status: string; evidence?: Record<string, unknown> }> } } }>;
    };
    assert.equal(body.run.status, 'DISPATCHED');
    assert.equal(body.steps.every((step) => step.status === 'PENDING'), true);

    const warningChecks = body.steps
      .flatMap((step) => step.inputSnapshot.resultDetail?.dryRunChecks ?? [])
      .filter((check) => check.key === 'certificate_already_active');
    assert.equal(warningChecks.length >= 1, true);
    assert.equal(warningChecks[0]?.status, 'warning');
    assert.equal(warningChecks[0]?.evidence?.expectedFingerprintSha256, fixture.certificateFingerprintSha256);
    assert.equal(warningChecks[0]?.evidence?.currentFingerprintSha256, fixture.certificateFingerprintSha256);
  });

  it('历史计划目标缺少 target.tenantId 时，仍可使用 plan.tenantId 发起 dry-run', async () => {
    const { db, security, service: deploymentService, fixture } = await createMigratedDeploymentService();
    const app = createApp({ db, security, corePersistence: { mode: 'memory' }, deploymentPlans: new DeploymentPlansController(deploymentService) });
    const ready = await createReadyLowRiskPlan(app, fixture, 'idem_dry_run_missing_target_tenant_plan');
    const targets = await deploymentService.getRepository().listTargetsByPlan(ready.id, 'tenant_1');
    assert.equal(targets.length > 0, true);
    await deploymentService.getRepository().updateTarget(targets[0]!.id, {
      tenantId: undefined,
      updatedAt: new Date().toISOString(),
      updatedBy: 'user_1',
    });

    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/dry-run',
      headers: userHeaders,
      body: { planId: ready.id, idempotencyKey: 'idem_dry_run_missing_target_tenant' },
    });

    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    const body = response.body as {
      run: { status: string };
      steps: Array<{ inputSnapshot: { certificateBindingId?: string } }>;
    };
    assert.equal(body.run.status, 'DISPATCHED');
    assert.equal(body.steps.length > 0, true);
    assert.equal(body.steps.every((step) => step.inputSnapshot.certificateBindingId === fixture.target_1.bindingId), true);
  });

  it('mock-safe gateway adapter 成功时 run 和 step 从 DISPATCHED/RUNNING 走到 SUCCESS', async () => {
    const { db, security, service: deploymentService, fixture } = await createMigratedDeploymentService();
    const app = createApp({ db, security, corePersistence: { mode: 'memory' }, deploymentPlans: new DeploymentPlansController(deploymentService) });
    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans',
      headers: userHeaders,
      body: {
        ...createPlanBody(fixture, 'idem_gateway_success_plan', 'low'),
        targets: [{
          certificateBindingId: fixture.target_1.bindingId,
          executionTargetId: fixture.target_1.managedTargetId,
          executorType: 'GATEWAY_FORWARD',
          gatewayRoute: {
            gatewayId: 'gw_mock_safe',
            adapter: 'ssh',
            delegatedTargetId: fixture.hostId,
            mockSafeLocalRuntime: true,
          },
        }],
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const plan = created.body as { id: string };
    const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: plan.id } });
    assert.equal(submitted.statusCode, 200);
    const executed = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: userHeaders, body: { planId: plan.id, idempotencyKey: 'idem_gateway_success_run' } });
    const runId = (executed.body as { run: { id: string } }).run.id;

    const jobResult = await deploymentService.getExecutionsService().runNextJobForTest();
    const run = await deploymentService.getExecutionsService().getRun(runId, 'tenant_1');
    const steps = await deploymentService.getExecutionsService().listSteps({ tenantId: 'tenant_1', executionRunId: runId });
    const finishedPlan = await deploymentService.getRepository().getPlanOrThrow(plan.id, 'tenant_1');
    const finishedTargets = await deploymentService.getRepository().listTargetsByPlan(plan.id, 'tenant_1');

    assert.equal(jobResult?.success, true);
    assert.equal(run.status, 'SUCCESS');
    assert.equal(finishedPlan.status, 'SUCCESS');
    assert.equal(finishedTargets.every((target) => target.status === 'COMPLETED'), true);
    assert.equal(steps.every((step) => step.status === 'SUCCESS'), true);
  });

  it('mock executor 失败时 run 走到 FAILED，并留下失败 step', async () => {
    const { service: deploymentService, fixture } = await createMigratedDeploymentService();
    const plan = await deploymentService.create({ ...createPlanBody(fixture, 'idem_mock_fail_plan', 'low'), actorId: 'user_1', tenantId: 'tenant_1' }, { actor: { id: 'user_1', type: 'user', scope: { tenantId: 'tenant_1' } } });
    const ready = await deploymentService.submit({ planId: plan.id, actorId: 'user_1', tenantId: 'tenant_1' });
    const targetId = ready.targets[0].id;
    const created = await deploymentService.getExecutionsService().createApplyRun({
      deploymentPlanId: ready.id,
      deploymentPlanTargetIds: [targetId],
      type: 'apply',
      idempotencyKey: 'idem_mock_fail_run',
      actorId: 'user_1',
      tenantId: 'tenant_1',
      executorTypeByTargetId: new Map([[targetId, 'MOCK']]),
      mockResultByTargetId: new Map([[targetId, 'fail']]),
      allowMockExecutor: true,
    });

    const jobResult = await deploymentService.getExecutionsService().runNextJobForTest();
    const run = await deploymentService.getExecutionsService().getRun(created.run.id, 'tenant_1');
    const steps = await deploymentService.getExecutionsService().listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });

    assert.equal(jobResult?.success, false);
    assert.equal(run.status, 'FAILED');
    assert.equal(steps.some((step) => step.status === 'FAILED'), true);
    assert.equal(steps.some((step) => step.status === 'PENDING'), true);
  });

  it('取消计划会传播到已入队 run，并取消未开始步骤', async () => {
    const { db, security, service: deploymentService, fixture } = await createMigratedDeploymentService();
    const app = createApp({ db, security, corePersistence: { mode: 'memory' }, deploymentPlans: new DeploymentPlansController(deploymentService) });
    const plan = await createReadyLowRiskPlan(app, fixture, 'idem_cancel_plan');
    const executed = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: userHeaders, body: { planId: plan.id, idempotencyKey: 'idem_cancel_run' } });
    const runId = (executed.body as { run: { id: string } }).run.id;

    const cancelled = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/cancel', headers: userHeaders, body: { planId: plan.id, reason: '用户取消' } });
    const run = await deploymentService.getExecutionsService().getRun(runId, 'tenant_1');
    const steps = await deploymentService.getExecutionsService().listSteps({ tenantId: 'tenant_1', executionRunId: runId });

    assert.equal(cancelled.statusCode, 200);
    assert.equal(run.status, 'CANCELLED');
    assert.equal(steps.every((step) => step.status === 'SKIPPED'), true);
  });

  it('执行失败后可以进入回滚', async () => {
    const { db, security, service: deploymentService, fixture } = await createMigratedDeploymentService();
    const app = createApp({ db, security, corePersistence: { mode: 'memory' }, deploymentPlans: new DeploymentPlansController(deploymentService) });
    const plan = await createReadyLowRiskPlan(app, fixture, 'idem_rollback_plan');
    const executed = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: userHeaders, body: { planId: plan.id, idempotencyKey: 'idem_rollback_run' } });
    assert.equal(executed.statusCode, 200);
    const runId = (executed.body as { run: { id: string } }).run.id;

    // 编排壳不接真实 SSH/Agent；这里通过服务层把 run 推到 FAILED，验证公开 rollback API。
    const failedRun = await deploymentService.markRunFailedForTest(runId, 'orchestrator_1', 'tenant_1');
    assert.equal(failedRun.status, 'FAILED');

    const rollback = await app.inject({ method: 'POST', path: '/api/v1/execution-runs/rollback', headers: userHeaders, body: { runId, idempotencyKey: 'idem_rollback_ok' } });
    assert.equal(rollback.statusCode, 200);
    const body = rollback.body as { sourceRun: { status: string }; rollbackRun: { status: string }; steps: Array<{ stepType: string; inputSnapshot: Record<string, unknown> }>; jobId: string };
    assert.equal(body.sourceRun.status, 'ROLLBACK_RUNNING');
    assert.equal(body.rollbackRun.status, 'DISPATCHED');
    assert.equal(body.steps.length, 2);
    const rollbackStep = body.steps.find((step) => step.stepType === 'ROLLBACK');
    assert.ok(rollbackStep);
    assert.equal(rollbackStep!.inputSnapshot.operation, 'rollback');
    assert.equal(typeof rollbackStep!.inputSnapshot.sourceRunId, 'string');
    assert.equal(typeof (rollbackStep!.inputSnapshot.rollbackContext as { sourceRunId?: string } | undefined)?.sourceRunId, 'string');
    assert.ok(body.jobId);
  });

  it('回滚缺少源步骤目标时拒绝创建空 rollback', async () => {
    const { db, security, service: deploymentService, fixture } = await createMigratedDeploymentService();
    const plan = await deploymentService.create({ ...createPlanBody(fixture, 'idem_empty_rollback_plan', 'low'), actorId: 'user_1', tenantId: 'tenant_1' }, { actor: { id: 'user_1', type: 'user', scope: { tenantId: 'tenant_1' } } });
    const ready = await deploymentService.submit({ planId: plan.id, actorId: 'user_1', tenantId: 'tenant_1' });
    const created = await deploymentService.getExecutionsService().createApplyRun({
      deploymentPlanId: ready.id,
      deploymentPlanTargetIds: [],
      type: 'apply',
      idempotencyKey: 'idem_empty_rollback_run',
      actorId: 'user_1',
      tenantId: 'tenant_1',
      executorTypeByTargetId: new Map(),
    });
    await deploymentService.markRunFailedForTest(created.run.id, 'orchestrator_1', 'tenant_1');
    const app = createApp({ db, security, corePersistence: { mode: 'memory' }, deploymentPlans: new DeploymentPlansController(deploymentService) });

    const rollback = await app.inject({ method: 'POST', path: '/api/v1/execution-runs/rollback', headers: userHeaders, body: { runId: created.run.id, idempotencyKey: 'idem_empty_rollback' } });

    assert.equal(rollback.statusCode, 400, JSON.stringify(rollback.body));
    assert.equal((rollback.body as { errorCode: string }).errorCode, 'VALIDATION_FAILED');
  });

  it('非法状态跳转失败', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const plan = await createReadyLowRiskPlan(app, fixture, 'idem_illegal_state');
    const cancelled = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/cancel', headers: userHeaders, body: { planId: plan.id } });
    assert.equal(cancelled.statusCode, 200);

    const execute = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: userHeaders, body: { planId: plan.id, idempotencyKey: 'idem_illegal_run' } });
    assert.equal(execute.statusCode, 409);
    assert.equal((execute.body as { errorCode: string }).errorCode, 'DEPLOYMENT_INVALID_STATE');
  });

  it('幂等键冲突失败', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const first = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body: createPlanBody(fixture, 'idem_conflict', 'low') });
    assert.equal(first.statusCode, 201);

    const conflictBody = createPlanBody(fixture, 'idem_conflict', 'low');
    conflictBody.name = '另一份计划';
    const second = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body: conflictBody });
    assert.equal(second.statusCode, 409);
    assert.equal((second.body as { errorCode: string }).errorCode, 'IDEMPOTENCY_CONFLICT');
  });

  it('创建、dry-run 和 execute 支持 Header 幂等键', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const body = createPlanBody(fixture, 'body_ignored_by_header', 'low');
    delete (body as Partial<typeof body>).idempotencyKey;

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans',
      headers: { ...userHeaders, 'x-idempotency-key': 'idem_header_plan' },
      body,
    });
    assert.equal(created.statusCode, 201);
    const plan = created.body as { id: string; idempotencyKey: string };
    assert.equal(plan.idempotencyKey, 'idem_header_plan');

    const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: plan.id } });
    assert.equal(submitted.statusCode, 200);

    const dryRun = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/dry-run', headers: { ...userHeaders, 'x-idempotency-key': 'idem_header_dry' }, body: { planId: plan.id } });
    assert.equal(dryRun.statusCode, 200);

    const executed = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: { ...userHeaders, 'x-idempotency-key': 'idem_header_exec' }, body: { planId: plan.id } });
    assert.equal(executed.statusCode, 200);
  });

  it('能力匹配 blocked 的目标不能创建计划，manual_required 会强制进入审批', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const blocked = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans',
      headers: userHeaders,
      body: {
        ...createPlanBody(fixture, 'idem_cap_blocked', 'low'),
        targets: [{ certificateBindingId: fixture.target_1.bindingId, executorType: 'AGENT', matchResult: { status: 'blocked', missingCapabilities: ['file.write'] } }],
      },
    });
    assert.equal(blocked.statusCode, 400);
    assert.equal((blocked.body as { errorCode: string }).errorCode, 'VALIDATION_FAILED');

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans',
      headers: userHeaders,
      body: {
        ...createPlanBody(fixture, 'idem_cap_manual', 'low'),
        targets: [{ certificateBindingId: fixture.target_1.bindingId, executorType: 'AGENT', matchResult: { status: 'manual_required', manualRisk: [{ capabilityKey: 'file.write' }] } }],
      },
    });
    assert.equal(created.statusCode, 201);
    const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: (created.body as { id: string }).id } });
    assert.equal((submitted.body as { status: string }).status, 'PENDING_APPROVAL');
  });

  it('能力重评估会更新目标 matchResult，blocked 目标不进入 dry-run，degraded 强制审批', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const site = await app.inject({
      method: 'POST',
      path: '/api/v1/site-assets',
      headers: userHeaders,
      body: {
        serviceInstanceId: fixture.serviceInstanceId,
        hostId: fixture.hostId,
        agentId: fixture.agentId,
        providerType: 'IIS',
        siteType: 'WEB_SITE',
        siteName: 'Site reevaluate',
        siteKey: 'tenant_1:iis:reevaluate:*:443:www.iis-site.example.com',
        bindingInformation: '*:443:www.iis-site.example.com',
        hostHeader: 'www.iis-site.example.com',
        listenIp: '*',
        port: 443,
        protocol: 'HTTPS',
        metadata: { appPool: 'DefaultAppPool' },
      },
    });
    assert.equal(site.statusCode, 201, JSON.stringify(site.body));
    const reevaluateSiteAssetId = (site.body as { id: string }).id;

    const target = await app.inject({
      method: 'POST',
      path: '/api/v1/managed-targets',
      headers: userHeaders,
      body: {
        agentId: fixture.agentId,
        hostId: fixture.hostId,
        serviceInstanceId: fixture.serviceInstanceId,
        siteAssetId: reevaluateSiteAssetId,
        providerType: 'IIS',
        frameworkType: 'IIS',
        targetType: 'SITE_BINDING',
        targetKey: 'tenant_1:site-binding:reevaluate:*:443:www.iis-site.example.com',
        bindingKey: '*:443:www.iis-site.example.com',
        capabilityProfile: { providerType: 'IIS', bindingInformation: '*:443:www.iis-site.example.com' },
      },
    });
    assert.equal(target.statusCode, 201, JSON.stringify(target.body));
    const reevaluateManagedTargetId = (target.body as { id: string }).id;

    const binding = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers: userHeaders,
      body: {
        serviceInstanceId: fixture.serviceInstanceId,
        siteAssetId: reevaluateSiteAssetId,
        managedTargetId: reevaluateManagedTargetId,
        domainName: 'www.iis-site.example.com',
        port: 443,
        protocol: 'HTTPS',
        bindingKey: '*:443:www.iis-site.example.com',
        bindingType: 'WINDOWS_CERT_STORE',
        certificateVersionId: fixture.certificateVersionId,
        targetCertificateVersionId: fixture.certificateVersionId,
        desiredFingerprintSha256: fixture.certificateFingerprintSha256,
        storeLocation: 'LocalMachine',
        storeName: 'My',
        storeThumbprint: 'REEVALUATE11111111111111111111111111111111'.slice(0, 40),
        verifyMethod: 'TLS_CONNECT',
      },
    });
    if (binding.statusCode !== 201) {
      throw new Error(`创建 CertificateBinding 失败：${binding.statusCode} ${JSON.stringify(binding.body)}`);
    }
    const reevaluateBindingId = (binding.body as { id: string }).id;

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans',
      headers: userHeaders,
      body: {
        ...createPlanBody(fixture, 'idem_cap_reeval', 'low'),
        targets: [
          { certificateBindingId: reevaluateBindingId, executionTargetId: reevaluateManagedTargetId, executorType: 'AGENT' },
          { certificateBindingId: fixture.target_1.bindingId, executionTargetId: fixture.target_1.managedTargetId, executorType: 'AGENT' },
        ],
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const plan = created.body as { id: string; targets: Array<{ id: string; certificateBindingId: string }> };
    const okTarget = plan.targets.find((target) => target.certificateBindingId === reevaluateBindingId)!;
    const blockedTarget = plan.targets.find((target) => target.certificateBindingId === fixture.target_1.bindingId)!;

    const reevaluated = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/capabilities/reevaluate',
      headers: userHeaders,
      body: {
        planId: plan.id,
        targetResults: [
          { targetId: okTarget.id, matchResult: { status: 'degraded', missingCapabilities: ['service.reload'] } },
          { targetId: blockedTarget.id, matchResult: { status: 'blocked', missingCapabilities: ['file.write'] } },
        ],
      },
    });
    assert.equal(reevaluated.statusCode, 200);
    const updated = reevaluated.body as { policy: { approvalRequired: boolean; riskLevel: string }; targets: Array<{ id: string; status: string; matchResult: { status: string } }> };
    assert.equal(updated.policy.approvalRequired, true);
    assert.equal(updated.policy.riskLevel, 'high');
    assert.equal(updated.targets.find((target) => target.id === blockedTarget.id)?.status, 'FAILED');
    assert.equal(updated.targets.find((target) => target.id === okTarget.id)?.matchResult.status, 'degraded');

    const dryRun = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/dry-run',
      headers: userHeaders,
      body: { planId: plan.id, idempotencyKey: 'idem_cap_reeval_dry' },
    });
    assert.equal(dryRun.statusCode, 200);
    const dryRunSteps = (dryRun.body as { steps: Array<{ deploymentPlanTargetId?: string }> }).steps;
    assert.equal(dryRunSteps.length, 2);
    assert.equal(dryRunSteps.every((step) => step.deploymentPlanTargetId === okTarget.id), true);

    const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: plan.id } });
    assert.equal((submitted.body as { status: string }).status, 'PENDING_APPROVAL');
  });

  it('支持用 managedTargetId + LATEST_AUTO 自动解析 binding 和最新 PFX 证书版本', async () => {
    const binding = {
      id: 'binding_auto_latest_1',
      tenantId: 'tenant_auto_latest',
      siteAssetId: 'site_auto_latest_1',
      managedTargetId: 'target_auto_latest_1',
      serviceInstanceId: 'svc_auto_latest_1',
      hostId: 'host_auto_latest_1',
      domainName: 'iis-site.example.com',
      domain: 'iis-site.example.com',
      port: 443,
      protocol: 'HTTPS',
      bindingKey: '*:443:iis-site.example.com',
      bindingType: 'WINDOWS_CERT_STORE',
      verifyMethod: 'TLS',
      status: 'ACTIVE',
      metadata: {},
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:00:00.000Z',
      version: 1,
    };
    const assets = {
      getManagedTarget: async (_tenantId, managedTargetId) => managedTargetId === 'target_auto_latest_1'
        ? {
          id: 'target_auto_latest_1',
          tenantId: 'tenant_auto_latest',
          agentId: 'agent-auto-latest-01',
          hostId: 'host_auto_latest_1',
          serviceInstanceId: 'svc_auto_latest_1',
          serviceAssetId: 'sat_auto_latest_1',
          siteAssetId: 'site_auto_latest_1',
          providerType: 'IIS',
          frameworkType: 'IIS',
          targetType: 'SITE_BINDING',
          targetKey: 'agent-auto-latest-01:site-binding:agent-auto-latest-01:iis:default web site:*:443:iis-site.example.com',
          bindingKey: '*:443:iis-site.example.com',
          capabilityProfile: {},
          status: 'ACTIVE',
          metadata: {},
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
          version: 1,
        }
        : undefined,
      getSiteAsset: async (_tenantId, siteAssetId) => siteAssetId === 'site_auto_latest_1'
        ? {
          id: 'site_auto_latest_1',
          tenantId: 'tenant_auto_latest',
          serviceInstanceId: 'svc_auto_latest_1',
          serviceAssetId: 'sat_auto_latest_1',
          hostId: 'host_auto_latest_1',
          agentId: 'agent-auto-latest-01',
          providerType: 'IIS',
          siteType: 'IIS',
          siteName: 'Default Web Site',
          siteKey: 'agent-auto-latest-01:iis:default web site:*:443:iis-site.example.com',
          bindingInformation: '*:443:iis-site.example.com',
          hostHeader: 'iis-site.example.com',
          port: 443,
          protocol: 'HTTPS',
          discoverySource: 'MANUAL',
          status: 'ACTIVE',
          metadata: {},
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
          version: 1,
        }
        : undefined,
    };
    const bindings = {
      listCertificateBindings: async () => ({ items: [binding], total: 1, page: 1, pageSize: 5000 }),
      getCertificateBinding: async () => binding,
    };
    const versionById = {
      certver_auto_latest_1: {
        id: 'certver_auto_latest_1',
        certificateAssetId: 'certasset_auto_latest_1',
        versionNo: 2,
        commonName: 'iis-site.example.com',
        sans: ['iis-site.example.com'],
        issuer: { raw: 'CN=issuer' },
        subject: { raw: 'CN=iis-site.example.com' },
        serialNumber: '001',
        notBefore: '2026-06-23T00:00:00.000Z',
        notAfter: '2026-12-31T00:00:00.000Z',
        fingerprintSha256: 'fp-auto-latest-1',
        publicKeyAlgorithm: 'RSA',
        signatureAlgorithm: 'SHA256RSA',
        leafStorageRef: 'vault://leaf/1',
        privateKeySecretRef: 'secret://pfx/1',
        chainCertificateRefs: [],
        chainOrder: [],
        chainDiagnostics: [],
        chainStatus: 'valid',
        deployable: true,
        sourceType: 'manual',
        status: 'active',
        createdBy: 'user_1',
        createdAt: '2026-06-23T00:00:00.000Z',
      },
      certver_auto_latest_2: {
        id: 'certver_auto_latest_2',
        certificateAssetId: 'certasset_auto_latest_1',
        versionNo: 3,
        commonName: 'iis-site.example.com',
        sans: ['iis-site.example.com'],
        issuer: { raw: 'CN=issuer' },
        subject: { raw: 'CN=iis-site.example.com' },
        serialNumber: '002',
        notBefore: '2026-07-03T00:00:00.000Z',
        notAfter: '2027-01-31T00:00:00.000Z',
        fingerprintSha256: 'fp-auto-latest-2',
        publicKeyAlgorithm: 'RSA',
        signatureAlgorithm: 'SHA256RSA',
        leafStorageRef: 'vault://leaf/2',
        privateKeySecretRef: 'secret://pfx/2',
        chainCertificateRefs: [],
        chainOrder: [],
        chainDiagnostics: [],
        chainStatus: 'valid',
        deployable: true,
        sourceType: 'manual',
        status: 'active',
        createdBy: 'user_1',
        createdAt: '2026-07-03T00:00:00.000Z',
      },
    };
    const formatsByVersionId = {
      certver_auto_latest_1: {
        id: 'fmt_auto_latest_1',
        certificateVersionId: 'certver_auto_latest_1',
        format: 'pfx',
        artifactRef: 'artifact://certificate-format/certver_auto_latest_1/pfx',
        parameterHash: 'hash_auto_latest_1',
        parameters: {
          configName: 'Windows-IIS-PKCS12-标准模板',
          systemPlatform: 'windows',
          runtimePlatform: 'iis',
        },
        containsPrivateKey: true,
        passwordSecretRef: 'secret://pfx-password/1',
        createdBy: 'user_1',
        createdAt: '2026-06-23T00:00:00.000Z',
      },
      certver_auto_latest_2: {
        id: 'fmt_auto_latest_2',
        certificateVersionId: 'certver_auto_latest_2',
        format: 'pfx',
        artifactRef: 'artifact://certificate-format/certver_auto_latest_2/pfx',
        parameterHash: 'hash_auto_latest_2',
        parameters: {
          configName: 'Windows-IIS-PKCS12-标准模板',
          systemPlatform: 'windows',
          runtimePlatform: 'iis',
        },
        containsPrivateKey: true,
        passwordSecretRef: 'secret://pfx-password/2',
        createdBy: 'user_1',
        createdAt: '2026-07-03T00:00:00.000Z',
      },
    };
    let latestVersionIds = ['certver_auto_latest_1'];
    const certificates = {
      getVersion: async (id) => versionById[id as keyof typeof versionById],
      getAsset: async (id) => id === 'certasset_auto_latest_1'
        ? {
          id: 'certasset_auto_latest_1',
          name: 'iis-site.example.com',
          primaryDomain: 'iis-site.example.com',
          sans: ['iis-site.example.com'],
          sourceType: 'manual',
          status: 'active',
          tags: [],
          createdBy: 'user_1',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
        }
        : undefined,
      listVersions: async () => ({
        items: await Promise.all(latestVersionIds.map((id) => certificates.getVersion(id))),
        total: latestVersionIds.length,
        page: 1,
        pageSize: 5000,
      }),
      listFormatsByVersion: async (id) => {
        const format = formatsByVersionId[id as keyof typeof formatsByVersionId];
        return format ? [format] : [];
      },
      listFormats: async () => ({
        items: Object.values(formatsByVersionId),
        total: Object.keys(formatsByVersionId).length,
        page: 1,
        pageSize: 5000,
      }),
      getFormat: async (id) => Object.values(formatsByVersionId).find((item) => item.id === id),
    };
    const repository = new DeploymentPlansRepository();
    const executions = new ExecutionsApplicationService({
      deploymentPlansRepository: repository,
    });
    const service = new DeploymentPlansApplicationService({ repository, executions, assets, bindings, certificates });

    const plan = await service.create({
      name: 'auto latest iis deploy',
      selectionMode: 'LATEST_AUTO',
      idempotencyKey: 'idem_auto_latest_plan',
      actorId: 'user_1',
      tenantId: 'tenant_auto_latest',
      targets: [{ managedTargetId: 'target_auto_latest_1', executorType: 'AGENT' }],
    });

    assert.equal(plan.certificateVersionId, 'certver_auto_latest_1');
    assert.equal(plan.selectionMode, 'LATEST_AUTO');
    assert.equal(plan.targets.length, 1);
    assert.equal(plan.targets[0].certificateBindingId, binding.id);
    assert.equal(plan.targets[0].executionTargetId, 'target_auto_latest_1');

    const ready = await service.submit({ planId: plan.id, actorId: 'user_1', tenantId: 'tenant_auto_latest' });
    latestVersionIds = ['certver_auto_latest_1', 'certver_auto_latest_2'];
    const dryRun = await service.dryRun({ planId: ready.id, actorId: 'user_1', tenantId: 'tenant_auto_latest', idempotencyKey: 'idem_auto_latest_dry_run' });
    const step = dryRun.steps[0] as { inputSnapshot: { deploymentArtifact?: { certificateVersionId: string; format: string; artifactRef: string; passwordSecretRef?: string } } };
    assert.equal(dryRun.plan.selectionMode, 'LATEST_AUTO');
    assert.equal(dryRun.plan.certificateVersionId, 'certver_auto_latest_2');
    assert.equal(step.inputSnapshot.deploymentArtifact?.certificateVersionId, 'certver_auto_latest_2');
    assert.equal(step.inputSnapshot.deploymentArtifact?.format, 'pfx');
    assert.equal(step.inputSnapshot.deploymentArtifact?.artifactRef, 'artifact://certificate-format/certver_auto_latest_2/pfx');
    assert.equal(step.inputSnapshot.deploymentArtifact?.passwordSecretRef, 'secret://pfx-password/2');
  });

  it('deployment plan -> execute -> agent task payload -> agent artifact download 最小链路可跑通 IIS 换证', async () => {
    const security = createSecurityServices();
    security.rbac.createPolicy({ subjectType: 'user', subjectId: 'approver_1', effect: 'allow', actions: ['approval.decide'], resourceTypes: ['approval'], scope: { tenantId: 'tenant_1' } });
    security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'user_1',
      effect: 'allow',
      actions: ['host.create', 'service_instance.manage', 'service_asset.manage', 'site_asset.manage', 'managed_target.manage', 'binding.manage', 'secret.create', 'certificate.import', 'certificate.format.create'],
      resourceTypes: ['host', 'service_instance', 'service_asset', 'site_asset', 'managed_target', 'certificate_binding', 'secret', 'certificate_version', 'certificate_version_format'],
      scope: { tenantId: 'tenant_1' },
    });
    const db = new PgliteDatabase();
    await runMigrations(db);
    grantDeploymentFixturePolicies(security, 'tenant_1');
    const app = createApp({ db, corePersistence: { mode: 'memory' }, security });
    const agentsService = app.getResource('agentsService');
    assert.ok(agentsService);
    const chain = createPemChainFixture();

    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers: userHeaders,
      body: {
        agentKey: 'iis-agent-01',
        hostname: 'IIS-HOST-01',
        version: '1.0.0',
        osType: 'windows',
      },
    });
    assert.equal(registered.statusCode, 201, JSON.stringify(registered.body));
    const agentId = (registered.body as { id: string }).id;

    const host = await app.inject({
      method: 'POST',
      path: '/api/v1/hosts',
      headers: userHeaders,
      body: { hostname: 'iis-host-01.example.com', primaryIp: '10.10.10.10', osType: 'WINDOWS', agentId, compatibilityLevel: 'L1', managementMode: 'AGENT' },
    });
    assert.equal(host.statusCode, 201, JSON.stringify(host.body));
    const hostId = (host.body as { id: string }).id;

    const service = await app.inject({
      method: 'POST',
      path: '/api/v1/service-instances',
      headers: userHeaders,
      body: { hostId, providerType: 'IIS', serviceName: 'iis', displayName: 'Default IIS', configPath: 'IIS:\\\\Sites' },
    });
    assert.equal(service.statusCode, 201, JSON.stringify(service.body));
    const serviceInstanceId = (service.body as { id: string }).id;

    const site = await app.inject({
      method: 'POST',
      path: '/api/v1/site-assets',
      headers: userHeaders,
      body: {
        serviceInstanceId,
        hostId,
        agentId,
        providerType: 'IIS',
        siteType: 'WEB_SITE',
        siteName: 'Default Web Site',
        siteKey: 'iis-agent-01:iis:default web site:*:443:iis-site.example.com',
        bindingInformation: '*:443:iis-site.example.com',
        hostHeader: 'iis-site.example.com',
        listenIp: '*',
        port: 443,
        protocol: 'HTTPS',
        metadata: { appPool: 'DefaultAppPool' },
      },
    });
    assert.equal(site.statusCode, 201, JSON.stringify(site.body));
    const siteAssetId = (site.body as { id: string }).id;

    const target = await app.inject({
      method: 'POST',
      path: '/api/v1/managed-targets',
      headers: userHeaders,
      body: {
        agentId,
        hostId,
        serviceInstanceId,
        siteAssetId,
        providerType: 'IIS',
        frameworkType: 'IIS',
        targetType: 'SITE_BINDING',
        targetKey: 'iis-agent-01:site-binding:*:443:iis-site.example.com',
        bindingKey: '*:443:iis-site.example.com',
        capabilityProfile: { providerType: 'IIS', bindingInformation: '*:443:iis-site.example.com' },
      },
    });
    assert.equal(target.statusCode, 201, JSON.stringify(target.body));
    const managedTargetId = (target.body as { id: string }).id;

    const secret = await app.inject({
      method: 'POST',
      path: '/api/v1/secrets',
      headers: userHeaders,
      body: { name: 'iis pfx password', type: 'pfx_password', scopeType: 'global', plainText: 'IIS-Pfx-123!' },
    });
    assert.equal(secret.statusCode, 201, JSON.stringify(secret.body));
    const passwordSecretRef = (secret.body as { secretRef: string }).secretRef;

    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: userHeaders,
      body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
    });
    assert.equal(imported.statusCode, 201, JSON.stringify(imported.body));
    const certificateVersionId = (imported.body as { version: { id: string } }).version.id;

    const exported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats/export',
      headers: userHeaders,
      body: {
        certificateVersionId,
        format: 'pfx',
        containsPrivateKey: true,
        passwordSecretRef,
        parameters: { alias: 'iis-site' },
        persistArtifact: true,
      },
    });
    assert.equal(exported.statusCode, 201, JSON.stringify(exported.body));
    const exportedBody = exported.body as { artifactRef: string; passwordSecretRef?: string };
    const artifactRef = exportedBody.artifactRef;
    const exportedPasswordSecretRef = exportedBody.passwordSecretRef ?? passwordSecretRef;
    const persistedFormat = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats',
      headers: userHeaders,
      body: {
        certificateVersionId,
        format: 'pfx',
        artifactRef,
        containsPrivateKey: true,
        passwordSecretRef: exportedPasswordSecretRef,
        parameters: { alias: 'iis-site' },
      },
    });
    assert.equal(persistedFormat.statusCode, 201, JSON.stringify(persistedFormat.body));

    const binding = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers: userHeaders,
      body: {
        serviceInstanceId,
        siteAssetId,
        managedTargetId,
        domainName: 'iis-site.example.com',
        port: 443,
        protocol: 'HTTPS',
        bindingKey: '*:443:iis-site.example.com',
        bindingType: 'WINDOWS_CERT_STORE',
        certificateVersionId,
        targetCertificateVersionId: certificateVersionId,
        desiredFingerprintSha256: (imported.body as { version: { fingerprintSha256: string } }).version.fingerprintSha256,
        storeLocation: 'LocalMachine',
        storeName: 'My',
        storeThumbprint: 'ABCDEF1234567890ABCDEF1234567890ABCDEF12',
        verifyMethod: 'TLS_CONNECT',
      },
    });
    if (binding.statusCode !== 201) {
      throw new Error(`seedDeploymentFixture 创建 CertificateBinding 失败：${binding.statusCode} ${JSON.stringify(binding.body)}`);
    }
    const bindingId = (binding.body as { id: string }).id;

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans',
      headers: userHeaders,
      body: {
        name: 'IIS 站点换证',
        certificateVersionId,
        idempotencyKey: 'idem_iis_execute_chain_plan',
        policy: { riskLevel: 'low', approvalRequired: false, failurePolicy: 'rollback' },
        targets: [{ certificateBindingId: bindingId, managedTargetId, executorType: 'AGENT' }],
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const planId = (created.body as { id: string }).id;

    const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId } });
    assert.equal(submitted.statusCode, 200);

    const executed = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/execute',
      headers: userHeaders,
      body: { planId, idempotencyKey: 'idem_iis_execute_chain_run' },
    });
    assert.equal(executed.statusCode, 200);
    const executeBody = executed.body as { run: { id: string }; steps: Array<{ id: string; stepType: string; inputSnapshot: any }> };
    const installStep = executeBody.steps.find((step) => step.stepType === 'INSTALL');
    assert.ok(installStep);
    assert.equal(installStep!.inputSnapshot.type, 'windows.iis.deploy_certificate');
    assert.equal(installStep!.inputSnapshot.siteName, 'Default Web Site');
    assert.equal(installStep!.inputSnapshot.bindingSelector.bindingInformation, '*:443:iis-site.example.com');
    assert.equal(installStep!.inputSnapshot.verifyUrl, 'https://iis-site.example.com:443');
    assert.equal(installStep!.inputSnapshot.deploymentArtifact.artifactRef, artifactRef);
    assert.equal(installStep!.inputSnapshot.deploymentArtifact.passwordSecretRef, exportedPasswordSecretRef);

    const executeService = app.getResource('agentsService');
    const adapter = new AgentExecutorAdapter(executeService);
    const adapterResult = await adapter.executeStep({
      step: {
        ...installStep!,
        tenantId: 'tenant_1',
        executionRunId: executeBody.run.id,
        attemptCount: 1,
      },
      runType: 'apply',
      dryRun: false,
    });
    assert.equal(adapterResult.success, true);

    const pulled = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/tasks/pull?agentId=${agentId}`,
      headers: userHeaders,
    });
    assert.equal(pulled.statusCode, 200);
    const tasks = pulled.body as Array<{ id: string; payload: any }>;
    const installTask = tasks.find((task) => task.payload?.type === 'windows.iis.deploy_certificate');
    assert.ok(installTask);
    assert.equal(installTask!.payload.siteName, 'Default Web Site');
    assert.equal(installTask!.payload.bindingSelector.bindingInformation, '*:443:iis-site.example.com');
    assert.equal(installTask!.payload.verifyUrl, 'https://iis-site.example.com:443');
    assert.equal(installTask!.payload.deploymentArtifact.artifactRef, artifactRef);

    const ack = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/ack',
      headers: userHeaders,
      body: { agentId, taskId: installTask!.id, leaseId: 'lease_iis_chain_1' },
    });
    assert.equal(ack.statusCode, 200);

    const artifact = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/tasks/artifact?agentId=${agentId}&taskId=${installTask!.id}&leaseId=lease_iis_chain_1&artifactRef=${encodeURIComponent(artifactRef)}&passwordSecretRef=${encodeURIComponent(exportedPasswordSecretRef)}`,
      headers: userHeaders,
    });
    assert.equal(artifact.statusCode, 200);
    assert.equal(artifact.headers['content-type'], 'application/x-pkcs12');
    assert.equal(artifact.headers['x-artifact-password'], 'IIS-Pfx-123!');
    assert.ok(Buffer.isBuffer(artifact.body));
    assert.ok((artifact.body as Buffer).length > 0);
  });

  it('支持按应用资产创建部署计划，并自动解析唯一 IIS 目标绑定', async () => {
    const security = createSecurityServices();
    security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'user_1',
      effect: 'allow',
      actions: ['host.create', 'service_instance.manage', 'site_asset.manage', 'managed_target.manage', 'binding.manage', 'binding.read', 'secret.create', 'certificate.import', 'certificate.format.create', 'service_asset.manage', 'service_asset.read'],
      resourceTypes: ['host', 'service_instance', 'site_asset', 'managed_target', 'certificate_binding', 'secret', 'certificate_version', 'certificate_version_format', 'service_asset'],
      scope: { tenantId: 'tenant_1' },
    });
    const { app } = await createMigratedTestApp({ security });
    const chain = createPemChainFixture('app-target.example.com');

    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers: userHeaders,
      body: {
        agentKey: 'iis-app-asset-agent-01',
        hostname: 'IIS-APP-ASSET-01',
        version: '1.0.0',
        osType: 'windows',
      },
    });
    assert.equal(registered.statusCode, 201);
    const agentId = (registered.body as { id: string }).id;

    const host = await app.inject({
      method: 'POST',
      path: '/api/v1/hosts',
      headers: userHeaders,
      body: { hostname: 'iis-app-asset.example.com', primaryIp: '10.10.20.20', osType: 'WINDOWS', agentId, compatibilityLevel: 'L1', managementMode: 'AGENT' },
    });
    assert.equal(host.statusCode, 201);
    const hostId = (host.body as { id: string }).id;

    const service = await app.inject({
      method: 'POST',
      path: '/api/v1/service-instances',
      headers: userHeaders,
      body: { hostId, providerType: 'IIS', serviceName: 'iis', displayName: 'Default IIS', configPath: 'IIS:\\\\Sites' },
    });
    assert.equal(service.statusCode, 201);
    const serviceInstanceId = (service.body as { id: string }).id;

    const site = await app.inject({
      method: 'POST',
      path: '/api/v1/site-assets',
      headers: userHeaders,
      body: {
        serviceInstanceId,
        hostId,
        agentId,
        providerType: 'IIS',
        siteType: 'WEB_SITE',
        siteName: 'Default Web Site',
        siteKey: 'iis-app-asset-agent-01:iis:default web site:*:443:app-target.example.com',
        bindingInformation: '*:443:app-target.example.com',
        hostHeader: 'app-target.example.com',
        listenIp: '*',
        port: 443,
        protocol: 'HTTPS',
        metadata: { appPool: 'DefaultAppPool' },
      },
    });
    assert.equal(site.statusCode, 201);
    const siteAssetId = (site.body as { id: string }).id;

    const target = await app.inject({
      method: 'POST',
      path: '/api/v1/managed-targets',
      headers: userHeaders,
      body: {
        agentId,
        hostId,
        serviceInstanceId,
        siteAssetId,
        providerType: 'IIS',
        frameworkType: 'IIS',
        targetType: 'SITE_BINDING',
        targetKey: 'iis-app-asset-agent-01:site-binding:*:443:app-target.example.com',
        bindingKey: '*:443:app-target.example.com',
        capabilityProfile: { providerType: 'IIS', bindingInformation: '*:443:app-target.example.com' },
      },
    });
    assert.equal(target.statusCode, 201);
    const targetBody = target.body as { id: string; bindingKey?: string };
    const managedTargetId = targetBody.id;
    const managedTargetBindingKey = targetBody.bindingKey ?? '*:443:app-target.example.com';

    const secret = await app.inject({
      method: 'POST',
      path: '/api/v1/secrets',
      headers: userHeaders,
      body: { name: 'iis app asset pfx password', type: 'pfx_password', scopeType: 'global', plainText: 'IIS-App-Asset-123!' },
    });
    assert.equal(secret.statusCode, 201);
    const passwordSecretRef = (secret.body as { secretRef: string }).secretRef;

    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: userHeaders,
      body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
    });
    assert.equal(imported.statusCode, 201);
    const importedBody = imported.body as { version: { id: string; fingerprintSha256: string } };
    const certificateVersionId = importedBody.version.id;

    const exported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats',
      headers: userHeaders,
      body: {
        certificateVersionId,
        format: 'pfx',
        artifactRef: `artifact://certificate-format/${certificateVersionId}/pfx/app-target`,
        containsPrivateKey: true,
        passwordSecretRef,
        parameters: { alias: 'app-target' },
      },
    });
    assert.equal(exported.statusCode, 201);

    const serviceAsset = await app.inject({
      method: 'POST',
      path: '/api/v1/service-assets',
      headers: userHeaders,
      body: {
        address: 'app-target.example.com',
        addressType: 'DNS',
        port: 443,
        protocol: 'HTTPS',
        platform: 'WINDOWS',
        hostId,
        agentId,
        serviceInstanceId,
        displayName: 'App Target',
        targetBinding: {
          agentId,
          siteAssetId,
          managedTargetId,
          providerType: 'IIS',
          frameworkType: 'IIS',
          targetType: 'SITE_BINDING',
          targetKey: managedTargetId,
          bindingKey: managedTargetBindingKey,
          status: 'ACTIVE',
          metadata: { source: 'manual' },
        },
      },
    });
    assert.equal(serviceAsset.statusCode, 201, JSON.stringify(serviceAsset.body));
    const applicationAssetId = (serviceAsset.body as { id: string }).id;

    const existingBindings = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-bindings?filter[serviceAssetId]=${applicationAssetId}`,
      headers: userHeaders,
    });
    assert.equal(existingBindings.statusCode, 200, JSON.stringify(existingBindings.body));
    let bindingId = (existingBindings.body as { items: Array<{ id: string }> }).items[0]?.id;
    if (!bindingId) {
      const binding = await app.inject({
        method: 'POST',
        path: '/api/v1/certificate-bindings',
        headers: userHeaders,
        body: {
          serviceInstanceId,
          serviceAssetId: applicationAssetId,
          siteAssetId,
          managedTargetId,
          domainName: 'app-target.example.com',
          port: 443,
          protocol: 'HTTPS',
          bindingKey: managedTargetBindingKey,
          bindingType: 'WINDOWS_CERT_STORE',
          certificateVersionId,
          targetCertificateVersionId: certificateVersionId,
          desiredFingerprintSha256: importedBody.version.fingerprintSha256,
          storeLocation: 'LocalMachine',
          storeName: 'My',
          storeThumbprint: '1234567890ABCDEF1234567890ABCDEF12345678',
          verifyMethod: 'TLS_CONNECT',
        },
      });
      assert.equal(binding.statusCode, 201, JSON.stringify(binding.body));
      bindingId = (binding.body as { id: string }).id;
    }

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/from-application-asset',
      headers: userHeaders,
      body: {
        applicationAssetId,
        selectionMode: 'LATEST_AUTO',
        idempotencyKey: 'idem_application_asset_plan',
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const plan = created.body as {
      status: string;
      certificateVersionId: string;
      targets: Array<{ certificateBindingId: string; executionTargetId?: string }>;
    };
    assert.equal(plan.status, 'DRAFT');
    assert.equal(plan.certificateVersionId, certificateVersionId);
    assert.equal(plan.targets.length, 1);
    assert.equal(plan.targets[0].certificateBindingId, bindingId);
    assert.equal(plan.targets[0].executionTargetId, managedTargetId);
  });

  it('应用资产换证执行结果回写后，会生成快照并把状态暴露到应用资产详情', async () => {
    const security = createSecurityServices();
    security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'user_1',
      effect: 'allow',
      actions: ['host.create', 'service_instance.manage', 'site_asset.manage', 'managed_target.manage', 'binding.manage', 'service_asset.manage', 'service_asset.read', 'managed_target.read', 'secret.create', 'certificate.import', 'certificate.format.create'],
      resourceTypes: ['host', 'service_instance', 'site_asset', 'managed_target', 'certificate_binding', 'service_asset', 'managed_target_snapshot', 'secret', 'certificate_version', 'certificate_version_format'],
      scope: { tenantId: 'tenant_1' },
    });
    const { app } = await createMigratedTestApp({ security });
    const chain = createPemChainFixture('sync-target.example.com');

    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers: userHeaders,
      body: {
        agentKey: 'iis-sync-agent-01',
        hostname: 'IIS-SYNC-01',
        version: '1.0.0',
        osType: 'windows',
      },
    });
    assert.equal(registered.statusCode, 201);
    const agentId = (registered.body as { id: string }).id;

    const host = await app.inject({
      method: 'POST',
      path: '/api/v1/hosts',
      headers: userHeaders,
      body: { hostname: 'iis-sync.example.com', primaryIp: '10.10.30.30', osType: 'WINDOWS', agentId, compatibilityLevel: 'L1', managementMode: 'AGENT' },
    });
    assert.equal(host.statusCode, 201);
    const hostId = (host.body as { id: string }).id;

    const service = await app.inject({
      method: 'POST',
      path: '/api/v1/service-instances',
      headers: userHeaders,
      body: { hostId, providerType: 'IIS', serviceName: 'iis', displayName: 'Default IIS', configPath: 'IIS:\\\\Sites' },
    });
    assert.equal(service.statusCode, 201, JSON.stringify(service.body));
    const serviceInstanceId = (service.body as { id: string }).id;

    const site = await app.inject({
      method: 'POST',
      path: '/api/v1/site-assets',
      headers: userHeaders,
      body: {
        serviceInstanceId,
        hostId,
        agentId,
        providerType: 'IIS',
        siteType: 'WEB_SITE',
        siteName: 'Default Web Site',
        siteKey: 'iis-sync-agent-01:iis:default web site:*:443:sync-target.example.com',
        bindingInformation: '*:443:sync-target.example.com',
        hostHeader: 'sync-target.example.com',
        listenIp: '*',
        port: 443,
        protocol: 'HTTPS',
        metadata: { appPool: 'DefaultAppPool' },
      },
    });
    assert.equal(site.statusCode, 201);
    const siteAssetId = (site.body as { id: string }).id;

    const target = await app.inject({
      method: 'POST',
      path: '/api/v1/managed-targets',
      headers: userHeaders,
      body: {
        agentId,
        hostId,
        serviceInstanceId,
        siteAssetId,
        providerType: 'IIS',
        frameworkType: 'IIS',
        targetType: 'SITE_BINDING',
        targetKey: 'iis-sync-agent-01:site-binding:*:443:sync-target.example.com',
        bindingKey: '*:443:sync-target.example.com',
        capabilityProfile: { providerType: 'IIS', bindingInformation: '*:443:sync-target.example.com' },
      },
    });
    assert.equal(target.statusCode, 201);
    const managedTargetId = (target.body as { id: string }).id;

    const secret = await app.inject({
      method: 'POST',
      path: '/api/v1/secrets',
      headers: userHeaders,
      body: { name: 'iis sync pfx password', type: 'pfx_password', scopeType: 'global', plainText: 'IIS-Sync-123!' },
    });
    assert.equal(secret.statusCode, 201);
    const passwordSecretRef = (secret.body as { secretRef: string }).secretRef;

    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: userHeaders,
      body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
    });
    assert.equal(imported.statusCode, 201);
    const importedBody = imported.body as { version: { id: string; fingerprintSha256: string } };
    const certificateVersionId = importedBody.version.id;

    const exported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats/export',
      headers: userHeaders,
      body: {
        certificateVersionId,
        format: 'pfx',
        containsPrivateKey: true,
        passwordSecretRef,
        parameters: { alias: 'sync-target' },
      },
    });
    assert.equal(exported.statusCode, 201, JSON.stringify(exported.body));
    const exportedBody = exported.body as { artifactRef: string; passwordSecretRef?: string };
    const persistedFormat = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats',
      headers: userHeaders,
      body: {
        certificateVersionId,
        format: 'pfx',
        artifactRef: exportedBody.artifactRef,
        containsPrivateKey: true,
        passwordSecretRef: exportedBody.passwordSecretRef ?? passwordSecretRef,
        parameters: { alias: 'sync-target' },
      },
    });
    assert.equal(persistedFormat.statusCode, 201, JSON.stringify(persistedFormat.body));

    const serviceAsset = await app.inject({
      method: 'POST',
      path: '/api/v1/service-assets',
      headers: userHeaders,
      body: {
        address: 'sync-target.example.com',
        addressType: 'DNS',
        port: 443,
        protocol: 'HTTPS',
        platform: 'WINDOWS',
        hostId,
        agentId,
        serviceInstanceId,
        displayName: 'Sync Target',
        targetBinding: {
          agentId,
          siteAssetId,
          managedTargetId,
          providerType: 'IIS',
          frameworkType: 'IIS',
          targetType: 'SITE_BINDING',
          targetKey: managedTargetId,
          bindingKey: '*:443:sync-target.example.com',
          status: 'ACTIVE',
          metadata: { source: 'manual' },
        },
      },
    });
    assert.equal(serviceAsset.statusCode, 201, JSON.stringify(serviceAsset.body));
    const applicationAssetId = (serviceAsset.body as { id: string }).id;

    const binding = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers: userHeaders,
      body: {
        serviceInstanceId,
        serviceAssetId: applicationAssetId,
        siteAssetId,
        managedTargetId,
        domainName: 'sync-target.example.com',
        port: 443,
        protocol: 'HTTPS',
        bindingKey: '*:443:sync-target.example.com',
        bindingType: 'WINDOWS_CERT_STORE',
        certificateVersionId,
        targetCertificateVersionId: certificateVersionId,
        desiredFingerprintSha256: importedBody.version.fingerprintSha256,
        storeLocation: 'LocalMachine',
        storeName: 'My',
        storeThumbprint: '1111111111111111111111111111111111111111',
        verifyMethod: 'TLS_CONNECT',
      },
    });
    assert.equal(binding.statusCode, 201, JSON.stringify(binding.body));

    const createdPlan = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/from-application-asset',
      headers: userHeaders,
      body: {
        applicationAssetId,
        selectionMode: 'EXPLICIT',
        targetCertificateVersionId: certificateVersionId,
        idempotencyKey: 'idem_sync_application_asset_plan',
      },
    });
    assert.equal(createdPlan.statusCode, 201, JSON.stringify(createdPlan.body));
    const planId = (createdPlan.body as { id: string }).id;

    const submitted = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/submit',
      headers: userHeaders,
      body: { planId },
    });
    assert.equal(submitted.statusCode, 200);

    const executed = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/execute',
      headers: userHeaders,
      body: { planId, idempotencyKey: 'idem_sync_application_asset_run' },
    });
    assert.equal(executed.statusCode, 200);
    const executedBody = executed.body as { run: { id: string }; steps: Array<{ stepType: string }> };
    const runId = executedBody.run.id;
    const installStep = executedBody.steps.find((step) => step.stepType === 'INSTALL');
    assert.ok(installStep);

    const executeService = app.getResource('agentsService');
    const adapter = new AgentExecutorAdapter(executeService);
    const adapterResult = await adapter.executeStep({
      step: {
        ...installStep,
        tenantId: 'tenant_1',
        executionRunId: runId,
        attemptCount: 1,
      },
      runType: 'apply',
      dryRun: false,
    });
    assert.equal(adapterResult.success, true, JSON.stringify(adapterResult));

    const pulled = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/tasks/pull?agentId=${agentId}`,
      headers: userHeaders,
    });
    assert.equal(pulled.statusCode, 200);
    const task = (pulled.body as Array<{ id: string; payload: { type?: string } }>).find((item) => item.payload?.type === 'windows.iis.deploy_certificate');
    assert.ok(task);

    const ack = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/ack',
      headers: userHeaders,
      body: { agentId, taskId: task!.id, leaseId: 'lease_sync_1' },
    });
    assert.equal(ack.statusCode, 200);

    const result = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/result',
      headers: userHeaders,
      body: {
        agentId,
        taskId: task!.id,
        leaseId: 'lease_sync_1',
        success: true,
        detail: {
          oldThumbprint: '1111111111111111111111111111111111111111',
          newThumbprint: '2222222222222222222222222222222222222222',
          rolledBack: false,
          manualRequired: false,
          binding: {
            bindingInformation: '*:443:sync-target.example.com',
            hostHeader: 'sync-target.example.com',
            port: 443,
          },
          verify: {
            remoteThumbprint: '2222222222222222222222222222222222222222',
          },
        },
      },
    });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));

    const detail = await app.inject({
      method: 'GET',
      path: `/api/v1/service-assets/detail?serviceAssetId=${applicationAssetId}`,
      headers: userHeaders,
    });
    assert.equal(detail.statusCode, 200);
    const detailBody = detail.body as {
      targetSnapshots?: Array<{ snapshotType: string; storeThumbprint?: string; executionRunId?: string; metadata?: { resultState?: string } }>;
      targetBinding?: { status?: string; metadata?: { lastDeploymentResultState?: string; currentThumbprint?: string } };
      targetBindingDetail?: {
        managedTarget?: { status?: string; metadata?: { lastDeploymentResultState?: string } };
        siteAsset?: { runtimeStatus?: string; metadata?: { lastDeploymentResultState?: string } };
        certificateBindings: Array<{ status?: string; storeThumbprint?: string; metadata?: { deploymentResultState?: string } }>;
      };
    };
    assert.equal(detailBody.targetSnapshots?.length, 2, JSON.stringify(detailBody));
    assert.equal(detailBody.targetSnapshots?.[0]?.executionRunId, runId);
    assert.equal(detailBody.targetSnapshots?.some((item) => item.snapshotType === 'PRE_DEPLOY'), true);
    assert.equal(detailBody.targetSnapshots?.some((item) => item.snapshotType === 'POST_DEPLOY'), true);
    assert.equal(detailBody.targetBinding?.status, 'ACTIVE');
    assert.equal(detailBody.targetBinding?.metadata?.lastDeploymentResultState, 'DEPLOY_SUCCESS');
    assert.equal(detailBody.targetBinding?.metadata?.currentThumbprint, '2222222222222222222222222222222222222222');
    assert.equal(detailBody.targetBindingDetail?.siteAsset?.runtimeStatus, 'DEPLOYED');
    assert.equal(detailBody.targetBindingDetail?.siteAsset?.metadata?.lastDeploymentResultState, 'DEPLOY_SUCCESS');
    assert.equal(detailBody.targetBindingDetail?.managedTarget?.status, 'ACTIVE');
    assert.equal(detailBody.targetBindingDetail?.managedTarget?.metadata?.lastDeploymentResultState, 'DEPLOY_SUCCESS');
    const syncedBinding = detailBody.targetBindingDetail?.certificateBindings.find((item) => item.storeThumbprint === '2222222222222222222222222222222222222222');
    assert.equal(syncedBinding?.status, 'MANAGED');
    assert.equal(syncedBinding?.storeThumbprint, '2222222222222222222222222222222222222222');

  });

  it('按应用资产创建部署计划时会锁定 certificateFormatId，并把指定 format 带入步骤快照与 Agent payload', async () => {
    const security = createSecurityServices();
    security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'user_1',
      effect: 'allow',
      actions: ['host.create', 'service_instance.manage', 'site_asset.manage', 'managed_target.manage', 'binding.manage', 'secret.create', 'certificate.import', 'certificate.format.create', 'service_asset.manage', 'service_asset.read'],
      resourceTypes: ['host', 'service_instance', 'site_asset', 'managed_target', 'certificate_binding', 'secret', 'certificate_version', 'certificate_version_format', 'service_asset'],
      scope: { tenantId: 'tenant_1' },
    });
    const { app } = await createMigratedTestApp({ security });
    const chain = createPemChainFixture('format-target.example.com');

    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers: userHeaders,
      body: {
        agentKey: 'iis-format-agent-01',
        hostname: 'IIS-FORMAT-01',
        version: '1.0.0',
        osType: 'windows',
      },
    });
    assert.equal(registered.statusCode, 201);
    const agentId = (registered.body as { id: string }).id;

    const host = await app.inject({
      method: 'POST',
      path: '/api/v1/hosts',
      headers: userHeaders,
      body: { hostname: 'iis-format.example.com', primaryIp: '10.10.40.40', osType: 'WINDOWS', agentId, compatibilityLevel: 'L1', managementMode: 'AGENT' },
    });
    assert.equal(host.statusCode, 201);
    const hostId = (host.body as { id: string }).id;

    const service = await app.inject({
      method: 'POST',
      path: '/api/v1/service-instances',
      headers: userHeaders,
      body: { hostId, providerType: 'IIS', serviceName: 'iis', displayName: 'Default IIS', configPath: 'IIS:\\\\Sites' },
    });
    assert.equal(service.statusCode, 201);
    const serviceInstanceId = (service.body as { id: string }).id;

    const site = await app.inject({
      method: 'POST',
      path: '/api/v1/site-assets',
      headers: userHeaders,
      body: {
        serviceInstanceId,
        hostId,
        agentId,
        providerType: 'IIS',
        siteType: 'WEB_SITE',
        siteName: 'Default Web Site',
        siteKey: 'iis-format-agent-01:iis:default web site:*:443:format-target.example.com',
        bindingInformation: '*:443:format-target.example.com',
        hostHeader: 'format-target.example.com',
        listenIp: '*',
        port: 443,
        protocol: 'HTTPS',
        metadata: { appPool: 'DefaultAppPool' },
      },
    });
    assert.equal(site.statusCode, 201);
    const siteAssetId = (site.body as { id: string }).id;

    const target = await app.inject({
      method: 'POST',
      path: '/api/v1/managed-targets',
      headers: userHeaders,
      body: {
        agentId,
        hostId,
        serviceInstanceId,
        siteAssetId,
        providerType: 'IIS',
        frameworkType: 'IIS',
        targetType: 'SITE_BINDING',
        targetKey: 'iis-format-agent-01:site-binding:*:443:format-target.example.com',
        bindingKey: '*:443:format-target.example.com',
        capabilityProfile: { providerType: 'IIS', bindingInformation: '*:443:format-target.example.com' },
      },
    });
    assert.equal(target.statusCode, 201);
    const managedTargetId = (target.body as { id: string }).id;

    const secret = await app.inject({
      method: 'POST',
      path: '/api/v1/secrets',
      headers: userHeaders,
      body: { name: 'iis format pfx password', type: 'pfx_password', scopeType: 'global', plainText: 'IIS-Format-123!' },
    });
    assert.equal(secret.statusCode, 201);
    const passwordSecretRef = (secret.body as { secretRef: string }).secretRef;

    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: userHeaders,
      body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
    });
    assert.equal(imported.statusCode, 201);
    const importedBody = imported.body as { version: { id: string; fingerprintSha256: string } };
    const certificateVersionId = importedBody.version.id;

    const formatA = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats',
      headers: userHeaders,
      body: {
        format: 'pfx',
        containsPrivateKey: true,
        passwordSecretRef,
        parameters: {
          alias: 'format-a',
          systemPlatform: 'windows',
          runtimePlatform: 'iis',
          configName: 'Windows-IIS-PKCS12-A',
        },
      },
    });
    assert.equal(formatA.statusCode, 201, JSON.stringify(formatA.body));
    const formatAId = (formatA.body as { id: string }).id;

    const formatB = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats',
      headers: userHeaders,
      body: {
        format: 'pfx',
        containsPrivateKey: true,
        passwordSecretRef,
        parameters: {
          alias: 'format-b',
          systemPlatform: 'windows',
          runtimePlatform: 'iis',
          configName: 'Windows-IIS-PKCS12-B',
        },
      },
    });
    assert.equal(formatB.statusCode, 201, JSON.stringify(formatB.body));

    const serviceAsset = await app.inject({
      method: 'POST',
      path: '/api/v1/service-assets',
      headers: userHeaders,
      body: {
        address: 'format-target.example.com',
        addressType: 'DNS',
        port: 443,
        protocol: 'HTTPS',
        platform: 'WINDOWS',
        hostId,
        agentId,
        serviceInstanceId,
        displayName: 'Format Target',
        targetBinding: {
          agentId,
          siteAssetId,
          managedTargetId,
          providerType: 'IIS',
          frameworkType: 'IIS',
          targetType: 'SITE_BINDING',
          targetKey: managedTargetId,
          bindingKey: '*:443:format-target.example.com',
          status: 'ACTIVE',
          metadata: { source: 'manual' },
        },
      },
    });
    assert.equal(serviceAsset.statusCode, 201, JSON.stringify(serviceAsset.body));
    const applicationAssetId = (serviceAsset.body as { id: string }).id;

    await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers: userHeaders,
      body: {
        serviceInstanceId,
        serviceAssetId: applicationAssetId,
        siteAssetId,
        managedTargetId,
        domainName: 'format-target.example.com',
        port: 443,
        protocol: 'HTTPS',
        bindingKey: '*:443:format-target.example.com',
        bindingType: 'WINDOWS_CERT_STORE',
        certificateVersionId,
        targetCertificateVersionId: certificateVersionId,
        desiredFingerprintSha256: importedBody.version.fingerprintSha256,
        storeLocation: 'LocalMachine',
        storeName: 'My',
        storeThumbprint: '3333333333333333333333333333333333333333',
        verifyMethod: 'TLS_CONNECT',
      },
    });

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/from-application-asset',
      headers: userHeaders,
      body: {
        applicationAssetId,
        selectionMode: 'EXPLICIT',
        targetCertificateVersionId: certificateVersionId,
        certificateFormatId: formatAId,
        idempotencyKey: 'idem_application_asset_plan_with_format',
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const plan = created.body as { id: string; certificateVersionId: string; certificateFormatId?: string };
    assert.equal(plan.certificateVersionId, certificateVersionId);
    assert.equal(plan.certificateFormatId, formatAId);

    const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: plan.id } });
    assert.equal(submitted.statusCode, 200);

    const executed = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/execute',
      headers: userHeaders,
      body: { planId: plan.id, idempotencyKey: 'idem_application_asset_execute_with_format' },
    });
    assert.equal(executed.statusCode, 200, JSON.stringify(executed.body));
    const executeBody = executed.body as { run: { id: string }; steps: Array<{ id: string; stepType: string; inputSnapshot: any }> };
    const installStep = executeBody.steps.find((step) => step.stepType === 'INSTALL');
    assert.ok(installStep);
    assert.equal(installStep!.inputSnapshot.deploymentArtifact.certificateFormatId, formatAId);
    assert.equal(installStep!.inputSnapshot.deploymentArtifact.format, 'pfx');
    assert.equal(installStep!.inputSnapshot.deploymentArtifact.containsPrivateKey, true);
    assert.equal(typeof installStep!.inputSnapshot.pfxBase64, 'undefined');

    const executeService = app.getResource('agentsService');
    const adapter = new AgentExecutorAdapter(executeService);
    const adapterResult = await adapter.executeStep({
      step: {
        ...installStep!,
        tenantId: 'tenant_1',
        executionRunId: executeBody.run.id,
        attemptCount: 1,
      },
      runType: 'apply',
      dryRun: false,
    });
    assert.equal(adapterResult.success, true);

    const pulled = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/tasks/pull?agentId=${agentId}`,
      headers: userHeaders,
    });
    assert.equal(pulled.statusCode, 200);
    const tasks = pulled.body as Array<{ payload: any }>;
    const installTask = tasks.find((task) => task.payload?.type === 'windows.iis.deploy_certificate');
    assert.ok(installTask);
    assert.equal(installTask!.payload.deploymentArtifact.certificateFormatId, formatAId);
    assert.equal(installTask!.payload.deploymentArtifact.format, 'pfx');
    assert.equal(installTask!.payload.deploymentArtifact.containsPrivateKey, true);
    assert.equal(typeof installTask!.payload.pfxBase64, 'string');
    assert.equal(installTask!.payload.pfxBase64.length > 0, true);
    assert.equal(typeof installTask!.payload.pfxPassword, 'string');
    assert.notEqual(installTask!.payload.pfxPassword, '[REDACTED]');
  });

  it('dry-run 经 Agent 回传后会把 dryRunChecks 和 dryRunSummary 写回步骤结果结构', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const ready = await createReadyLowRiskPlan(app, fixture, 'idem_dry_run_checks_plan');

    const dryRun = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/dry-run',
      headers: userHeaders,
      body: { planId: ready.id, idempotencyKey: 'idem_dry_run_checks_run' },
    });
    assert.equal(dryRun.statusCode, 200, JSON.stringify(dryRun.body));
    const dryRunBody = dryRun.body as { run: { id: string }; steps: Array<{ id: string; inputSnapshot: any }> };
    const step = dryRunBody.steps[0]!;

    const agentsService = app.getResource('agentsService');
    const adapter = new AgentExecutorAdapter(agentsService);
    const adapterResult = await adapter.executeStep({
      step: {
        ...step,
        tenantId: 'tenant_1',
        executionRunId: dryRunBody.run.id,
        attemptCount: 1,
      },
      runType: 'dry_run',
      dryRun: true,
    });
    assert.equal(adapterResult.success, true, JSON.stringify(adapterResult));

    const pulled = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/tasks/pull?agentId=${fixture.agentId}`,
      headers: userHeaders,
    });
    assert.equal(pulled.statusCode, 200);
    const task = (pulled.body as Array<{ id: string; payload: any }>).find((item) => item.payload?.dryRun === true);
    assert.ok(task);

    const ack = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/ack',
      headers: userHeaders,
      body: { agentId: fixture.agentId, taskId: task!.id, leaseId: 'lease_dry_run_checks_1' },
    });
    assert.equal(ack.statusCode, 200);

    const result = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/result',
      headers: userHeaders,
      body: {
        agentId: fixture.agentId,
        taskId: task!.id,
        leaseId: 'lease_dry_run_checks_1',
        success: true,
        detail: {
          mode: 'dry_run_preflight',
          dryRunChecks: [
            { key: 'site_exists', label: '站点存在', status: 'passed', detail: '已命中 IIS 站点' },
            { key: 'pfx_loadable', label: 'PFX 可解析', status: 'passed', detail: 'PFX 可被本机解析' },
            { key: 'domain_match', label: '证书域名匹配', status: 'warning', detail: '域名存在回退判断' },
          ],
          dryRunSummary: { passed: 2, failed: 0, warning: 1, unknown: 0 },
        },
      },
    });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));

    const executionSteps = await app.inject({
      method: 'GET',
      path: `/api/v1/execution-steps?executionRunId=${dryRunBody.run.id}`,
      headers: userHeaders,
    });
    assert.equal(executionSteps.statusCode, 200, JSON.stringify(executionSteps.body));
    const storedStep = ((executionSteps.body as {
      items: Array<{ id: string; inputSnapshot: any }>;
    }).items ?? []).find((item) => item.id === step.id);
    assert.ok(storedStep);
    assert.deepEqual(storedStep!.inputSnapshot.resultDetail.dryRunSummary, { passed: 2, failed: 0, warning: 1, unknown: 0 });
    assert.equal(storedStep!.inputSnapshot.resultDetail.dryRunChecks.length, 3);
    assert.deepEqual(storedStep!.inputSnapshot.resultDetail.dryRunChecks[0], {
      key: 'site_exists',
      label: '站点存在',
      status: 'passed',
      detail: '已命中 IIS 站点',
    });
  });

});

function grantDeploymentFixturePolicies(security: ReturnType<typeof createSecurityServices>, tenantId: string): void {
  security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: 'user_1',
    effect: 'allow',
    actions: ['host.create', 'service_instance.manage', 'site_asset.manage', 'managed_target.manage', 'binding.manage', 'secret.create', 'certificate.import', 'certificate.format.create'],
    resourceTypes: ['host', 'service_instance', 'site_asset', 'managed_target', 'certificate_binding', 'secret', 'certificate_version', 'certificate_version_format'],
    scope: { tenantId },
  });
}

function grantWildcardPolicy(security: ReturnType<typeof createSecurityServices>, subjectId: string, tenantId: string): void {
  security.rbac.createPolicy({
    subjectType: 'user',
    subjectId,
    effect: 'allow',
    actions: ['*'],
    resourceTypes: ['*'],
    scope: { tenantId },
  });
}

function workflowTemplateFixture(name: string): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name, category: 'certificate_deployment' },
    variables: {
      host: { type: 'string', required: true },
      sshCredential: { type: 'credential', required: false },
    },
    steps: [
      {
        name: 'deploy',
        type: 'ssh',
        ssh: {
          mode: 'command',
          connection: {
            host: '{{host}}',
            username: 'deploy',
            credential: '{{sshCredential}}',
          },
          command: 'echo deploy',
        },
      },
    ],
  };
}

function workflowHttpCertificateFixture(name: string): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name, category: 'certificate_deployment' },
    variables: {
      callbackUrl: { type: 'string', required: true },
    },
    steps: [
      {
        name: 'verifyRemoteCertificate',
        type: 'http',
        request: {
          method: 'GET',
          url: '{{callbackUrl}}',
          successStatusCodes: [200],
        },
        extract: {
          remoteFingerprintSha256: { type: 'jsonPath', path: '$.fingerprint' },
          remoteThumbprint: { type: 'jsonPath', path: '$.thumbprint', optional: true },
        },
        assert: [{ type: 'statusCode', equals: 200 }],
      },
    ],
  };
}

async function seedWorkflowStrategyFixture(app: ReturnType<typeof createApp>): Promise<{
  applicationAssetId: string;
  bindingId: string;
  certificateVersionId: string;
  certificateFormatId: string;
  certificateFingerprintSha256: string;
  domain: string;
}> {
  const domain = 'workflow-strategy.example.com';
  const agent = await app.inject({
    method: 'POST',
    path: '/api/v1/agents/register',
    headers: userHeaders,
    body: { agentKey: 'workflow-strategy-agent-01', hostname: 'workflow-strategy-host', version: '1.0.0', osType: 'windows' },
  });
  assert.equal(agent.statusCode, 201, JSON.stringify(agent.body));
  const agentId = (agent.body as { id: string }).id;

  const host = await app.inject({
    method: 'POST',
    path: '/api/v1/hosts',
    headers: userHeaders,
    body: { hostname: 'workflow-strategy-host.example.com', osType: 'WINDOWS', agentId, compatibilityLevel: 'L1', managementMode: 'AGENT' },
  });
  assert.equal(host.statusCode, 201, JSON.stringify(host.body));
  const hostId = (host.body as { id: string }).id;

  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/service-instances',
    headers: userHeaders,
    body: { hostId, providerType: 'IIS', serviceName: 'iis', displayName: 'iis', configPath: 'IIS:\\\\Sites' },
  });
  assert.equal(service.statusCode, 201, JSON.stringify(service.body));
  const serviceInstanceId = (service.body as { id: string }).id;

  const certificate = await importCertificateFormatFixture(app, 'tenant_1', domain, 'workflow_strategy');

  const site = await app.inject({
    method: 'POST',
    path: '/api/v1/site-assets',
    headers: userHeaders,
    body: {
      serviceInstanceId,
      hostId,
      agentId,
      providerType: 'IIS',
      siteType: 'WEB_SITE',
      siteName: 'Workflow Strategy Site',
      siteKey: `workflow-strategy-agent-01:iis:*:443:${domain}`,
      bindingInformation: `*:443:${domain}`,
      hostHeader: domain,
      listenIp: '*',
      port: 443,
      protocol: 'HTTPS',
    },
  });
  assert.equal(site.statusCode, 201, JSON.stringify(site.body));
  const siteAssetId = (site.body as { id: string }).id;

  const target = await app.inject({
    method: 'POST',
    path: '/api/v1/managed-targets',
    headers: userHeaders,
    body: {
      agentId,
      hostId,
      serviceInstanceId,
      siteAssetId,
      providerType: 'IIS',
      frameworkType: 'IIS',
      targetType: 'SITE_BINDING',
      targetKey: `workflow-strategy-agent-01:iis:*:443:${domain}`,
      bindingKey: `*:443:${domain}`,
      capabilityProfile: { canDeployPfx: true },
      deploymentMode: 'AGENT_PUSH',
    },
  });
  assert.equal(target.statusCode, 201, JSON.stringify(target.body));
  const managedTarget = target.body as { id: string; bindingKey?: string };

  const asset = await app.inject({
    method: 'POST',
    path: '/api/v1/service-assets',
    headers: userHeaders,
    body: {
      serviceInstanceId,
      hostId,
      agentId,
      address: domain,
      addressType: 'DNS',
      protocol: 'HTTPS',
      port: 443,
      platform: 'WINDOWS',
      displayName: domain,
      targetBinding: {
        agentId,
        siteAssetId,
        managedTargetId: managedTarget.id,
        providerType: 'IIS',
        frameworkType: 'IIS',
        targetType: 'SITE_BINDING',
        targetKey: managedTarget.id,
        bindingKey: managedTarget.bindingKey,
        status: 'ACTIVE',
      },
    },
  });
  assert.equal(asset.statusCode, 201, JSON.stringify(asset.body));
  const applicationAssetId = (asset.body as { id: string }).id;

  const bindings = await app.inject({
    method: 'GET',
    path: `/api/v1/certificate-bindings?filter[serviceAssetId]=${applicationAssetId}`,
    headers: userHeaders,
  });
  assert.equal(bindings.statusCode, 200, JSON.stringify(bindings.body));
  const binding = (bindings.body as { items: Array<{ id: string }> }).items[0];
  assert.ok(binding);

  return {
    applicationAssetId,
    bindingId: binding.id,
    certificateVersionId: certificate.certificateVersionId,
    certificateFormatId: certificate.certificateFormatId,
    certificateFingerprintSha256: certificate.certificateFingerprintSha256,
    domain,
  };
}

async function seedDeploymentFixture(app: ReturnType<typeof createApp>, tenantId: string): Promise<DeploymentFixture> {
  const chain = createPemChainFixture();
  const headers = { ...userHeaders, 'x-tenant-id': tenantId };

  const registered = await app.inject({
    method: 'POST',
    path: '/api/v1/agents/register',
    headers,
    body: {
      agentKey: `${tenantId}-fixture-agent-01`,
      hostname: `${tenantId.toUpperCase()}-FIXTURE-01`,
      version: '1.0.0',
      osType: 'windows',
    },
  });
  assert.equal(registered.statusCode, 201);
  const agentId = (registered.body as { id: string }).id;

  const host = await app.inject({
    method: 'POST',
    path: '/api/v1/hosts',
    headers,
    body: { hostname: `${tenantId}.fixture.example.com`, primaryIp: '10.250.0.1', osType: 'WINDOWS', agentId, compatibilityLevel: 'L1', managementMode: 'AGENT' },
  });
  assert.equal(host.statusCode, 201);
  const hostId = (host.body as { id: string }).id;

  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/service-instances',
    headers,
    body: { hostId, providerType: 'IIS', serviceName: 'iis', displayName: 'Default IIS', configPath: 'IIS:\\\\Sites' },
  });
  assert.equal(service.statusCode, 201);
  const serviceInstanceId = (service.body as { id: string }).id;

  const imported = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-versions/import',
    headers,
    body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
  });
  assert.equal(imported.statusCode, 201);
  const importedBody = imported.body as { version: { id: string; fingerprintSha256: string } };
  const certificateVersionId = importedBody.version.id;

  const secret = await app.inject({
    method: 'POST',
    path: '/api/v1/secrets',
    headers,
    body: { name: `${tenantId} fixture pfx password`, type: 'pfx_password', scopeType: 'global', plainText: 'Fixture-Pfx-123!' },
  });
  assert.equal(secret.statusCode, 201);
  const passwordSecretRef = (secret.body as { secretRef: string }).secretRef;

  const exported = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-version-formats',
    headers,
      body: {
        certificateVersionId,
        format: 'pfx',
        artifactRef: `artifact://certificate-format/${certificateVersionId}/pfx`,
        containsPrivateKey: true,
        passwordSecretRef,
        parameters: { alias: tenantId, systemPlatform: 'windows', runtimePlatform: 'iis' },
      },
    });
  assert.equal(exported.statusCode, 201);
  const certificateFormatId = (exported.body as { id: string }).id;

  const targets: Array<{ key: keyof Pick<DeploymentFixture, 'target_1' | 'binding_ok' | 'binding_blocked'>; domain: string }> = [
    { key: 'target_1', domain: 'iis-site.example.com' },
    { key: 'binding_ok', domain: 'ok.example.com' },
    { key: 'binding_blocked', domain: 'blocked.example.com' },
  ];
  const seededTargets = {} as Pick<DeploymentFixture, 'target_1' | 'binding_ok' | 'binding_blocked'>;

  for (const item of targets) {
    const bindingKey = `*:443:${item.domain}`;
    const site = await app.inject({
      method: 'POST',
      path: '/api/v1/site-assets',
      headers,
      body: {
        serviceInstanceId,
        hostId,
        agentId,
        providerType: 'IIS',
        siteType: 'WEB_SITE',
        siteName: `Site ${item.key}`,
        siteKey: `${tenantId}:iis:${item.key}:${bindingKey}`,
        bindingInformation: bindingKey,
        hostHeader: item.domain,
        listenIp: '*',
        port: 443,
        protocol: 'HTTPS',
        metadata: { appPool: 'DefaultAppPool' },
      },
    });
    assert.equal(site.statusCode, 201);
    const siteAssetId = (site.body as { id: string }).id;

    const target = await app.inject({
      method: 'POST',
      path: '/api/v1/managed-targets',
      headers,
      body: {
        agentId,
        hostId,
        serviceInstanceId,
        siteAssetId,
        providerType: 'IIS',
        frameworkType: 'IIS',
        targetType: 'SITE_BINDING',
        targetKey: `${tenantId}:site-binding:${item.key}:${bindingKey}`,
        bindingKey,
        capabilityProfile: { providerType: 'IIS', bindingInformation: bindingKey },
      },
    });
    assert.equal(target.statusCode, 201);
    const managedTargetId = (target.body as { id: string }).id;

    const serviceAsset = await app.inject({
      method: 'POST',
      path: '/api/v1/service-assets',
      headers,
      body: {
        serviceInstanceId,
        address: item.domain,
        addressType: 'DNS',
        protocol: 'HTTPS',
        port: 443,
        environment: 'test',
        owner: 'qa',
        displayName: item.domain,
      },
    });
    assert.equal(serviceAsset.statusCode, 201);
    const applicationAssetId = (serviceAsset.body as { id: string }).id;

    const targetBinding = await app.inject({
      method: 'POST',
      path: '/api/v1/application-asset-targets',
      headers,
      body: {
        applicationAssetId,
        siteAssetId,
        managedTargetId,
        bindingKey,
      },
    });
    if (targetBinding.statusCode !== 201) {
      throw new Error(`seedDeploymentFixture 创建 ApplicationAssetTarget 失败：${targetBinding.statusCode} ${JSON.stringify(targetBinding.body)}`);
    }

    const binding = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: {
        serviceInstanceId,
        serviceAssetId: applicationAssetId,
        siteAssetId,
        managedTargetId,
        domainName: item.domain,
        port: 443,
        protocol: 'HTTPS',
        bindingKey,
        bindingType: 'WINDOWS_CERT_STORE',
        certificateVersionId,
        targetCertificateVersionId: certificateVersionId,
        desiredFingerprintSha256: importedBody.version.fingerprintSha256,
        storeLocation: 'LocalMachine',
        storeName: 'My',
        storeThumbprint: `${item.key}`.padEnd(40, '1').slice(0, 40).toUpperCase(),
        verifyMethod: 'TLS_CONNECT',
      },
    });
    if (binding.statusCode !== 201) {
      throw new Error(`seedDeploymentFixture 创建 CertificateBinding 失败：${binding.statusCode} ${JSON.stringify(binding.body)}`);
    }
    const bindingId = (binding.body as { id: string }).id;

    seededTargets[item.key] = { applicationAssetId, siteAssetId, managedTargetId, bindingId, bindingKey, domain: item.domain };
  }

  return {
    agentId,
    hostId,
    serviceInstanceId,
    certificateVersionId,
    certificateFormatId,
    certificateFingerprintSha256: importedBody.version.fingerprintSha256,
    ...seededTargets,
  };
}

async function importCertificateFormatFixture(
  app: ReturnType<typeof createApp>,
  tenantId: string,
  commonName: string,
  alias: string,
): Promise<{ certificateVersionId: string; certificateFormatId: string; certificateFingerprintSha256: string }> {
  const headers = { 'x-actor-id': 'user_1', 'x-tenant-id': tenantId, 'x-request-id': `req_${alias}` };
  const pemFixture = createPemChainFixture(commonName);
  const imported = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-versions/import',
    headers,
    body: {
      sourceType: 'manual',
      certificatePem: pemFixture.pem,
      privateKeyPem: pemFixture.privateKeyPem,
      importedBy: 'user_1',
    },
  });
  assert.equal(imported.statusCode, 201, JSON.stringify(imported.body));
  const importedBody = imported.body as { version: { id: string; fingerprintSha256: string } };

  const secret = await app.inject({
    method: 'POST',
    path: '/api/v1/secrets',
    headers,
    body: { name: `${alias} pfx password`, type: 'pfx_password', scopeType: 'global', plainText: 'Fixture-Pfx-456!' },
  });
  assert.equal(secret.statusCode, 201, JSON.stringify(secret.body));

  const exported = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-version-formats',
    headers,
    body: {
      certificateVersionId: importedBody.version.id,
      format: 'pfx',
      artifactRef: `artifact://certificate-format/${importedBody.version.id}/pfx/${alias}`,
      containsPrivateKey: true,
      passwordSecretRef: (secret.body as { secretRef: string }).secretRef,
      parameters: { alias, systemPlatform: 'windows', runtimePlatform: 'iis' },
    },
  });
  assert.equal(exported.statusCode, 201, JSON.stringify(exported.body));

  return {
    certificateVersionId: importedBody.version.id,
    certificateFormatId: (exported.body as { id: string }).id,
    certificateFingerprintSha256: importedBody.version.fingerprintSha256,
  };
}

function createPemChainFixture(commonName = 'iis-site.example.com'): { pem: string; privateKeyPem: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gcac-deployment-chain-'));
  try {
    runOpenSsl(dir, 'genrsa', '-out', 'root.key', '2048');
    runOpenSsl(dir, 'req', '-x509', '-new', '-nodes', '-key', 'root.key', '-sha256', '-days', '3650', '-subj', '/CN=Root CA/O=GCAC', '-out', 'root.pem');

    runOpenSsl(dir, 'genrsa', '-out', 'intermediate.key', '2048');
    runOpenSsl(dir, 'req', '-new', '-key', 'intermediate.key', '-subj', '/CN=Intermediate CA/O=GCAC', '-out', 'intermediate.csr');
    writeFileSync(join(dir, 'intermediate.ext'), 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n');
    runOpenSsl(dir, 'x509', '-req', '-in', 'intermediate.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-out', 'intermediate.pem', '-days', '1000', '-sha256', '-extfile', 'intermediate.ext');

    runOpenSsl(dir, 'genrsa', '-out', 'leaf.key', '2048');
    runOpenSsl(dir, 'req', '-new', '-key', 'leaf.key', '-subj', `/CN=${commonName}/O=GCAC`, '-out', 'leaf.csr');
    writeFileSync(join(dir, 'leaf.ext'), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${commonName},DNS:www.${commonName}\n`);
    runOpenSsl(dir, 'x509', '-req', '-in', 'leaf.csr', '-CA', 'intermediate.pem', '-CAkey', 'intermediate.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '365', '-sha256', '-extfile', 'leaf.ext');

    return {
      pem: [readFileSync(join(dir, 'leaf.pem'), 'utf8'), readFileSync(join(dir, 'intermediate.pem'), 'utf8'), readFileSync(join(dir, 'root.pem'), 'utf8')].join('\n'),
      privateKeyPem: readFileSync(join(dir, 'leaf.key'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runOpenSsl(cwd: string, ...args: string[]): void {
  execFileSync('openssl', args, { cwd, stdio: 'ignore' });
}

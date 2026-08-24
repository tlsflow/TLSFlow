// @ts-nocheck
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, describe as baseDescribe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { configureTestAuth, testAuthHeaders } from '../../common/http/test-auth.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgAssetsRepository } from '../assets/repository/assets.repository.js';
import { PgBindingsRepository } from '../bindings/repository/bindings.repository.js';
import { PgCertificatesRepository } from '../certificates/repository/certificates.repository.js';
import { createCertificateServices } from '../certificates/controller/certificates.controller.js';
import { CertificateFormatExporter } from '../certificates/application/certificate-format-exporter.js';
import { PgDeviceAssetsRepository } from '../device-assets/repository/device-assets.repository.js';
import { createSecurityServices } from '../security/security.controller.js';
import { DeploymentInputSnapshotsRepository } from '../deployment-inputs/repository/deployment-input-snapshots.repository.js';
import { DeploymentPlansApplicationService } from './application/deployment-plans.application-service.js';
import { GatewaysApplicationService } from '../gateways/application/gateways.application-service.js';
import { DeploymentPlansRepository } from './repository/deployment-plans.repository.js';
import type { CreateDeploymentPlanInput } from './dto/deployment-plans.dto.js';
import { AgentExecutorAdapter } from '../executions/application/executors.js';
import { ExecutionsApplicationService } from '../executions/application/executions.application-service.js';
import type { PluginRunnerExecutionDependencies } from '../executions/application/plugin-runner-executor.adapter.js';
import type { PluginRunnerExecutionInput, PluginRunnerLaunchSpec } from '../plugins/runner/index.js';
import type { PluginRunnerExecuteResult } from '../plugins/runner/protocol/protocol.types.js';
import type { WorkflowDslV1 } from '../workflow-templates/dto/workflow-templates.dto.js';
import { BuiltinUnifiedPluginLoader } from '../plugins/builtin-plugins/builtin-unified-plugin-loader.js';
import { WorkflowTemplatesApplicationService } from '../workflow-templates/application/workflow-templates.application-service.js';
import { computeAgentExecutionReceiptDigest, computeAgentPlanDigest } from '../agents/security/agent-security.contract.js';
import { signPolicyPayload } from '../agents/security/agent-security.contract.js';
import { FilePolicyAuthorityStateStoreV1, PolicyAuthorityServiceV1 } from '../agents/security/policy-authority.service.js';

const userHeaders = testAuthHeaders('user_1', 'tenant_1', { 'x-request-id': 'req_test' });
const approverHeaders = testAuthHeaders('approver_1', 'tenant_1', { 'x-request-id': 'req_approve' });
const describe = (name: string, fn: () => void) => baseDescribe(name, { concurrency: false }, fn);

const activeTestDatabases = new Set<PgliteDatabase>();
const activePolicyAuthorityStatePaths = new Set<string>();

function createTrackedDatabase(): PgliteDatabase {
  const db = new PgliteDatabase();
  activeTestDatabases.add(db);
  return db;
}

async function closeTrackedDatabases(): Promise<void> {
  const databases = [...activeTestDatabases];
  activeTestDatabases.clear();
  await Promise.all(databases.map((db) => db.close()));
}

async function closeTestResources(): Promise<void> {
  await closeTrackedDatabases();
  for (const statePath of activePolicyAuthorityStatePaths) {
    rmSync(statePath, { force: true });
    rmSync(`${statePath}.lock`, { force: true });
    rmSync(join(statePath, '..'), { recursive: true, force: true });
  }
  activePolicyAuthorityStatePaths.clear();
}

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
  const db = createTrackedDatabase();
  await runMigrations(db);
  const security = options.security ?? createSecurityServices();
  await grantDeploymentFixturePolicies(security, 'tenant_1');
  const app = createDeploymentTestApp(db, security);
  configureDeploymentLicenseFixture(app);
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
} = {}) {
  const db = createTrackedDatabase();
  await runMigrations(db);
  const security = options.security ?? createSecurityServices();
  await grantDeploymentFixturePolicies(security, 'tenant_1');
  const app = createDeploymentTestApp(db, security);
  configureDeploymentLicenseFixture(app);
  const service = app.getResource('deploymentPlansService') as DeploymentPlansApplicationService;
  const repository = service.getRepository();
  const assets = new PgAssetsRepository(db);
  const bindings = new PgBindingsRepository(assets, db);
  const certificates = new PgCertificatesRepository(db);
  const fixture = await seedDeploymentFixture(app, 'tenant_1');
  return { db, security, app, repository, assets, bindings, certificates, service, fixture };
}

function createDeploymentTestApp(db: PgliteDatabase, security: ReturnType<typeof createSecurityServices>) {
  const certificates = createCertificateServices(security, { db, pfxExporter: new PfxPluginRunnerFixture() });
  // 本文件只验证部署插件的 v2 执行合同；旧领域信任计划由独立测试覆盖，不能把已退役的动作带入本 Fixture。
  Object.defineProperty(certificates.certificates, 'getTrustRoots', { value: undefined });
  return configureTestAuth(createApp({
    db,
    corePersistence: { mode: 'memory' },
    security,
    agentPlanAuthorization: createDeploymentAgentPlanAuthorizationFixture(security),
    certificates,
    pluginRunner: createDeploymentPluginRunnerFixture(),
  }));
}

function createDeploymentAgentPlanAuthorizationFixture(security: ReturnType<typeof createSecurityServices>) {
  const root = generateKeyPairSync('ed25519');
  const signer = generateKeyPairSync('ed25519');
  const rootPublicKeyPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const signerPublicKeyPem = signer.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const trustRoot = {
    rootKeyId: 'gcac-policy-root-2026',
    authorityId: 'gcac-policy-authority-2026',
    algorithm: 'Ed25519',
    publicKeyPem: rootPublicKeyPem,
    fingerprintSha256: createHash('sha256').update(root.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'),
  };
  const keySet = {
    keySetVersion: 'gcac.agent-security/v1',
    authorityId: trustRoot.authorityId,
    activeKeyId: 'gcac-policy-signing-2026',
    issuedAt: '2026-01-01T00:00:00.000Z',
    keys: [{
      keyId: 'gcac-policy-signing-2026',
      algorithm: 'Ed25519',
      publicKeyPem: signerPublicKeyPem,
      status: 'ACTIVE',
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2099-01-01T00:00:00.000Z',
    }],
  };
  const envelopeValue = {
    envelopeVersion: 'gcac.agent-security/v1',
    rootKeyId: trustRoot.rootKeyId,
    authorityId: trustRoot.authorityId,
    keySet,
  };
  const statePath = join(mkdtempSync(join(tmpdir(), 'gcac-p1-agent-policy-')), 'state.json');
  writeFileSync(statePath, JSON.stringify({
    stateVersion: 'gcac.policy-authority-state/v1',
    revokedTokenIds: [],
    revokedDecisionIds: [],
    revokedKeyIds: [],
    nonces: [],
  }), 'utf8');
  activePolicyAuthorityStatePaths.add(statePath);
  const state = new FilePolicyAuthorityStateStoreV1(statePath);
  const authority = new PolicyAuthorityServiceV1({
    trustRoot,
    keySet: { ...envelopeValue, signature: signPolicyPayload(envelopeValue, root.privateKey) },
    signingKeySource: { getPrivateKey: (keyId: string) => keyId === 'gcac-policy-signing-2026' ? signer.privateKey : undefined },
    evaluator: {
      evaluate: (request: Record<string, unknown>) => ({
        allowed: true,
        actions: request.actions,
        allowedPaths: request.allowedPaths,
        allowedServices: request.allowedServices,
        artifactDigests: request.artifactDigests,
        policyRef: request.policyRef,
        policyVersion: request.policyVersion,
      }),
    },
    revocations: state,
    nonceStore: state,
    now: () => new Date().toISOString(),
  });
  return {
    policyAuthority: {
      assertReady: () => { authority.getTrustedKeySet(); },
      issueAuthorization: (request: Record<string, unknown>) => authority.issueAuthorization(request as never),
    },
    grants: { validate: (input: Record<string, unknown>) => security.grants.validate(input as never) },
    localPolicy: {
      resolve: async ({ agentId }: { agentId: string }) => ({
        policyVersion: 'gcac.agent-security/v1',
        agentId,
        authorityKeyIds: ['gcac-policy-signing-2026'],
        allowedActions: ['certificate.store.inspect'],
        pathRules: [],
        serviceRules: [],
        commandRules: [],
        disabled: false,
        updatedAt: new Date().toISOString(),
      }),
    },
  };
}

function createDeploymentPluginRunnerFixture(): PluginRunnerExecutionDependencies {
  const runner = {
    executablePath: process.execPath,
    workingDirectory: process.cwd(),
    args: ['deployment-execution-api-test-runner'],
    executorModulePath: process.execPath,
    runnerVersion: 'fixture-1.0.0',
    sdkVersion: 'fixture-1.0.0',
  };
  return {
    runner,
    supervisor: {
      start: async (spec: PluginRunnerLaunchSpec) => ({
        execute: async (input: PluginRunnerExecutionInput): Promise<PluginRunnerExecuteResult> => ({
          protocolVersion: 'gcac.plugin-runner/v1',
          messageType: 'execute_result',
          requestId: `fixture-${input.executionStepId}`,
          sentAt: new Date().toISOString(),
          pluginVersionId: spec.pluginVersionId,
          tenantId: input.tenantId,
          executionId: input.executionId,
          executionStepId: input.executionStepId,
          success: true,
          status: 'SUCCESS',
          summary: {
            state: 'SUCCEEDED',
            operationResults: [{
              operationId: `runner-preflight-${input.executionStepId}`,
              operationType: 'preflight.assert',
              stage: 'prepare',
              status: 'SUCCEEDED',
              detail: { passed: true },
            }],
          },
          normalizedObjects: [],
          warnings: [],
        }),
      }),
    },
  };
}

class PfxPluginRunnerFixture extends CertificateFormatExporter {
  override generate(format: string, input: Record<string, unknown>) {
    if (format !== 'pfx') return super.generate(format, input as never);
    const content = Buffer.from(`pfx-plugin-runner:${String((input.version as { id?: string })?.id ?? 'fixture')}`, 'utf8');
    return {
      format: 'pfx',
      content,
      contentType: 'application/x-pkcs12',
      warnings: [],
      files: [{ key: 'bundle', role: 'bundle', format: 'pfx', contentBase64: content.toString('base64'), contentEncoding: 'base64' }],
    };
  }
}

function configureDeploymentLicenseFixture(app: ReturnType<typeof createApp>): void {
  const licensing = app.getResource('licensingService');
  assert.ok(licensing);
  licensing.requireApplicationAssetQuota = async () => undefined;
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
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/deployment-plans/from-application-asset',
    headers: userHeaders,
    body: {
      applicationAssetId: fixture.target_1.applicationAssetId,
      targetCertificateVersionId: fixture.certificateVersionId,
      certificateFormatId: fixture.certificateFormatId,
      selectionMode: 'EXPLICIT',
      idempotencyKey,
      policy: { riskLevel: 'low', approvalRequired: false, failurePolicy: 'rollback' },
    },
  });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const plan = created.body as { id: string };
  const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: plan.id } });
  assert.equal(submitted.statusCode, 200);
  return submitted.body as { id: string; status: string };
}

async function createApprovedHighRiskPlan(app: ReturnType<typeof createApp>, fixture: DeploymentFixture, idempotencyKey = 'idem_plan_high') {
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/deployment-plans/from-application-asset',
    headers: userHeaders,
    body: {
      applicationAssetId: fixture.target_1.applicationAssetId,
      targetCertificateVersionId: fixture.certificateVersionId,
      certificateFormatId: fixture.certificateFormatId,
      selectionMode: 'EXPLICIT',
      idempotencyKey,
      policy: { riskLevel: 'high', approvalRequired: true, failurePolicy: 'rollback' },
    },
  });
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

async function createIisManagedTargetFixture(app: ReturnType<typeof createApp>, input: {
  hostId: string;
  frameworkInstanceId: string;
  domain: string;
  keyPrefix: string;
  siteName: string;
}) {
  const bindingKey = `*:443:${input.domain}`;
  const site = await app.inject({
    method: 'POST',
    path: '/api/v1/site-assets',
    headers: userHeaders,
    body: {
      frameworkInstanceId: input.frameworkInstanceId,
      deviceId: input.hostId,
      discoveryProviderKey: 'manual:test',
      siteType: 'web.site',
      siteName: input.siteName,
      siteKey: `${input.keyPrefix}:site:${bindingKey}`,
      bindingInformation: bindingKey,
      hostHeader: input.domain,
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
      deviceId: input.hostId,
      frameworkInstanceId: input.frameworkInstanceId,
      siteId: siteAssetId,
      discoveryProviderKey: 'manual:test',
      targetType: 'tls.binding',
      targetKey: `${input.keyPrefix}:target:${bindingKey}`,
      bindingKey,
      supportedCapabilities: ['certificate.deploy', 'certificate.rollback'],
      executionLocations: ['AGENT'],
      metadata: { bindingInformation: bindingKey },
    },
  });
  assert.equal(target.statusCode, 201, JSON.stringify(target.body));

  return {
    siteAssetId,
    managedTargetId: (target.body as { id: string }).id,
    bindingKey,
  };
}

async function createApplicationAssetTargetFixture(app: ReturnType<typeof createApp>, input: {
  managedTargetId: string;
  domain: string;
  displayName: string;
  certificateFormatId: string;
}) {
  const asset = await app.inject({
    method: 'POST',
    path: '/api/v1/service-assets',
    headers: userHeaders,
    body: {
      address: input.domain,
      addressType: 'DNS',
      protocol: 'HTTPS',
      port: 443,
      displayName: input.displayName,
    },
  });
  assert.equal(asset.statusCode, 201, JSON.stringify(asset.body));
  const applicationAssetId = (asset.body as { id: string }).id;

  await configureApplicationAssetManagedTarget(app, applicationAssetId, input.managedTargetId, input.certificateFormatId);
  return applicationAssetId;
}

async function configureApplicationAssetManagedTarget(
  app: ReturnType<typeof createApp>,
  applicationAssetId: string,
  managedTargetId: string,
  certificateFormatId: string,
) {

  await ensureIisAgentPlanPlugin(app);

  let compatible = await app.inject({
    method: 'GET',
    path: `/api/v1/managed-targets/${managedTargetId}/compatible-plugins?capabilityKey=certificate.deploy&applicationAssetId=${applicationAssetId}`,
    headers: userHeaders,
  });
  assert.equal(compatible.statusCode, 200, JSON.stringify(compatible.body));
  if ((compatible.body as { items: unknown[] }).items.length === 0) {
    const unifiedPlugins = app.getResource('unifiedPluginsService');
    assert.ok(unifiedPlugins);
    await new BuiltinUnifiedPluginLoader().installAll(unifiedPlugins);
    compatible = await app.inject({
      method: 'GET',
      path: `/api/v1/managed-targets/${managedTargetId}/compatible-plugins?capabilityKey=certificate.deploy&applicationAssetId=${applicationAssetId}`,
      headers: userHeaders,
    });
    assert.equal(compatible.statusCode, 200, JSON.stringify(compatible.body));
  }
  const plugin = (compatible.body as { items: Array<{ pluginVersionId: string; compatible: boolean }> }).items.find((item) => item.compatible);
  assert.ok(plugin, JSON.stringify(compatible.body));

  const saved = await app.inject({
    method: 'PUT',
    path: `/api/v1/application-assets/${applicationAssetId}/managed-target`,
    headers: userHeaders,
    body: {
      managedTargetId,
      capabilityKey: 'certificate.deploy',
      certificateFormatId,
      pluginOverride: {
        pluginVersionId: plugin.pluginVersionId,
        inputBindings: {
          apiVersion: 'gcac.input-bindings/v1',
          variables: {},
          connections: {},
          credentials: {},
          artifacts: {},
        },
      },
    },
  });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));

  const strategy = await app.inject({
    method: 'PATCH',
    path: `/api/v1/service-assets/${applicationAssetId}/deployment-strategy`,
    headers: userHeaders,
    body: {
      deploymentStrategy: {
        type: 'MANAGED_TARGET',
        managedTarget: { managedTargetId, certificateFormatId },
      },
    },
  });
  assert.equal(strategy.statusCode, 200, JSON.stringify(strategy.body));
}

async function ensureIisAgentPlanPlugin(app: ReturnType<typeof createApp>): Promise<void> {
  const unifiedPlugins = app.getResource('unifiedPluginsService');
  assert.ok(unifiedPlugins);
  const existing = (await unifiedPlugins.listVersions('tenant_1')).find((item: { pluginId: string }) => item.pluginId === 'web.agent.plan');
  if (existing) return;
  const agentPlanResource = JSON.stringify({
    inputContract: {
      apiVersion: 'gcac.deployment-input/v1',
      variables: {},
      connections: {},
      credentials: {},
      artifacts: {
        serverCert: {
          kind: 'certificate',
          required: true,
          configurationMode: 'required',
          lifecycle: 'pre_execution',
          artifactContract: { outputs: { bundle: { role: 'pkcs12_bundle', required: true, sensitive: true } } },
        },
      },
    },
    plan: {
      planVersion: 'gcac.agent-security/v1',
      planId: 'iis-pfx-deploy-plan',
      agentId: 'fixture-agent',
      tenantId: 'fixture-tenant',
      pluginId: 'web.agent.plan',
      pluginVersionId: 'fixture-plugin-version',
      capability: 'certificate.deploy',
      operations: [{
        operationId: 'inspect-target-store',
        operationType: 'certificate.store.inspect',
        stage: 'prepare',
        input: { store: 'LocalMachine\\My' },
        dependsOn: [],
        idempotencyKey: 'iis-pfx-inspect',
        timeoutSeconds: 30,
      }],
      planDigest: '',
      tokenId: 'draft-token',
      policyDecisionId: 'draft-decision',
      nonce: 'draft-nonce',
      expiresAt: '2099-01-01T00:00:00.000Z',
      writeEffect: false,
    },
    authorization: {
      grantId: 'fixture-agent-plan-grant',
      policyRef: 'fixture-agent-plan-policy',
      policyVersion: '1',
      actions: ['certificate.store.inspect'],
      allowedPaths: [],
      allowedServices: [],
      artifactDigests: [],
      lifetimeSeconds: 300,
    },
  });
  const parsed = JSON.parse(agentPlanResource) as { plan: Record<string, unknown> };
  parsed.plan.planDigest = computeAgentPlanDigest(parsed.plan as never);
  const installed = await unifiedPlugins.importVersion('tenant_1', {
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId: 'web.agent.plan',
      version: '1.0.0',
      displayNameKey: 'plugin.microsoftIisAgentPlan.name',
      publisher: 'GCAC test fixture',
      runtime: 'AGENT_PLAN',
      source: 'USER',
      scope: 'MANAGED',
      trust: 'USER_SIGNED',
      support: 'SELF_MANAGED',
      capabilities: [
        { key: 'certificate.deploy', contractVersion: 'v1', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations: ['AGENT'] },
        { key: 'certificate.rollback', contractVersion: 'v1', actionContractId: 'certificate.rollback.v1', riskLevel: 'HIGH', executionLocations: ['AGENT'] },
      ],
      permissions: ['certificate.deploy'],
      compatibility: {
        productFamilies: ['WINDOWS_SERVER'],
        frameworkTypes: ['web.iis'],
        targetTypes: ['tls.binding'],
        managementMethods: ['AGENT'],
        executionLocations: ['AGENT'],
        artifactContracts: ['certificate.deploy.v1'],
      },
      resources: { agentPlans: { 'certificate.deploy': 'agent-plans/certificate-deploy.json', 'certificate.rollback': 'agent-plans/certificate-deploy.json' } },
    },
    resources: { 'agent-plans/certificate-deploy.json': agentPlanResource },
    packageContent: agentPlanResource,
  }, 'USER');
  const approved = await unifiedPlugins.approvePermissions(installed.id, installed.manifest.permissions);
  await unifiedPlugins.enableVersion(approved.id);
}

async function completeAgentDryRun(app: ReturnType<typeof createApp>, input: {
  planId: string;
  agentId: string;
  idempotencyKey: string;
}) {
  const dryRun = await app.inject({
    method: 'POST',
    path: '/api/v1/deployment-plans/dry-run',
    headers: userHeaders,
    body: { planId: input.planId, idempotencyKey: input.idempotencyKey },
  });
  assert.equal(dryRun.statusCode, 200, JSON.stringify(dryRun.body));
  const body = dryRun.body as { run: { id: string }; steps: Array<{ id: string; inputSnapshot: unknown }> };
  const executions = app.getResource('executionsService') as ExecutionsApplicationService;
  assert.ok(executions);
  const dispatched = await executions.runDispatchedExecution(body.run.id, 'user_1', 'tenant_1');
  assert.equal(dispatched.success, true, JSON.stringify(dispatched));
  assert.equal(dispatched.pending, true, JSON.stringify(dispatched));
  let completed = false;
  for (let cycle = 0; cycle < 20 && !completed; cycle += 1) {
    const pulled = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/tasks/pull?agentId=${input.agentId}`,
      headers: userHeaders,
    });
    assert.equal(pulled.statusCode, 200, JSON.stringify(pulled.body));
    const queuedTasks = pulled.body as Array<{ id: string; agentId: string; payload: Record<string, unknown> }>;
    if (queuedTasks.length === 0) {
      const currentRun = await executions.getRun(body.run.id, 'tenant_1');
      completed = currentRun.status === 'SUCCESS';
      if (!completed) {
        const resumed = await executions.runDispatchedExecution(body.run.id, 'user_1', 'tenant_1');
        assert.equal(resumed.success, true, JSON.stringify(resumed));
      }
      continue;
    }
    for (const task of queuedTasks) {
      const leaseId = `lease_dry_run_${task.id}`;
      const ack = await app.inject({
        method: 'POST',
        path: '/api/v1/agents/tasks/ack',
        headers: userHeaders,
        body: { agentId: task.agentId, taskId: task.id, leaseId },
      });
      assert.equal(ack.statusCode, 200, JSON.stringify(ack.body));
      const plan = task.payload.plan as { planId: string; planDigest: string; operations: Array<{ operationId: string; operationType: string; stage?: string }> };
      const token = task.payload.token as { tokenId: string };
      const startedAt = new Date().toISOString();
      const operation = plan.operations[0];
      assert.ok(operation, JSON.stringify(plan));
      const operationId = operation.operationId;
      const operationResults = [{
        operationId,
        operationType: operation.operationType,
        stage: operation.stage ?? 'prepare',
        status: 'SUCCEEDED',
        detail: { passed: true },
      }];
      const receipt = {
        receiptVersion: 'gcac.agent-security/v1',
        operationId,
        planId: plan.planId,
        planDigest: plan.planDigest,
        agentId: task.agentId,
        tenantId: 'tenant_1',
        tokenId: token.tokenId,
        status: 'SUCCESS',
        startedAt,
        completedAt: new Date().toISOString(),
        operationResults,
        nonceConsumed: false,
      };
      const result = await app.inject({
        method: 'POST',
        path: '/api/v1/agents/tasks/result',
        headers: userHeaders,
        body: {
          agentId: task.agentId,
          taskId: task.id,
          leaseId,
          success: true,
          status: 'SUCCESS',
          detail: { mode: 'agent_v2_receipt', operationResults, receipt: { ...receipt, digest: computeAgentExecutionReceiptDigest(receipt) } },
        },
      });
      assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    }
    completed = (await executions.getRun(body.run.id, 'tenant_1')).status === 'SUCCESS';
  }
  assert.equal(completed, true, JSON.stringify(await executions.getRun(body.run.id, 'tenant_1')));
  const storedRun = await executions.getRun(body.run.id, 'tenant_1');
  assert.equal(storedRun.status, 'SUCCESS', JSON.stringify(storedRun));
  const storedSteps = await executions.listSteps({ tenantId: 'tenant_1', executionRunId: body.run.id });
  assert.equal(storedSteps.length, body.steps.length);
  assert.ok(storedSteps.every((step: { status: string }) => step.status === 'SUCCESS'), JSON.stringify(storedSteps));
  assert.ok(storedSteps.some((step: { inputSnapshot?: { resultDetail?: { dryRunSummary?: unknown } } }) => step.inputSnapshot?.resultDetail?.dryRunSummary), JSON.stringify(storedSteps));
  const drained = await app.inject({
    method: 'GET',
    path: `/api/v1/agents/tasks/pull?agentId=${input.agentId}`,
    headers: userHeaders,
  });
  assert.equal(drained.statusCode, 200, JSON.stringify(drained.body));
  assert.deepEqual(drained.body, []);
  return body;
}


describe('部署计划与执行编排 API', () => {
  afterEach(closeTestResources);
  after(closeTestResources);
  it('同一应用资产重复创建时复用人工草稿，提交后允许创建新周期', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const create = (idempotencyKey: string) => app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/from-application-asset',
      headers: userHeaders,
      body: {
        applicationAssetId: fixture.target_1.applicationAssetId,
        targetCertificateVersionId: fixture.certificateVersionId,
        certificateFormatId: fixture.certificateFormatId,
        selectionMode: 'EXPLICIT',
        idempotencyKey,
        policy: { riskLevel: 'low', approvalRequired: false, failurePolicy: 'rollback' },
      },
    });

    const first = await create('idem_asset_draft_first');
    const second = await create('idem_asset_draft_second');
    assert.equal(first.statusCode, 201, JSON.stringify(first.body));
    assert.equal(second.statusCode, 201, JSON.stringify(second.body));
    assert.equal((second.body as { id: string }).id, (first.body as { id: string }).id);

    const planId = (first.body as { id: string }).id;
    const submitted = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/submit',
      headers: userHeaders,
      body: { planId },
    });
    assert.equal(submitted.statusCode, 200, JSON.stringify(submitted.body));
    assert.equal((submitted.body as { status: string }).status, 'READY');

    const nextCycle = await create('idem_asset_draft_next_cycle');
    assert.equal(nextCycle.statusCode, 201, JSON.stringify(nextCycle.body));
    assert.notEqual((nextCycle.body as { id: string }).id, planId);
  });

  it('删除接口可以移除非草稿部署计划及其关联记录', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const ready = await createReadyLowRiskPlan(app, fixture, 'idem_protected_ready_plan');
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/delete',
      headers: userHeaders,
      body: { planId: ready.id },
    });

    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal((response.body as { deleted?: boolean }).deleted, true);

    const listed = await app.inject({
      method: 'GET',
      path: '/api/v1/deployment-plans',
      headers: userHeaders,
    });
    assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
    assert.equal((listed.body as { items: Array<{ id: string }> }).items.some((item) => item.id === ready.id), false);
  });

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
    const db = createTrackedDatabase();
    await runMigrations(db);
    const security = createSecurityServices();
    grantWildcardPolicy(security, 'user_1', 'tenant_1');
    const app = createDeploymentTestApp(db, security);
    const fixture = await seedWorkflowStrategyFixture(app, db);
    const workflow = await createPublishedWorkflow(app, workflowTemplateFixture('应用资产工作流部署'));

    const strategy = await app.inject({
      method: 'PUT',
      path: `/api/v1/application-assets/${fixture.applicationAssetId}/managed-target`,
      headers: userHeaders,
      body: {
        managedTargetId: fixture.managedTargetId,
        capabilityKey: 'certificate.deploy',
        certificateFormatId: fixture.certificateFormatId,
        executionMode: 'WORKFLOW_OVERRIDE',
        workflowExecution: {
          tenantId: 'tenant_1',
          workflowTemplateId: workflow.template.id,
          workflowVersionSelection: 'PINNED',
          workflowVersionId: workflow.version.id,
          runner: 'CONTROL_PLANE',
            inputBindings: {
              apiVersion: 'gcac.input-bindings/v1',
              variables: {},
              connections: { targetSsh: { host: fixture.domain } },
              credentials: {},
              artifacts: {
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
    const plan = created.body as {
      certificateFormatId?: string;
      targets: Array<{ id: string; certificateBindingId?: string; executorType: string; strategyPayload?: any; requiredCapabilities: string[] }>;
      workflowExecutionIdentities?: Array<{
        mode: string;
        workflowName?: string;
        workflowVersionId: string;
        workflowDslVersion?: string;
        workflowVersionSelection: string;
      }>;
    };
    assert.equal(plan.targets.length, 1);
    assert.equal(plan.certificateFormatId, fixture.certificateFormatId);
    assert.equal(plan.targets[0].certificateBindingId, fixture.bindingId);
    assert.equal(plan.targets[0].executorType, 'WORKFLOW');
    assert.deepEqual(plan.targets[0].requiredCapabilities, ['workflow.run']);
    assert.equal(plan.targets[0].strategyPayload.workflowRequest.workflowVersionId, workflow.version.id);
    assert.equal(plan.targets[0].strategyPayload.workflowRequest.runner, 'CONTROL_PLANE');
    assert.equal(plan.targets[0].strategyPayload.workflowRequest.certificateBindingId, fixture.bindingId);
    assert.ok(plan.targets[0].strategyPayload.deploymentInputPreflight);
    assert.ok(plan.targets[0].strategyPayload.deploymentInputSnapshotRef);
    assert.deepEqual(plan.workflowExecutionIdentities, [{
      mode: 'WORKFLOW',
      workflowId: workflow.template.id,
      workflowName: workflow.version.content.metadata.name,
      workflowVersionId: workflow.version.id,
      workflowDslVersion: workflow.version.content.metadata.version,
      workflowVersionSelection: 'PINNED',
      targetIds: [plan.targets[0].id],
    }]);
  });

  it('WORKFLOW 应用资产选择始终最新版本时，已有部署计划 dry-run 仍使用创建时固定版本', async () => {
    const db = createTrackedDatabase();
    await runMigrations(db);
    const security = createSecurityServices();
    grantWildcardPolicy(security, 'user_1', 'tenant_1');
    const app = createDeploymentTestApp(db, security);
    const fixture = await seedWorkflowStrategyFixture(app, db);
    const workflow = await createPublishedWorkflow(app, workflowTemplateFixture('应用资产工作流实时版本'));

    const strategy = await app.inject({
      method: 'PUT',
      path: `/api/v1/application-assets/${fixture.applicationAssetId}/managed-target`,
      headers: userHeaders,
      body: {
        managedTargetId: fixture.managedTargetId,
        capabilityKey: 'certificate.deploy',
        certificateFormatId: fixture.certificateFormatId,
        executionMode: 'WORKFLOW_OVERRIDE',
        workflowExecution: {
          tenantId: 'tenant_1',
          workflowTemplateId: workflow.template.id,
          workflowVersionSelection: 'LATEST_PUBLISHED',
          runner: 'CONTROL_PLANE',
            inputBindings: {
              apiVersion: 'gcac.input-bindings/v1',
              variables: {},
              connections: { targetSsh: { host: fixture.domain } },
              credentials: {},
              artifacts: {
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
        idempotencyKey: 'idem_workflow_latest_plan',
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const plan = created.body as {
      id: string;
      targets: Array<{ id: string; strategyPayload?: any }>;
      workflowExecutionIdentities?: Array<{ workflowVersionSelection: string; workflowVersionId: string }>;
    };
    assert.equal(plan.targets[0].strategyPayload.workflowRequest.workflowVersionId, workflow.version.id);
    assert.equal(plan.workflowExecutionIdentities?.[0]?.workflowVersionSelection, 'LATEST_PUBLISHED');
    assert.equal(plan.workflowExecutionIdentities?.[0]?.workflowVersionId, workflow.version.id);

    const v2Content = workflowTemplateFixture('应用资产工作流实时版本');
    v2Content.metadata.version = '1.0.1';
    v2Content.steps[0]!.ssh!.args = ['service-main-v2'];
    const createdV2 = await app.inject({
      method: 'POST',
      path: `/api/v1/workflows/${workflow.template.id}/versions`,
      headers: userHeaders,
      body: {
        content: v2Content,
        changeSummary: '发布第二版',
      },
    });
    assert.equal(createdV2.statusCode, 201, JSON.stringify(createdV2.body));
    const version2 = createdV2.body as { id: string };
    const publishedV2 = await app.inject({
      method: 'POST',
      path: `/api/v1/workflows/versions/${version2.id}/publish`,
      headers: userHeaders,
    });
    assert.equal(publishedV2.statusCode, 200, JSON.stringify(publishedV2.body));

    const dryRun = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/dry-run',
      headers: userHeaders,
      body: { planId: plan.id, idempotencyKey: 'idem_workflow_latest_plan_dry' },
    });
    assert.equal(dryRun.statusCode, 200, JSON.stringify(dryRun.body));
    const dryRunBody = dryRun.body as { steps: Array<{ inputSnapshot: any }> };
    assert.equal(dryRunBody.steps[0].inputSnapshot.workflowRequest.workflowVersionId, workflow.version.id);
    assert.equal(dryRunBody.steps[0].inputSnapshot.workflowRequest.workflowVersionSelection, 'PINNED');
  });

  it('无 Agent 目标绑定的 WORKFLOW 应用资产也可以创建部署计划', async () => {
    const db = createTrackedDatabase();
    await runMigrations(db);
    const security = createSecurityServices();
    grantWildcardPolicy(security, 'user_1', 'tenant_1');
    const app = createDeploymentTestApp(db, security);
    const certificate = await importCertificateFormatFixture(app, 'tenant_1', 'workflow-only.example.com', 'workflow_only');
    const workflow = await createPublishedWorkflow(app, workflowHttpCertificateFixture('无 Agent 绑定工作流'));

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
      },
    });
    assert.equal(asset.statusCode, 201, JSON.stringify(asset.body));
    const applicationAssetId = (asset.body as { id: string }).id;
    const savedWorkflow = await app.inject({
      method: 'PUT',
      path: `/api/v1/application-assets/${applicationAssetId}/standalone-workflow`,
      headers: userHeaders,
      body: {
        workflowExecution: {
          tenantId: 'tenant_1',
          workflowTemplateId: workflow.template.id,
          workflowVersionSelection: 'PINNED',
          workflowVersionId: workflow.version.id,
          runner: 'CONTROL_PLANE',
          inputBindings: {
            apiVersion: 'gcac.input-bindings/v1',
            variables: { callbackUrl: 'https://workflow-only.example.com:8443/verify' },
            connections: { callbackHttp: { host: 'workflow-only.example.com', port: 8443 } },
            credentials: {},
            artifacts: {
              serverCert: {
                certificateFormatId: certificate.certificateFormatId,
                outputBindings: { bundle: 'bundle' },
              },
            },
          },
        },
      },
    });
    assert.equal(savedWorkflow.statusCode, 200, JSON.stringify(savedWorkflow.body));

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
    assert.deepEqual(plan.targets[0].strategyPayload.certificateVerification, {
      capabilityKey: 'certificate.verify',
      schemaVersion: '1.0',
      connectHost: 'workflow-only.example.com',
      serverName: 'workflow-only.example.com',
      port: 8443,
      expectedDomains: ['workflow-only.example.com'],
      verifyUrl: 'https://workflow-only.example.com:8443',
      source: 'APPLICATION_VERIFY_URL',
    });

    const dryRun = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/dry-run',
      headers: userHeaders,
      body: { planId: (created.body as { id: string }).id, idempotencyKey: 'idem_workflow_only_asset_dry_run' },
    });
    assert.equal(dryRun.statusCode, 200, JSON.stringify(dryRun.body));
    const dryRunSteps = (dryRun.body as { steps: Array<{ stepType: string; inputSnapshot: any }> }).steps;
    const workflowStep = dryRunSteps.find((step) => step.stepType === 'INSTALL');
    const verifyStep = dryRunSteps.find((step) => step.stepType === 'VERIFY');
    assert.equal(workflowStep?.inputSnapshot.workflowRequest.applicationAssetId, applicationAssetId);
    assert.equal(verifyStep?.inputSnapshot.certificateVerification.connectHost, 'workflow-only.example.com');
    assert.equal(verifyStep?.inputSnapshot.certificateVerification.serverName, 'workflow-only.example.com');
    assert.equal(verifyStep?.inputSnapshot.certificateVerification.port, 8443);
  });

  it('应用资产 WORKFLOW 策略经真实 HTTP 工作流执行后会回写绑定和资产状态', async () => {
    const db = createTrackedDatabase();
    await runMigrations(db);
    const security = createSecurityServices();
    grantWildcardPolicy(security, 'user_1', 'tenant_1');
    const app = createDeploymentTestApp(db, security);
    const fixture = await seedWorkflowStrategyFixture(app, db);
    const verifyServer = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ fingerprint: fixture.certificateFingerprintSha256, thumbprint: 'A'.repeat(40) }));
    });
    await new Promise<void>((resolve, reject) => {
      verifyServer.once('error', reject);
      verifyServer.listen(0, '127.0.0.1', () => resolve());
    });
    const tlsServer = createHttpsServer({ key: fixture.privateKeyPem, cert: fixture.certificatePem }, (_request, response) => {
      response.end('ok');
    });
    await new Promise<void>((resolve, reject) => {
      tlsServer.once('error', reject);
      tlsServer.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const address = verifyServer.address();
      const tlsAddress = tlsServer.address();
      assert.ok(address && typeof address === 'object');
      assert.ok(tlsAddress && typeof tlsAddress === 'object');
      await db.query(
        `update pg_hosts
         set primary_ip = '127.0.0.1', ip_addresses = '["127.0.0.1"]'::jsonb
         where id = (select device_id from pg_managed_targets where id = $1)`,
        [fixture.managedTargetId],
      );
      await db.query('update pg_service_assets set port = $2 where id = $1', [fixture.applicationAssetId, tlsAddress.port]);
      const workflowUrl = `http://127.0.0.1:${address.port}/verify`;
      const workflow = await createPublishedWorkflow(app, workflowHttpCertificateFixture('应用资产工作流真实 HTTP 验收'));

      const strategy = await app.inject({
        method: 'PUT',
        path: `/api/v1/application-assets/${fixture.applicationAssetId}/managed-target`,
        headers: userHeaders,
        body: {
          managedTargetId: fixture.managedTargetId,
          capabilityKey: 'certificate.deploy',
          certificateFormatId: fixture.certificateFormatId,
          executionMode: 'WORKFLOW_OVERRIDE',
          workflowExecution: {
            tenantId: 'tenant_1',
            workflowTemplateId: workflow.template.id,
            workflowVersionSelection: 'PINNED',
            workflowVersionId: workflow.version.id,
            runner: 'CONTROL_PLANE',
              inputBindings: {
                apiVersion: 'gcac.input-bindings/v1',
                variables: { callbackUrl: workflowUrl },
                connections: { callbackHttp: { host: '127.0.0.1', port: address.port } },
                credentials: {},
                artifacts: {
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
      const executionSteps = (steps.body as { items: Array<{ status: string; inputSnapshot: any }> }).items;
      const workflowStep = executionSteps.find((item) => item.inputSnapshot?.resultDetail?.workflowRun);
      assert.ok(workflowStep, JSON.stringify(steps.body));
      assert.equal(workflowStep.status, 'SUCCESS');
      assert.equal(
        workflowStep.inputSnapshot.resultDetail.workflowRun.stepResults[0]?.extracted?.remoteFingerprintSha256,
        fixture.certificateFingerprintSha256,
      );
      const tlsVerifyStep = executionSteps.find((item) => item.inputSnapshot?.resultDetail?.certificateVerification);
      assert.ok(tlsVerifyStep, JSON.stringify(steps.body));
      assert.equal(tlsVerifyStep.status, 'SUCCESS');
      assert.equal(tlsVerifyStep.inputSnapshot.resultDetail.verify.remoteCertificateSha256, fixture.certificateFingerprintSha256);

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
      await new Promise<void>((resolve, reject) => tlsServer.close((error) => error ? reject(error) : resolve()));
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

    await configureApplicationAssetManagedTarget(
      app,
      fixture.target_1.applicationAssetId,
      fixture.target_1.managedTargetId,
      secondFixture.certificateFormatId,
    );

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
        idempotencyKey: 'idem_edit_draft_update',
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

  it('编辑正在执行的应用资产部署计划会被拒绝并保留执行记录', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const secondFixture = await importCertificateFormatFixture(app, 'tenant_1', 'iis-site.example.com', 'tenant_1_edit_success');
    const ready = await createReadyLowRiskPlan(app, fixture, 'idem_edit_success');
    await completeAgentDryRun(app, { planId: ready.id, agentId: fixture.agentId, idempotencyKey: 'idem_edit_success_dry_run' });
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
        idempotencyKey: 'idem_edit_success_update',
      },
    });

    assert.equal(updated.statusCode, 409, JSON.stringify(updated.body));
    assert.equal((updated.body as { errorCode: string }).errorCode, 'DEPLOYMENT_INVALID_STATE');

    const runs = await app.inject({
      method: 'GET',
      path: `/api/v1/execution-runs?deploymentPlanId=${ready.id}`,
      headers: userHeaders,
    });
    assert.equal(runs.statusCode, 200, JSON.stringify(runs.body));
    assert.ok(((runs.body as { items: unknown[] }).items ?? []).length >= 2);
  });

  it('创建部署计划未手填 gatewayRoute 时自动调用 ZoneRouter 写入路由', async () => {
    const { service: deploymentService, fixture, app } = await createMigratedDeploymentService();
    const appGateways = app.getResource('gatewaysService') as GatewaysApplicationService;
    const appGateway = await appGateways.register('tenant_1', {
      agentId: 'agent_auto_route_001',
      zoneIds: ['zone_prod'],
      version: '1.0.0',
      adapters: ['probe.tcp'],
      capabilities: ['certificate.backup', 'certificate.install', 'service.reload', 'certificate.verify'],
      currentLoad: 0,
      maxConcurrentTasks: 4,
      successRate: 0.99,
    });
    await appGateways.probe('tenant_1', { gatewayId: appGateway.id, targetId: fixture.target_1.managedTargetId, zoneId: 'zone_prod', protocol: 'probe.tcp', status: 'reachable', latencyMs: 12, ttlSeconds: 600 });
    const plan = await deploymentService.create({
      name: '自动路由部署计划',
      certificateVersionId: fixture.certificateVersionId,
      certificateFormatId: fixture.certificateFormatId,
      idempotencyKey: 'idem_auto_route_plan',
      actorId: 'user_1',
      tenantId: 'tenant_1',
      policy: { riskLevel: 'low', approvalRequired: false, failurePolicy: 'stop' },
      targets: [{
        certificateBindingId: fixture.target_1.bindingId,
        executionTargetId: fixture.target_1.managedTargetId,
        executorType: 'GATEWAY_FORWARD',
        zoneId: 'zone_prod',
        protocols: ['probe.tcp'],
      }],
    });

    const route = plan.targets[0].gatewayRoute;
    assert.equal(route?.gatewayId, appGateway.id);
    assert.equal(route?.agentId, 'agent_auto_route_001');
    assert.equal(route?.zoneId, 'zone_prod');
    assert.equal(route?.adapter, 'probe.tcp');
    assert.equal(route?.delegatedTargetId, fixture.target_1.managedTargetId);
    assert.equal(route?.candidateGateways?.length, 1);
    assert.equal(route?.fallbackSuggestions, undefined);
    assert.equal(route?.missingCapabilities, undefined);
    assert.equal(route?.approvalRequired, false);
  });


  it('部署目标必须引用 certificateBindingId，禁止直接部署到 Host', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const body = { ...createPlanBody(fixture, 'idem_missing_binding'), targets: [{ hostId: 'host_1', executorType: 'SSH' }] };
    const response = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body });

    assert.equal(response.statusCode, 400);
    assert.equal((response.body as { errorCode: string }).errorCode, 'VALIDATION_FAILED');
  });

  it('旧 SSH/CURL/WINRM/SMB_WMI 执行器不能创建或提交部署计划', async () => {
    const { app, service: deploymentService, fixture } = await createMigratedDeploymentService();
    const legacyExecutorTypes = ['SSH', 'CURL', 'WINRM', 'SMB_WMI'];

    for (const executorType of legacyExecutorTypes) {
      const createResponse = await app.inject({
        method: 'POST',
        path: '/api/v1/deployment-plans',
        headers: userHeaders,
        body: {
          ...createPlanBody(fixture, `idem_retired_create_${executorType}`),
          targets: [{ ...createPlanBody(fixture).targets[0], executorType }],
        },
      });
      assert.equal(createResponse.statusCode, 400, JSON.stringify(createResponse.body));
      assert.equal((createResponse.body as { errorCode: string }).errorCode, 'VALIDATION_FAILED');

      const seedResponse = await app.inject({
        method: 'POST',
        path: '/api/v1/deployment-plans',
        headers: userHeaders,
        body: createPlanBody(fixture, `idem_retired_submit_${executorType}`),
      });
      assert.equal(seedResponse.statusCode, 201, JSON.stringify(seedResponse.body));
      const planId = (seedResponse.body as { id: string }).id;
      const targets = await deploymentService.getRepository().listTargetsByPlan(planId, 'tenant_1');
      assert.equal(targets.length, 1);
      await deploymentService.getRepository().updateTarget(targets[0]!.id, {
        executorType,
        updatedAt: new Date().toISOString(),
        updatedBy: 'test_retired_executor',
      });

      const submitResponse = await app.inject({
        method: 'POST',
        path: '/api/v1/deployment-plans/submit',
        headers: userHeaders,
        body: { planId },
      });
      assert.equal(submitResponse.statusCode, 400, JSON.stringify(submitResponse.body));
      assert.equal((submitResponse.body as { errorCode: string }).errorCode, 'VALIDATION_FAILED');
    }
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

  it('审批单通过后查询部署计划会同步为 READY/APPROVED', async () => {
    const security = createSecurityServices();
    grantWildcardPolicy(security, 'user_1', 'tenant_1');
    grantWildcardPolicy(security, 'approver_1', 'tenant_1');
    const { app, fixture } = await createMigratedTestApp({ security });
    const service = app.getResource('deploymentPlansService') as DeploymentPlansApplicationService;
    const { planId, approvalId } = await createApprovedHighRiskPlan(app, fixture, 'idem_approval_sync');

    const listed = await app.inject({
      method: 'GET',
      path: '/api/v1/deployment-plans',
      headers: userHeaders,
    });
    assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
    const plan = (listed.body as { items: Array<{ id: string; status: string; approvalStatus: string; approvalId?: string }> }).items
      .find((item) => item.id === planId);
    assert.ok(plan);
    assert.equal(plan.status, 'READY');
    assert.equal(plan.approvalStatus, 'APPROVED');
    assert.equal(plan.approvalId, approvalId);

    const persisted = await service.getRepository().getPlanOrThrow(planId, 'tenant_1');
    assert.equal(persisted.status, 'READY');
    assert.equal(persisted.approvalStatus, 'APPROVED');
    assert.equal(persisted.approvalId, approvalId);
  });

  it('无审批执行高风险计划失败', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const created = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans', headers: userHeaders, body: createPlanBody(fixture, 'idem_no_approval', 'high') });
    const plan = created.body as { id: string };

    const response = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: userHeaders, body: { planId: plan.id, idempotencyKey: 'idem_run_denied' } });

    assert.equal(response.statusCode, 422);
    assert.equal((response.body as { errorCode: string }).errorCode, 'DEPLOYMENT_APPROVAL_REQUIRED');
  });

  it('READY 计划通过 execute approvalId 执行时，宿主必须把本次审批写入授权上下文', async () => {
    const security = createSecurityServices();
    security.rbac.createPolicy({ subjectType: 'user', subjectId: 'approver_1', effect: 'allow', actions: ['approval.decide'], resourceTypes: ['approval'], scope: { tenantId: 'tenant_1' } });
    const { app, fixture } = await createMigratedTestApp({ security });
    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/from-application-asset',
      headers: userHeaders,
      body: {
        applicationAssetId: fixture.target_1.applicationAssetId,
        targetCertificateVersionId: fixture.certificateVersionId,
        certificateFormatId: fixture.certificateFormatId,
        selectionMode: 'EXPLICIT',
        idempotencyKey: 'idem_ready_explicit_approval',
        policy: { riskLevel: 'high', approvalRequired: true, failurePolicy: 'rollback' },
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const createdPlan = created.body as { id: string };
    const submitted = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/submit',
      headers: userHeaders,
      body: { planId: createdPlan.id },
    });
    assert.equal(submitted.statusCode, 200, JSON.stringify(submitted.body));
    const approvalId = (submitted.body as { approvalId: string }).approvalId;
    assert.ok(approvalId);
    const decided = await app.inject({
      method: 'POST',
      path: '/api/v1/approvals/decide',
      headers: approverHeaders,
      body: { approvalId, decision: 'approved' },
    });
    assert.equal(decided.statusCode, 200, JSON.stringify(decided.body));

    const deploymentService = app.getResource('deploymentPlansService') as DeploymentPlansApplicationService;
    await deploymentService.getRepository().updatePlan(createdPlan.id, {
      status: 'READY',
      approvalStatus: 'NOT_REQUIRED',
      approvalId: undefined,
      updatedAt: new Date().toISOString(),
      updatedBy: 'user_1',
    });
    await completeAgentDryRun(app, {
      planId: createdPlan.id,
      agentId: fixture.agentId,
      idempotencyKey: 'idem_ready_explicit_approval_dry_run',
    });

    const executed = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/execute',
      headers: userHeaders,
      body: {
        planId: createdPlan.id,
        approvalId,
        idempotencyKey: 'idem_ready_explicit_approval_execute',
      },
    });
    assert.equal(executed.statusCode, 200, JSON.stringify(executed.body));
    const body = executed.body as {
      steps: Array<{ inputSnapshot: { executionAuthorization?: { approvalId?: string; approved?: boolean } } }>;
    };
    assert.equal(body.steps.every((step) => step.inputSnapshot.executionAuthorization?.approvalId === approvalId), true);
    assert.equal(body.steps.every((step) => step.inputSnapshot.executionAuthorization?.approved === true), true);
  });

  it('历史低风险计划包含 allowInsecureTls 时，正式执行仍必须先申请审批', async () => {
    const { app, service: deploymentService, fixture } = await createMigratedDeploymentService();
    const ready = await createReadyLowRiskPlan(app, fixture, 'idem_legacy_insecure_tls_plan');
    const targets = await deploymentService.getRepository().listTargetsByPlan(ready.id, 'tenant_1');
    assert.equal(targets.length > 0, true);
    const target = targets[0]!;
    const workflowRequest = (target.strategyPayload?.workflowRequest ?? {}) as Record<string, unknown>;
    await deploymentService.getRepository().updateTarget(target.id, {
      strategyPayload: {
        ...(target.strategyPayload ?? {}),
        workflowRequest: {
          ...workflowRequest,
          inputBindings: {
            apiVersion: 'gcac.input-bindings/v1',
            variables: { allowInsecureTls: true },
            connections: {},
            credentials: {},
            artifacts: {},
          },
        },
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'user_1',
    });

    const executed = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/execute',
      headers: userHeaders,
      body: {
        planId: ready.id,
        idempotencyKey: 'idem_legacy_insecure_tls_execute',
      },
    });
    assert.equal(executed.statusCode, 422, JSON.stringify(executed.body));
    assert.equal((executed.body as { errorCode: string }).errorCode, 'DEPLOYMENT_APPROVAL_REQUIRED');
  });

  it('有审批执行高风险计划成功入队，并生成 ExecutionRun 和 ExecutionStep', async () => {
    const security = createSecurityServices();
    security.rbac.createPolicy({ subjectType: 'user', subjectId: 'approver_1', effect: 'allow', actions: ['approval.decide'], resourceTypes: ['approval'], scope: { tenantId: 'tenant_1' } });
    const { app, fixture } = await createMigratedTestApp({ security });
    const { planId, approvalId } = await createApprovedHighRiskPlan(app, fixture, 'idem_approved_high');
    await completeAgentDryRun(app, { planId, agentId: fixture.agentId, idempotencyKey: 'idem_approved_high_dry_run' });

    const response = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/execute', headers: userHeaders, body: { planId, approvalId, idempotencyKey: 'idem_run_high' } });

    assert.equal(response.statusCode, 200);
    const body = response.body as {
      plan: { status: string };
      run: { status: string; externalRunId: string };
      steps: Array<{ stepType: string; inputSnapshot: { actionType?: string } }>;
      jobId: string;
    };
    assert.equal(body.plan.status, 'RUNNING');
    assert.equal(body.run.status, 'DISPATCHED');
    assert.ok(body.jobId);
    assert.deepEqual(
      body.steps.map((step) => step.stepType),
      ['DISCOVER', 'BACKUP', 'INSTALL', 'RELOAD', 'VERIFY'],
    );
    assert.equal(
      body.steps.every((step) => step.inputSnapshot.actionType === 'agent.plan.execute'),
      true,
    );
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
    assert.deepEqual(
      body.steps.map((step) => step.stepType),
      ['DISCOVER', 'BACKUP', 'INSTALL', 'RELOAD', 'VERIFY'],
    );
    assert.equal(body.steps.every((step) => step.inputSnapshot.dryRun === true), true);
  });

  it('dry-run 返回后可立即从统一任务列表查询到对应任务', async () => {
    const security = createSecurityServices();
    await grantDeploymentFixturePolicies(security, 'tenant_1');
    security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'user_1',
      effect: 'allow',
      actions: ['task.read'],
      resourceTypes: ['task'],
      scope: { tenantId: 'tenant_1' },
    });
    const { app, fixture } = await createMigratedTestApp({ security });
    const plan = await createReadyLowRiskPlan(app, fixture, 'idem_dry_run_task_visible');

    const dryRun = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/dry-run',
      headers: userHeaders,
      body: { planId: plan.id, idempotencyKey: 'idem_dry_run_task_visible' },
    });

    assert.equal(dryRun.statusCode, 200, JSON.stringify(dryRun.body));
    const dryRunBody = dryRun.body as {
      jobId: string;
      run: { id: string; externalRunId?: string };
    };
    assert.ok(dryRunBody.jobId);
    assert.equal(dryRunBody.run.externalRunId, dryRunBody.jobId);

    const tasks = await app.inject({
      method: 'GET',
      path: `/api/v1/tasks?page=1&pageSize=20&filter[taskId]=${encodeURIComponent(dryRunBody.jobId)}`,
      headers: userHeaders,
    });

    assert.equal(tasks.statusCode, 200, JSON.stringify(tasks.body));
    const taskBody = tasks.body as {
      items: Array<{
        id: string;
        taskType: string;
        category: string;
        payload?: { runId?: string };
      }>;
    };
    assert.equal(taskBody.items.length, 1);
    assert.equal(taskBody.items[0]?.id, dryRunBody.jobId);
    assert.equal(taskBody.items[0]?.taskType, 'CERTIFICATE_DRY_RUN');
    assert.equal(taskBody.items[0]?.category, 'EXECUTION');
    assert.equal(taskBody.items[0]?.payload?.runId, dryRunBody.run.id);
  });

  it('dry-run 返回时保留过程态，并等待 Agent 返回真实检查结论', async () => {
    const { app, service: deploymentService, fixture, bindings } = await createMigratedDeploymentService();
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
      steps: Array<{ stepType: string; status: string; inputSnapshot: { resultDetail?: { dryRunChecks?: Array<{ key: string; status: string; evidence?: Record<string, unknown> }>; operationResults?: unknown[] } } }>;
    };
    assert.equal(body.run.status, 'DISPATCHED');
    assert.equal(body.steps.every((step) => step.status === 'PENDING'), true);

    assert.ok(body.steps.length > 0);
    const staticChecks = body.steps.flatMap((step) => step.inputSnapshot.resultDetail?.dryRunChecks ?? []);
    assert.equal(staticChecks.some((check) => check.key === 'certificate_already_active' && check.status === 'warning'), true);
    assert.equal(
      body.steps.every((step) => step.inputSnapshot.resultDetail?.operationResults === undefined),
      true,
    );
  });

  it('历史计划目标缺少 target.tenantId 时，仍可使用 plan.tenantId 发起 dry-run', async () => {
    const { app, service: deploymentService, fixture } = await createMigratedDeploymentService();
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

  it('取消计划会传播到已入队 run，并取消未开始步骤', async () => {
    const { app, service: deploymentService, fixture } = await createMigratedDeploymentService();
    const plan = await createReadyLowRiskPlan(app, fixture, 'idem_cancel_plan');
    await completeAgentDryRun(app, { planId: plan.id, agentId: fixture.agentId, idempotencyKey: 'idem_cancel_dry_run' });
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
    const { app, service: deploymentService, fixture } = await createMigratedDeploymentService();
    const plan = await createReadyLowRiskPlan(app, fixture, 'idem_rollback_plan');
    await completeAgentDryRun(app, { planId: plan.id, agentId: fixture.agentId, idempotencyKey: 'idem_rollback_dry_run' });
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
    assert.deepEqual(body.steps.map((step) => step.stepType), ['ROLLBACK', 'VERIFY']);
    assert.equal(
      body.steps.every((step) => step.inputSnapshot.actionType === 'agent.plan.execute'),
      true,
    );
    assert.equal(
      body.steps.every((step) => typeof step.inputSnapshot.sourceRunId === 'string'),
      true,
    );
    assert.equal(
      body.steps.every((step) => typeof (step.inputSnapshot.rollbackContext as { sourceRunId?: string } | undefined)?.sourceRunId === 'string'),
      true,
    );
    assert.ok(body.jobId);
  });

  it('执行成功后可以通过公开 API 进入人工回滚', async () => {
    const { app, service: deploymentService } = await createMigratedDeploymentService();
    const executions = deploymentService.getExecutionsService();
    const targetId = 'dpt_success_rollback';
    const created = await executions.createApplyRun({
      deploymentPlanId: 'pln_success_rollback',
      deploymentPlanTargetIds: [targetId],
      type: 'apply',
      idempotencyKey: 'idem_success_rollback_run',
      actorId: 'user_1',
      tenantId: 'tenant_1',
      executorTypeByTargetId: new Map([[targetId, 'AGENT']]),
      agentPayloadByTargetId: new Map([[targetId, {
        deploymentInputSnapshotRef: {
          apiVersion: 'gcac.deployment-input-snapshot/v1',
          snapshotId: 'dpis_success_rollback',
          revision: 1,
          resolvedSha256: 'f'.repeat(64),
        },
      }]]),
    });
    const runId = created.run.id;
    await executions.getRepository().updateRun(runId, {
      status: 'SUCCESS',
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: 'orchestrator_1',
    });

    const rollback = await app.inject({
      method: 'POST',
      path: '/api/v1/execution-runs/rollback',
      headers: userHeaders,
      body: { runId, idempotencyKey: 'idem_success_rollback_ok' },
    });

    assert.equal(rollback.statusCode, 200, JSON.stringify(rollback.body));
    const body = rollback.body as { sourceRun: { status: string }; rollbackRun: { status: string }; steps: Array<{ stepType: string }> };
    assert.equal(body.sourceRun.status, 'ROLLBACK_RUNNING');
    assert.equal(body.rollbackRun.status, 'DISPATCHED');
    assert.deepEqual(body.steps.map((step) => step.stepType), ['ROLLBACK', 'VERIFY']);
  });

  it('回滚缺少源步骤目标时拒绝创建空 rollback', async () => {
    const { app, service: deploymentService, fixture } = await createMigratedDeploymentService();
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
    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/from-application-asset',
      headers: { ...userHeaders, 'x-idempotency-key': 'idem_header_plan' },
      body: {
        applicationAssetId: fixture.target_1.applicationAssetId,
        targetCertificateVersionId: fixture.certificateVersionId,
        certificateFormatId: fixture.certificateFormatId,
        selectionMode: 'EXPLICIT',
      },
    });
    assert.equal(created.statusCode, 201);
    const plan = created.body as { id: string; idempotencyKey: string };
    assert.equal(plan.idempotencyKey, 'idem_header_plan');

    const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: plan.id } });
    assert.equal(submitted.statusCode, 200);

    await completeAgentDryRun(app, { planId: plan.id, agentId: fixture.agentId, idempotencyKey: 'idem_header_dry' });

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

  it('能力重评估会更新目标 matchResult，并让 degraded 目标强制审批', async () => {
    const { app, fixture } = await createMigratedTestApp();
    const reevaluateTarget = await createIisManagedTargetFixture(app, {
      hostId: fixture.hostId,
      frameworkInstanceId: fixture.serviceInstanceId,
      domain: 'www.iis-site.example.com',
      keyPrefix: 'tenant_1:iis:reevaluate',
      siteName: 'Site reevaluate',
    });
    const reevaluateSiteAssetId = reevaluateTarget.siteAssetId;
    const reevaluateManagedTargetId = reevaluateTarget.managedTargetId;

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

    const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: plan.id } });
    assert.equal((submitted.body as { status: string }).status, 'PENDING_APPROVAL');
  });

  it('支持用 managedTargetId + LATEST_AUTO 在创建时解析 binding 和最新 PFX 证书版本', async () => {
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
          frameworkType: 'web.iis',
          targetType: 'tls.binding',
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
          frameworkType: 'web.iis',
          siteType: 'web.iis',
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
        parameterHash: 'hash_auto_latest_1',
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
    const latestVersionIds = ['certver_auto_latest_1', 'certver_auto_latest_2'];
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
  const service = new DeploymentPlansApplicationService({
    repository,
    executions,
    assets,
    bindings,
    certificates,
    certificatesApp: {
      generateDeploymentArtifactFromFormat: async ({ certificateVersionId, certificateFormatId }) => ({
        certificateVersionId,
        certificateFormatId,
        format: 'pfx',
        containsPrivateKey: true,
        pfxBase64: 'dGVzdA==',
        pfxPassword: 'test-password',
        files: [],
        warnings: [],
      }),
    } as never,
    managedTargetContextResolver: {
      resolve: async () => ({
        managedTarget: await assets.getManagedTarget('tenant_auto_latest', 'target_auto_latest_1'),
        host: { id: 'host_auto_latest_1', tenantId: 'tenant_auto_latest', hostname: 'iis-auto-latest', osType: 'WINDOWS', status: 'ACTIVE' },
        siteAsset: await assets.getSiteAsset('tenant_auto_latest', 'site_auto_latest_1'),
        serviceInstance: { id: 'svc_auto_latest_1', tenantId: 'tenant_auto_latest', deviceId: 'host_auto_latest_1', frameworkType: 'web.iis', frameworkKey: 'iis', displayName: 'IIS', discoveryProviderKey: 'manual:test', rawFacts: {}, status: 'ACTIVE' },
        agent: { id: 'agent-auto-latest-01' },
        discoveryProviderKey: 'manual:test',
        frameworkType: 'web.iis',
        availableExecutionLocations: ['AGENT'],
      }),
    } as never,
  });

    const plan = await service.create({
      name: 'auto latest iis deploy',
      selectionMode: 'LATEST_AUTO',
      certificateVersionId: 'certver_auto_latest_1',
      certificateFormatId: 'fmt_auto_latest_1',
      idempotencyKey: 'idem_auto_latest_plan',
      actorId: 'user_1',
      tenantId: 'tenant_auto_latest',
      targets: [{
        managedTargetId: 'target_auto_latest_1',
        executorType: 'AGENT',
        strategyPayload: {
          agentId: 'agent-auto-latest-01',
          certificateVerification: {
            capabilityKey: 'certificate.verify', schemaVersion: '1.0', connectHost: '10.20.30.40', serverName: 'iis-site.example.com', port: 443,
          },
        },
      }],
    });

    assert.equal(plan.certificateVersionId, 'certver_auto_latest_2');
    assert.equal(plan.certificateFormatId, 'fmt_auto_latest_1');
    assert.equal(plan.selectionMode, 'LATEST_AUTO');
    assert.equal(plan.targets.length, 1);
    assert.equal(plan.targets[0].certificateBindingId, binding.id);
    assert.equal(plan.targets[0].executionTargetId, 'target_auto_latest_1');
  });

  it('LATEST_AUTO 保存计划时可处理数据库返回的 Date 类型证书时间', async () => {
    const binding = {
      id: 'binding_auto_latest_date_1',
      tenantId: 'tenant_auto_latest_date',
      siteAssetId: 'site_auto_latest_date_1',
      managedTargetId: 'target_auto_latest_date_1',
      serviceInstanceId: 'svc_auto_latest_date_1',
      hostId: 'host_auto_latest_date_1',
      domainName: 'date-site.example.com',
      domain: 'date-site.example.com',
      port: 443,
      protocol: 'HTTPS',
      bindingKey: '*:443:date-site.example.com',
      bindingType: 'WINDOWS_CERT_STORE',
      verifyMethod: 'TLS',
      status: 'ACTIVE',
      metadata: {},
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:00:00.000Z',
      version: 1,
    };
    const managedTarget = {
      id: 'target_auto_latest_date_1',
      tenantId: 'tenant_auto_latest_date',
      agentId: 'agent-auto-latest-date-01',
      hostId: 'host_auto_latest_date_1',
      serviceInstanceId: 'svc_auto_latest_date_1',
      serviceAssetId: 'sat_auto_latest_date_1',
      siteAssetId: 'site_auto_latest_date_1',
      frameworkType: 'web.iis',
      targetType: 'tls.binding',
      targetKey: 'agent-auto-latest-date-01:site-binding:agent-auto-latest-date-01:iis:default web site:*:443:date-site.example.com',
      bindingKey: '*:443:date-site.example.com',
      capabilityProfile: {},
      status: 'ACTIVE',
      metadata: {},
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:00:00.000Z',
      version: 1,
    };
    const olderVersion = {
      id: 'certver_auto_latest_date_1',
      certificateAssetId: 'certasset_auto_latest_date_1',
      versionNo: 1,
      commonName: 'date-site.example.com',
      sans: ['date-site.example.com'],
      issuer: { raw: 'CN=issuer' },
      subject: { raw: 'CN=date-site.example.com' },
      serialNumber: 'date-001',
      notBefore: '2026-06-23T00:00:00.000Z',
      notAfter: '2026-12-31T00:00:00.000Z',
      fingerprintSha256: 'fp-auto-latest-date-1',
      publicKeyAlgorithm: 'RSA',
      signatureAlgorithm: 'SHA256RSA',
      leafStorageRef: 'vault://leaf/date-1',
      privateKeySecretRef: 'secret://pfx/date-1',
      chainCertificateRefs: [],
      chainOrder: [],
      chainDiagnostics: [],
      chainStatus: 'valid',
      deployable: true,
      sourceType: 'manual',
      status: 'active',
      createdBy: 'user_1',
      createdAt: '2026-06-23T00:00:00.000Z',
    };
    const newerVersion = {
      ...olderVersion,
      id: 'certver_auto_latest_date_2',
      versionNo: 2,
      serialNumber: 'date-002',
      notAfter: new Date('2027-01-31T00:00:00.000Z') as unknown as string,
      fingerprintSha256: 'fp-auto-latest-date-2',
      leafStorageRef: 'vault://leaf/date-2',
      privateKeySecretRef: 'secret://pfx/date-2',
      createdAt: new Date('2026-07-03T00:00:00.000Z') as unknown as string,
    };
    const olderFormat = {
      id: 'fmt_auto_latest_date_1',
      certificateVersionId: olderVersion.id,
      format: 'pfx',
      artifactRef: `artifact://certificate-format/${olderVersion.id}/pfx`,
      parameterHash: 'hash_auto_latest_date',
      parameters: { systemPlatform: 'windows', runtimePlatform: 'iis' },
      containsPrivateKey: true,
      passwordSecretRef: 'secret://pfx-password/date-1',
      createdBy: 'user_1',
      createdAt: olderVersion.createdAt,
    };
    const newerFormat = {
      ...olderFormat,
      id: 'fmt_auto_latest_date_2',
      certificateVersionId: newerVersion.id,
      artifactRef: `artifact://certificate-format/${newerVersion.id}/pfx`,
      passwordSecretRef: 'secret://pfx-password/date-2',
      createdAt: newerVersion.createdAt,
    };
    const assets = {
      getManagedTarget: async () => managedTarget,
      getSiteAsset: async () => undefined,
    };
    const bindings = {
      listCertificateBindings: async () => ({ items: [binding], total: 1, page: 1, pageSize: 5000 }),
      getCertificateBinding: async () => binding,
    };
    const certificates = {
      getVersion: async (id) => id === newerVersion.id ? newerVersion : olderVersion,
      getAsset: async () => ({
        id: 'certasset_auto_latest_date_1',
        name: 'date-site.example.com',
        primaryDomain: 'date-site.example.com',
        sans: ['date-site.example.com'],
        sourceType: 'manual',
        status: 'active',
        tags: [],
        createdBy: 'user_1',
        createdAt: '2026-06-23T00:00:00.000Z',
        updatedAt: '2026-06-23T00:00:00.000Z',
      }),
      listVersions: async () => ({
        items: [olderVersion, newerVersion],
        total: 2,
        page: 1,
        pageSize: 5000,
      }),
      listFormatsByVersion: async (id) => id === newerVersion.id ? [newerFormat] : [olderFormat],
      listFormats: async () => ({ items: [olderFormat, newerFormat], total: 2, page: 1, pageSize: 5000 }),
      getFormat: async (id) => id === newerFormat.id ? newerFormat : id === olderFormat.id ? olderFormat : undefined,
    };
    const repository = new DeploymentPlansRepository();
    const executions = new ExecutionsApplicationService({
      deploymentPlansRepository: repository,
    });
    const service = new DeploymentPlansApplicationService({
      repository,
      executions,
      assets,
      bindings,
      certificates,
      certificatesApp: {
        generateDeploymentArtifactFromFormat: async ({ certificateVersionId, certificateFormatId }) => ({
          certificateVersionId,
          certificateFormatId,
          format: 'pfx',
          containsPrivateKey: true,
          pfxBase64: 'dGVzdA==',
          pfxPassword: 'test-password',
          files: [],
          warnings: [],
        }),
      } as never,
    });

    const plan = await service.create({
      name: 'auto latest date iis deploy',
      selectionMode: 'LATEST_AUTO',
      certificateVersionId: olderVersion.id,
      certificateFormatId: olderFormat.id,
      idempotencyKey: 'idem_auto_latest_date_plan',
      actorId: 'user_1',
      tenantId: 'tenant_auto_latest_date',
      targets: [{ managedTargetId: 'target_auto_latest_date_1', executorType: 'AGENT' }],
    });

    assert.equal(plan.certificateVersionId, 'certver_auto_latest_date_2');
    assert.equal(plan.certificateFormatId, 'fmt_auto_latest_date_1');
  });


  it('按 MANAGED_TARGET 应用资产创建部署计划不再要求 CertificateBinding', async () => {
    const security = createSecurityServices();
    security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'user_1',
      effect: 'allow',
      actions: ['host.create', 'service_instance.manage', 'site_asset.manage', 'managed_target.manage', 'secret.create', 'certificate.import', 'certificate.format.create', 'service_asset.manage', 'service_asset.read'],
      resourceTypes: ['host', 'service_instance', 'site_asset', 'managed_target', 'secret', 'certificate_version', 'certificate_version_format', 'service_asset'],
      scope: { tenantId: 'tenant_1' },
    });
    const { app, db } = await createMigratedTestApp({ security });
    const chain = createPemChainFixture('managed-no-binding.example.com');

    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers: userHeaders,
      body: {
        agentKey: 'managed-no-binding-agent-01',
        hostname: 'MANAGED-NO-BINDING-01',
        ipAddress: '10.20.30.50',
        version: '1.0.0',
        osType: 'windows',
      },
    });
    assert.equal(registered.statusCode, 201, JSON.stringify(registered.body));
    const agentId = (registered.body as { id: string }).id;
    const hostId = `host_${agentId}`;
    await db.query(`update pg_hosts set primary_ip = $2, ip_addresses = $3::jsonb where id = $1`, [
      hostId,
      '10.20.30.50',
      JSON.stringify(['10.20.30.50']),
    ]);

    const service = await app.inject({
      method: 'POST',
      path: '/api/v1/framework-instances',
      headers: userHeaders,
      body: { deviceId: hostId, frameworkType: 'web.iis', frameworkKey: 'iis', displayName: 'Default IIS', discoveryProviderKey: 'manual:test' },
    });
    assert.equal(service.statusCode, 201, JSON.stringify(service.body));
    const serviceInstanceId = (service.body as { id: string }).id;

    const { managedTargetId } = await createIisManagedTargetFixture(app, {
      hostId,
      frameworkInstanceId: serviceInstanceId,
      domain: 'managed-no-binding.example.com',
      keyPrefix: 'managed-no-binding-agent-01',
      siteName: 'Default Web Site',
    });

    const secret = await app.inject({
      method: 'POST',
      path: '/api/v1/secrets',
      headers: userHeaders,
      body: { name: 'managed no binding pfx password', type: 'pfx_password', scopeType: 'global', plainText: 'No-Binding-123!' },
    });
    assert.equal(secret.statusCode, 201, JSON.stringify(secret.body));

    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: userHeaders,
      body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
    });
    assert.equal(imported.statusCode, 201, JSON.stringify(imported.body));
    const certificateVersionId = (imported.body as { version: { id: string } }).version.id;

    const format = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats',
      headers: userHeaders,
      body: {
        format: 'pfx',
        containsPrivateKey: true,
        passwordSecretRef: (secret.body as { secretRef: string }).secretRef,
        parameters: { configName: 'Windows-IIS-PKCS12-No-Binding', systemPlatform: 'windows', runtimePlatform: 'iis' },
      },
    });
    assert.equal(format.statusCode, 201, JSON.stringify(format.body));
    const certificateFormatId = (format.body as { id: string }).id;

    const applicationAssetId = await createApplicationAssetTargetFixture(app, {
      managedTargetId,
      domain: 'managed-no-binding.example.com',
      displayName: 'Managed No Binding',
      certificateFormatId,
    });
    const strategy = await app.inject({
      method: 'PATCH',
      path: `/api/v1/service-assets/${applicationAssetId}/deployment-strategy`,
      headers: userHeaders,
      body: {
        deploymentStrategy: {
          type: 'MANAGED_TARGET',
          managedTarget: { managedTargetId, certificateFormatId },
        },
      },
    });
    assert.equal(strategy.statusCode, 200, JSON.stringify(strategy.body));

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/from-application-asset',
      headers: userHeaders,
      body: {
        applicationAssetId,
        selectionMode: 'LATEST_AUTO',
        targetCertificateVersionId: certificateVersionId,
        certificateFormatId,
        idempotencyKey: 'idem_application_asset_plan_without_binding',
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const plan = created.body as { certificateFormatId?: string; targets: Array<{ certificateBindingId?: string; executionTargetId?: string; strategyPayload?: { deploymentInputSnapshotRef?: { snapshotId?: string }; deploymentStrategy?: unknown } }> };
    assert.equal(plan.certificateFormatId, certificateFormatId);
    assert.equal(plan.targets[0]?.certificateBindingId, undefined);
    assert.equal(plan.targets[0]?.executionTargetId, managedTargetId);
    assert.equal((plan.targets[0]?.strategyPayload?.deploymentStrategy as { type?: string } | undefined)?.type, 'MANAGED_TARGET');

    const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: (created.body as { id: string }).id } });
    assert.equal(submitted.statusCode, 200, JSON.stringify(submitted.body));
    const dryRun = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/dry-run',
      headers: userHeaders,
      body: { planId: (created.body as { id: string }).id, idempotencyKey: 'idem_application_asset_plan_without_binding_dry_run' },
    });
    assert.equal(dryRun.statusCode, 200, JSON.stringify(dryRun.body));
    const dryRunBody = dryRun.body as { steps: Array<{ inputSnapshot: { actionType?: string; deploymentArtifact?: unknown; resolvedDeploymentInput?: unknown } }> };
    assert.equal(
      dryRunBody.steps.some((step) => step.inputSnapshot.actionType === 'agent.plan.execute'),
      true,
    );
    assert.equal(dryRunBody.steps.every((step) => step.inputSnapshot.deploymentArtifact === undefined), true);
    assert.equal(dryRunBody.steps.every((step) => step.inputSnapshot.resolvedDeploymentInput === undefined), true);
    const runtimeSnapshot = await new DeploymentInputSnapshotsRepository(db).getRuntimeSnapshot(
      'tenant_1',
      String(plan.targets[0]?.strategyPayload?.deploymentInputSnapshotRef?.snapshotId),
    );
    assert.equal(runtimeSnapshot?.deploymentArtifact.certificateFormatId, certificateFormatId);
  });


  it('按应用资产创建计划时使用资产 DNS 而不是目标绑定 IP 校验证书域名', async () => {
    const security = createSecurityServices();
    security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'user_1',
      effect: 'allow',
      actions: ['host.create', 'service_instance.manage', 'site_asset.manage', 'managed_target.manage', 'binding.manage', 'binding.read', 'secret.create', 'certificate.import', 'certificate.format.create', 'service_asset.manage', 'service_asset.read'],
      resourceTypes: ['host', 'service_instance', 'site_asset', 'managed_target', 'certificate_binding', 'secret', 'certificate_version', 'certificate_version_format', 'service_asset'],
      scope: { tenantId: 'tenant_1' },
    });
    const { app, db } = await createMigratedTestApp({ security });
    const chain = createPemChainFixture('*.example.com');

    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers: userHeaders,
      body: {
        agentKey: 'iis-app-asset-agent-01',
        hostname: 'IIS-APP-ASSET-01',
        ipAddress: '10.255.0.213',
        version: '1.0.0',
        osType: 'windows',
      },
    });
    assert.equal(registered.statusCode, 201);
    const agentId = (registered.body as { id: string }).id;

    const hostId = `host_${agentId}`;
    await db.query(`update pg_hosts set primary_ip = $2, ip_addresses = $3::jsonb where id = $1`, [
      hostId,
      '10.255.0.213',
      JSON.stringify(['10.255.0.213']),
    ]);

    const service = await app.inject({
      method: 'POST',
      path: '/api/v1/framework-instances',
      headers: userHeaders,
      body: { deviceId: hostId, frameworkType: 'web.iis', frameworkKey: 'iis', displayName: 'Default IIS', rawFacts: { configPath: 'IIS:\\\\Sites' }, discoveryProviderKey: 'manual:test' },
    });
    assert.equal(service.statusCode, 201);
    const serviceInstanceId = (service.body as { id: string }).id;

    const managedTargetFixture = await createIisManagedTargetFixture(app, {
      hostId,
      frameworkInstanceId: serviceInstanceId,
      domain: 'app-target.example.com',
      keyPrefix: 'iis-app-asset-agent-01',
      siteName: 'Default Web Site',
    });
    const { siteAssetId, managedTargetId, bindingKey: managedTargetBindingKey } = managedTargetFixture;

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
        parameters: { alias: 'app-target', systemPlatform: 'windows', runtimePlatform: 'iis' },
      },
    });
    assert.equal(exported.statusCode, 201);
    const certificateFormatId = (exported.body as { id: string }).id;

    const applicationAssetId = await createApplicationAssetTargetFixture(app, {
      managedTargetId,
      domain: 'app-target.example.com',
      displayName: 'App Target',
      certificateFormatId,
    });

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
          domainName: '10.255.0.213',
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
        targetCertificateVersionId: certificateVersionId,
        certificateFormatId,
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

    const submitted = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/submit',
      headers: userHeaders,
      body: { planId: (created.body as { id: string }).id },
    });
    assert.equal(submitted.statusCode, 200, JSON.stringify(submitted.body));

    const dryRun = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/dry-run',
      headers: userHeaders,
      body: {
        planId: (created.body as { id: string }).id,
        idempotencyKey: 'idem_application_asset_plan_dry_run',
      },
    });
    assert.equal(dryRun.statusCode, 200, JSON.stringify(dryRun.body));
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
        ipAddress: '10.255.0.214',
        version: '1.0.0',
        osType: 'windows',
      },
    });
    assert.equal(registered.statusCode, 201);
    const agentId = (registered.body as { id: string }).id;

    const hostId = `host_${agentId}`;

    const service = await app.inject({
      method: 'POST',
      path: '/api/v1/framework-instances',
      headers: userHeaders,
      body: { deviceId: hostId, frameworkType: 'web.iis', frameworkKey: 'iis', displayName: 'Default IIS', rawFacts: { configPath: 'IIS:\\\\Sites' }, discoveryProviderKey: 'manual:test' },
    });
    assert.equal(service.statusCode, 201, JSON.stringify(service.body));
    const serviceInstanceId = (service.body as { id: string }).id;

    const managedTargetFixture = await createIisManagedTargetFixture(app, {
      hostId,
      frameworkInstanceId: serviceInstanceId,
      domain: 'sync-target.example.com',
      keyPrefix: 'iis-sync-agent-01',
      siteName: 'Default Web Site',
    });
    const { siteAssetId, managedTargetId } = managedTargetFixture;

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
        parameters: { alias: 'sync-target', systemPlatform: 'windows', runtimePlatform: 'iis' },
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
        parameters: { alias: 'sync-target', systemPlatform: 'windows', runtimePlatform: 'iis' },
      },
    });
    assert.equal(persistedFormat.statusCode, 201, JSON.stringify(persistedFormat.body));
    const certificateFormatId = (persistedFormat.body as { id: string }).id;

    const applicationAssetId = await createApplicationAssetTargetFixture(app, {
      managedTargetId,
      domain: 'sync-target.example.com',
      displayName: 'Sync Target',
      certificateFormatId,
    });

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
    await completeAgentDryRun(app, { planId, agentId, idempotencyKey: 'idem_sync_application_asset_dry_run' });

    const executed = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/execute',
      headers: userHeaders,
      body: { planId, idempotencyKey: 'idem_sync_application_asset_run' },
    });
    assert.equal(executed.statusCode, 200);
    const executedBody = executed.body as { run: { id: string }; steps: Array<{ id: string; stepType: string }> };
    const runId = executedBody.run.id;
    const verifyStep = executedBody.steps.find((step) => step.stepType === 'VERIFY');
    assert.ok(verifyStep);

    const resultSync = app.getResource<any>('executionResultSync');
    resultSync.setContinuationRunner(async () => undefined);
    const deploymentDetail = {
      oldThumbprint: '1111111111111111111111111111111111111111',
      newThumbprint: '2222222222222222222222222222222222222222',
      rolledBack: false,
      manualRequired: false,
      binding: {
        bindingInformation: '*:443:sync-target.example.com',
        hostHeader: 'sync-target.example.com',
        port: 443,
      },
    };
    await resultSync.applyAgentTaskResult({
      tenantId: 'tenant_1',
      executionRunId: runId,
      executionStepId: verifyStep!.id,
      actorId: agentId,
      success: true,
      detail: {
        ...deploymentDetail,
        verify: {
          remoteThumbprint: '2222222222222222222222222222222222222222',
          remoteCertificateSha256: importedBody.version.fingerprintSha256,
        },
      },
    });

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
    const { app, db } = await createMigratedTestApp({ security });
    const chain = createPemChainFixture('format-target.example.com');

    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers: userHeaders,
      body: {
        agentKey: 'iis-format-agent-01',
        hostname: 'IIS-FORMAT-01',
        ipAddress: '10.255.0.215',
        version: '1.0.0',
        osType: 'windows',
      },
    });
    assert.equal(registered.statusCode, 201);
    const agentId = (registered.body as { id: string }).id;

    const hostId = `host_${agentId}`;

    const service = await app.inject({
      method: 'POST',
      path: '/api/v1/framework-instances',
      headers: userHeaders,
      body: { deviceId: hostId, frameworkType: 'web.iis', frameworkKey: 'iis', displayName: 'Default IIS', rawFacts: { configPath: 'IIS:\\\\Sites' }, discoveryProviderKey: 'manual:test' },
    });
    assert.equal(service.statusCode, 201);
    const serviceInstanceId = (service.body as { id: string }).id;

    const managedTargetFixture = await createIisManagedTargetFixture(app, {
      hostId,
      frameworkInstanceId: serviceInstanceId,
      domain: 'format-target.example.com',
      keyPrefix: 'iis-format-agent-01',
      siteName: 'Default Web Site',
    });
    const { siteAssetId, managedTargetId } = managedTargetFixture;

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

    const applicationAssetId = await createApplicationAssetTargetFixture(app, {
      managedTargetId,
      domain: 'format-target.example.com',
      displayName: 'Format Target',
      certificateFormatId: formatAId,
    });

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
    const plan = created.body as {
      id: string;
      certificateVersionId: string;
      certificateFormatId?: string;
      targets: Array<{ strategyPayload?: { deploymentInputSnapshotRef?: { snapshotId?: string } } }>;
    };
    assert.equal(plan.certificateVersionId, certificateVersionId);
    assert.equal(plan.certificateFormatId, formatAId);

    const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers: userHeaders, body: { planId: plan.id } });
    assert.equal(submitted.statusCode, 200);
    const dryRun = await app.inject({
      method: 'POST',
      path: '/api/v1/deployment-plans/dry-run',
      headers: userHeaders,
      body: { planId: plan.id, idempotencyKey: 'idem_application_asset_format_dry_run' },
    });
    assert.equal(dryRun.statusCode, 200, JSON.stringify(dryRun.body));
    const dryRunBody = dryRun.body as { steps: Array<{ inputSnapshot: Record<string, unknown> }> };
    const atomicStep = dryRunBody.steps.find((step) => step.inputSnapshot.actionType === 'agent.plan.execute');
    assert.ok(atomicStep);
    assert.equal(atomicStep!.inputSnapshot.deploymentArtifact, undefined);
    assert.equal(atomicStep!.inputSnapshot.resolvedDeploymentInput, undefined);
    assert.equal(typeof atomicStep!.inputSnapshot.pfxBase64, 'undefined');

    const runtimeSnapshot = await new DeploymentInputSnapshotsRepository(db).getRuntimeSnapshot(
      'tenant_1',
      String(plan.targets[0]?.strategyPayload?.deploymentInputSnapshotRef?.snapshotId),
    );
    assert.equal(runtimeSnapshot?.deploymentArtifact.certificateFormatId, formatAId);
    assert.equal(runtimeSnapshot?.deploymentArtifact.format, 'pfx');
    assert.equal(runtimeSnapshot?.deploymentArtifact.containsPrivateKey, true);
  });

  it('Agent Atomic dry-run 执行结果回传后会把 operationResults 转换为统一预检结果', async () => {
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

    const resultSync = app.getResource('executionResultSync') as {
      applyAgentTaskResult(input: Record<string, unknown>): Promise<void>;
    };
    await resultSync.applyAgentTaskResult({
      tenantId: 'tenant_1',
      executionRunId: dryRunBody.run.id,
      executionStepId: step.id,
      actorId: fixture.agentId,
      success: true,
      detail: {
        planId: 'agplan_dry_run_checks',
        state: 'SUCCEEDED',
        operationResults: [
          { operationId: 'iis-pfx-inspect', operationType: 'windows.certificate.inspect_pfx', stage: 'prepare', status: 'SUCCEEDED', detail: { subject: 'CN=example.com' } },
          { operationId: 'iis-binding-check', operationType: 'preflight.assert', stage: 'prepare', status: 'SUCCEEDED', detail: { passed: true } },
        ],
      },
    });

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
    assert.deepEqual(storedStep!.inputSnapshot.resultDetail.dryRunSummary, { passed: 2, failed: 0, warning: 0, unknown: 0 });
    assert.equal(storedStep!.inputSnapshot.resultDetail.dryRunChecks.length, 2);
    assert.deepEqual(storedStep!.inputSnapshot.resultDetail.dryRunChecks[0], {
      key: 'atomic:iis-pfx-inspect',
      label: 'iis-pfx-inspect · windows.certificate.inspect_pfx',
      status: 'passed',
      detail: '原子操作 iis-pfx-inspect 已完成非破坏性预演。',
      evidence: {
        operationId: 'iis-pfx-inspect',
        operationType: 'windows.certificate.inspect_pfx',
        stage: 'prepare',
        result: { subject: 'CN=example.com' },
      },
    });
  });

});

async function grantDeploymentFixturePolicies(
  security: ReturnType<typeof createSecurityServices>,
  tenantId: string,
): Promise<void> {
  const roleId = `role_deployment_fixture_${Math.random().toString(36).slice(2)}`;
  const objectSetId = `oset_deployment_fixture_${Math.random().toString(36).slice(2)}`;
  await security.rbac.createRole({
    id: roleId,
    code: roleId,
    name: '部署测试对象访问',
    builtin: false,
  });
  const objectSet = await security.objectPermissions.createObjectSet({
    id: objectSetId,
    tenantId,
    name: '部署测试租户对象',
    kind: 'dynamic',
    objectTypes: [
      'host',
      'service_instance',
      'site_asset',
      'managed_target',
      'service_asset',
      'application_asset',
      'certificate_binding',
      'secret',
      'certificate_version',
      'certificate_version_format',
      'plugin_version',
      'plugin_binding',
      'plugin_capability_assignment',
      'deployment_plan',
      'execution_run',
      'execution_step',
      'workflow_template',
      'device_asset',
      'gateway',
      'agent',
    ],
    conditions: { tenantId },
    status: 'active',
  });
  await security.objectPermissions.createRoleBinding({
    tenantId,
    principalType: 'user',
    principalId: 'user_1',
    roleId,
    objectSetId: objectSet.id,
    effect: 'allow',
    enabled: true,
  });
  await security.objectPermissions.createAccessGrant({
    tenantId,
    roleId,
    objectSetId: objectSet.id,
    accessLevel: 'control',
    effect: 'allow',
  });
  security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: 'user_1',
    effect: 'allow',
    actions: [
      'host.create',
      'service_instance.manage',
      'site_asset.manage',
      'managed_target.manage',
      'service_asset.manage',
      'binding.manage',
      'secret.create',
      'certificate.import',
      'certificate.format.create',
      'plugin.read',
      'plugin.manage',
      'execution.run.read',
      'execution.run.retry',
      'execution.run.rollback',
      'execution.step.read',
    ],
    resourceTypes: [
      'host',
      'service_instance',
      'site_asset',
      'managed_target',
      'service_asset',
      'certificate_binding',
      'secret',
      'certificate_version',
      'certificate_version_format',
      'plugin',
      'execution_run',
      'execution_step',
    ],
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

async function createPublishedWorkflow(app: ReturnType<typeof createApp>, content: WorkflowDslV1) {
  const workflowTemplates = app.getResource('workflowTemplatesService') as WorkflowTemplatesApplicationService;
  const workflow = await workflowTemplates.createWorkflow({ content });
  await workflowTemplates.publishVersion(workflow.version.id);
  return workflow;
}

function workflowTemplateFixture(name: string): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name, category: 'certificate_deployment', version: '1.0.0' },
    inputContract: {
      apiVersion: 'gcac.deployment-input/v1',
      variables: {},
      connections: {
        targetSsh: {
          transport: 'ssh',
          host: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
          port: { type: 'number', required: true, configurationMode: 'advanced', source: { kind: 'default' }, lifecycle: 'pre_execution', bindingPolicy: 'default_overridable', default: 22 },
          username: { type: 'string', required: true, configurationMode: 'advanced', source: { kind: 'default' }, lifecycle: 'pre_execution', bindingPolicy: 'default_overridable', default: 'deploy' },
          hostKey: { policy: 'strict' },
        },
      },
      credentials: {},
      artifacts: {
        serverCert: {
          kind: 'certificate',
          required: true,
          configurationMode: 'required',
          lifecycle: 'pre_execution',
          artifactContract: { outputs: { bundle: { role: 'pkcs12_bundle', required: true, sensitive: true } } },
        },
      },
    },
    steps: [
      {
        name: 'deploy',
        type: 'ssh',
        ssh: {
          connectionRef: 'targetSsh',
          program: 'systemctl',
          args: ['service-main'],
          argumentTemplate: 'systemctl.restart',
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
    inputContract: {
      apiVersion: 'gcac.deployment-input/v1',
      variables: {
        callbackUrl: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
      },
      connections: {
        callbackHttp: {
          transport: 'http',
          host: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
          port: { type: 'number', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
        },
      },
      credentials: {},
      artifacts: {
        serverCert: {
          kind: 'certificate',
          required: true,
          configurationMode: 'required',
          lifecycle: 'pre_execution',
          artifactContract: { outputs: { bundle: { role: 'pkcs12_bundle', required: true, sensitive: true } } },
        },
      },
    },
    steps: [
      {
        name: 'verifyRemoteCertificate',
        type: 'http',
        request: {
          method: 'GET',
          connectionRef: 'callbackHttp',
          url: '{{variables.callbackUrl}}',
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

async function seedWorkflowStrategyFixture(app: ReturnType<typeof createApp>, db: PgliteDatabase): Promise<{
  applicationAssetId: string;
  managedTargetId: string;
  bindingId: string;
  certificateVersionId: string;
  certificateFormatId: string;
  certificateFingerprintSha256: string;
  certificatePem: string;
  privateKeyPem: string;
  domain: string;
}> {
  const domain = 'workflow-strategy.example.com';
  const device = await new PgDeviceAssetsRepository(db).create('tenant_1', {
    displayName: 'Workflow Strategy Device',
    managementAddress: '10.255.0.216',
    managementPort: 443,
    deviceFamily: 'test.workflow-device',
    authMode: 'AUTO',
    tlsVerify: true,
  });
  const agent = await app.inject({
    method: 'POST',
    path: '/api/v1/agents/register',
    headers: userHeaders,
    body: {
      agentKey: 'workflow-strategy-agent-01',
      hostname: 'workflow-strategy-host',
      ipAddress: '10.255.0.216',
      version: '1.0.0',
      osType: 'windows',
    },
  });
  assert.equal(agent.statusCode, 201, JSON.stringify(agent.body));
  const hostId = device.hostId;

  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/framework-instances',
    headers: userHeaders,
    body: {
      deviceId: hostId,
      frameworkType: 'web.iis',
      frameworkKey: 'iis',
      displayName: 'iis',
      rawFacts: { configPath: 'IIS:\\\\Sites' },
      discoveryProviderKey: 'manual:test',
    },
  });
  assert.equal(service.statusCode, 201, JSON.stringify(service.body));
  const serviceInstanceId = (service.body as { id: string }).id;

  const certificate = await importCertificateFormatFixture(app, 'tenant_1', domain, 'workflow_strategy');

  const site = await app.inject({
    method: 'POST',
    path: '/api/v1/site-assets',
    headers: userHeaders,
    body: {
      frameworkInstanceId: serviceInstanceId,
      deviceId: hostId,
      discoveryProviderKey: 'manual:test',
      siteType: 'web.site',
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
      deviceId: hostId,
      frameworkInstanceId: serviceInstanceId,
      siteId: siteAssetId,
      discoveryProviderKey: 'manual:test',
      targetType: 'tls.binding',
      targetKey: `workflow-strategy-agent-01:iis:*:443:${domain}`,
      bindingKey: `*:443:${domain}`,
      supportedCapabilities: ['certificate.deploy', 'certificate.rollback'],
      executionLocations: ['AGENT', 'CONTROL_PLANE'],
      metadata: { bindingInformation: `*:443:${domain}` },
    },
  });
  assert.equal(target.statusCode, 201, JSON.stringify(target.body));
  const managedTarget = target.body as { id: string; bindingKey?: string };

  const asset = await app.inject({
    method: 'POST',
    path: '/api/v1/service-assets',
    headers: userHeaders,
    body: {
      address: domain,
      addressType: 'DNS',
      protocol: 'HTTPS',
      port: 443,
      displayName: domain,
    },
  });
  assert.equal(asset.statusCode, 201, JSON.stringify(asset.body));
  const applicationAssetId = (asset.body as { id: string }).id;

  const targetBinding = await app.inject({
    method: 'POST',
    path: '/api/v1/application-asset-targets',
    headers: userHeaders,
    body: {
      applicationAssetId,
      managedTargetId: managedTarget.id,
    },
  });
  assert.equal(targetBinding.statusCode, 201, JSON.stringify(targetBinding.body));

  const binding = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-bindings',
    headers: userHeaders,
    body: {
      serviceInstanceId,
      serviceAssetId: applicationAssetId,
      siteAssetId,
      managedTargetId: managedTarget.id,
      domainName: domain,
      port: 443,
      protocol: 'HTTPS',
      bindingKey: managedTarget.bindingKey,
      bindingType: 'WINDOWS_CERT_STORE',
      certificateVersionId: certificate.certificateVersionId,
      targetCertificateVersionId: certificate.certificateVersionId,
      desiredFingerprintSha256: certificate.certificateFingerprintSha256,
      storeLocation: 'LocalMachine',
      storeName: 'My',
      verifyMethod: 'TLS_CONNECT',
    },
  });
  assert.equal(binding.statusCode, 201, JSON.stringify(binding.body));

  return {
    applicationAssetId,
    managedTargetId: managedTarget.id,
    bindingId: (binding.body as { id: string }).id,
    certificateVersionId: certificate.certificateVersionId,
    certificateFormatId: certificate.certificateFormatId,
    certificateFingerprintSha256: certificate.certificateFingerprintSha256,
    certificatePem: certificate.certificatePem,
    privateKeyPem: certificate.privateKeyPem,
    domain,
  };
}

async function seedDeploymentFixture(app: ReturnType<typeof createApp>, tenantId: string): Promise<DeploymentFixture> {
  const chain = createPemChainFixture();
  const headers = testAuthHeaders('user_1', tenantId, { 'x-request-id': 'req_test' });

  const registered = await app.inject({
    method: 'POST',
    path: '/api/v1/agents/register',
    headers,
    body: {
      agentKey: `${tenantId}-fixture-agent-01`,
      hostname: `${tenantId.toUpperCase()}-FIXTURE-01`,
      ipAddress: '10.255.0.217',
      version: '1.0.0',
      osType: 'windows',
    },
  });
  assert.equal(registered.statusCode, 201);
  const agentId = (registered.body as { id: string }).id;

  const hostId = `host_${agentId}`;

  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/framework-instances',
    headers,
    body: { deviceId: hostId, frameworkType: 'web.iis', frameworkKey: 'iis', displayName: 'Default IIS', rawFacts: { configPath: 'IIS:\\\\Sites'  }, discoveryProviderKey: 'manual:test' },
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
        frameworkInstanceId: serviceInstanceId,
        deviceId: hostId,
        discoveryProviderKey: 'manual:test',
        siteType: 'web.site',
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
        deviceId: hostId,
        frameworkInstanceId: serviceInstanceId,
        siteId: siteAssetId,
        discoveryProviderKey: 'manual:test',
        targetType: 'tls.binding',
        targetKey: `${tenantId}:site-binding:${item.key}:${bindingKey}`,
        bindingKey,
        supportedCapabilities: ['certificate.deploy', 'certificate.rollback'],
        executionLocations: ['AGENT'],
        metadata: { bindingInformation: bindingKey },
      },
    });
    assert.equal(target.statusCode, 201);
    const managedTargetId = (target.body as { id: string }).id;

    const serviceAsset = await app.inject({
      method: 'POST',
      path: '/api/v1/service-assets',
      headers,
      body: {
        address: item.domain,
        addressType: 'DNS',
        protocol: 'HTTPS',
        port: 443,
        environment: 'test',
        owner: 'qa',
        displayName: item.domain,
      },
    });
    assert.equal(serviceAsset.statusCode, 201, JSON.stringify(serviceAsset.body));
    const applicationAssetId = (serviceAsset.body as { id: string }).id;

    const targetBinding = await app.inject({
      method: 'POST',
      path: '/api/v1/application-asset-targets',
      headers,
      body: {
        applicationAssetId,
        managedTargetId,
      },
    });
    if (targetBinding.statusCode !== 201) {
      throw new Error(`seedDeploymentFixture 创建 ApplicationAssetTarget 失败：${targetBinding.statusCode} ${JSON.stringify(targetBinding.body)}`);
    }
    await configureApplicationAssetManagedTarget(app, applicationAssetId, managedTargetId, certificateFormatId);

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
): Promise<{ certificateVersionId: string; certificateFormatId: string; certificateFingerprintSha256: string; certificatePem: string; privateKeyPem: string }> {
  const headers = testAuthHeaders('user_1', tenantId, { 'x-request-id': `req_${alias}` });
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
    certificatePem: pemFixture.pem,
    privateKeyPem: pemFixture.privateKeyPem,
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

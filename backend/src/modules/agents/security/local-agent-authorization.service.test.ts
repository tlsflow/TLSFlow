import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { WINDOWS_WEB_DISCOVERY_PATHS } from '../agent-discovery-paths.js';
import { agentSecurityContractVersion, computeAgentPlanDigest, type AgentPlanV1 } from './agent-security.contract.js';
import { createLocalAgentAuthorizationServicesV1 } from './local-agent-authorization.service.js';

test('本机 Agent Authority 只签发 Agent Core 短期只读发现授权', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gcac-local-authority-'));
  try {
    const services = createLocalAgentAuthorizationServicesV1({
      NODE_ENV: 'development',
      GCAC_LOCAL_AGENT_AUTHORITY_DIR: directory,
    });
    assert.ok(services);

    const allowed = await services.authorization.policyAuthority.issueAuthorization({
      agentId: 'agt-happy',
      tenantId: 'tenant-happy',
      pluginId: 'web.nginx',
      pluginVersionId: 'plugin-version-happy',
      capability: 'application.discover',
      actions: ['filesystem.read', 'process.list', 'service.list'],
      allowedPaths: ['/etc', '/opt'],
      allowedServices: [],
      artifactDigests: [],
      policyRef: 'gcac.agent.discovery',
      policyVersion: '1',
      planDigest: 'a'.repeat(64),
      lifetimeSeconds: 300,
    });
    assert.equal(allowed.decision.allowed, true);
    assert.ok(allowed.token);
    assert.equal(allowed.token?.actions.length, 3);

    const denied = await services.authorization.policyAuthority.issueAuthorization({
      agentId: 'agt-happy',
      tenantId: 'tenant-happy',
      pluginId: 'web.nginx',
      pluginVersionId: 'plugin-version-happy',
      capability: 'application.discover',
      actions: ['filesystem.read', 'process.list', 'service.list'],
      allowedPaths: ['/tmp'],
      allowedServices: [],
      artifactDigests: [],
      policyRef: 'gcac.agent.discovery',
      policyVersion: '1',
      planDigest: 'b'.repeat(64),
      lifetimeSeconds: 300,
    });
    assert.equal(denied.decision.allowed, false);
    assert.equal(denied.token, undefined);

    const windowsAllowed = await services.authorization.policyAuthority.issueAuthorization({
      agentId: 'agt-windows',
      tenantId: 'tenant-happy',
      pluginId: 'web.iis',
      pluginVersionId: 'plugin-version-windows',
      capability: 'application.discover',
      actions: ['filesystem.read', 'process.list', 'service.list'],
      allowedPaths: [...WINDOWS_WEB_DISCOVERY_PATHS],
      allowedServices: [],
      artifactDigests: [],
      policyRef: 'gcac.agent.discovery',
      policyVersion: '1',
      planDigest: 'c'.repeat(64),
      lifetimeSeconds: 300,
    });
    assert.equal(windowsAllowed.decision.allowed, true);
    assert.ok(windowsAllowed.token);
    assert.deepEqual(windowsAllowed.decision.allowedPaths, []);

    const material = await services.trustMaterialIssuer.issue({ tenantId: 'tenant-happy', agentId: 'agt-happy' }) as {
      localPolicy: { agentId: string; allowedActions: string[]; pathRules: Array<{ prefix: string }> };
      capabilityKeySet: Record<string, string>;
    };
    assert.equal(material.localPolicy.agentId, 'agt-happy');
    assert.deepEqual(material.localPolicy.allowedActions.sort(), ['filesystem.read', 'process.list', 'service.list']);
    assert.deepEqual(material.localPolicy.pathRules.map((rule) => rule.prefix), ['/etc', '/opt', '/usr/local', '/usr/share/nginx', '/srv', '/var/lib', '/var/www']);
    assert.deepEqual(material.capabilityKeySet, services.trustMaterialIssuer.getTrustedKeySet());
    const windowsMaterial = await services.trustMaterialIssuer.issue({ tenantId: 'tenant-happy', agentId: 'agt-windows', osType: 'WINDOWS' }) as {
      localPolicy: { pathRules: Array<{ prefix: string }> };
    };
    assert.deepEqual(windowsMaterial.localPolicy.pathRules, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('本机执行策略必须精确绑定后才允许证书根信任安装', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gcac-local-execution-policy-'));
  try {
    writeFileSync(join(directory, 'execution-policy.json'), JSON.stringify({
      version: 'gcac.local-agent-execution-policy/v1',
      bindings: [{
        tenantId: 'tenant-execution',
        agentId: 'agt-execution',
        pluginId: 'web.apache.windows',
        pluginVersionId: 'plugin-version-apache',
        capability: 'certificate.deploy',
        policyRef: 'certificate-update-policy',
        policyVersion: 'v1',
        actions: ['certificate.store.install'],
        allowedPaths: ['C:/GCAC-Lab/certs'],
        allowedServices: [],
        artifactDigests: [],
        commandRules: [],
      }],
    }));
    const services = createLocalAgentAuthorizationServicesV1({
      NODE_ENV: 'development',
      GCAC_LOCAL_AGENT_AUTHORITY_DIR: directory,
    });
    assert.ok(services);
    const allowed = await services.authorization.policyAuthority.issueAuthorization({
      agentId: 'agt-execution',
      tenantId: 'tenant-execution',
      pluginId: 'web.apache.windows',
      pluginVersionId: 'plugin-version-apache',
      capability: 'certificate.deploy',
      actions: ['certificate.store.install'],
      allowedPaths: ['C:/GCAC-Lab/certs/apache.crt.pem'],
      allowedServices: [],
      artifactDigests: [],
      policyRef: 'certificate-update-policy',
      policyVersion: 'v1',
      planDigest: 'a'.repeat(64),
      lifetimeSeconds: 300,
    });
    assert.equal(allowed.decision.allowed, true);
    assert.ok(allowed.token);

    const wrongVersion = await services.authorization.policyAuthority.issueAuthorization({
      agentId: 'agt-execution',
      tenantId: 'tenant-execution',
      pluginId: 'web.apache.windows',
      pluginVersionId: 'plugin-version-other',
      capability: 'certificate.deploy',
      actions: ['certificate.store.install'],
      allowedPaths: ['C:/GCAC-Lab/certs/apache.crt.pem'],
      allowedServices: [],
      artifactDigests: [],
      policyRef: 'certificate-update-policy',
      policyVersion: 'v1',
      planDigest: 'b'.repeat(64),
      lifetimeSeconds: 300,
    });
    assert.equal(wrongVersion.decision.allowed, false);
    assert.equal(wrongVersion.token, undefined);
    assert.equal(services.executionPolicy.inspect({ tenantId: 'tenant-execution', agentId: 'agt-execution', pluginId: 'web.apache.windows', pluginVersionId: 'plugin-version-other', capability: 'certificate.deploy', policyRef: 'certificate-update-policy', policyVersion: 'v1' }).matchedIdentity, false);
    const repaired = services.executionPolicy.copyBinding({ tenantId: 'tenant-execution', agentId: 'agt-execution', pluginId: 'web.apache.windows', sourcePluginVersionId: 'plugin-version-apache', targetPluginVersionId: 'plugin-version-other', capability: 'certificate.deploy' });
    assert.equal(repaired.matchedIdentity, true);
    assert.equal(services.executionPolicy.inspect({ tenantId: 'tenant-execution', agentId: 'agt-execution', pluginId: 'web.apache.windows', pluginVersionId: 'plugin-version-other', capability: 'certificate.deploy' }).matchedIdentity, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('开发环境 provisioning 自动接入内存 Authority，不要求手工编辑 execution-policy.json', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gcac-local-auto-provision-'));
  try {
    const services = createLocalAgentAuthorizationServicesV1({
      NODE_ENV: 'development',
      GCAC_LOCAL_AGENT_AUTHORITY_DIR: directory,
    });
    assert.ok(services);
    const plan = {
      planVersion: agentSecurityContractVersion,
      planId: 'plan-auto-provision',
      agentId: 'agt-auto-provision',
      tenantId: 'tenant-auto-provision',
      pluginId: 'web.apache.linux',
      pluginVersionId: 'plugin-version-auto-provision',
      capability: 'certificate.deploy',
      operations: [{
        operationId: 'op-auto-provision',
        operationType: 'filesystem.read',
        stage: 'prepare',
        input: { path: '/var/lib/gcac/cert.pem' },
        dependsOn: [],
        idempotencyKey: 'idem-auto-provision',
        timeoutSeconds: 30,
      }],
      planDigest: '',
      tokenId: 'token-auto-provision',
      policyDecisionId: 'decision-auto-provision',
      nonce: 'nonce-auto-provision',
      expiresAt: '2026-08-23T00:10:00.000Z',
      writeEffect: false,
    } satisfies AgentPlanV1;
    plan.planDigest = computeAgentPlanDigest(plan);
    const actions = ['filesystem.read'];
    const provisioning = await services.authorization.policyAuthority.provisionAgentPlan!({
      tenantId: plan.tenantId,
      agentId: plan.agentId,
      pluginId: plan.pluginId,
      pluginVersionId: plan.pluginVersionId,
      capability: plan.capability,
      planDigest: plan.planDigest,
      policyRef: 'certificate-update-policy',
      policyVersion: 'v1',
      actions,
      allowedPaths: ['/var/lib/gcac'],
      allowedServices: [],
      commandRules: [],
      artifactDigests: ['a'.repeat(64)],
      lifetimeSeconds: 300,
      bootstrapLocalPolicy: true,
      currentLocalPolicy: {
        policyVersion: agentSecurityContractVersion,
        agentId: plan.agentId,
        authorityKeyIds: ['bootstrap-pending'],
        allowedActions: actions,
        pathRules: [{ prefix: '/var/lib/gcac', operations: actions }],
        serviceRules: [],
        commandRules: [],
        disabled: false,
        updatedAt: plan.expiresAt,
      },
      compiledPlan: plan,
    });
    assert.equal(provisioning.rule.planDigest, plan.planDigest);
    const authorization = await services.authorization.policyAuthority.issueAuthorization({
      agentId: plan.agentId,
      tenantId: plan.tenantId,
      pluginId: plan.pluginId,
      pluginVersionId: plan.pluginVersionId,
      capability: plan.capability,
      actions,
      allowedPaths: ['/var/lib/gcac/cert.pem'],
      allowedServices: [],
      artifactDigests: ['a'.repeat(64)],
      policyRef: 'certificate-update-policy',
      policyVersion: 'v1',
      planDigest: plan.planDigest,
      lifetimeSeconds: 300,
    });
    assert.equal(authorization.decision.allowed, true, authorization.decision.reason);
    assert.ok(authorization.token);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('开发环境缺少 execution-policy.json 时仍必须委托宿主 Execution Grant', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gcac-local-grant-delegation-'));
  try {
    let calls = 0;
    const services = createLocalAgentAuthorizationServicesV1(
      { NODE_ENV: 'development', GCAC_LOCAL_AGENT_AUTHORITY_DIR: directory },
      {
        grants: {
          validate: async () => {
            calls += 1;
            return { status: 'active' } as never;
          },
        },
      },
    );
    assert.ok(services);
    await services.authorization.grants.validate({
      grantId: 'grant-development',
      tenantId: 'tenant-development',
      planId: 'plan-development',
      runId: 'run-development',
      stepId: 'step-development',
      executorType: 'AGENT',
      action: 'certificate.store.install',
    });
    assert.equal(calls, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

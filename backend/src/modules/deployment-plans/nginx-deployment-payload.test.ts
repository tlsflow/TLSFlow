import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../../app.module.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import type { UnifiedPluginsApplicationService } from '../plugins/application/unified-plugins.application-service.js';
import { BuiltinUnifiedPluginLoader } from '../plugins/builtin-plugins/builtin-unified-plugin-loader.js';
import { createSecurityServices } from '../security/security.controller.js';

const headers = { 'x-actor-id': 'user_1', 'x-tenant-id': 'tenant_1', 'x-request-id': 'req_nginx_payload' };

test('NGINX deployment plan 会通过统一插件能力生成 Agent Atomic 请求', async () => {
  const security = createSecurityServices();
  security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: 'user_1',
    effect: 'allow',
    actions: [
      'agent.register',
      'host.create',
      'service_instance.manage',
      'service_asset.manage',
      'site_asset.manage',
      'managed_target.manage',
      'binding.manage',
      'certificate.import',
      'certificate.format.create',
      'deployment_plan.create',
      'deployment_plan.submit',
      'deployment_plan.dry_run',
    ],
    resourceTypes: [
      'agent',
      'host',
      'service_instance',
      'service_asset',
      'site_asset',
      'managed_target',
      'certificate_binding',
      'certificate_version',
      'certificate_version_format',
      'deploymentPlan',
    ],
    scope: { tenantId: 'tenant_1' },
  });

  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = createApp({ db, corePersistence: { mode: 'memory' }, security });
  const chain = createPemChainFixture('nginx-site.example.com');

  const registered = await app.inject({
    method: 'POST',
    path: '/api/v1/agents/register',
    headers,
    body: {
      agentKey: 'nginx-agent-01',
      hostname: 'nginx-host-01.example.com',
      version: '1.0.0',
      osType: 'linux',
      directControl: {
        enabled: true,
        reachable: true,
        listenAddress: '127.0.0.1:19081',
        protocolVersion: 'v1',
        supportedActions: ['health', 'discovery.run', 'agent.atomic_plan.execute'],
      },
    },
  });
  assert.equal(registered.statusCode, 201, JSON.stringify(registered.body));
  const agentId = (registered.body as { id: string }).id;

  const hostId = `host_${agentId}`;

  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/framework-instances',
    headers,
    body: { deviceId: hostId, frameworkType: 'web.nginx', frameworkKey: 'nginx', displayName: 'nginx', rawFacts: { configPath: '/etc/nginx/nginx.conf' }, discoveryProviderKey: `agent:${agentId}` },
  });
  assert.equal(service.statusCode, 201, JSON.stringify(service.body));
  const serviceInstanceId = (service.body as { id: string }).id;

  const serviceAsset = await app.inject({
    method: 'POST',
    path: '/api/v1/service-assets',
    headers,
    body: {
      serviceInstanceId,
      hostId,
      agentId,
      address: 'app-nginx.example.net',
      addressType: 'DNS',
      port: 9443,
      protocol: 'HTTPS',
      sniName: 'app-nginx.example.net',
      verifyUrl: 'https://app-nginx.example.net:9443',
      displayName: 'NGINX 对外访问入口',
    },
  });
  assert.equal(serviceAsset.statusCode, 201, JSON.stringify(serviceAsset.body));
  const serviceAssetId = (serviceAsset.body as { id: string }).id;

  const site = await app.inject({
    method: 'POST',
    path: '/api/v1/site-assets',
    headers,
    body: {
      frameworkInstanceId: serviceInstanceId,
      deviceId: hostId,
      discoveryProviderKey: `agent:${agentId}`,
      siteType: 'web.site',
      siteName: 'nginx-site.example.com',
      siteKey: 'nginx:nginx-site.example.com:443:https',
      hostHeader: 'nginx-site.example.com',
      listenIp: '*',
      port: 443,
      protocol: 'HTTPS',
      configPath: '/etc/nginx/sites-enabled/nginx-site.conf',
      metadata: {
        sourceFile: '/etc/nginx/sites-enabled/nginx-site.conf',
        serverNames: ['nginx-site.example.com', 'www.nginx-site.example.com'],
        testCommand: 'nginx -t',
        reloadCommand: 'systemctl reload nginx',
        permission: {
          recommendedHelperCommand: '/usr/local/libexec/gcac-nginx-helper',
        },
        verifyUrl: 'https://nginx-site.example.com:443',
      },
    },
  });
  assert.equal(site.statusCode, 201, JSON.stringify(site.body));
  const siteAssetId = (site.body as { id: string }).id;

  const target = await app.inject({
    method: 'POST',
    path: '/api/v1/managed-targets',
    headers,
    body: {
      deviceId: hostId,
      frameworkInstanceId: serviceInstanceId,
      siteId: siteAssetId,
      discoveryProviderKey: `agent:${agentId}`,
      targetType: 'tls.file',
      targetKey: 'nginx:file:/etc/nginx/certs/nginx-site.pem',
      bindingKey: 'nginx:nginx-site.example.com:443:https',
      supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'],
      executionLocations: ['AGENT'],
      metadata: { certPath: '/etc/nginx/certs/nginx-site.pem', keyPath: '/etc/nginx/certs/nginx-site.key' },
    },
  });
  assert.equal(target.statusCode, 201, JSON.stringify(target.body));
  const managedTargetId = (target.body as { id: string }).id;

  await configureApplicationAssetManagedTarget(app, serviceAssetId, managedTargetId, {
    certificatePath: '/etc/nginx/certs/nginx-site.pem',
    privateKeyPath: '/etc/nginx/certs/nginx-site.key',
    nginxProgram: '/usr/sbin/nginx',
    serviceName: 'nginx',
    verifyHost: 'app-nginx.example.net',
    verifyPort: 9443,
  });

  const imported = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-versions/import',
    headers,
    body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
  });
  assert.equal(imported.statusCode, 201, JSON.stringify(imported.body));
  const importedBody = imported.body as { version: { id: string; fingerprintSha256: string } };
  const certificateVersionId = importedBody.version.id;

  const format = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-version-formats',
    headers,
    body: {
      certificateVersionId,
      format: 'pem',
      containsPrivateKey: false,
      parameters: {
        includeLeafCertificate: true,
        includeCertificateChain: true,
        includePrivateKey: false,
        generatePrivateKeyFile: true,
        systemPlatform: 'linux',
        runtimePlatform: 'nginx',
      },
    },
  });
  assert.equal(format.statusCode, 201, JSON.stringify(format.body));
  const certificateFormatId = (format.body as { id: string }).id;

  const binding = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-bindings',
    headers,
    body: {
      serviceInstanceId,
      serviceAssetId,
      siteAssetId,
      managedTargetId,
      domainName: 'nginx-site.example.com',
      port: 443,
      protocol: 'HTTPS',
      bindingKey: 'nginx:nginx-site.example.com:443:https',
      bindingType: 'FILE_PATH',
      certificateVersionId,
      targetCertificateVersionId: certificateVersionId,
      desiredFingerprintSha256: importedBody.version.fingerprintSha256,
      observedFingerprintSha256: '4'.repeat(64),
      certPath: '/etc/nginx/certs/nginx-site.pem',
      keyPath: '/etc/nginx/certs/nginx-site.key',
      reloadCommand: 'systemctl reload nginx',
      verifyMethod: 'TLS_CONNECT',
      metadata: {
        sourceFile: '/etc/nginx/sites-enabled/nginx-site.conf',
        serverNames: ['nginx-site.example.com', 'www.nginx-site.example.com'],
        testCommand: 'nginx -t',
      },
    },
  });
  assert.equal(binding.statusCode, 201, JSON.stringify(binding.body));
  const bindingId = (binding.body as { id: string }).id;

  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/deployment-plans/from-application-asset',
    headers,
    body: {
      applicationAssetId: serviceAssetId,
      selectionMode: 'EXPLICIT',
      targetCertificateVersionId: certificateVersionId,
      certificateFormatId,
      idempotencyKey: 'idem_nginx_payload_plan',
      policy: { riskLevel: 'low', approvalRequired: false, failurePolicy: 'rollback' },
    },
  });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const planId = (created.body as { id: string }).id;

  const submitted = await app.inject({ method: 'POST', path: '/api/v1/deployment-plans/submit', headers, body: { planId } });
  assert.equal(submitted.statusCode, 200, JSON.stringify(submitted.body));

  const dryRun = await app.inject({
    method: 'POST',
    path: '/api/v1/deployment-plans/dry-run',
    headers,
    body: { planId, idempotencyKey: 'idem_nginx_payload_dry_run' },
  });
  assert.equal(dryRun.statusCode, 200, JSON.stringify(dryRun.body));
  const dryRunBody = dryRun.body as { steps: Array<{ stepType: string; inputSnapshot: any }> };
  assert.equal(dryRunBody.steps.length, 1, JSON.stringify(dryRunBody));
  const atomicStep = dryRunBody.steps.find((step) => step.stepType === 'CUSTOM');
  assert.ok(atomicStep, JSON.stringify(dryRunBody));
  assert.equal(atomicStep!.inputSnapshot.actionType, 'agent.atomic_plan.execute');
  assert.equal(atomicStep!.inputSnapshot.pluginRuntimeCapability.runtime, 'AGENT_ATOMIC');
  assert.equal(atomicStep!.inputSnapshot.pluginRuntimeCapability.capabilityKey, 'certificate.deploy');
  assert.equal(atomicStep!.inputSnapshot.applicationAssetId, serviceAssetId);
  assert.equal(atomicStep!.inputSnapshot.managedTargetId, managedTargetId);
  assert.equal(atomicStep!.inputSnapshot.siteName, 'nginx-site.example.com');
  assert.equal(atomicStep!.inputSnapshot.bindingSelector.hostHeader, 'nginx-site.example.com');
  assert.equal(atomicStep!.inputSnapshot.bindingSelector.port, 443);
  assert.equal(atomicStep!.inputSnapshot.deploymentArtifact.format, 'pem');
});

async function configureApplicationAssetManagedTarget(
  app: ReturnType<typeof createApp>,
  applicationAssetId: string,
  managedTargetId: string,
  variableBindings: Record<string, unknown>,
): Promise<void> {
  const unifiedPlugins = app.getResource('unifiedPluginsService') as UnifiedPluginsApplicationService | undefined;
  assert.ok(unifiedPlugins);
  await new BuiltinUnifiedPluginLoader().installAll('tenant_1', unifiedPlugins);

  const compatible = await app.inject({
    method: 'GET',
    path: `/api/v1/managed-targets/${managedTargetId}/compatible-plugins?capabilityKey=certificate.deploy&applicationAssetId=${applicationAssetId}`,
    headers,
  });
  assert.equal(compatible.statusCode, 200, JSON.stringify(compatible.body));
  const plugin = (compatible.body as { items: Array<{ pluginVersionId: string; compatible: boolean }> }).items.find((item) => item.compatible);
  assert.ok(plugin, JSON.stringify(compatible.body));

  const saved = await app.inject({
    method: 'PUT',
    path: `/api/v1/application-assets/${applicationAssetId}/managed-target`,
    headers,
    body: {
      managedTargetId,
      capabilityKey: 'certificate.deploy',
      pluginOverride: { pluginVersionId: plugin.pluginVersionId, variableBindings },
    },
  });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));

  const strategy = await app.inject({
    method: 'PATCH',
    path: `/api/v1/service-assets/${applicationAssetId}/deployment-strategy`,
    headers,
    body: {
      deploymentStrategy: {
        type: 'MANAGED_TARGET',
        managedTarget: { managedTargetId, capabilityKey: 'certificate.deploy' },
      },
    },
  });
  assert.equal(strategy.statusCode, 200, JSON.stringify(strategy.body));
}

function createPemChainFixture(commonName: string): { pem: string; privateKeyPem: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gcac-nginx-chain-'));
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

test('按应用资产创建 NGINX 部署计划时会保留显式选择的 certificateFormatId', async () => {
  const security = createSecurityServices();
  security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: 'user_1',
    effect: 'allow',
    actions: [
      'agent.register',
      'host.create',
      'service_instance.manage',
      'site_asset.manage',
      'managed_target.manage',
      'binding.manage',
      'service_asset.manage',
      'service_asset.read',
      'certificate.import',
      'certificate.format.create',
      'deployment_plan.create',
      'deployment_plan.submit',
      'deployment_plan.dry_run',
    ],
    resourceTypes: [
      'agent',
      'host',
      'service_instance',
      'site_asset',
      'managed_target',
      'service_asset',
      'certificate_binding',
      'certificate_version',
      'certificate_version_format',
      'deploymentPlan',
    ],
    scope: { tenantId: 'tenant_1' },
  });

  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = createApp({ db, corePersistence: { mode: 'memory' }, security });
  const chain = createPemChainFixture('nginx-asset.example.com');

  const registered = await app.inject({
    method: 'POST',
    path: '/api/v1/agents/register',
    headers,
    body: {
      agentKey: 'nginx-agent-asset-01',
      hostname: 'nginx-asset-host.example.com',
      version: '1.0.0',
      osType: 'linux',
      directControl: {
        enabled: true,
        reachable: true,
        listenAddress: '127.0.0.1:19082',
        protocolVersion: 'v1',
        supportedActions: ['health', 'discovery.run', 'agent.atomic_plan.execute'],
      },
    },
  });
  assert.equal(registered.statusCode, 201, JSON.stringify(registered.body));
  const agentId = (registered.body as { id: string }).id;

  const hostId = `host_${agentId}`;

  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/framework-instances',
    headers,
    body: { deviceId: hostId, frameworkType: 'web.nginx', frameworkKey: 'nginx', displayName: 'nginx', rawFacts: { configPath: '/etc/nginx/nginx.conf' }, discoveryProviderKey: `agent:${agentId}` },
  });
  assert.equal(service.statusCode, 201, JSON.stringify(service.body));
  const serviceInstanceId = (service.body as { id: string }).id;

  const site = await app.inject({
    method: 'POST',
    path: '/api/v1/site-assets',
    headers,
    body: {
      frameworkInstanceId: serviceInstanceId,
      deviceId: hostId,
      discoveryProviderKey: `agent:${agentId}`,
      siteType: 'web.site',
      siteName: 'nginx-asset.example.com',
      siteKey: 'nginx:nginx-asset.example.com:443:https',
      hostHeader: 'nginx-asset.example.com',
      listenIp: '*',
      port: 443,
      protocol: 'HTTPS',
      configPath: '/etc/nginx/sites-enabled/nginx-asset.conf',
      metadata: {
        sourceFile: '/etc/nginx/sites-enabled/nginx-asset.conf',
        serverNames: ['nginx-asset.example.com'],
        testCommand: 'nginx -t',
        reloadCommand: 'systemctl reload nginx',
      },
    },
  });
  assert.equal(site.statusCode, 201, JSON.stringify(site.body));
  const siteAssetId = (site.body as { id: string }).id;

  const target = await app.inject({
    method: 'POST',
    path: '/api/v1/managed-targets',
    headers,
    body: {
      deviceId: hostId,
      frameworkInstanceId: serviceInstanceId,
      siteId: siteAssetId,
      discoveryProviderKey: `agent:${agentId}`,
      targetType: 'tls.file',
      targetKey: 'nginx:file:/etc/nginx/certs/nginx-asset.pem',
      bindingKey: 'nginx:nginx-asset.example.com:443:https',
      supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'],
      executionLocations: ['AGENT'],
      metadata: { certPath: '/etc/nginx/certs/nginx-asset.pem', keyPath: '/etc/nginx/certs/nginx-asset.key' },
    },
  });
  assert.equal(target.statusCode, 201, JSON.stringify(target.body));
  const managedTargetId = (target.body as { id: string }).id;

  const applicationAsset = await app.inject({
    method: 'POST',
    path: '/api/v1/service-assets',
    headers,
    body: {
      address: 'nginx-asset.example.com',
      addressType: 'DNS',
      port: 443,
      protocol: 'HTTPS',
      platform: 'LINUX',
      hostId,
      agentId,
      serviceInstanceId,
      displayName: 'NGINX Asset',
    },
  });
  assert.equal(applicationAsset.statusCode, 201, JSON.stringify(applicationAsset.body));
  const applicationAssetId = (applicationAsset.body as { id: string }).id;

  await configureApplicationAssetManagedTarget(app, applicationAssetId, managedTargetId, {
    certificatePath: '/etc/nginx/certs/nginx-asset.pem',
    privateKeyPath: '/etc/nginx/certs/nginx-asset.key',
    nginxProgram: '/usr/sbin/nginx',
    serviceName: 'nginx',
    verifyHost: 'nginx-asset.example.com',
    verifyPort: 443,
  });

  const discoveredBinding = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-bindings',
    headers,
    body: {
      serviceInstanceId,
      serviceAssetId: applicationAssetId,
      siteAssetId,
      managedTargetId,
      domainName: 'nginx-asset.example.com',
      port: 443,
      protocol: 'HTTPS',
      bindingKey: 'nginx:nginx-asset.example.com:443:https',
      bindingType: 'FILE_PATH',
      certPath: '/etc/nginx/certs/nginx-asset.pem',
      keyPath: '/etc/nginx/certs/nginx-asset.key',
      reloadCommand: 'systemctl reload nginx',
      verifyMethod: 'TLS_CONNECT',
      metadata: {
        sourceFile: '/etc/nginx/sites-enabled/nginx-asset.conf',
        serverNames: ['nginx-asset.example.com'],
        testCommand: 'nginx -t',
      },
    },
  });
  assert.equal(discoveredBinding.statusCode, 201, JSON.stringify(discoveredBinding.body));

  const imported = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-versions/import',
    headers,
    body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
  });
  assert.equal(imported.statusCode, 201, JSON.stringify(imported.body));
  const importedBody = imported.body as { version: { id: string; fingerprintSha256: string } };
  const certificateVersionId = importedBody.version.id;

  const format = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-version-formats',
    headers,
    body: {
      certificateVersionId,
      format: 'pem',
      containsPrivateKey: false,
      parameters: {
        configName: 'Linux-NGINX-PEM',
        includeLeafCertificate: true,
        includeCertificateChain: true,
        includePrivateKey: false,
        generatePrivateKeyFile: true,
        systemPlatform: 'linux',
        runtimePlatform: 'nginx',
        extension: 'pem',
      },
    },
  });
  assert.equal(format.statusCode, 201, JSON.stringify(format.body));
  const certificateFormatId = (format.body as { id: string }).id;

  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/deployment-plans/from-application-asset',
    headers,
    body: {
      applicationAssetId,
      selectionMode: 'EXPLICIT',
      targetCertificateVersionId: certificateVersionId,
      certificateFormatId,
      idempotencyKey: 'idem_nginx_asset_plan_with_format',
    },
  });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const plan = created.body as { id: string; certificateVersionId: string; certificateFormatId?: string };
  assert.equal(plan.certificateVersionId, certificateVersionId);
  assert.equal(plan.certificateFormatId, certificateFormatId);

  const submitted = await app.inject({
    method: 'POST',
    path: '/api/v1/deployment-plans/submit',
    headers,
    body: { planId: plan.id },
  });
  assert.equal(submitted.statusCode, 200, JSON.stringify(submitted.body));

  const dryRun = await app.inject({
    method: 'POST',
    path: '/api/v1/deployment-plans/dry-run',
    headers,
    body: { planId: plan.id, idempotencyKey: 'idem_nginx_asset_plan_with_format_dry_run' },
  });
  assert.equal(dryRun.statusCode, 200, JSON.stringify(dryRun.body));
  const dryRunBody = dryRun.body as { steps: Array<{ stepType: string; inputSnapshot: any }> };
  assert.equal(dryRunBody.steps.length, 1);
  const atomicStep = dryRunBody.steps.find((step) => step.stepType === 'CUSTOM');
  assert.ok(atomicStep);
  assert.equal(atomicStep!.inputSnapshot.deploymentArtifact.certificateFormatId, certificateFormatId);
  assert.equal(atomicStep!.inputSnapshot.deploymentArtifact.format, 'pem');
  assert.equal(atomicStep!.inputSnapshot.deploymentArtifact.containsPrivateKey, false);
  assert.equal(atomicStep!.inputSnapshot.actionType, 'agent.atomic_plan.execute');
  assert.equal(atomicStep!.inputSnapshot.pluginRuntimeCapability.runtime, 'AGENT_ATOMIC');
  assert.equal(atomicStep!.inputSnapshot.pluginRuntimeCapability.capabilityKey, 'certificate.deploy');
});

test('NGINX 部署 dry-run 从统一受管目标上下文生成 payload', async () => {
  const security = createSecurityServices();
  security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: 'user_1',
    effect: 'allow',
    actions: [
      'agent.register',
      'host.create',
      'service_instance.manage',
      'site_asset.manage',
      'managed_target.manage',
      'service_asset.manage',
      'service_asset.read',
      'binding.manage',
      'discovery.manage',
      'certificate.import',
      'certificate.format.create',
      'deployment_plan.create',
      'deployment_plan.submit',
      'deployment_plan.dry_run',
    ],
    resourceTypes: [
      'agent',
      'host',
      'service_instance',
      'site_asset',
      'managed_target',
      'service_asset',
      'certificate_binding',
      'discovery_snapshot',
      'certificate_version',
      'certificate_version_format',
      'deploymentPlan',
    ],
    scope: { tenantId: 'tenant_1' },
  });

  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = createApp({ db, corePersistence: { mode: 'memory' }, security });
  const chain = createPemChainFixture('nginx-legacy.example.com');

  const registered = await app.inject({
    method: 'POST',
    path: '/api/v1/agents/register',
    headers,
    body: {
      agentKey: 'nginx-agent-legacy-01',
      hostname: 'nginx-legacy-host.example.com',
      version: '1.0.0',
      osType: 'linux',
      directControl: {
        enabled: true,
        reachable: true,
        listenAddress: '127.0.0.1:19083',
        protocolVersion: 'v1',
        supportedActions: ['health', 'discovery.run', 'agent.atomic_plan.execute'],
      },
    },
  });
  assert.equal(registered.statusCode, 201, JSON.stringify(registered.body));
  const agentId = (registered.body as { id: string }).id;

  const hostId = `host_${agentId}`;

  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/framework-instances',
    headers,
    body: { deviceId: hostId, frameworkType: 'web.nginx', frameworkKey: 'nginx', displayName: 'nginx', rawFacts: { configPath: '/etc/nginx/nginx.conf' }, discoveryProviderKey: `agent:${agentId}` },
  });
  assert.equal(service.statusCode, 201, JSON.stringify(service.body));
  const serviceInstanceId = (service.body as { id: string }).id;

  const site = await app.inject({
    method: 'POST',
    path: '/api/v1/site-assets',
    headers,
    body: {
      frameworkInstanceId: serviceInstanceId,
      deviceId: hostId,
      discoveryProviderKey: `agent:${agentId}`,
      siteType: 'web.site',
      siteName: 'nginx-legacy.example.com',
      siteKey: 'nginx:nginx-legacy.example.com:443:https',
      hostHeader: 'nginx-legacy.example.com',
      listenIp: '*',
      port: 443,
      protocol: 'HTTPS',
      configPath: '/etc/nginx/sites-enabled/nginx-legacy.conf',
      metadata: {
        sourceFile: '/etc/nginx/sites-enabled/nginx-legacy.conf',
        serverNames: ['nginx-legacy.example.com'],
        testCommand: 'nginx -t',
        reloadCommand: 'systemctl reload nginx',
      },
    },
  });
  assert.equal(site.statusCode, 201, JSON.stringify(site.body));
  const siteAssetId = (site.body as { id: string }).id;

  const target = await app.inject({
    method: 'POST',
    path: '/api/v1/managed-targets',
    headers,
    body: {
      deviceId: hostId,
      frameworkInstanceId: serviceInstanceId,
      siteId: siteAssetId,
      discoveryProviderKey: `agent:${agentId}`,
      targetType: 'tls.file',
      targetKey: 'nginx:file:/etc/nginx/certs/nginx-legacy.pem',
      bindingKey: 'nginx:nginx-legacy.example.com:443:https',
      supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'],
      executionLocations: ['AGENT'],
      metadata: { certPath: '/etc/nginx/certs/nginx-legacy.pem', keyPath: '/etc/nginx/certs/nginx-legacy.key' },
    },
  });
  assert.equal(target.statusCode, 201, JSON.stringify(target.body));
  const managedTargetId = (target.body as { id: string }).id;

  const applicationAsset = await app.inject({
    method: 'POST',
    path: '/api/v1/service-assets',
    headers,
    body: {
      address: 'nginx-legacy.example.com',
      addressType: 'DNS',
      port: 443,
      protocol: 'HTTPS',
      platform: 'LINUX',
      hostId,
      agentId,
      serviceInstanceId,
      displayName: 'NGINX App',
    },
  });
  assert.equal(applicationAsset.statusCode, 201, JSON.stringify(applicationAsset.body));
  const applicationAssetId = (applicationAsset.body as { id: string }).id;

  await configureApplicationAssetManagedTarget(app, applicationAssetId, managedTargetId, {
    certificatePath: '/etc/nginx/certs/nginx-legacy.pem',
    privateKeyPath: '/etc/nginx/certs/nginx-legacy.key',
    nginxProgram: '/usr/sbin/nginx',
    serviceName: 'nginx',
    verifyHost: 'nginx-legacy.example.com',
    verifyPort: 443,
  });

  const binding = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-bindings',
    headers,
    body: {
      serviceInstanceId,
      serviceAssetId: applicationAssetId,
      siteAssetId,
      managedTargetId,
      domainName: 'nginx-legacy.example.com',
      port: 443,
      protocol: 'HTTPS',
      bindingKey: 'nginx:nginx-legacy.example.com:443:https',
      bindingType: 'FILE_PATH',
      certPath: '/etc/nginx/certs/nginx-legacy.pem',
      keyPath: '/etc/nginx/certs/nginx-legacy.key',
      reloadCommand: 'systemctl reload nginx',
      verifyMethod: 'TLS_CONNECT',
      status: 'MANAGED',
    },
  });
  assert.equal(binding.statusCode, 201, JSON.stringify(binding.body));

  const imported = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-versions/import',
    headers,
    body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
  });
  assert.equal(imported.statusCode, 201, JSON.stringify(imported.body));
  const importedBody = imported.body as { version: { id: string } };
  const certificateVersionId = importedBody.version.id;

  const format = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-version-formats',
    headers,
    body: {
      certificateVersionId,
      format: 'pem',
      containsPrivateKey: false,
      parameters: {
        configName: 'Linux-NGINX-PEM',
        includeLeafCertificate: true,
        includeCertificateChain: true,
        includePrivateKey: false,
        generatePrivateKeyFile: true,
        systemPlatform: 'linux',
        runtimePlatform: 'nginx',
        extension: 'pem',
      },
    },
  });
  assert.equal(format.statusCode, 201, JSON.stringify(format.body));
  const certificateFormatId = (format.body as { id: string }).id;

  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/deployment-plans/from-application-asset',
    headers,
    body: {
      applicationAssetId,
      selectionMode: 'EXPLICIT',
      targetCertificateVersionId: certificateVersionId,
      certificateFormatId,
      idempotencyKey: 'idem_nginx_legacy_snapshot_plan',
    },
  });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const plan = created.body as { id: string };

  const submitted = await app.inject({
    method: 'POST',
    path: '/api/v1/deployment-plans/submit',
    headers,
    body: { planId: plan.id },
  });
  assert.equal(submitted.statusCode, 200, JSON.stringify(submitted.body));

  const dryRun = await app.inject({
    method: 'POST',
    path: '/api/v1/deployment-plans/dry-run',
    headers,
    body: { planId: plan.id, idempotencyKey: 'idem_nginx_legacy_snapshot_dry_run' },
  });
  assert.equal(dryRun.statusCode, 200, JSON.stringify(dryRun.body));
  const dryRunBody = dryRun.body as { steps: Array<{ stepType: string; inputSnapshot: any }> };
  assert.equal(dryRunBody.steps.length, 1);
  const atomicStep = dryRunBody.steps.find((step) => step.stepType === 'CUSTOM');
  assert.ok(atomicStep);
  assert.equal(atomicStep!.inputSnapshot.actionType, 'agent.atomic_plan.execute');
  assert.equal(atomicStep!.inputSnapshot.pluginRuntimeCapability.runtime, 'AGENT_ATOMIC');
  assert.equal(atomicStep!.inputSnapshot.pluginRuntimeCapability.capabilityKey, 'certificate.deploy');
});

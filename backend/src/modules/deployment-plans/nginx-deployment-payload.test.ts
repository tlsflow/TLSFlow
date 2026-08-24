import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../../app.module.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createSecurityServices } from '../security/security.controller.js';

const headers = { 'x-actor-id': 'user_1', 'x-tenant-id': 'tenant_1', 'x-request-id': 'req_nginx_payload' };

test('NGINX deployment plan 会生成 linux.nginx.deploy_certificate payload', async () => {
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
        supportedActions: ['health', 'discovery.run', 'linux.nginx.deploy_certificate'],
      },
    },
  });
  assert.equal(registered.statusCode, 201, JSON.stringify(registered.body));
  const agentId = (registered.body as { id: string }).id;

  const host = await app.inject({
    method: 'POST',
    path: '/api/v1/hosts',
    headers,
    body: { hostname: 'nginx-host-01.example.com', primaryIp: '10.10.50.10', osType: 'LINUX', agentId, compatibilityLevel: 'L1', managementMode: 'AGENT' },
  });
  assert.equal(host.statusCode, 201, JSON.stringify(host.body));
  const hostId = (host.body as { id: string }).id;

  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/service-instances',
    headers,
    body: { hostId, providerType: 'NGINX', serviceName: 'nginx', displayName: 'nginx', configPath: '/etc/nginx/nginx.conf' },
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
      serviceInstanceId,
      serviceAssetId,
      hostId,
      agentId,
      providerType: 'NGINX',
      siteType: 'WEB_SITE',
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
      agentId,
      hostId,
      serviceInstanceId,
      siteAssetId,
      providerType: 'NGINX',
      frameworkType: 'NGINX',
      targetType: 'FILE_DEPLOY',
      targetKey: 'nginx:file:/etc/nginx/certs/nginx-site.pem',
      bindingKey: 'nginx:nginx-site.example.com:443:https',
      capabilityProfile: { providerType: 'NGINX', certPath: '/etc/nginx/certs/nginx-site.pem', keyPath: '/etc/nginx/certs/nginx-site.key' },
    },
  });
  assert.equal(target.statusCode, 201, JSON.stringify(target.body));
  const managedTargetId = (target.body as { id: string }).id;

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
    path: '/api/v1/deployment-plans',
    headers,
    body: {
      name: 'NGINX 站点换证',
      certificateVersionId,
      certificateFormatId,
      idempotencyKey: 'idem_nginx_payload_plan',
      policy: { riskLevel: 'low', approvalRequired: false, failurePolicy: 'rollback' },
      targets: [{ certificateBindingId: bindingId, managedTargetId, executorType: 'AGENT' }],
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
  const discoverStep = dryRunBody.steps.find((step) => step.stepType === 'DISCOVER');
  const verifyStep = dryRunBody.steps.find((step) => step.stepType === 'VERIFY');
  assert.ok(discoverStep);
  assert.ok(verifyStep);
  assert.equal(discoverStep!.inputSnapshot.type, 'linux.nginx.deploy_certificate');
  assert.equal(discoverStep!.inputSnapshot.stepType, 'DISCOVER');
  assert.equal(discoverStep!.inputSnapshot.operation, 'dryRun');
  assert.equal(discoverStep!.inputSnapshot.providerType, 'NGINX');
  assert.equal(discoverStep!.inputSnapshot.bindingSelector.sourceFile, '/etc/nginx/sites-enabled/nginx-site.conf');
  assert.equal(discoverStep!.inputSnapshot.bindingSelector.certPath, '/etc/nginx/certs/nginx-site.pem');
  assert.equal(discoverStep!.inputSnapshot.bindingSelector.keyPath, '/etc/nginx/certs/nginx-site.key');
  assert.deepEqual(discoverStep!.inputSnapshot.bindingSelector.serverNames, ['nginx-site.example.com', 'www.nginx-site.example.com']);
  assert.equal(discoverStep!.inputSnapshot.executionPolicy.testCommand, 'nginx -t');
  assert.equal(discoverStep!.inputSnapshot.executionPolicy.reloadCommand, 'systemctl reload nginx');
  assert.equal(discoverStep!.inputSnapshot.executionPolicy.helperCommand, '/usr/local/libexec/gcac-nginx-helper');
  assert.equal(discoverStep!.inputSnapshot.executionPolicy.verifyHost, 'app-nginx.example.net');
  assert.equal(discoverStep!.inputSnapshot.executionPolicy.verifyPort, 9443);
  assert.equal(discoverStep!.inputSnapshot.executionPolicy.hostHeader, 'app-nginx.example.net');
  assert.equal(discoverStep!.inputSnapshot.executionPolicy.verifyUrl, 'https://app-nginx.example.net:9443');
  assert.equal(discoverStep!.inputSnapshot.verifyUrl, 'https://app-nginx.example.net:9443');
  assert.deepEqual(discoverStep!.inputSnapshot.expectedDomains, ['app-nginx.example.net']);
  assert.equal(discoverStep!.inputSnapshot.expectedCertificateFingerprintSha256, importedBody.version.fingerprintSha256);
  assert.equal(typeof discoverStep!.inputSnapshot.artifact.certificatePem, 'string');
  assert.equal(typeof discoverStep!.inputSnapshot.artifact.privateKeyPem, 'string');
  assert.equal(discoverStep!.inputSnapshot.deploymentArtifact.format, 'pem');
  assert.equal(discoverStep!.inputSnapshot.deploymentArtifact.containsPrivateKey, false);
  assert.equal(verifyStep!.inputSnapshot.stepType, 'VERIFY');
  assert.equal(verifyStep!.inputSnapshot.operation, 'verify');
  assert.equal(verifyStep!.inputSnapshot.executorType, 'CONTROL_PLANE_TLS');
  assert.equal(verifyStep!.inputSnapshot.type, 'linux.nginx.deploy_certificate');
  assert.equal(verifyStep!.inputSnapshot.verifyUrl, 'https://app-nginx.example.net:9443');
  assert.deepEqual(verifyStep!.inputSnapshot.expectedDomains, ['app-nginx.example.net']);
});

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
        supportedActions: ['health', 'discovery.run', 'linux.nginx.deploy_certificate'],
      },
    },
  });
  assert.equal(registered.statusCode, 201, JSON.stringify(registered.body));
  const agentId = (registered.body as { id: string }).id;

  const host = await app.inject({
    method: 'POST',
    path: '/api/v1/hosts',
    headers,
    body: { hostname: 'nginx-asset-host.example.com', primaryIp: '10.10.60.10', osType: 'LINUX', agentId, compatibilityLevel: 'L1', managementMode: 'AGENT' },
  });
  assert.equal(host.statusCode, 201, JSON.stringify(host.body));
  const hostId = (host.body as { id: string }).id;

  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/service-instances',
    headers,
    body: { hostId, providerType: 'NGINX', serviceName: 'nginx', displayName: 'nginx', configPath: '/etc/nginx/nginx.conf' },
  });
  assert.equal(service.statusCode, 201, JSON.stringify(service.body));
  const serviceInstanceId = (service.body as { id: string }).id;

  const site = await app.inject({
    method: 'POST',
    path: '/api/v1/site-assets',
    headers,
    body: {
      serviceInstanceId,
      hostId,
      agentId,
      providerType: 'NGINX',
      siteType: 'WEB_SITE',
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
      agentId,
      hostId,
      serviceInstanceId,
      siteAssetId,
      providerType: 'NGINX',
      frameworkType: 'NGINX',
      targetType: 'FILE_DEPLOY',
      targetKey: 'nginx:file:/etc/nginx/certs/nginx-asset.pem',
      bindingKey: 'nginx:nginx-asset.example.com:443:https',
      capabilityProfile: { providerType: 'NGINX', certPath: '/etc/nginx/certs/nginx-asset.pem', keyPath: '/etc/nginx/certs/nginx-asset.key' },
    },
  });
  assert.equal(target.statusCode, 201, JSON.stringify(target.body));
  const managedTargetId = (target.body as { id: string }).id;

  const discoveredBinding = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-bindings',
    headers,
    body: {
      serviceInstanceId,
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
      metadata: {
        sourceFile: '/etc/nginx/sites-enabled/nginx-legacy.conf',
        serverNames: ['nginx-legacy.example.com'],
        testCommand: 'nginx -t',
      },
    },
  });
  assert.equal(discoveredBinding.statusCode, 201, JSON.stringify(discoveredBinding.body));

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
      targetBinding: {
        agentId,
        siteAssetId,
        managedTargetId,
        providerType: 'NGINX',
        frameworkType: 'NGINX',
        targetType: 'FILE_DEPLOY',
        targetKey: managedTargetId,
        bindingKey: 'nginx:nginx-asset.example.com:443:https',
        status: 'ACTIVE',
        metadata: { source: 'manual' },
      },
    },
  });
  assert.equal(applicationAsset.statusCode, 201, JSON.stringify(applicationAsset.body));
  const applicationAssetId = (applicationAsset.body as { id: string }).id;

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
  const discoverStep = dryRunBody.steps.find((step) => step.stepType === 'DISCOVER');
  assert.ok(discoverStep);
  assert.equal(discoverStep!.inputSnapshot.deploymentArtifact.certificateFormatId, certificateFormatId);
  assert.equal(discoverStep!.inputSnapshot.deploymentArtifact.format, 'pem');
  assert.equal(discoverStep!.inputSnapshot.deploymentArtifact.containsPrivateKey, false);
  assert.equal(typeof discoverStep!.inputSnapshot.artifact.privateKeyPem, 'string');
  assert.equal(discoverStep!.inputSnapshot.type, 'linux.nginx.deploy_certificate');
  assert.equal(discoverStep!.inputSnapshot.bindingSelector.certPath, '/etc/nginx/certs/nginx-asset.pem');
  assert.equal(discoverStep!.inputSnapshot.bindingSelector.keyPath, '/etc/nginx/certs/nginx-asset.key');
  assert.equal(discoverStep!.inputSnapshot.executionPolicy.reloadCommand, 'systemctl reload nginx');
});

test('NGINX 历史坏绑定缺少 certPath/keyPath 时，dry-run 会从发现快照回填 payload', async () => {
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
        supportedActions: ['health', 'discovery.run', 'linux.nginx.deploy_certificate'],
      },
    },
  });
  assert.equal(registered.statusCode, 201, JSON.stringify(registered.body));
  const agentId = (registered.body as { id: string }).id;

  const host = await app.inject({
    method: 'POST',
    path: '/api/v1/hosts',
    headers,
    body: { hostname: 'nginx-legacy-host.example.com', primaryIp: '10.10.70.10', osType: 'LINUX', agentId, compatibilityLevel: 'L1', managementMode: 'AGENT' },
  });
  assert.equal(host.statusCode, 201, JSON.stringify(host.body));
  const hostId = (host.body as { id: string }).id;

  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/service-instances',
    headers,
    body: { hostId, providerType: 'NGINX', serviceName: 'nginx', displayName: 'nginx', configPath: '/etc/nginx/nginx.conf' },
  });
  assert.equal(service.statusCode, 201, JSON.stringify(service.body));
  const serviceInstanceId = (service.body as { id: string }).id;

  const site = await app.inject({
    method: 'POST',
    path: '/api/v1/site-assets',
    headers,
    body: {
      serviceInstanceId,
      hostId,
      agentId,
      providerType: 'NGINX',
      siteType: 'WEB_SITE',
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
      agentId,
      hostId,
      serviceInstanceId,
      siteAssetId,
      providerType: 'NGINX',
      frameworkType: 'NGINX',
      targetType: 'FILE_DEPLOY',
      targetKey: 'nginx:file:/etc/nginx/certs/nginx-legacy.pem',
      bindingKey: 'nginx:nginx-legacy.example.com:443:https',
      capabilityProfile: { providerType: 'NGINX' },
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
      displayName: 'Legacy NGINX App',
      targetBinding: {
        agentId,
        siteAssetId,
        managedTargetId,
        providerType: 'NGINX',
        frameworkType: 'NGINX',
        targetType: 'FILE_DEPLOY',
        targetKey: managedTargetId,
        bindingKey: 'nginx:nginx-legacy.example.com:443:https',
        status: 'ACTIVE',
        metadata: { source: 'legacy-bad-binding' },
      },
    },
  });
  assert.equal(applicationAsset.statusCode, 201, JSON.stringify(applicationAsset.body));
  const applicationAssetId = (applicationAsset.body as { id: string }).id;

  const assetDetail = await app.inject({
    method: 'GET',
    path: `/api/v1/service-assets/detail?serviceAssetId=${applicationAssetId}`,
    headers,
  });
  assert.equal(assetDetail.statusCode, 200, JSON.stringify(assetDetail.body));
  const selectedBinding = ((assetDetail.body as {
    targetBindingDetail?: {
      certificateBindings?: Array<{ id: string; serviceAssetId?: string; certPath?: string; keyPath?: string }>
    }
  }).targetBindingDetail?.certificateBindings ?? [])[0];
  assert.ok(selectedBinding);
  await db.query(
    'update pg_certificate_bindings set cert_path = null, key_path = null, reload_command = null, updated_at = $2::timestamptz, version = version + 1 where id = $1',
    [selectedBinding!.id, new Date().toISOString()],
  );

  const snapshot = await app.inject({
    method: 'POST',
    path: '/api/v1/discovery-snapshots',
    headers,
    body: {
      normalizedHash: 'nginx-legacy-snapshot-001',
      source: 'AGENT',
      normalizedPayload: {
        bindings: [{
          serviceRef: serviceInstanceId,
          domainName: 'nginx-legacy.example.com',
          port: 443,
          protocol: 'HTTPS',
          bindingKey: 'nginx:nginx-legacy.example.com:443:https',
          bindingType: 'FILE_PATH',
          certPath: '/etc/nginx/certs/nginx-legacy.pem',
          keyPath: '/etc/nginx/certs/nginx-legacy.key',
          verifyMethod: 'TLS_CONNECT',
          metadata: {
            sourceFile: '/etc/nginx/sites-enabled/nginx-legacy.conf',
            serverNames: ['nginx-legacy.example.com'],
            testCommand: 'nginx -t',
            reloadCommand: 'systemctl reload nginx',
          },
        }],
      },
    },
  });
  assert.equal(snapshot.statusCode, 201, JSON.stringify(snapshot.body));

  const detailAfterDowngrade = await app.inject({
    method: 'GET',
    path: `/api/v1/service-assets/detail?serviceAssetId=${applicationAssetId}`,
    headers,
  });
  assert.equal(detailAfterDowngrade.statusCode, 200, JSON.stringify(detailAfterDowngrade.body));
  const legacyBinding = ((detailAfterDowngrade.body as {
    targetBindingDetail?: {
      certificateBindings?: Array<{ id: string; certPath?: string; keyPath?: string }>
    }
  }).targetBindingDetail?.certificateBindings ?? []).find((item) => item.id === selectedBinding!.id);
  assert.ok(legacyBinding);
  assert.equal(legacyBinding?.certPath, undefined);
  assert.equal(legacyBinding?.keyPath, undefined);

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
  const discoverStep = dryRunBody.steps.find((step) => step.stepType === 'DISCOVER');
  assert.ok(discoverStep);
  assert.equal(discoverStep!.inputSnapshot.providerType, 'NGINX');
  assert.equal(discoverStep!.inputSnapshot.bindingSelector.certPath, '/etc/nginx/certs/nginx-legacy.pem');
  assert.equal(discoverStep!.inputSnapshot.bindingSelector.keyPath, '/etc/nginx/certs/nginx-legacy.key');
  assert.equal(discoverStep!.inputSnapshot.executionPolicy.reloadCommand, 'systemctl reload nginx');
});

test('NGINX 历史坏绑定会从 agent capability snapshot 回填并修正 FILE_PATH 模型', async () => {
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
  const chain = createPemChainFixture('test.local');

  const registered = await app.inject({
    method: 'POST',
    path: '/api/v1/agents/register',
    headers,
    body: {
      agentKey: 'nginx-agent-capability-01',
      hostname: 'nginx-capability-host.example.com',
      version: '1.0.0',
      osType: 'linux',
      directControl: {
        enabled: true,
        reachable: true,
        listenAddress: '127.0.0.1:19084',
        protocolVersion: 'v1',
        supportedActions: ['health', 'discovery.run', 'linux.nginx.deploy_certificate'],
      },
    },
  });
  assert.equal(registered.statusCode, 201, JSON.stringify(registered.body));
  const agentId = (registered.body as { id: string }).id;

  const capabilityReport = await app.inject({
    method: 'POST',
    path: '/api/v1/agents/capabilities',
    headers,
    body: {
      agentId,
      compatibilityLevel: 'L1',
      capabilities: [{
        capabilityKey: 'linux.nginx.detail',
        confidence: 1,
        value: {
          installed: true,
          running: true,
          configPath: '/etc/nginx/nginx.conf',
          serviceName: 'nginx',
          sites: [{
            name: 'test.local',
            serverNames: ['test.local', 'www.test.local'],
            configFiles: ['/etc/nginx/sites-enabled/gcac-test.conf'],
            listen: [{
              address: '*',
              port: 443,
              protocol: 'https',
              certificatePath: '/etc/gcac-test/certs/test.crt',
              certificateKeyPath: '/etc/gcac-test/certs/test.key',
              testCommand: '/usr/sbin/nginx -t',
              reloadCommand: 'systemctl reload nginx',
              permission: {
                recommendedHelperCommand: '/usr/local/libexec/gcac-nginx-helper',
              },
            }],
          }],
        },
      }],
    },
  });
  assert.equal(capabilityReport.statusCode, 201, JSON.stringify(capabilityReport.body));

  const host = await app.inject({
    method: 'POST',
    path: '/api/v1/hosts',
    headers,
    body: { hostname: 'nginx-capability-host.example.com', primaryIp: '10.10.80.10', osType: 'LINUX', agentId, compatibilityLevel: 'L1', managementMode: 'AGENT' },
  });
  assert.equal(host.statusCode, 201, JSON.stringify(host.body));
  const hostId = (host.body as { id: string }).id;

  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/service-instances',
    headers,
    body: { hostId, providerType: 'NGINX', serviceName: 'nginx', displayName: 'nginx', configPath: '/etc/nginx/nginx.conf' },
  });
  assert.equal(service.statusCode, 201, JSON.stringify(service.body));
  const serviceInstanceId = (service.body as { id: string }).id;

  const site = await app.inject({
    method: 'POST',
    path: '/api/v1/site-assets',
    headers,
    body: {
      serviceInstanceId,
      hostId,
      agentId,
      providerType: 'NGINX',
      siteType: 'WEB_SITE',
      siteName: 'test.local',
      siteKey: 'nginx:test.local:443:https',
      bindingInformation: '*:443:test.local',
      hostHeader: 'test.local',
      listenIp: '*',
      port: 443,
      protocol: 'HTTPS',
      configPath: '/var/www/nginx-test',
      metadata: {
        source: 'agent_capability_fallback',
        providerType: 'NGINX',
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
      agentId,
      hostId,
      serviceInstanceId,
      siteAssetId,
      providerType: 'NGINX',
      frameworkType: 'NGINX',
      targetType: 'SITE_BINDING',
      targetKey: 'nginx:site-binding:test.local',
      bindingKey: '*:443:test.local',
      capabilityProfile: {
        providerType: 'NGINX',
        bindingInformation: '*:443:test.local',
        hostHeader: 'test.local',
        source: 'agent_capability_fallback',
      },
    },
  });
  assert.equal(target.statusCode, 201, JSON.stringify(target.body));
  const managedTargetId = (target.body as { id: string }).id;

  const badBinding = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-bindings',
    headers,
    body: {
      serviceInstanceId,
      siteAssetId,
      managedTargetId,
      domainName: 'test.local',
      port: 443,
      protocol: 'HTTPS',
      bindingKey: '*:443:test.local',
      bindingType: 'WINDOWS_CERT_STORE',
      storeLocation: 'LocalMachine',
      storeName: 'My',
      verifyMethod: 'STORE_QUERY',
      status: 'MANAGED',
      metadata: {
        source: 'legacy-bad-binding',
      },
    },
  });
  assert.equal(badBinding.statusCode, 201, JSON.stringify(badBinding.body));
  const bindingId = (badBinding.body as { id: string }).id;

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
    path: '/api/v1/deployment-plans',
    headers,
    body: {
      name: 'NGINX capability snapshot repair',
      certificateVersionId,
      certificateFormatId,
      idempotencyKey: 'idem_nginx_agent_snapshot_plan',
      policy: { riskLevel: 'low', approvalRequired: false, failurePolicy: 'rollback' },
      targets: [{ certificateBindingId: bindingId, managedTargetId, executorType: 'AGENT' }],
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
    body: { planId: plan.id, idempotencyKey: 'idem_nginx_agent_snapshot_dry_run' },
  });
  assert.equal(dryRun.statusCode, 200, JSON.stringify(dryRun.body));
  const dryRunBody = dryRun.body as { steps: Array<{ stepType: string; inputSnapshot: any }> };
  const discoverStep = dryRunBody.steps.find((step) => step.stepType === 'DISCOVER');
  assert.ok(discoverStep);
  assert.equal(discoverStep!.inputSnapshot.providerType, 'NGINX');
  assert.equal(discoverStep!.inputSnapshot.bindingSelector.certPath, '/etc/gcac-test/certs/test.crt');
  assert.equal(discoverStep!.inputSnapshot.bindingSelector.keyPath, '/etc/gcac-test/certs/test.key');
  assert.equal(discoverStep!.inputSnapshot.bindingSelector.sourceFile, '/etc/nginx/sites-enabled/gcac-test.conf');
  assert.deepEqual(discoverStep!.inputSnapshot.bindingSelector.serverNames, ['test.local', 'www.test.local']);
  assert.equal(discoverStep!.inputSnapshot.executionPolicy.testCommand, '/usr/sbin/nginx -t');
  assert.equal(discoverStep!.inputSnapshot.executionPolicy.reloadCommand, 'systemctl reload nginx');
  assert.equal(discoverStep!.inputSnapshot.executionPolicy.helperCommand, '/usr/local/libexec/gcac-nginx-helper');

  const patched = (await db.query<{
    binding_type: string;
    verify_method: string;
    cert_path: string | null;
    key_path: string | null;
    local_config_path: string | null;
  }>(
    'select binding_type, verify_method, cert_path, key_path, local_config_path from pg_certificate_bindings where id = $1',
    [bindingId],
  )).rows[0];
  assert.ok(patched);
  assert.equal(patched?.binding_type, 'FILE_PATH');
  assert.equal(patched?.verify_method, 'TLS_CONNECT');
  assert.equal(patched?.cert_path, '/etc/gcac-test/certs/test.crt');
  assert.equal(patched?.key_path, '/etc/gcac-test/certs/test.key');
  assert.equal(patched?.local_config_path, '/etc/nginx/sites-enabled/gcac-test.conf');
});

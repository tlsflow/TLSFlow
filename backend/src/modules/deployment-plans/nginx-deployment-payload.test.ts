import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../../app.module.js';
import { configureTestAuth, testAuthHeaders } from '../../common/http/test-auth.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import type { UnifiedPluginsApplicationService } from '../plugins/application/unified-plugins.application-service.js';
import type { PluginWorkflowPublisherService } from '../plugins/application/plugin-workflow-publisher.service.js';
import { createSecurityServices } from '../security/security.controller.js';
import { DeploymentInputSnapshotsRepository } from '../deployment-inputs/repository/deployment-input-snapshots.repository.js';

const headers = testAuthHeaders('user_1', 'tenant_1', { 'x-request-id': 'req_nginx_payload' });
let nginxFixtureSequence = 0;

test('NGINX deployment plan 会通过统一插件能力生成 Workflow 请求', async () => {
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
      'device_asset.manage',
      'plugin.read',
      'plugin.manage',
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
      'device_asset',
      'plugin',
      'deploymentPlan',
    ],
    scope: { tenantId: 'tenant_1' },
  });

  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = configureTestAuth(createApp({ db, corePersistence: { mode: 'memory' }, security }));
  const chain = createPemChainFixture('nginx-site.example.com');

  const controlPlane = await createNginxControlPlaneFixture(app, security);
  const { hostId, discoveryProviderKey } = controlPlane;

  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/framework-instances',
    headers,
    body: { deviceId: hostId, frameworkType: 'web.nginx', frameworkKey: 'nginx', displayName: 'nginx', rawFacts: { configPath: '/etc/nginx/nginx.conf' }, discoveryProviderKey },
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
      address: 'nginx-site.example.com',
      addressType: 'DNS',
      port: 9443,
      protocol: 'HTTPS',
      sniName: 'nginx-site.example.com',
      verifyUrl: 'https://nginx-site.example.com:9443',
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
      discoveryProviderKey,
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
      discoveryProviderKey,
      targetType: 'tls.file',
      targetKey: 'nginx:file:/etc/nginx/certs/nginx-site.pem',
      bindingKey: 'nginx:nginx-site.example.com:443:https',
      supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'],
      executionLocations: ['CONTROL_PLANE'],
      metadata: { certPath: '/etc/nginx/certs/nginx-site.pem', keyPath: '/etc/nginx/certs/nginx-site.key' },
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

  await configureApplicationAssetManagedTarget(app, security, serviceAssetId, managedTargetId, certificateFormatId, {
    certificatePath: '/etc/nginx/certs/nginx-site.pem',
    privateKeyPath: '/etc/nginx/certs/nginx-site.key',
    nginxProgram: '/usr/sbin/nginx',
    serviceName: 'nginx',
  });

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
  const dryRunBody = dryRun.body as { run: { id: string }; steps: Array<{ stepType: string; inputSnapshot: any }> };
  const workflowStep = findWorkflowStep(dryRunBody.steps);
  assert.equal(workflowStep.inputSnapshot.executorType, 'WORKFLOW');
  assert.equal(workflowStep.inputSnapshot.pluginRuntimeCapability.runtime, 'WORKFLOW_DSL');
  assert.equal(workflowStep.inputSnapshot.pluginRuntimeCapability.executionLocation, 'CONTROL_PLANE');
  assert.equal(workflowStep.inputSnapshot.pluginRuntimeCapability.capabilityKey, 'certificate.deploy');
  assert.equal(workflowStep.inputSnapshot.applicationAssetId, serviceAssetId);
  assert.equal(workflowStep.inputSnapshot.managedTargetId, managedTargetId);
  assert.equal(workflowStep.inputSnapshot.workflowRequest.runner, 'CONTROL_PLANE');
  assert.equal(workflowStep.inputSnapshot.workflowRequest.workflowVersionSelection, 'PINNED');
  assert.equal(workflowStep.inputSnapshot.workflowRequest.capabilityKey, 'certificate.deploy');
  assert.equal(workflowStep.inputSnapshot.resolvedDeploymentInput, undefined);
  assert.equal(workflowStep.inputSnapshot.deploymentInputSnapshotRef?.apiVersion, 'gcac.deployment-input-snapshot/v1');
  const runtimeSnapshot = await new DeploymentInputSnapshotsRepository(db).getRuntimeSnapshot(
    'tenant_1',
    String(workflowStep.inputSnapshot.deploymentInputSnapshotRef?.snapshotId),
  );
  assert.equal(runtimeSnapshot?.contract.apiVersion, 'gcac.deployment-input/v1');
  assert.equal(runtimeSnapshot?.resolvedDeploymentInput.variables.certificatePath, '/etc/nginx/certs/nginx-site.pem');
  assert.equal(runtimeSnapshot?.resolvedDeploymentInput.variables.privateKeyPath, '/etc/nginx/certs/nginx-site.key');
  assert.equal(runtimeSnapshot?.resolvedDeploymentInput.variables.nginxProgram, '/usr/sbin/nginx');
  assert.equal(runtimeSnapshot?.resolvedDeploymentInput.variables.serviceName, 'nginx');
});

async function createNginxControlPlaneFixture(
  app: ReturnType<typeof createApp>,
  security: ReturnType<typeof createSecurityServices>,
): Promise<{ hostId: string; discoveryProviderKey: string }> {
  await grantNginxDeviceAssetCreateAccess(security);
  const created = await app.inject({
    method: 'POST',
    path: '/api/v1/device-assets',
    headers,
    body: {
      displayName: 'NGINX Control Plane Fixture',
      managementAddress: 'nginx-control.example.com',
      deviceFamily: 'fixture.nginx',
      credentialId: 'fixture-nginx-credential',
      authMode: 'AUTO',
      tlsVerify: true,
    },
  });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const device = created.body as { id: string; hostId: string };
  return { hostId: device.hostId, discoveryProviderKey: `device:${device.id}` };
}

async function grantNginxDeviceAssetCreateAccess(security: ReturnType<typeof createSecurityServices>): Promise<void> {
  const roleId = 'role_nginx_device_asset_create';
  const objectSetId = 'oset_nginx_device_asset_create';
  await security.rbac.createRole({ id: roleId, code: roleId, name: 'NGINX device asset create test access', builtin: false });
  const objectSet = await security.objectPermissions.createObjectSet({
    id: objectSetId,
    tenantId: 'tenant_1',
    name: 'NGINX device asset create test access',
    kind: 'dynamic',
    objectTypes: ['device_asset'],
    conditions: { tenantId: 'tenant_1' },
    status: 'active',
  });
  await security.objectPermissions.createRoleBinding({
    tenantId: 'tenant_1',
    principalType: 'user',
    principalId: 'user_1',
    roleId,
    objectSetId: objectSet.id,
    effect: 'allow',
    enabled: true,
  });
  await security.objectPermissions.createAccessGrant({ tenantId: 'tenant_1', roleId, objectSetId: objectSet.id, accessLevel: 'edit', effect: 'allow' });
}

function findWorkflowStep(steps: Array<{ stepType: string; inputSnapshot: any }>) {
  const step = steps.find((item) => item.inputSnapshot.executorType === 'WORKFLOW');
  assert.ok(step, JSON.stringify(steps));
  return step!;
}

async function configureApplicationAssetManagedTarget(
  app: ReturnType<typeof createApp>,
  security: ReturnType<typeof createSecurityServices>,
  applicationAssetId: string,
  managedTargetId: string,
  certificateFormatId: string,
  variableBindings: Record<string, unknown>,
): Promise<void> {
  const unifiedPlugins = app.getResource('unifiedPluginsService') as UnifiedPluginsApplicationService | undefined;
  const workflowPublisher = app.getResource('pluginWorkflowPublisher') as PluginWorkflowPublisherService | undefined;
  assert.ok(unifiedPlugins);
  assert.ok(workflowPublisher);
  const nginxPlugin = await createNginxTestPlugin(unifiedPlugins, workflowPublisher);
  const accessiblePlugins = await unifiedPlugins.listAccessibleVersions('tenant_1');
  await grantNginxTestObjectAccess(security, applicationAssetId, managedTargetId, accessiblePlugins.map((plugin) => plugin.id));

  const compatible = await app.inject({
    method: 'GET',
    path: `/api/v1/managed-targets/${managedTargetId}/compatible-plugins?capabilityKey=certificate.deploy&applicationAssetId=${applicationAssetId}`,
    headers,
  });
  assert.equal(compatible.statusCode, 200, JSON.stringify(compatible.body));
  const plugin = (compatible.body as { items: Array<{ pluginVersionId: string; compatible: boolean }> }).items
    .find((item) => item.pluginVersionId === nginxPlugin.id && item.compatible);
  assert.ok(plugin, JSON.stringify(compatible.body));

  const saved = await app.inject({
    method: 'PUT',
    path: `/api/v1/application-assets/${applicationAssetId}/managed-target`,
    headers,
    body: {
      managedTargetId,
      capabilityKey: 'certificate.deploy',
      pluginOverride: {
        pluginVersionId: plugin.pluginVersionId,
        inputBindings: {
          apiVersion: 'gcac.input-bindings/v1',
          variables: variableBindings,
          connections: {},
          credentials: {},
          artifacts: {
            certificate: { certificateFormatId, outputBindings: { leafPem: 'leafPem', privateKeyPem: 'privateKeyPem' } },
          },
        },
      },
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
        managedTarget: { managedTargetId },
      },
    },
  });
  assert.equal(strategy.statusCode, 200, JSON.stringify(strategy.body));
}

async function createNginxTestPlugin(
  unifiedPlugins: UnifiedPluginsApplicationService,
  workflowPublisher: PluginWorkflowPublisherService,
) {
  const workflowPath = 'workflows/certificate-deploy.json';
  const imported = await unifiedPlugins.importVersion('tenant_1', {
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId: 'fixture.nginx.certificate',
      version: '1.0.0',
      displayNameKey: 'plugin.fixture.nginx.name',
      descriptionKey: 'plugin.fixture.nginx.description',
      defaultLocale: 'zh-CN',
      publisher: 'GCAC test',
      runtime: 'WORKFLOW_DSL',
      source: 'USER',
      scope: 'MANAGED',
      trust: 'UNSIGNED',
      support: 'SELF_MANAGED',
      capabilities: [{
        key: 'certificate.deploy',
        contractVersion: 'v1',
        actionContractId: 'certificate.deploy.v1',
        riskLevel: 'HIGH',
        executionLocations: ['CONTROL_PLANE'],
      }],
      permissions: [],
      compatibility: {
        frameworkTypes: ['web.nginx'],
        targetTypes: ['tls.file'],
        managementMethods: ['PLUGIN'],
        executionLocations: ['CONTROL_PLANE'],
        artifactContracts: ['certificate.deploy.v1'],
      },
      resources: {
        workflows: { 'certificate.deploy': workflowPath },
        locales: { 'zh-CN': 'locales/zh-CN.json' },
      },
    },
    resources: {
      [workflowPath]: JSON.stringify({
        apiVersion: 'gcac.workflow/v1',
        kind: 'CurlSshWorkflow',
        metadata: { name: 'fixture-nginx-certificate-deploy', version: '1.0.0' },
        inputContract: {
          apiVersion: 'gcac.deployment-input/v1',
          variables: {
            certificatePath: requiredNginxVariable(),
            privateKeyPath: requiredNginxVariable(),
            nginxProgram: requiredNginxVariable(),
            serviceName: requiredNginxVariable(),
          },
          connections: {},
          credentials: {},
          artifacts: {
            certificate: {
              kind: 'certificate',
              required: true,
              configurationMode: 'required',
              lifecycle: 'pre_execution',
              artifactContract: {
                outputs: {
                  leafPem: { role: 'public_certificate', required: true },
                  privateKeyPem: { role: 'private_key', required: true, sensitive: true },
                },
              },
            },
          },
        },
        steps: [{
          name: 'record-nginx-deployment',
          type: 'transform',
          stage: 'install',
          transform: { engine: 'jsonata', input: {}, outputs: { result: { expression: '{}' } } },
        }],
      }),
      'locales/zh-CN.json': JSON.stringify({
        'plugin.fixture.nginx.name': 'NGINX 测试插件',
        'plugin.fixture.nginx.description': 'NGINX 部署载荷测试插件',
      }),
    },
  });
  const enabled = await unifiedPlugins.enableVersion(imported.id);
  await workflowPublisher.publishPlugin(enabled);
  return enabled;
}

function requiredNginxVariable() {
  return {
    type: 'string',
    required: true,
    configurationMode: 'required',
    source: { kind: 'binding' },
    lifecycle: 'pre_execution',
    bindingPolicy: 'required_binding',
  } as const;
}

async function grantNginxTestObjectAccess(
  security: ReturnType<typeof createSecurityServices>,
  applicationAssetId: string,
  managedTargetId: string,
  pluginVersionIds: string[],
): Promise<void> {
  const fixtureSuffix = `${nginxFixtureSequence += 1}_${pluginVersionIds.at(-1) ?? managedTargetId}`;
  const roleId = `role_nginx_payload_${managedTargetId}_${fixtureSuffix}`;
  const objectSetId = `oset_nginx_payload_${managedTargetId}_${fixtureSuffix}`;
  await security.rbac.createRole({ id: roleId, code: roleId, name: 'NGINX deployment payload test objects', builtin: false });
  const objectSet = await security.objectPermissions.createObjectSet({
    id: objectSetId,
    tenantId: '*',
    name: 'NGINX deployment payload test objects',
    kind: 'static',
    objectTypes: ['application_asset', 'managed_target', 'plugin_version'],
    status: 'active',
  });
  const members = [
    { objectType: 'application_asset', objectId: applicationAssetId, tenantId: 'tenant_1' },
    { objectType: 'managed_target', objectId: managedTargetId, tenantId: 'tenant_1' },
    ...pluginVersionIds.map((objectId) => ({ objectType: 'plugin_version', objectId, tenantId: 'tenant_1' })),
  ];
  for (const member of members) {
    await security.objectPermissions.addObjectSetMember({ ...member, objectSetId: objectSet.id, addedBy: 'user_1' });
  }
  await security.objectPermissions.createRoleBinding({
    tenantId: '*',
    principalType: 'user',
    principalId: 'user_1',
    roleId,
    objectSetId: objectSet.id,
    effect: 'allow',
    enabled: true,
  });
  await security.objectPermissions.createAccessGrant({ tenantId: '*', roleId, objectSetId: objectSet.id, accessLevel: 'control', effect: 'allow' });
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

async function waitForDeploymentPlanAudits(
  security: ReturnType<typeof createSecurityServices>,
  planId: string,
  expectedCount: number,
): Promise<Array<{ action: string; detail?: unknown }>> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const audits = await security.audit.query({ resourceType: 'deploymentPlan', resourceId: planId });
    if (audits.length >= expectedCount) return audits;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return security.audit.query({ resourceType: 'deploymentPlan', resourceId: planId });
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
      'device_asset.manage',
      'plugin.read',
      'plugin.manage',
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
      'device_asset',
      'plugin',
      'deploymentPlan',
    ],
    scope: { tenantId: 'tenant_1' },
  });

  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = configureTestAuth(createApp({ db, corePersistence: { mode: 'memory' }, security }));
  const chain = createPemChainFixture('nginx-asset.example.com');

  const controlPlane = await createNginxControlPlaneFixture(app, security);
  const { hostId, discoveryProviderKey } = controlPlane;

  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/framework-instances',
    headers,
    body: { deviceId: hostId, frameworkType: 'web.nginx', frameworkKey: 'nginx', displayName: 'nginx', rawFacts: { configPath: '/etc/nginx/nginx.conf' }, discoveryProviderKey },
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
      discoveryProviderKey,
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
      discoveryProviderKey,
      targetType: 'tls.file',
      targetKey: 'nginx:file:/etc/nginx/certs/nginx-asset.pem',
      bindingKey: 'nginx:nginx-asset.example.com:443:https',
      supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'],
      executionLocations: ['CONTROL_PLANE'],
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
      serviceInstanceId,
      displayName: 'NGINX Asset',
    },
  });
  assert.equal(applicationAsset.statusCode, 201, JSON.stringify(applicationAsset.body));
  const applicationAssetId = (applicationAsset.body as { id: string }).id;

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

  await configureApplicationAssetManagedTarget(app, security, applicationAssetId, managedTargetId, certificateFormatId, {
    certificatePath: '/etc/nginx/certs/nginx-asset.pem',
    privateKeyPath: '/etc/nginx/certs/nginx-asset.key',
    nginxProgram: '/usr/sbin/nginx',
    serviceName: 'nginx',
  });

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
  const plan = created.body as {
    id: string;
    certificateVersionId: string;
    certificateFormatId?: string;
    targets: Array<{ strategyPayload?: Record<string, any> }>;
  };
  assert.equal(plan.certificateVersionId, certificateVersionId);
  assert.equal(plan.certificateFormatId, certificateFormatId);
  const preflight = plan.targets[0]?.strategyPayload?.deploymentInputPreflight;
  assert.equal(preflight?.apiVersion, 'gcac.resolved-deployment-input/v1');
  assert.match(String(preflight?.resolvedSha256), /^[a-f0-9]{64}$/);
  assert.equal(plan.targets[0]?.strategyPayload?.resolvedDeploymentInput, undefined);
  const snapshotRef = plan.targets[0]?.strategyPayload?.deploymentInputSnapshotRef;
  assert.equal(snapshotRef?.apiVersion, 'gcac.deployment-input-snapshot/v1');
  assert.equal(snapshotRef?.revision, 1);
  assert.equal(snapshotRef?.resolvedSha256, preflight.resolvedSha256);

  const snapshotsResponse = await app.inject({
    method: 'GET',
    path: `/api/v1/deployment-plans/input-snapshots?planId=${plan.id}`,
    headers,
  });
  assert.equal(snapshotsResponse.statusCode, 200, JSON.stringify(snapshotsResponse.body));
  const snapshots = snapshotsResponse.body as { items: Array<any>; total: number };
  assert.equal(snapshots.total, 1);
  assert.equal(snapshots.items[0]?.id, snapshotRef?.snapshotId);
  assert.equal(snapshots.items[0]?.snapshot.resolvedSha256, preflight.resolvedSha256);
  assert.equal(snapshots.items[0]?.snapshot.identity.pluginVersionId, plan.targets[0]?.strategyPayload?.pluginRuntimeCapability?.pluginVersionId);
  assert.equal(JSON.stringify(snapshots.items).includes(chain.privateKeyPem), false);
  assert.equal(JSON.stringify(snapshots.items).includes('secretRefs'), false);

  const updatedResponse = await app.inject({
    method: 'POST',
    path: '/api/v1/deployment-plans/update-from-application-asset',
    headers,
    body: {
      planId: plan.id,
      applicationAssetId,
      selectionMode: 'EXPLICIT',
      targetCertificateVersionId: certificateVersionId,
      certificateFormatId,
      idempotencyKey: 'idem_nginx_asset_plan_with_format_update',
    },
  });
  assert.equal(updatedResponse.statusCode, 200, JSON.stringify(updatedResponse.body));
  const updatedPlan = updatedResponse.body as typeof plan;
  const latestSnapshotRef = updatedPlan.targets[0]?.strategyPayload?.deploymentInputSnapshotRef;
  assert.equal(latestSnapshotRef?.revision, 2);
  assert.notEqual(latestSnapshotRef?.snapshotId, snapshotRef?.snapshotId);

  const snapshotsAfterUpdateResponse = await app.inject({
    method: 'GET',
    path: `/api/v1/deployment-plans/input-snapshots?planId=${plan.id}`,
    headers,
  });
  assert.equal(snapshotsAfterUpdateResponse.statusCode, 200, JSON.stringify(snapshotsAfterUpdateResponse.body));
  const snapshotsAfterUpdate = snapshotsAfterUpdateResponse.body as { items: Array<any>; total: number };
  assert.equal(snapshotsAfterUpdate.total, 2);
  assert.deepEqual(snapshotsAfterUpdate.items.map((item) => item.revision), [1, 2]);
  assert.equal(snapshotsAfterUpdate.items[0]?.id, snapshotRef?.snapshotId);
  assert.equal(JSON.stringify(snapshotsAfterUpdate.items).includes(chain.privateKeyPem), false);
  const persistedTargets = await db.query<{ payload: unknown }>(
    `select payload from pg_documents
      where namespace='deployment-plans:targets' and payload->>'deploymentPlanId'=$1`,
    [plan.id],
  );
  const persistedTargetJson = JSON.stringify(persistedTargets.rows);
  assert.equal(persistedTargetJson.includes(chain.privateKeyPem), false);
  assert.equal(persistedTargetJson.includes('resolvedDeploymentInput'), false);
  assert.equal(persistedTargetJson.includes('effectiveInputBindings'), false);
  assert.equal(persistedTargetJson.includes('inputBindings'), false);
  const planAudits = await waitForDeploymentPlanAudits(security, plan.id, 2);
  const createAudit = planAudits.find((item) => item.action === 'deployment_plan.create');
  const updateAudit = planAudits.find((item) => item.action === 'deployment_plan.update');
  assert.equal((createAudit?.detail as any)?.deploymentInputSnapshots?.[0]?.snapshotId, snapshotRef?.snapshotId);
  assert.equal((updateAudit?.detail as any)?.deploymentInputSnapshots?.[0]?.snapshotId, latestSnapshotRef?.snapshotId);
  assert.equal(JSON.stringify(planAudits).includes(chain.privateKeyPem), false);

  await configureApplicationAssetManagedTarget(app, security, applicationAssetId, managedTargetId, certificateFormatId, {
    certificatePath: '/etc/nginx/certs/changed-after-plan.pem',
    privateKeyPath: '/etc/nginx/certs/changed-after-plan.key',
    nginxProgram: '/usr/bin/nginx',
    serviceName: 'nginx-changed-after-plan',
  });

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
  const dryRunBody = dryRun.body as { run: { id: string }; steps: Array<{ stepType: string; inputSnapshot: any }> };
  const atomicStep = findWorkflowStep(dryRunBody.steps);
  assert.equal(atomicStep!.inputSnapshot.deploymentArtifact, undefined);
  assert.equal(atomicStep!.inputSnapshot.executorType, 'WORKFLOW');
  assert.equal(atomicStep!.inputSnapshot.pluginRuntimeCapability.runtime, 'WORKFLOW_DSL');
  assert.equal(atomicStep!.inputSnapshot.pluginRuntimeCapability.executionLocation, 'CONTROL_PLANE');
  assert.equal(atomicStep!.inputSnapshot.pluginRuntimeCapability.capabilityKey, 'certificate.deploy');
  assert.equal(atomicStep!.inputSnapshot.resolvedDeploymentInput, undefined);
  assert.deepEqual(atomicStep!.inputSnapshot.deploymentInputSnapshotRef, latestSnapshotRef);
  assert.equal(atomicStep!.inputSnapshot.workflowRequest.runner, 'CONTROL_PLANE');
  assert.equal(atomicStep!.inputSnapshot.workflowRequest.workflowVersionSelection, 'PINNED');
  assert.equal(atomicStep!.inputSnapshot.workflowRequest.capabilityKey, 'certificate.deploy');

  const persistedSteps = await db.query<{ input_snapshot: unknown }>(
    `select input_snapshot from pg_execution_steps where execution_run_id=$1 order by step_no`,
    [dryRunBody.run.id],
  );
  const persistedStepJson = JSON.stringify(persistedSteps.rows);
  assert.equal(persistedStepJson.includes(chain.privateKeyPem), false);
  assert.equal(persistedStepJson.includes('resolvedDeploymentInput'), false, persistedStepJson);
  assert.equal(persistedStepJson.includes('deploymentArtifact'), false, persistedStepJson);
  assert.equal(persistedStepJson.includes('pfxBase64'), false);
  assert.equal(persistedStepJson.includes('privateKeyPem'), false, persistedStepJson);

  const runtimeSnapshot = await new DeploymentInputSnapshotsRepository(db).getRuntimeSnapshot(
    'tenant_1',
    String(latestSnapshotRef?.snapshotId),
  );
  assert.equal(runtimeSnapshot?.deploymentArtifact.certificateFormatId, certificateFormatId);
  assert.equal(runtimeSnapshot?.deploymentArtifact.format, 'pem');
  assert.equal(runtimeSnapshot?.contract.apiVersion, 'gcac.deployment-input/v1');
  assert.equal(runtimeSnapshot?.effectiveBinding.inputBindings.apiVersion, 'gcac.input-bindings/v1');
  assert.equal(runtimeSnapshot?.resolvedDeploymentInput.resolvedSha256, preflight.resolvedSha256);
  assert.equal(runtimeSnapshot?.resolvedDeploymentInput.variables.certificatePath, '/etc/nginx/certs/nginx-asset.pem');
  assert.equal(runtimeSnapshot?.resolvedDeploymentInput.variables.privateKeyPath, '/etc/nginx/certs/nginx-asset.key');
  assert.equal(runtimeSnapshot?.resolvedDeploymentInput.variables.nginxProgram, '/usr/sbin/nginx');
  assert.equal(runtimeSnapshot?.resolvedDeploymentInput.variables.serviceName, 'nginx');
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
      'device_asset.manage',
      'plugin.read',
      'plugin.manage',
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
      'device_asset',
      'plugin',
      'deploymentPlan',
    ],
    scope: { tenantId: 'tenant_1' },
  });

  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = configureTestAuth(createApp({ db, corePersistence: { mode: 'memory' }, security }));
  const chain = createPemChainFixture('nginx-legacy.example.com');

  const controlPlane = await createNginxControlPlaneFixture(app, security);
  const { hostId, discoveryProviderKey } = controlPlane;

  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/framework-instances',
    headers,
    body: { deviceId: hostId, frameworkType: 'web.nginx', frameworkKey: 'nginx', displayName: 'nginx', rawFacts: { configPath: '/etc/nginx/nginx.conf' }, discoveryProviderKey },
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
      discoveryProviderKey,
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
      discoveryProviderKey,
      targetType: 'tls.file',
      targetKey: 'nginx:file:/etc/nginx/certs/nginx-legacy.pem',
      bindingKey: 'nginx:nginx-legacy.example.com:443:https',
      supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'],
      executionLocations: ['CONTROL_PLANE'],
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
      serviceInstanceId,
      displayName: 'NGINX App',
    },
  });
  assert.equal(applicationAsset.statusCode, 201, JSON.stringify(applicationAsset.body));
  const applicationAssetId = (applicationAsset.body as { id: string }).id;

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

  await configureApplicationAssetManagedTarget(app, security, applicationAssetId, managedTargetId, certificateFormatId, {
    certificatePath: '/etc/nginx/certs/nginx-legacy.pem',
    privateKeyPath: '/etc/nginx/certs/nginx-legacy.key',
    nginxProgram: '/usr/sbin/nginx',
    serviceName: 'nginx',
  });

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
  const atomicStep = findWorkflowStep(dryRunBody.steps);
  assert.equal(atomicStep!.inputSnapshot.actionType, undefined);
  assert.equal(atomicStep!.inputSnapshot.executorType, 'WORKFLOW');
  assert.equal(atomicStep!.inputSnapshot.pluginRuntimeCapability.runtime, 'WORKFLOW_DSL');
  assert.equal(atomicStep!.inputSnapshot.pluginRuntimeCapability.executionLocation, 'CONTROL_PLANE');
  assert.equal(atomicStep!.inputSnapshot.pluginRuntimeCapability.capabilityKey, 'certificate.deploy');
  assert.equal(atomicStep!.inputSnapshot.workflowRequest.runner, 'CONTROL_PLANE');
  assert.equal(atomicStep!.inputSnapshot.workflowRequest.workflowVersionSelection, 'PINNED');
  assert.equal(atomicStep!.inputSnapshot.workflowRequest.capabilityKey, 'certificate.deploy');
});

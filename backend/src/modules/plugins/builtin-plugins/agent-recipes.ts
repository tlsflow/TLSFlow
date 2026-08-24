import type { AgentDeploymentPluginManifestV1 } from '../dto/agent-deployment-plugins.dto.js';
import { GCAC_VERSION } from '../../../common/version.js';

const commonCompatibility = {
  architectures: ['amd64', 'arm64'],
  requiredCapabilities: ['agent.atomic_plan.execute'],
  operationSchemaVersions: {
    'file.backup': ['1.0'],
    'file.atomic_replace': ['1.0'],
    'file.restore': ['1.0'],
    'service.control': ['1.0'],
    'tls.verify': ['1.0'],
  },
};

export const builtinAgentPluginManifests: AgentDeploymentPluginManifestV1[] = [
  {
    apiVersion: 'gcac.agent-plugin/v1',
    kind: 'AgentDeploymentPlugin',
    pluginId: 'builtin.linux.nginx.pem',
    name: 'linux-nginx-pem-certificate-deployment',
    publisher: 'GCAC',
    version: '1.0.0',
    minGcacVersion: GCAC_VERSION,
    metadata: { displayName: 'NGINX PEM 证书部署', description: '备份并原子替换 NGINX PEM 证书和私钥，执行配置检查、reload 和 TLS 验证。', category: 'web-server', tags: ['nginx', 'pem', 'linux'] },
    compatibility: {
      ...commonCompatibility,
      platforms: ['LINUX'],
      frameworks: ['NGINX'],
      operationSchemaVersions: {
        ...commonCompatibility.operationSchemaVersions,
        'preflight.assert': ['1.0'],
        'command.execute': ['1.0'],
      },
    },
    variables: {
      certificatePath: { type: 'file', required: true, default: '/etc/nginx/tls/server.crt' },
      privateKeyPath: { type: 'file', required: true, default: '/etc/nginx/tls/server.key' },
      nginxProgram: { type: 'enum', required: true, default: '/usr/sbin/nginx', enum: ['/usr/sbin/nginx', '/usr/bin/nginx'] },
      serviceName: { type: 'string', required: true, default: 'nginx' },
      verifyHost: { type: 'string', required: true },
      verifyPort: { type: 'number', required: true, default: 443, minimum: 1, maximum: 65535 },
    },
    artifactInputs: {
      certificate: { type: 'certificate', required: true },
      privateKey: { type: 'private_key', required: true },
    },
    permissions: [
      { name: 'nginx-files', risk: 'high', scope: 'filesystem', values: ['/etc/nginx/*'] },
      { name: 'nginx-process', risk: 'medium', scope: 'process', values: ['/usr/sbin/nginx', '/usr/bin/nginx'] },
      { name: 'nginx-service', risk: 'high', scope: 'service', values: ['*'] },
      { name: 'nginx-tls', risk: 'low', scope: 'network', values: ['*'] },
    ],
    operations: nginxOperations(),
    rollback: nginxRollback(),
  },
  {
    apiVersion: 'gcac.agent-plugin/v1',
    kind: 'AgentDeploymentPlugin',
    pluginId: 'builtin.windows.iis.pfx',
    name: 'windows-iis-pfx-certificate-deployment',
    publisher: 'GCAC',
    version: '1.0.0',
    minGcacVersion: GCAC_VERSION,
    metadata: { displayName: 'IIS PFX 证书部署', description: '检查并导入 PFX、授权应用池私钥、更新 IIS HTTPS Binding 并验证 TLS。', category: 'web-server', tags: ['iis', 'pfx', 'windows'] },
    compatibility: {
      architectures: ['amd64', 'arm64'],
      requiredCapabilities: ['agent.atomic_plan.execute'],
      platforms: ['WINDOWS'],
      frameworks: ['IIS'],
      operationSchemaVersions: {
        'windows.certificate.inspect_pfx': ['1.0'],
        'windows.certificate_store.import_pfx': ['1.0'],
        'windows.certificate_private_key.grant': ['1.0'],
        'windows.iis.binding.capture': ['1.0'],
        'windows.iis.binding.update_certificate': ['1.0'],
        'windows.iis.binding.restore_certificate': ['1.0'],
        'tls.verify': ['1.0'],
      },
    },
    variables: {
      siteName: { type: 'string', required: true },
      bindingInformation: { type: 'string', required: true },
      appPoolName: { type: 'string', required: false },
      verifyHost: { type: 'string', required: true },
      verifyPort: { type: 'number', required: true, default: 443, minimum: 1, maximum: 65535 },
    },
    artifactInputs: { certificate: { type: 'bundle', required: true } },
    permissions: [
      { name: 'windows-certificate-store', risk: 'high', scope: 'certificate_store', values: ['LocalMachine/My'] },
      { name: 'iis-sites-and-app-pools', risk: 'high', scope: 'iis', values: ['*'] },
      { name: 'iis-tls', risk: 'low', scope: 'network', values: ['*'] },
    ],
    operations: iisOperations(),
    rollback: iisRollback(),
  },
  {
    apiVersion: 'gcac.agent-plugin/v1',
    kind: 'AgentDeploymentPlugin',
    pluginId: 'builtin.rabbitmq.pem',
    name: 'rabbitmq-pem-certificate-deployment',
    publisher: 'GCAC',
    version: '1.0.0',
    minGcacVersion: GCAC_VERSION,
    metadata: { displayName: 'RabbitMQ PEM 证书部署', description: '替换 RabbitMQ PEM 证书和私钥，重启服务并校验 TLS。', category: 'messaging', tags: ['rabbitmq', 'pem', 'linux'] },
    compatibility: { ...commonCompatibility, platforms: ['LINUX'], frameworks: ['CUSTOM'] },
    variables: {
      certificatePath: { type: 'file', required: true, default: '/etc/rabbitmq/tls/server.crt' },
      privateKeyPath: { type: 'file', required: true, default: '/etc/rabbitmq/tls/server.key' },
      serviceName: { type: 'string', required: true, default: 'rabbitmq-server' },
      verifyHost: { type: 'string', required: true },
      verifyPort: { type: 'number', required: true, default: 5671, minimum: 1, maximum: 65535 },
    },
    artifactInputs: {
      certificate: { type: 'certificate', required: true },
      privateKey: { type: 'private_key', required: true },
    },
    permissions: [
      { name: 'rabbitmq-files', risk: 'medium', scope: 'filesystem', values: ['/etc/rabbitmq/tls/*'] },
      { name: 'rabbitmq-service', risk: 'medium', scope: 'service', values: ['rabbitmq-server'] },
      { name: 'rabbitmq-tls', risk: 'low', scope: 'network', values: ['*'] },
    ],
    operations: certificateFileOperations('rabbitmq', '${variables.certificatePath}', '${variables.privateKeyPath}', '${variables.serviceName}'),
    rollback: certificateFileRollback('rabbitmq'),
  },
  {
    apiVersion: 'gcac.agent-plugin/v1',
    kind: 'AgentDeploymentPlugin',
    pluginId: 'builtin.java.pkcs12',
    name: 'java-pkcs12-certificate-deployment',
    publisher: 'GCAC',
    version: '1.0.0',
    minGcacVersion: GCAC_VERSION,
    metadata: { displayName: 'Java PKCS#12 / KeyStore 部署', description: '原子替换 Java 服务使用的 PKCS#12 或 KeyStore 文件并重启服务。', category: 'java', tags: ['java', 'pkcs12', 'keystore', 'linux', 'windows'] },
    compatibility: { ...commonCompatibility, platforms: ['WINDOWS', 'LINUX'], frameworks: ['TOMCAT', 'CUSTOM'] },
    variables: {
      keystorePath: { type: 'file', required: true },
      serviceName: { type: 'string', required: true },
      verifyHost: { type: 'string', required: true },
      verifyPort: { type: 'number', required: true, minimum: 1, maximum: 65535 },
    },
    artifactInputs: { keystore: { type: 'bundle', required: true } },
    permissions: [
      { name: 'keystore-files', risk: 'high', scope: 'filesystem', values: ['*'] },
      { name: 'java-service', risk: 'high', scope: 'service', values: ['*'] },
      { name: 'java-tls', risk: 'low', scope: 'network', values: ['*'] },
    ],
    operations: singleFileOperations('keystore', '${variables.keystorePath}', '${variables.serviceName}', '${artifacts.keystore}'),
    rollback: singleFileRollback('keystore'),
  },
  {
    apiVersion: 'gcac.agent-plugin/v1',
    kind: 'AgentDeploymentPlugin',
    pluginId: 'builtin.windows-service.certificate-file',
    name: 'windows-service-certificate-file-deployment',
    publisher: 'GCAC',
    version: '1.0.0',
    minGcacVersion: GCAC_VERSION,
    metadata: { displayName: '自定义 Windows Service 证书文件部署', description: '替换自定义 Windows 服务读取的证书文件并重启指定服务。', category: 'windows-service', tags: ['windows', 'service', 'custom'] },
    compatibility: { ...commonCompatibility, platforms: ['WINDOWS'], frameworks: ['CUSTOM'] },
    variables: {
      certificatePath: { type: 'file', required: true },
      serviceName: { type: 'string', required: true },
      verifyHost: { type: 'string', required: true },
      verifyPort: { type: 'number', required: true, minimum: 1, maximum: 65535 },
    },
    artifactInputs: { certificateFile: { type: 'bundle', required: true } },
    permissions: [
      { name: 'service-certificate-file', risk: 'high', scope: 'filesystem', values: ['*'] },
      { name: 'windows-service', risk: 'high', scope: 'service', values: ['*'] },
      { name: 'service-tls', risk: 'low', scope: 'network', values: ['*'] },
    ],
    operations: singleFileOperations('windows-service', '${variables.certificatePath}', '${variables.serviceName}', '${artifacts.certificateFile}'),
    rollback: singleFileRollback('windows-service'),
  },
];

function nginxOperations(): AgentDeploymentPluginManifestV1['operations'] {
  return [
    operation('nginx-cert-preflight', 'prepare', 'preflight.assert', { path: '${variables.certificatePath}' }),
    operation('nginx-key-preflight', 'prepare', 'preflight.assert', { path: '${variables.privateKeyPath}' }),
    operation('nginx-program-preflight', 'prepare', 'preflight.assert', { program: '${variables.nginxProgram}' }),
    operation('nginx-cert-backup', 'backup', 'file.backup', { path: '${variables.certificatePath}' }),
    operation('nginx-key-backup', 'backup', 'file.backup', { path: '${variables.privateKeyPath}' }),
    operation('nginx-cert-install', 'install', 'file.atomic_replace', { path: '${variables.certificatePath}', artifact: '${artifacts.certificate}', mode: 420 }),
    operation('nginx-key-install', 'install', 'file.atomic_replace', { path: '${variables.privateKeyPath}', artifact: '${artifacts.privateKey}', mode: 384 }),
    operation('nginx-config-test', 'refresh', 'command.execute', { program: '${variables.nginxProgram}', args: ['-t'] }),
    operation('nginx-reload', 'refresh', 'service.control', { serviceName: '${variables.serviceName}', action: 'reload' }),
    operation('nginx-tls-verify', 'verify', 'tls.verify', {
      host: '${variables.verifyHost}',
      port: '${variables.verifyPort}',
      serverName: '${variables.verifyHost}',
      expectedFingerprint: '${artifacts.certificate.fingerprintSha256}',
      skipChainValidation: true,
    }),
  ];
}

function nginxRollback(): AgentDeploymentPluginManifestV1['rollback'] {
  return [
    operation('nginx-rollback-reload', 'rollback', 'service.control', { serviceName: '${variables.serviceName}', action: 'reload', whenOperationCompleted: 'nginx-reload' }),
    operation('nginx-rollback-config-test', 'rollback', 'command.execute', { program: '${variables.nginxProgram}', args: ['-t'], whenOperationCompleted: 'nginx-cert-install' }),
    operation('nginx-cert-restore', 'rollback', 'file.restore', { backupOperationId: 'nginx-cert-backup', whenOperationCompleted: 'nginx-cert-backup' }),
    operation('nginx-key-restore', 'rollback', 'file.restore', { backupOperationId: 'nginx-key-backup', whenOperationCompleted: 'nginx-key-backup' }),
  ];
}

function iisOperations(): AgentDeploymentPluginManifestV1['operations'] {
  const artifact = '${artifacts.certificate}';
  const bindingSelector = { bindingInformation: '${variables.bindingInformation}' };
  return [
    operation('iis-pfx-inspect', 'prepare', 'windows.certificate.inspect_pfx', { store: 'LocalMachine/My', artifact }),
    operation('iis-binding-capture', 'backup', 'windows.iis.binding.capture', { siteName: '${variables.siteName}', bindingSelector }),
    operation('iis-pfx-import', 'install', 'windows.certificate_store.import_pfx', { store: 'LocalMachine/My', artifact }),
    operation('iis-private-key-grant', 'install', 'windows.certificate_private_key.grant', { store: 'LocalMachine/My', artifact, appPoolName: '${variables.appPoolName}' }),
    operation('iis-binding-update', 'install', 'windows.iis.binding.update_certificate', { siteName: '${variables.siteName}', bindingSelector, store: 'LocalMachine/My', artifact }),
    operation('iis-tls-verify', 'verify', 'tls.verify', {
      host: '${variables.verifyHost}',
      port: '${variables.verifyPort}',
      serverName: '${variables.verifyHost}',
      expectedFingerprint: '${artifacts.certificate.fingerprintSha256}',
      skipChainValidation: true,
    }),
  ];
}

function iisRollback(): AgentDeploymentPluginManifestV1['rollback'] {
  return [operation('iis-binding-restore', 'rollback', 'windows.iis.binding.restore_certificate', {
    siteName: '${variables.siteName}',
    captureOperationId: 'iis-binding-capture',
    whenOperationCompleted: 'iis-binding-update',
  })];
}

function certificateFileOperations(prefix: string, certificatePath: string, privateKeyPath: string, serviceName: string): AgentDeploymentPluginManifestV1['operations'] {
  return [
    operation(`${prefix}-cert-backup`, 'backup', 'file.backup', { path: certificatePath }),
    operation(`${prefix}-key-backup`, 'backup', 'file.backup', { path: privateKeyPath }),
    operation(`${prefix}-cert-install`, 'install', 'file.atomic_replace', { path: certificatePath, artifact: '${artifacts.certificate}', mode: 420 }),
    operation(`${prefix}-key-install`, 'install', 'file.atomic_replace', { path: privateKeyPath, artifact: '${artifacts.privateKey}', mode: 384 }),
    operation(`${prefix}-refresh`, 'refresh', 'service.control', { serviceName, action: 'restart' }),
    operation(`${prefix}-verify`, 'verify', 'tls.verify', { host: '${variables.verifyHost}', port: '${variables.verifyPort}', serverName: '${variables.verifyHost}' }),
  ];
}

function singleFileOperations(prefix: string, path: string, serviceName: string, artifact: string): AgentDeploymentPluginManifestV1['operations'] {
  return [
    operation(`${prefix}-backup`, 'backup', 'file.backup', { path }),
    operation(`${prefix}-install`, 'install', 'file.atomic_replace', { path, artifact, mode: 384 }),
    operation(`${prefix}-refresh`, 'refresh', 'service.control', { serviceName, action: 'restart' }),
    operation(`${prefix}-verify`, 'verify', 'tls.verify', { host: '${variables.verifyHost}', port: '${variables.verifyPort}', serverName: '${variables.verifyHost}' }),
  ];
}

function certificateFileRollback(prefix: string): AgentDeploymentPluginManifestV1['rollback'] {
  return [
    operation(`${prefix}-key-restore`, 'rollback', 'file.restore', { backupOperationId: `${prefix}-key-backup` }),
    operation(`${prefix}-cert-restore`, 'rollback', 'file.restore', { backupOperationId: `${prefix}-cert-backup` }),
  ];
}

function singleFileRollback(prefix: string): AgentDeploymentPluginManifestV1['rollback'] {
  return [operation(`${prefix}-restore`, 'rollback', 'file.restore', { backupOperationId: `${prefix}-backup` })];
}

function operation(id: string, stage: AgentDeploymentPluginManifestV1['operations'][number]['stage'], operationType: AgentDeploymentPluginManifestV1['operations'][number]['operationType'], input: Record<string, unknown>) {
  return { id, name: id, stage, operationType, schemaVersion: '1.0' as const, input };
}

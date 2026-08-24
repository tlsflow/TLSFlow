import type { AgentDeploymentPluginManifestV1 } from '../dto/agent-deployment-plugins.dto.js';

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
    pluginId: 'builtin.rabbitmq.pem',
    name: 'rabbitmq-pem-certificate-deployment',
    publisher: 'GCAC',
    version: '1.0.0',
    metadata: { displayName: 'RabbitMQ PEM 证书部署', description: '替换 RabbitMQ PEM 证书和私钥，重启服务并校验 TLS。', category: 'messaging', tags: ['rabbitmq', 'pem', 'linux'] },
    compatibility: { ...commonCompatibility, platforms: ['LINUX'] },
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
    metadata: { displayName: 'Java PKCS#12 / KeyStore 部署', description: '原子替换 Java 服务使用的 PKCS#12 或 KeyStore 文件并重启服务。', category: 'java', tags: ['java', 'pkcs12', 'keystore', 'linux', 'windows'] },
    compatibility: { ...commonCompatibility, platforms: ['WINDOWS', 'LINUX'] },
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
    metadata: { displayName: '自定义 Windows Service 证书文件部署', description: '替换自定义 Windows 服务读取的证书文件并重启指定服务。', category: 'windows-service', tags: ['windows', 'service', 'custom'] },
    compatibility: { ...commonCompatibility, platforms: ['WINDOWS'] },
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

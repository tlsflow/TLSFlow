import type { AgentDeploymentPluginManifestV1 } from '../dto/agent-deployment-plugins.dto.js';
import type { DeploymentInputContractV1, DeploymentVariableDefinitionV1 } from '../../deployment-inputs/dto/deployment-input-contract.dto.js';
import { GCAC_VERSION } from '../../../common/version.js';

const commonCompatibility = {
  architectures: ['amd64', 'arm64'],
  requiredCapabilities: ['agent.atomic_plan.execute'],
  operationSchemaVersions: {
    'file.backup': ['1.0'],
    'file.atomic_replace': ['1.0'],
    'file.restore': ['1.0'],
    'service.control': ['1.0'],
  },
};

const windowsAtomicCompatibility = {
  architectures: ['amd64', 'arm64'],
  requiredCapabilities: ['agent.atomic_plan.execute'],
  platforms: ['WINDOWS'] as AgentDeploymentPluginManifestV1['compatibility']['platforms'],
  operationSchemaVersions: {
    'file.backup': ['1.0'],
    'file.atomic_replace': ['1.0'],
    'file.restore': ['1.0'],
    'preflight.assert': ['1.0'],
    'command.execute': ['1.0'],
    'service.control': ['1.0'],
  },
};

export const builtinAgentPluginManifests: AgentDeploymentPluginManifestV1[] = [
  {
    apiVersion: 'gcac.agent-plugin/v1',
    kind: 'AgentDeploymentPlugin',
    pluginId: 'builtin.linux.nginx.pem',
    name: 'linux-nginx-pem-certificate-deployment',
    publisher: 'GCAC',
    version: '1.0.13',
    minGcacVersion: GCAC_VERSION,
    metadata: { displayName: 'NGINX PEM 证书部署', description: '备份并原子替换 NGINX PEM 证书和私钥，执行配置检查和 reload；TLS 验证由平台或指定 Gateway 执行。', logoUrl: '/plugin-logos/nginx.svg', category: 'web-server', tags: ['nginx', 'pem', 'linux'] },
    compatibility: {
      ...commonCompatibility,
      platforms: ['LINUX'],
      frameworks: ['web.nginx'],
      operationSchemaVersions: {
        ...commonCompatibility.operationSchemaVersions,
        'preflight.assert': ['1.0'],
        'command.execute': ['1.0'],
      },
    },
    inputContract: agentInputContract({
      certificatePath: { type: 'file', required: true, default: '/etc/nginx/tls/server.crt', assetPath: 'target.certificateLocation.certificatePath', assetOverridable: true },
      privateKeyPath: { type: 'file', required: true, default: '/etc/nginx/tls/server.key', assetPath: 'target.certificateLocation.privateKeyPath', assetOverridable: true },
      nginxProgram: { type: 'enum', required: true, default: '/usr/sbin/nginx', enum: ['/usr/sbin/nginx', '/usr/bin/nginx'], assetPath: 'target.certificateLocation.programPath', assetOverridable: true },
      serviceName: { type: 'string', required: true, default: 'nginx', assetPath: 'target.certificateLocation.serviceName', assetOverridable: true },
    }, { certificate: 'public_certificate', privateKey: 'private_key' }),
    permissions: [
      { name: 'nginx-files', risk: 'high', scope: 'filesystem', values: ['/etc/nginx/*'] },
      { name: 'nginx-process', risk: 'medium', scope: 'process', values: ['/usr/sbin/nginx', '/usr/bin/nginx'] },
      { name: 'nginx-service', risk: 'high', scope: 'service', values: ['*'] },
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
    version: '1.0.11',
    minGcacVersion: GCAC_VERSION,
    metadata: { displayName: 'IIS PFX 证书部署', description: '检查并导入 PFX、授权应用池私钥、更新 IIS HTTPS Binding 并验证 TLS。', logoUrl: '/plugin-logos/iis.svg', category: 'web-server', tags: ['iis', 'pfx', 'windows'] },
    compatibility: {
      architectures: ['amd64', 'arm64'],
      requiredCapabilities: ['agent.atomic_plan.execute'],
      platforms: ['WINDOWS'],
      frameworks: ['web.iis'],
      operationSchemaVersions: {
        'windows.certificate.inspect_pfx': ['1.0'],
        'windows.certificate_store.import_pfx': ['1.0'],
        'windows.certificate_private_key.grant': ['1.0'],
        'windows.iis.binding.capture': ['1.0'],
        'windows.iis.binding.update_certificate': ['1.0'],
        'windows.iis.binding.restore_certificate': ['1.0'],
      },
    },
    inputContract: agentInputContract({
      siteName: { type: 'string', required: true, assetPath: 'site.name' },
      bindingInformation: { type: 'string', required: true, assetPath: 'site.bindingInformation' },
      appPoolName: { type: 'string', required: false },
    }, { certificate: 'pkcs12_bundle' }),
    permissions: [
      { name: 'windows-certificate-store', risk: 'high', scope: 'certificate_store', values: ['LocalMachine/My'] },
      { name: 'iis-sites-and-app-pools', risk: 'high', scope: 'iis', values: ['*'] },
    ],
    operations: iisOperations(),
    rollback: iisRollback(),
  },
  {
    apiVersion: 'gcac.agent-plugin/v1',
    kind: 'AgentDeploymentPlugin',
    pluginId: 'builtin.windows.nginx.pem',
    name: 'windows-nginx-pem-certificate-deployment',
    publisher: 'GCAC',
    version: '1.0.1',
    minGcacVersion: GCAC_VERSION,
    metadata: { displayName: 'Windows NGINX PEM 证书部署', description: '基于 Windows Agent 原子操作替换 NGINX PEM 证书和私钥，检查配置、执行 reload 并保留回滚能力。', logoUrl: '/plugin-logos/nginx.svg', category: 'web-server', tags: ['nginx', 'pem', 'windows'] },
    compatibility: { ...windowsAtomicCompatibility, frameworks: ['web.nginx'] },
    inputContract: agentInputContract({
      certificatePath: { type: 'file', required: true, assetPath: 'target.certificateLocation.certificatePath', assetOverridable: true },
      privateKeyPath: { type: 'file', required: true, assetPath: 'target.certificateLocation.privateKeyPath', assetOverridable: true },
      configPath: { type: 'file', required: true, assetPath: 'target.certificateLocation.sourceConfigPath', assetOverridable: true },
      nginxProgram: { type: 'string', required: true, assetPath: 'target.certificateLocation.programPath', assetOverridable: true },
    }, { certificate: 'public_certificate', privateKey: 'private_key' }),
    permissions: [
      { name: 'windows-nginx-files', risk: 'high', scope: 'filesystem', values: [] },
      { name: 'windows-nginx-program', risk: 'high', scope: 'process', values: [] },
    ],
    operations: windowsNginxOperations(),
    rollback: windowsNginxRollback(),
  },
  {
    apiVersion: 'gcac.agent-plugin/v1',
    kind: 'AgentDeploymentPlugin',
    pluginId: 'builtin.windows.apache.pem',
    name: 'windows-apache-pem-certificate-deployment',
    publisher: 'GCAC',
    version: '1.0.1',
    minGcacVersion: GCAC_VERSION,
    metadata: { displayName: 'Windows Apache PEM 证书部署', description: '基于 Windows Agent 原子操作替换 Apache PEM 证书、私钥和链，执行 stop/start 刷新并保留回滚能力。', logoUrl: '/plugin-logos/apache.svg', category: 'web-server', tags: ['apache', 'pem', 'windows'] },
    compatibility: { ...windowsAtomicCompatibility, frameworks: ['web.apache'] },
    inputContract: agentInputContract({
      certificatePath: { type: 'file', required: true, assetPath: 'target.certificateLocation.certificatePath', assetOverridable: true },
      privateKeyPath: { type: 'file', required: true, assetPath: 'target.certificateLocation.privateKeyPath', assetOverridable: true },
      chainPath: { type: 'file', required: true, assetPath: 'target.certificateLocation.chainPath', assetOverridable: true },
      configPath: { type: 'file', required: true, assetPath: 'target.certificateLocation.sourceConfigPath', assetOverridable: true },
      apacheProgram: { type: 'string', required: true, assetPath: 'target.certificateLocation.programPath', assetOverridable: true },
      serviceName: { type: 'string', required: true, assetPath: 'target.certificateLocation.serviceName', assetOverridable: true },
    }, { certificate: 'public_certificate', privateKey: 'private_key', chain: 'certificate_chain' }),
    permissions: [
      { name: 'windows-apache-files', risk: 'high', scope: 'filesystem', values: [] },
      { name: 'windows-apache-program', risk: 'high', scope: 'process', values: [] },
      { name: 'windows-apache-service', risk: 'high', scope: 'service', values: [] },
    ],
    operations: windowsApacheOperations(),
    rollback: windowsApacheRollback(),
  },
  {
    apiVersion: 'gcac.agent-plugin/v1',
    kind: 'AgentDeploymentPlugin',
    pluginId: 'builtin.windows.tomcat.pkcs12',
    name: 'windows-tomcat-pkcs12-certificate-deployment',
    publisher: 'GCAC',
    version: '1.0.1',
    minGcacVersion: GCAC_VERSION,
    metadata: { displayName: 'Windows Tomcat KeyStore 证书部署', description: '基于 Windows Agent 原子操作替换 Tomcat PKCS#12 或 KeyStore 文件，执行 stop/start 刷新并保留回滚能力。', logoUrl: '/plugin-logos/java.svg', category: 'java', tags: ['tomcat', 'pkcs12', 'keystore', 'windows'] },
    compatibility: { ...windowsAtomicCompatibility, frameworks: ['app.tomcat'] },
    inputContract: agentInputContract({
      keystorePath: { type: 'file', required: true, assetPath: 'target.certificateLocation.keystorePath', assetOverridable: true },
      keystoreType: { type: 'enum', required: true, enum: ['PKCS12', 'JKS', 'OTHER'], assetPath: 'target.certificateLocation.keystoreType', assetOverridable: true },
      configPath: { type: 'file', required: true, assetPath: 'target.certificateLocation.sourceConfigPath', assetOverridable: true },
      javaPath: { type: 'string', required: true, assetPath: 'target.certificateLocation.programPath', assetOverridable: true },
      serviceName: { type: 'string', required: true, assetPath: 'target.certificateLocation.serviceName', assetOverridable: true },
    }, { keystore: 'pkcs12_bundle' }),
    permissions: [
      { name: 'windows-tomcat-files', risk: 'high', scope: 'filesystem', values: [] },
      { name: 'windows-tomcat-program', risk: 'high', scope: 'process', values: [] },
      { name: 'windows-tomcat-service', risk: 'high', scope: 'service', values: [] },
    ],
    operations: windowsTomcatOperations(),
    rollback: windowsTomcatRollback(),
  },
  {
    apiVersion: 'gcac.agent-plugin/v1',
    kind: 'AgentDeploymentPlugin',
    pluginId: 'builtin.windows.custom.certificate',
    name: 'windows-custom-certificate-target-deployment',
    publisher: 'GCAC',
    version: '1.0.1',
    minGcacVersion: GCAC_VERSION,
    metadata: { displayName: '手工 Windows 证书目标部署', description: '为无法自动发现的 Windows 服务提供结构化证书材料、配置检查、程序或服务刷新、验证和回滚。', logoUrl: '/plugin-logos/windows-service.svg', category: 'windows-service', tags: ['windows', 'custom', 'manual', 'certificate'] },
    compatibility: { ...windowsAtomicCompatibility, frameworks: ['runtime.custom'] },
    inputContract: manualWindowsInputContract(),
    permissions: [
      { name: 'windows-custom-files', risk: 'high', scope: 'filesystem', values: [] },
      { name: 'windows-custom-programs', risk: 'high', scope: 'process', values: [] },
      { name: 'windows-custom-services', risk: 'high', scope: 'service', values: [] },
    ],
    operations: manualWindowsOperations(),
    rollback: manualWindowsRollback(),
  },
  {
    apiVersion: 'gcac.agent-plugin/v1',
    kind: 'AgentDeploymentPlugin',
    pluginId: 'builtin.rabbitmq.pem',
    name: 'rabbitmq-pem-certificate-deployment',
    publisher: 'GCAC',
    version: '1.0.8',
    minGcacVersion: GCAC_VERSION,
    metadata: { displayName: 'RabbitMQ PEM 证书部署', description: '替换 RabbitMQ PEM 证书和私钥，重启服务并校验 TLS。', logoUrl: '/plugin-logos/rabbitmq.svg', category: 'messaging', tags: ['rabbitmq', 'pem', 'linux'] },
    compatibility: { ...commonCompatibility, platforms: ['LINUX'], frameworks: ['runtime.custom'] },
    inputContract: agentInputContract({
      certificatePath: { type: 'file', required: true, default: '/etc/rabbitmq/tls/server.crt' },
      privateKeyPath: { type: 'file', required: true, default: '/etc/rabbitmq/tls/server.key' },
      serviceName: { type: 'string', required: true, default: 'rabbitmq-server' },
    }, { certificate: 'public_certificate', privateKey: 'private_key' }),
    permissions: [
      { name: 'rabbitmq-files', risk: 'medium', scope: 'filesystem', values: ['/etc/rabbitmq/tls/*'] },
      { name: 'rabbitmq-service', risk: 'medium', scope: 'service', values: ['rabbitmq-server'] },
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
    version: '1.0.10',
    minGcacVersion: GCAC_VERSION,
    metadata: { displayName: 'Java PKCS#12 / KeyStore 部署', description: '原子替换 Java 服务使用的 PKCS#12 或 KeyStore 文件并重启服务。', logoUrl: '/plugin-logos/java.svg', category: 'java', tags: ['java', 'pkcs12', 'keystore', 'linux', 'windows'] },
    compatibility: { ...commonCompatibility, platforms: ['WINDOWS', 'LINUX'], frameworks: ['app.tomcat', 'runtime.custom'] },
    inputContract: agentInputContract({
      keystorePath: { type: 'file', required: true, assetPath: 'target.certificateLocation.keystorePath', assetOverridable: true },
      serviceName: { type: 'string', required: true, assetPath: 'target.certificateLocation.serviceName', assetOverridable: true },
    }, { keystore: 'pkcs12_bundle' }),
    permissions: [
      { name: 'keystore-files', risk: 'high', scope: 'filesystem', values: ['*'] },
      { name: 'java-service', risk: 'high', scope: 'service', values: ['*'] },
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
    version: '1.0.8',
    minGcacVersion: GCAC_VERSION,
    metadata: { displayName: '自定义 Windows Service 证书文件部署', description: '替换自定义 Windows 服务读取的证书文件并重启指定服务。', logoUrl: '/plugin-logos/windows-service.svg', category: 'windows-service', tags: ['windows', 'service', 'custom'] },
    compatibility: { ...commonCompatibility, platforms: ['WINDOWS'], frameworks: ['runtime.custom'] },
    inputContract: agentInputContract({
      certificatePath: { type: 'file', required: true },
      serviceName: { type: 'string', required: true },
    }, { certificateFile: 'pkcs12_bundle' }),
    permissions: [
      { name: 'service-certificate-file', risk: 'high', scope: 'filesystem', values: ['*'] },
      { name: 'windows-service', risk: 'high', scope: 'service', values: ['*'] },
    ],
    operations: singleFileOperations('windows-service', '${variables.certificatePath}', '${variables.serviceName}', '${artifacts.certificateFile}'),
    rollback: singleFileRollback('windows-service'),
  },
];

type AgentVariableDeclaration = Pick<DeploymentVariableDefinitionV1, 'type' | 'required' | 'default' | 'enum'> & {
  assetPath?: string;
  assetOverridable?: boolean;
};

function agentInputContract(
  variables: Record<string, AgentVariableDeclaration>,
  artifacts: Record<string, string>,
): DeploymentInputContractV1 {
  return {
    apiVersion: 'gcac.deployment-input/v1',
    variables: Object.fromEntries(Object.entries(variables).map(([name, definition]) => {
      const fromAsset = definition.assetPath !== undefined;
      const fixed = fromAsset && definition.assetOverridable !== true;
      const hasDefault = definition.default !== undefined;
      return [name, {
        type: definition.type,
        required: definition.required,
        configurationMode: fixed ? 'runtime' : hasDefault || !definition.required ? 'advanced' : 'required',
        source: fromAsset ? { kind: 'asset', path: definition.assetPath! } : hasDefault ? { kind: 'default' } : { kind: 'binding' },
        lifecycle: 'pre_execution',
        bindingPolicy: fixed ? 'fixed' : fromAsset || hasDefault || !definition.required ? 'default_overridable' : 'required_binding',
        default: definition.default,
        enum: definition.enum,
      } satisfies DeploymentVariableDefinitionV1];
    })),
    connections: {},
    credentials: {},
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([name, role]) => [name, {
      kind: 'certificate',
      required: true,
      configurationMode: 'required',
      lifecycle: 'pre_execution',
      artifactContract: { outputs: { [name]: { role, required: true, sensitive: role === 'private_key' || role === 'pkcs12_bundle' } } },
    }])),
  };
}

function manualWindowsInputContract(): DeploymentInputContractV1 {
  const binding = (type: 'string' | 'object' | 'array' | 'enum' | 'file', required = false, enumValues?: unknown[]): DeploymentVariableDefinitionV1 => ({
    type,
    required,
    configurationMode: required ? 'required' : 'advanced',
    source: { kind: 'binding' },
    lifecycle: 'pre_execution',
    bindingPolicy: required ? 'required_binding' : 'default_overridable',
    ...(enumValues ? { enum: enumValues } : {}),
  });
  return {
    apiVersion: 'gcac.deployment-input/v1',
    variables: {
      materialMode: binding('enum', true, ['PEM', 'KEYSTORE']),
      certificatePath: binding('file'),
      privateKeyPath: binding('file'),
      chainPath: binding('file'),
      keystorePath: binding('file'),
      keystoreType: binding('enum', false, ['PKCS12', 'JKS', 'OTHER']),
      programPath: binding('string', true),
      serviceName: binding('string'),
      configPath: binding('file'),
      configCheckProgram: binding('string'),
      configCheckArgs: binding('array'),
      refreshMode: binding('enum', true, ['PROGRAM', 'SERVICE']),
      refreshProgram: binding('string'),
      refreshArgs: binding('array'),
      verify: binding('object', true),
      expectedConfigFingerprint: binding('string'),
    },
    connections: {},
    credentials: {},
    artifacts: {
      certificate: optionalManualArtifact('public_certificate', false),
      privateKey: optionalManualArtifact('private_key', true),
      chain: optionalManualArtifact('certificate_chain', false),
      keystore: optionalManualArtifact('pkcs12_bundle', true),
    },
  };
}

function optionalManualArtifact(role: string, sensitive: boolean) {
  return {
    kind: 'file' as const,
    required: false,
    configurationMode: 'advanced' as const,
    lifecycle: 'pre_execution' as const,
    artifactContract: {
      outputs: {
        material: { role, required: true, sensitive },
      },
    },
  };
}

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

function windowsNginxOperations(): AgentDeploymentPluginManifestV1['operations'] {
  return [
    operation('windows-nginx-program-preflight', 'prepare', 'preflight.assert', { program: '${variables.nginxProgram}', mustExist: true }),
    operation('windows-nginx-config-preflight', 'prepare', 'preflight.assert', { path: '${variables.configPath}', mustExist: true }),
    operation('windows-nginx-cert-preflight', 'prepare', 'preflight.assert', { path: '${variables.certificatePath}', mustExist: true }),
    operation('windows-nginx-key-preflight', 'prepare', 'preflight.assert', { path: '${variables.privateKeyPath}', mustExist: true }),
    operation('windows-nginx-cert-backup', 'backup', 'file.backup', { path: '${variables.certificatePath}' }),
    operation('windows-nginx-key-backup', 'backup', 'file.backup', { path: '${variables.privateKeyPath}' }),
    operation('windows-nginx-cert-install', 'install', 'file.atomic_replace', { path: '${variables.certificatePath}', artifact: '${artifacts.certificate}' }),
    operation('windows-nginx-key-install', 'install', 'file.atomic_replace', { path: '${variables.privateKeyPath}', artifact: '${artifacts.privateKey}' }),
    operation('windows-nginx-config-test', 'refresh', 'command.execute', { program: '${variables.nginxProgram}', args: ['-t', '-c', '${variables.configPath}'] }),
    operation('windows-nginx-reload', 'refresh', 'command.execute', { program: '${variables.nginxProgram}', args: ['-s', 'reload', '-c', '${variables.configPath}'] }),
    operation('windows-nginx-verify', 'verify', 'preflight.assert', { path: '${variables.certificatePath}', mustExist: true }),
  ];
}

function windowsNginxRollback(): AgentDeploymentPluginManifestV1['rollback'] {
  return [
    operation('windows-nginx-key-restore', 'rollback', 'file.restore', { backupOperationId: 'windows-nginx-key-backup' }),
    operation('windows-nginx-cert-restore', 'rollback', 'file.restore', { backupOperationId: 'windows-nginx-cert-backup' }),
    operation('windows-nginx-config-test-rollback', 'rollback', 'command.execute', { program: '${variables.nginxProgram}', args: ['-t', '-c', '${variables.configPath}'] }),
    operation('windows-nginx-reload-rollback', 'rollback', 'command.execute', { program: '${variables.nginxProgram}', args: ['-s', 'reload', '-c', '${variables.configPath}'] }),
  ];
}

function windowsApacheOperations(): AgentDeploymentPluginManifestV1['operations'] {
  return [
    operation('windows-apache-program-preflight', 'prepare', 'preflight.assert', { program: '${variables.apacheProgram}', mustExist: true }),
    operation('windows-apache-config-preflight', 'prepare', 'preflight.assert', { path: '${variables.configPath}', mustExist: true }),
    operation('windows-apache-cert-preflight', 'prepare', 'preflight.assert', { path: '${variables.certificatePath}', mustExist: true }),
    operation('windows-apache-key-preflight', 'prepare', 'preflight.assert', { path: '${variables.privateKeyPath}', mustExist: true }),
    operation('windows-apache-chain-preflight', 'prepare', 'preflight.assert', { path: '${variables.chainPath}', mustExist: true }),
    operation('windows-apache-cert-backup', 'backup', 'file.backup', { path: '${variables.certificatePath}' }),
    operation('windows-apache-key-backup', 'backup', 'file.backup', { path: '${variables.privateKeyPath}' }),
    operation('windows-apache-chain-backup', 'backup', 'file.backup', { path: '${variables.chainPath}' }),
    operation('windows-apache-cert-install', 'install', 'file.atomic_replace', { path: '${variables.certificatePath}', artifact: '${artifacts.certificate}' }),
    operation('windows-apache-key-install', 'install', 'file.atomic_replace', { path: '${variables.privateKeyPath}', artifact: '${artifacts.privateKey}' }),
    operation('windows-apache-chain-install', 'install', 'file.atomic_replace', { path: '${variables.chainPath}', artifact: '${artifacts.chain}' }),
    operation('windows-apache-config-test', 'refresh', 'command.execute', { program: '${variables.apacheProgram}', args: ['-t', '-f', '${variables.configPath}'] }),
    operation('windows-apache-stop', 'refresh', 'service.control', { serviceName: '${variables.serviceName}', action: 'stop' }),
    operation('windows-apache-start', 'refresh', 'service.control', { serviceName: '${variables.serviceName}', action: 'start' }),
    operation('windows-apache-verify', 'verify', 'service.control', { serviceName: '${variables.serviceName}', action: 'status' }),
  ];
}

function windowsApacheRollback(): AgentDeploymentPluginManifestV1['rollback'] {
  return [
    operation('windows-apache-stop-rollback', 'rollback', 'service.control', { serviceName: '${variables.serviceName}', action: 'stop' }),
    operation('windows-apache-chain-restore', 'rollback', 'file.restore', { backupOperationId: 'windows-apache-chain-backup' }),
    operation('windows-apache-key-restore', 'rollback', 'file.restore', { backupOperationId: 'windows-apache-key-backup' }),
    operation('windows-apache-cert-restore', 'rollback', 'file.restore', { backupOperationId: 'windows-apache-cert-backup' }),
    operation('windows-apache-start-rollback', 'rollback', 'service.control', { serviceName: '${variables.serviceName}', action: 'start' }),
    operation('windows-apache-verify-rollback', 'rollback', 'service.control', { serviceName: '${variables.serviceName}', action: 'status' }),
  ];
}

function windowsTomcatOperations(): AgentDeploymentPluginManifestV1['operations'] {
  return [
    operation('windows-tomcat-java-preflight', 'prepare', 'preflight.assert', { program: '${variables.javaPath}', mustExist: true }),
    operation('windows-tomcat-config-preflight', 'prepare', 'preflight.assert', { path: '${variables.configPath}', mustExist: true }),
    operation('windows-tomcat-keystore-preflight', 'prepare', 'preflight.assert', { path: '${variables.keystorePath}', mustExist: true }),
    operation('windows-tomcat-keystore-backup', 'backup', 'file.backup', { path: '${variables.keystorePath}' }),
    operation('windows-tomcat-keystore-install', 'install', 'file.atomic_replace', { path: '${variables.keystorePath}', artifact: '${artifacts.keystore}' }),
    operation('windows-tomcat-stop', 'refresh', 'service.control', { serviceName: '${variables.serviceName}', action: 'stop' }),
    operation('windows-tomcat-start', 'refresh', 'service.control', { serviceName: '${variables.serviceName}', action: 'start' }),
    operation('windows-tomcat-verify', 'verify', 'service.control', { serviceName: '${variables.serviceName}', action: 'status' }),
  ];
}

function windowsTomcatRollback(): AgentDeploymentPluginManifestV1['rollback'] {
  return [
    operation('windows-tomcat-stop-rollback', 'rollback', 'service.control', { serviceName: '${variables.serviceName}', action: 'stop' }),
    operation('windows-tomcat-keystore-restore', 'rollback', 'file.restore', { backupOperationId: 'windows-tomcat-keystore-backup' }),
    operation('windows-tomcat-start-rollback', 'rollback', 'service.control', { serviceName: '${variables.serviceName}', action: 'start' }),
    operation('windows-tomcat-verify-rollback', 'rollback', 'service.control', { serviceName: '${variables.serviceName}', action: 'status' }),
  ];
}

function manualWindowsOperations(): AgentDeploymentPluginManifestV1['operations'] {
  const optionalPath = (variable: string) => ({ whenVariablePresent: `\${variables.${variable}}` });
  return [
    operation('windows-custom-program-preflight', 'prepare', 'preflight.assert', { program: '${variables.programPath}', mustExist: true }),
    operation('windows-custom-config-preflight', 'prepare', 'preflight.assert', { path: '${variables.configPath}', mustExist: true, ...optionalPath('configPath') }),
    operation('windows-custom-config-fingerprint', 'prepare', 'preflight.assert', {
      path: '${variables.configPath}',
      expectedSha256: '${variables.expectedConfigFingerprint}',
      whenVariablePresent: '${variables.expectedConfigFingerprint}',
    }),
    operation('windows-custom-certificate-backup', 'backup', 'file.backup', { path: '${variables.certificatePath}', ...optionalPath('certificatePath') }),
    operation('windows-custom-private-key-backup', 'backup', 'file.backup', { path: '${variables.privateKeyPath}', ...optionalPath('privateKeyPath') }),
    operation('windows-custom-chain-backup', 'backup', 'file.backup', { path: '${variables.chainPath}', ...optionalPath('chainPath') }),
    operation('windows-custom-keystore-backup', 'backup', 'file.backup', { path: '${variables.keystorePath}', ...optionalPath('keystorePath') }),
    operation('windows-custom-certificate-install', 'install', 'file.atomic_replace', { path: '${variables.certificatePath}', artifact: '${artifacts.certificate}', ...optionalPath('certificatePath') }),
    operation('windows-custom-private-key-install', 'install', 'file.atomic_replace', { path: '${variables.privateKeyPath}', artifact: '${artifacts.privateKey}', ...optionalPath('privateKeyPath') }),
    operation('windows-custom-chain-install', 'install', 'file.atomic_replace', { path: '${variables.chainPath}', artifact: '${artifacts.chain}', ...optionalPath('chainPath') }),
    operation('windows-custom-keystore-install', 'install', 'file.atomic_replace', { path: '${variables.keystorePath}', artifact: '${artifacts.keystore}', ...optionalPath('keystorePath') }),
    operation('windows-custom-config-check', 'refresh', 'command.execute', {
      program: '${variables.configCheckProgram}',
      args: '${variables.configCheckArgs}',
      whenVariablePresent: '${variables.configCheckProgram}',
    }),
    operation('windows-custom-program-refresh', 'refresh', 'command.execute', {
      program: '${variables.refreshProgram}',
      args: '${variables.refreshArgs}',
      whenVariablePresent: '${variables.refreshProgram}',
    }),
    operation('windows-custom-service-refresh', 'refresh', 'service.control', {
      serviceName: '${variables.serviceName}',
      action: 'restart',
      whenVariablePresent: '${variables.serviceName}',
    }),
    operation('windows-custom-verify', 'verify', 'preflight.assert', { program: '${variables.programPath}', mustExist: true }),
  ];
}

function manualWindowsRollback(): AgentDeploymentPluginManifestV1['rollback'] {
  const optionalPath = (variable: string) => ({ whenVariablePresent: `\${variables.${variable}}` });
  return [
    operation('windows-custom-service-rollback-refresh', 'rollback', 'service.control', { serviceName: '${variables.serviceName}', action: 'restart', whenVariablePresent: '${variables.serviceName}' }),
    operation('windows-custom-program-rollback-refresh', 'rollback', 'command.execute', { program: '${variables.refreshProgram}', args: '${variables.refreshArgs}', whenVariablePresent: '${variables.refreshProgram}' }),
    operation('windows-custom-keystore-restore', 'rollback', 'file.restore', { backupOperationId: 'windows-custom-keystore-backup', ...optionalPath('keystorePath') }),
    operation('windows-custom-chain-restore', 'rollback', 'file.restore', { backupOperationId: 'windows-custom-chain-backup', ...optionalPath('chainPath') }),
    operation('windows-custom-private-key-restore', 'rollback', 'file.restore', { backupOperationId: 'windows-custom-private-key-backup', ...optionalPath('privateKeyPath') }),
    operation('windows-custom-certificate-restore', 'rollback', 'file.restore', { backupOperationId: 'windows-custom-certificate-backup', ...optionalPath('certificatePath') }),
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
  ];
}

function singleFileOperations(prefix: string, path: string, serviceName: string, artifact: string): AgentDeploymentPluginManifestV1['operations'] {
  return [
    operation(`${prefix}-backup`, 'backup', 'file.backup', { path }),
    operation(`${prefix}-install`, 'install', 'file.atomic_replace', { path, artifact, mode: 384 }),
    operation(`${prefix}-refresh`, 'refresh', 'service.control', { serviceName, action: 'restart' }),
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

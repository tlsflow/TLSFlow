import { AppError } from '../../../common/errors/app-error.js';
import type { DeploymentInputContractV1 } from '../dto/deployment-input-contract.dto.js';
import { validateDeploymentInputContractV1 } from '../schema/deployment-input-contract.schema.js';
import type { CertificateUpdatePluginId } from '../../plugins/canonical-plugin-id/canonical-plugin-id.registry.js';

export const CERTIFICATE_UPDATE_INPUT_CONTRACT_API_VERSION = 'gcac.certificate-update-input/v1' as const;

export type CertificateUpdatePlatform = 'linux' | 'windows';
export type CertificateUpdateArtifactKind = 'PEM_FILES' | 'KEYSTORE' | 'WINDOWS_CERTIFICATE_STORE';

export interface CertificateUpdateInputContractV1 {
  apiVersion: typeof CERTIFICATE_UPDATE_INPUT_CONTRACT_API_VERSION;
  pluginId: CertificateUpdatePluginId;
  frameworkType: 'web.nginx' | 'web.apache' | 'app.tomcat' | 'web.iis';
  platform: CertificateUpdatePlatform;
  artifactKind: CertificateUpdateArtifactKind;
  deploymentInputContract: DeploymentInputContractV1;
  requiredFacts: readonly string[];
}

const pluginProfiles: Readonly<Record<CertificateUpdatePluginId, Pick<CertificateUpdateInputContractV1, 'frameworkType' | 'platform' | 'artifactKind'>>> = {
  'web.nginx.linux': { frameworkType: 'web.nginx', platform: 'linux', artifactKind: 'PEM_FILES' },
  'web.nginx.windows': { frameworkType: 'web.nginx', platform: 'windows', artifactKind: 'PEM_FILES' },
  'web.apache.linux': { frameworkType: 'web.apache', platform: 'linux', artifactKind: 'PEM_FILES' },
  'web.apache.windows': { frameworkType: 'web.apache', platform: 'windows', artifactKind: 'PEM_FILES' },
  'app.tomcat.linux': { frameworkType: 'app.tomcat', platform: 'linux', artifactKind: 'KEYSTORE' },
  'app.tomcat.windows': { frameworkType: 'app.tomcat', platform: 'windows', artifactKind: 'KEYSTORE' },
  'web.iis': { frameworkType: 'web.iis', platform: 'windows', artifactKind: 'WINDOWS_CERTIFICATE_STORE' },
};

export function certificateUpdateProfile(pluginId: string): Pick<CertificateUpdateInputContractV1, 'frameworkType' | 'platform' | 'artifactKind'> | undefined {
  return pluginProfiles[pluginId as CertificateUpdatePluginId];
}

export function validateCertificateUpdateInputContract(input: unknown): CertificateUpdateInputContractV1 {
  const value = record(input, 'CertificateUpdateInputContractV1');
  exact(value.apiVersion, CERTIFICATE_UPDATE_INPUT_CONTRACT_API_VERSION, 'apiVersion');
  const pluginId = stringValue(value.pluginId, 'pluginId') as CertificateUpdatePluginId;
  const expected = pluginProfiles[pluginId];
  if (!expected) fail('pluginId', '不是当前证书更新插件 ID');
  exact(value.frameworkType, expected.frameworkType, 'frameworkType');
  exact(value.platform, expected.platform, 'platform');
  exact(value.artifactKind, expected.artifactKind, 'artifactKind');
  const expectedFacts = pluginId === 'web.nginx.windows'
    ? ['frameworkType', 'site', 'tls.binding', 'certificateLocation', 'configFingerprint', 'programPath']
    : ['frameworkType', 'site', 'tls.binding', 'certificateLocation', 'configFingerprint', 'serviceName', 'programPath'];
  if (!Array.isArray(value.requiredFacts)
    || value.requiredFacts.length !== expectedFacts.length
    || value.requiredFacts.some((item) => typeof item !== 'string')) {
    fail('requiredFacts', `必须完整声明 ${expectedFacts.length} 类 Agent 事实`);
  }
  const requiredFacts = value.requiredFacts as unknown as CertificateUpdateInputContractV1['requiredFacts'];
  if (expectedFacts.some((item, index) => requiredFacts[index] !== item)) fail('requiredFacts', '事实顺序或内容不符合固定合同');
  const deploymentInputContract = value.deploymentInputContract;
  if (!deploymentInputContract) fail('deploymentInputContract', '必须嵌入通用 DeploymentInputContractV1');
  const normalizedDeploymentInputContract = validateDeploymentInputContractV1(deploymentInputContract);
  const credentialSlots = Object.keys(normalizedDeploymentInputContract.credentials);
  if (expected.artifactKind === 'WINDOWS_CERTIFICATE_STORE') {
    if (credentialSlots.length > 0) fail('deploymentInputContract.credentials', 'IIS PFX 密码由证书 Artifact 自动提供，不得要求用户绑定凭据');
    const artifactOutputs = normalizedDeploymentInputContract.artifacts.certificateArtifact?.artifactContract.outputs;
    if (!artifactOutputs?.pfxBase64 || !artifactOutputs.pfxPassword || !artifactOutputs.fingerprintSha256) {
      fail('deploymentInputContract.artifacts', 'IIS Artifact 必须声明 pfxBase64、pfxPassword 和 fingerprintSha256 输出');
    }
    if (artifactOutputs.pfxPassword.role !== 'pkcs12_password' || artifactOutputs.pfxPassword.sensitive !== true) {
      fail('deploymentInputContract.artifacts', 'IIS PFX 密码输出必须是敏感 pkcs12_password');
    }
  } else if (expected.artifactKind === 'KEYSTORE') {
    if (credentialSlots.length !== 1 || credentialSlots[0] !== 'keystorePassword') {
      fail('deploymentInputContract.credentials', 'KeyStore 插件只能声明 keystorePassword 凭据槽位');
    }
    const artifactOutputs = normalizedDeploymentInputContract.artifacts.certificateArtifact?.artifactContract.outputs;
    if (!artifactOutputs?.pfxBase64 || !artifactOutputs.jksBase64) {
      fail('deploymentInputContract.artifacts', 'KeyStore Artifact 必须同时声明可选的 PKCS12/JKS Base64 输出');
    }
    const passwordOutputs = Object.entries(artifactOutputs)
      .filter(([name, definition]) => /password/i.test(name) || definition.role === 'keystore_password')
      .map(([name]) => name);
    if (passwordOutputs.length > 0) {
      fail('deploymentInputContract.artifacts', 'KeyStore 密码必须通过 keystorePassword SecretRef 提供，Artifact 不得输出密码', {
        passwordOutputs,
      });
    }
  } else if (credentialSlots.length > 0) {
    fail('deploymentInputContract.credentials', 'PEM 插件不得声明凭据槽位');
  }
  return {
    apiVersion: CERTIFICATE_UPDATE_INPUT_CONTRACT_API_VERSION,
    pluginId,
    frameworkType: expected.frameworkType,
    platform: expected.platform,
    artifactKind: expected.artifactKind,
    deploymentInputContract: normalizedDeploymentInputContract,
    requiredFacts,
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '必须是对象');
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(path, '必须是非空字符串');
  return value.trim();
}

function exact(actual: unknown, expected: unknown, path: string): void {
  if (actual !== expected) fail(path, '固定值不匹配', { expected });
}

function fail(path: string, message: string, details: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', `证书更新输入合同无效：${message}`, { path, ...details });
}

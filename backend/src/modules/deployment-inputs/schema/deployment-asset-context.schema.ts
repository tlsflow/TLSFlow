import { AppError } from '../../../common/errors/app-error.js';
import {
  DEPLOYMENT_ASSET_CONTEXT_API_VERSION,
  type DeploymentAssetContextV1,
} from '../dto/deployment-asset-context.dto.js';
import {
  CERTIFICATE_LOCATION_API_VERSION,
  type CertificateLocationV1,
} from '../dto/certificate-location.dto.js';

const rootKeys = new Set(['apiVersion', 'application', 'host', 'site', 'target', 'deployment']);
const applicationKeys = new Set(['id', 'address', 'serverName', 'port', 'protocol']);
const hostKeys = new Set(['id', 'hostname', 'primaryIp', 'osType']);
const siteKeys = new Set(['id', 'type', 'name', 'key', 'bindingInformation', 'hostHeader', 'listenIp', 'port', 'protocol', 'metadata']);
const targetKeys = new Set(['id', 'type', 'key', 'bindingKey', 'certificateLocation', 'metadata']);
const deploymentKeys = new Set(['targets', 'certificateResourceName']);
const deploymentTargetKeys = new Set(['id', 'name', 'serverName', 'port', 'sni', 'certificateLocation', 'metadata']);
const certificateLocationKeys = new Set([
  'apiVersion', 'storageKind', 'certificatePath', 'privateKeyPath', 'chainPath', 'keystorePath', 'keystoreType', 'keyAlias',
  'storeName', 'storeLocation', 'storeThumbprint', 'sourceConfigPath', 'serviceName', 'programPath', 'programSha256', 'workingDirectory', 'testCommand',
  'reloadCommand', 'configFingerprint', 'confidence', 'observedAt', 'warnings',
]);

export class DeploymentAssetContextSchemaRegistry {
  validate(input: unknown): DeploymentAssetContextV1 {
    const context = record(input, 'assetContext');
    rejectUnknown(context, rootKeys, 'assetContext');
    requireExact(context.apiVersion, DEPLOYMENT_ASSET_CONTEXT_API_VERSION, 'assetContext.apiVersion');
    return {
      apiVersion: DEPLOYMENT_ASSET_CONTEXT_API_VERSION,
      application: validateApplication(context.application),
      host: context.host === undefined ? undefined : validateHost(context.host),
      site: context.site === undefined ? undefined : validateSite(context.site),
      target: context.target === undefined ? undefined : validateTarget(context.target),
      deployment: validateDeployment(context.deployment),
    };
  }
}

export const deploymentAssetContextSchemaRegistry = new DeploymentAssetContextSchemaRegistry();

export function validateDeploymentAssetContextV1(input: unknown): DeploymentAssetContextV1 {
  return deploymentAssetContextSchemaRegistry.validate(input);
}

function validateApplication(input: unknown): DeploymentAssetContextV1['application'] {
  const application = record(input, 'assetContext.application');
  rejectUnknown(application, applicationKeys, 'assetContext.application');
  return {
    id: nonEmptyString(application.id, 'assetContext.application.id'),
    address: nonEmptyString(application.address, 'assetContext.application.address'),
    serverName: nonEmptyString(application.serverName, 'assetContext.application.serverName'),
    port: portNumber(application.port, 'assetContext.application.port'),
    protocol: nonEmptyString(application.protocol, 'assetContext.application.protocol'),
  };
}

function validateHost(input: unknown): NonNullable<DeploymentAssetContextV1['host']> {
  const host = record(input, 'assetContext.host');
  rejectUnknown(host, hostKeys, 'assetContext.host');
  return {
    id: nonEmptyString(host.id, 'assetContext.host.id'),
    hostname: optionalString(host.hostname, 'assetContext.host.hostname'),
    primaryIp: optionalString(host.primaryIp, 'assetContext.host.primaryIp'),
    osType: optionalString(host.osType, 'assetContext.host.osType'),
  };
}

function validateSite(input: unknown): NonNullable<DeploymentAssetContextV1['site']> {
  const site = record(input, 'assetContext.site');
  rejectUnknown(site, siteKeys, 'assetContext.site');
  return {
    id: nonEmptyString(site.id, 'assetContext.site.id'),
    type: optionalString(site.type, 'assetContext.site.type'),
    name: optionalString(site.name, 'assetContext.site.name'),
    key: optionalString(site.key, 'assetContext.site.key'),
    bindingInformation: optionalString(site.bindingInformation, 'assetContext.site.bindingInformation'),
    hostHeader: optionalString(site.hostHeader, 'assetContext.site.hostHeader'),
    listenIp: optionalString(site.listenIp, 'assetContext.site.listenIp'),
    port: site.port === undefined ? undefined : portNumber(site.port, 'assetContext.site.port'),
    protocol: optionalString(site.protocol, 'assetContext.site.protocol'),
    metadata: metadataRecord(site.metadata, 'assetContext.site.metadata'),
  };
}

function validateTarget(input: unknown): NonNullable<DeploymentAssetContextV1['target']> {
  const target = record(input, 'assetContext.target');
  rejectUnknown(target, targetKeys, 'assetContext.target');
  return {
    id: nonEmptyString(target.id, 'assetContext.target.id'),
    type: nonEmptyString(target.type, 'assetContext.target.type'),
    key: nonEmptyString(target.key, 'assetContext.target.key'),
    bindingKey: optionalString(target.bindingKey, 'assetContext.target.bindingKey'),
    certificateLocation: target.certificateLocation === undefined
      ? undefined
      : validateCertificateLocation(target.certificateLocation, 'assetContext.target.certificateLocation'),
    metadata: metadataRecord(target.metadata, 'assetContext.target.metadata'),
  };
}

function validateDeployment(input: unknown): DeploymentAssetContextV1['deployment'] {
  const deployment = record(input, 'assetContext.deployment');
  rejectUnknown(deployment, deploymentKeys, 'assetContext.deployment');
  if (!Array.isArray(deployment.targets) || deployment.targets.length === 0) {
    throw validationError('assetContext.deployment.targets 必须是非空数组', { path: 'assetContext.deployment.targets' });
  }
  return {
    targets: deployment.targets.map((target, index) => validateDeploymentTarget(target, index)),
    certificateResourceName: nonEmptyString(deployment.certificateResourceName, 'assetContext.deployment.certificateResourceName'),
  };
}

function validateDeploymentTarget(input: unknown, index: number): DeploymentAssetContextV1['deployment']['targets'][number] {
  const path = `assetContext.deployment.targets.${index}`;
  const target = record(input, path);
  rejectUnknown(target, deploymentTargetKeys, path);
  return {
    id: optionalString(target.id, `${path}.id`),
    name: nonEmptyString(target.name, `${path}.name`),
    serverName: optionalString(target.serverName, `${path}.serverName`),
    port: target.port === undefined ? undefined : portNumber(target.port, `${path}.port`),
    sni: optionalBoolean(target.sni, `${path}.sni`),
    certificateLocation: target.certificateLocation === undefined
      ? undefined
      : validateCertificateLocation(target.certificateLocation, `${path}.certificateLocation`),
    metadata: metadataRecord(target.metadata, `${path}.metadata`),
  };
}

function validateCertificateLocation(input: unknown, path: string): CertificateLocationV1 {
  const location = record(input, path);
  rejectUnknown(location, certificateLocationKeys, path);
  requireExact(location.apiVersion, CERTIFICATE_LOCATION_API_VERSION, `${path}.apiVersion`);
  const storageKind = enumValue(location.storageKind, ['PEM_FILES', 'KEYSTORE', 'WINDOWS_CERTIFICATE_STORE'], `${path}.storageKind`);
  const certificatePath = optionalString(location.certificatePath, `${path}.certificatePath`);
  const privateKeyPath = optionalString(location.privateKeyPath, `${path}.privateKeyPath`);
  const keystorePath = optionalString(location.keystorePath, `${path}.keystorePath`);
  const storeThumbprint = optionalString(location.storeThumbprint, `${path}.storeThumbprint`);
  for (const [key, value] of [['certificatePath', certificatePath], ['privateKeyPath', privateKeyPath], ['chainPath', location.chainPath], ['keystorePath', keystorePath]] as const) {
    if (typeof value === 'string' && value.trim().toLowerCase().startsWith('windows-tls://')) {
      throw validationError(`${path}.${key} 不能使用 TLS 握手观测路径`, { path: `${path}.${key}` });
    }
  }
  if (!certificatePath && !privateKeyPath && !keystorePath && !storeThumbprint) {
    throw validationError(`${path} 缺少证书位置字段`, { path });
  }
  return {
    apiVersion: CERTIFICATE_LOCATION_API_VERSION,
    storageKind,
    certificatePath,
    privateKeyPath,
    chainPath: optionalString(location.chainPath, `${path}.chainPath`),
    keystorePath,
    keystoreType: location.keystoreType === undefined ? undefined : enumValue(location.keystoreType, ['JKS', 'PKCS12', 'PEM', 'UNKNOWN'], `${path}.keystoreType`),
    keyAlias: optionalString(location.keyAlias, `${path}.keyAlias`),
    storeName: optionalString(location.storeName, `${path}.storeName`),
    storeLocation: optionalString(location.storeLocation, `${path}.storeLocation`),
    storeThumbprint,
    sourceConfigPath: optionalString(location.sourceConfigPath, `${path}.sourceConfigPath`),
    serviceName: optionalString(location.serviceName, `${path}.serviceName`),
    programPath: optionalString(location.programPath, `${path}.programPath`),
    programSha256: optionalString(location.programSha256, `${path}.programSha256`),
    workingDirectory: optionalString(location.workingDirectory, `${path}.workingDirectory`),
    testCommand: optionalString(location.testCommand, `${path}.testCommand`),
    reloadCommand: optionalString(location.reloadCommand, `${path}.reloadCommand`),
    configFingerprint: optionalString(location.configFingerprint, `${path}.configFingerprint`),
    confidence: enumValue(location.confidence, ['EXACT', 'INFERRED', 'UNKNOWN'], `${path}.confidence`),
    observedAt: nonEmptyString(location.observedAt, `${path}.observedAt`),
    warnings: optionalStringArray(location.warnings, `${path}.warnings`),
  };
}

function metadataRecord(input: unknown, path: string): Record<string, unknown> {
  if (!isRecord(input)) throw validationError(`${path} 必须是对象`, { path });
  return { ...input };
}

function portNumber(input: unknown, path: string): number {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 1 || input > 65535) {
    throw validationError(`${path} 必须是 1 到 65535 的整数`, { path });
  }
  return input;
}

function optionalBoolean(input: unknown, path: string): boolean | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'boolean') throw validationError(`${path} 必须是布尔值`, { path });
  return input;
}

function optionalString(input: unknown, path: string): string | undefined {
  if (input === undefined) return undefined;
  return nonEmptyString(input, path);
}

function optionalStringArray(input: unknown, path: string): string[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw validationError(`${path} 必须是字符串数组`, { path });
  return input.map((item, index) => nonEmptyString(item, `${path}.${index}`));
}

function enumValue<const T extends string>(input: unknown, values: readonly T[], path: string): T {
  if (typeof input !== 'string' || !values.includes(input as T)) throw validationError(`${path} 不支持`, { path, values });
  return input as T;
}

function nonEmptyString(input: unknown, path: string): string {
  if (typeof input !== 'string' || input.trim() === '') throw validationError(`${path} 必须是非空字符串`, { path });
  return input.trim();
}

function record(input: unknown, path: string): Record<string, unknown> {
  if (!isRecord(input)) throw validationError(`${path} 必须是对象`, { path });
  return input;
}

function requireExact(input: unknown, expected: string, path: string): void {
  if (input !== expected) throw validationError(`${path} 不支持`, { path, expected });
}

function rejectUnknown(input: Record<string, unknown>, allowed: Set<string>, path: string): void {
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw validationError(`${path} 包含未知字段`, { path, unknown });
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function validationError(message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError('DEPLOYMENT_ASSET_CONTEXT_INVALID', message, details);
}

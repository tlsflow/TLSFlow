import { AppError } from '../../../common/errors/app-error.js';
import type { AgentFactEnvelopeV1 } from '../../agents/security/agent-security.contract.js';
import type { StandardDeviceDiscoveryV2 } from '../discovery/device-discovery.dto.js';
import { DeviceDiscoverySchemaService } from '../discovery/device-discovery-schema.service.js';

const standardObjectApiVersions = new Set([
  'gcac.application/v1',
  'gcac.certificate-binding/v1',
  'gcac.ca-object/v1',
  'gcac.cloud-service/v1',
]);
const stableKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const forbiddenKeyPattern = /(password|secret|token|private[_-]?key|authorization|cookie)/i;

export type StandardPluginObject = Record<string, unknown>;

export interface StandardPluginObjectValidationContext {
  tenantId: string;
  pluginId: string;
  pluginVersionId: string;
  fact: AgentFactEnvelopeV1;
}

/**
 * 插件结果只能以稳定的标准对象进入宿主主链。
 * 这里按协议版本分派 Schema，不读取产品名，也不调用插件代码。
 */
export class StandardPluginObjectSchemaService {
  constructor(private readonly deviceDiscovery = new DeviceDiscoverySchemaService()) {}

  validateMany(input: unknown, context: StandardPluginObjectValidationContext): StandardPluginObject[] {
    if (!Array.isArray(input) || input.length === 0 || input.length > 200) {
      throw invalid('normalizedObjects', '插件必须返回一个有界且非空的标准对象数组');
    }
    return input.map((item, index) => this.validateOne(item, context, `normalizedObjects.${index}`));
  }

  private validateOne(input: unknown, context: StandardPluginObjectValidationContext, path: string): StandardPluginObject {
    if (!isRecord(input)) throw invalid(path, '标准对象必须是对象');
    if (input.apiVersion === 'gcac.device-discovery/v2') {
      const discovery = this.deviceDiscovery.validate(input) as unknown as StandardDeviceDiscoveryV2;
      assertProvenance(discovery.device.metadata, context, path);
      return discovery as unknown as StandardPluginObject;
    }
    if (typeof input.apiVersion !== 'string' || !standardObjectApiVersions.has(input.apiVersion)) {
      throw invalid(`${path}.apiVersion`, '插件返回了未登记的标准对象版本');
    }
    if (typeof input.kind !== 'string' || !/^[A-Za-z][A-Za-z0-9.-]{0,127}$/.test(input.kind)) {
      throw invalid(`${path}.kind`, '标准对象 kind 无效');
    }
    if (typeof input.stableKey !== 'string' || !stableKeyPattern.test(input.stableKey)) {
      throw invalid(`${path}.stableKey`, '标准对象 stableKey 无效');
    }
    if (input.tenantId !== undefined && input.tenantId !== context.tenantId) {
      throw new AppError('TENANT_SCOPE_DENIED', '插件标准对象租户与事实租户不一致', { path });
    }
    if (input.pluginId !== undefined && input.pluginId !== context.pluginId) {
      throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '插件标准对象 Plugin ID 与执行绑定不一致', { path });
    }
    if (input.pluginVersionId !== undefined && input.pluginVersionId !== context.pluginVersionId) {
      throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '插件标准对象 PluginVersion 与执行绑定不一致', { path });
    }
    assertNoSecrets(input, path);
    return structuredClone(input);
  }
}

function assertProvenance(metadata: unknown, context: StandardPluginObjectValidationContext, path: string): void {
  if (!isRecord(metadata)) return;
  if (metadata.tenantId !== undefined && metadata.tenantId !== context.tenantId) {
    throw new AppError('TENANT_SCOPE_DENIED', '设备发现对象租户与事实租户不一致', { path });
  }
  if (metadata.pluginId !== undefined && metadata.pluginId !== context.pluginId) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '设备发现对象 Plugin ID 与执行绑定不一致', { path });
  }
  if (metadata.pluginVersionId !== undefined && metadata.pluginVersionId !== context.pluginVersionId) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '设备发现对象 PluginVersion 与执行绑定不一致', { path });
  }
}

function assertNoSecrets(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeyPattern.test(key)) {
      throw new AppError('VALIDATION_FAILED', '插件标准对象包含敏感字段', { path: `${path}.${key}` });
    }
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalid(path: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, { code: 'STANDARD_PLUGIN_OBJECT_INVALID', path });
}

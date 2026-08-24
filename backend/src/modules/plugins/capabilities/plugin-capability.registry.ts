import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedPluginCapabilityDescriptor } from '../dto/unified-plugins.dto.js';

export type PluginCapabilityRisk = 'LOW' | 'MEDIUM' | 'HIGH';
export type PluginCapabilityIdempotency = 'READ_ONLY' | 'IDEMPOTENT_WRITE' | 'NON_IDEMPOTENT_WRITE';

export interface PluginCapabilityContract {
  key: string;
  contractVersion: string;
  actionContractId: string;
  riskLevel: PluginCapabilityRisk;
  idempotency: PluginCapabilityIdempotency;
  permission: string;
  inputSchemaId: string;
  outputSchemaId: string;
  resourceLock: 'NONE' | 'DEVICE' | 'TARGET';
  executionLocations: Array<'AGENT' | 'CONTROL_PLANE' | 'GATEWAY'>;
}

const contracts: PluginCapabilityContract[] = [
  contract('device.connection.test', 'device.connection.test.v1', 'LOW', 'READ_ONLY', 'device.read', 'gcac.connection-test-input/v1', 'gcac.connection-test-result/v1', 'NONE'),
  contract('device.identity.detect', 'device.identity.detect.v1', 'LOW', 'READ_ONLY', 'device.read', 'gcac.device-identity-input/v1', 'gcac.device-identity-result/v1', 'NONE'),
  contract('device.discover', 'device.discover.v1', 'LOW', 'READ_ONLY', 'device.read', 'gcac.device-discovery-input/v1', 'gcac.device-discovery/v1', 'DEVICE'),
  contract('device.logs.read', 'device.logs.read.v1', 'LOW', 'READ_ONLY', 'device.read', 'gcac.device-logs-query/v1', 'gcac.device-logs-page/v1', 'NONE'),
  contract('certificate.discover', 'certificate.discover.v1', 'LOW', 'READ_ONLY', 'certificate.read', 'gcac.certificate-discovery-input/v1', 'gcac.device-discovery/v1', 'DEVICE'),
  contract('certificate.deploy', 'certificate.deploy.v1', 'HIGH', 'IDEMPOTENT_WRITE', 'certificate.deploy', 'gcac.certificate-deploy-input/v1', 'gcac.certificate-deploy-result/v1', 'TARGET'),
  contract('certificate.rollback', 'certificate.rollback.v1', 'HIGH', 'IDEMPOTENT_WRITE', 'certificate.deploy', 'gcac.certificate-rollback-input/v1', 'gcac.certificate-deploy-result/v1', 'TARGET'),
];

export class PluginCapabilityRegistry {
  private readonly byKey = new Map(contracts.map((item) => [item.key, item]));

  list(): PluginCapabilityContract[] {
    return structuredClone(contracts);
  }

  require(key: string): PluginCapabilityContract {
    const item = this.byKey.get(key);
    if (!item) throw new AppError('VALIDATION_FAILED', '插件声明了宿主不支持的能力', { capabilityKey: key });
    return structuredClone(item);
  }

  validate(descriptor: UnifiedPluginCapabilityDescriptor): PluginCapabilityContract {
    const expected = this.require(descriptor.key);
    const errors: string[] = [];
    if (descriptor.contractVersion !== expected.contractVersion) errors.push('contractVersion');
    if (descriptor.actionContractId !== expected.actionContractId) errors.push('actionContractId');
    if (descriptor.riskLevel !== expected.riskLevel) errors.push('riskLevel');
    if (descriptor.executionLocations.some((location) => !expected.executionLocations.includes(location))) errors.push('executionLocations');
    if (errors.length > 0) {
      throw new AppError('VALIDATION_FAILED', '插件能力声明与宿主 Contract 不一致', {
        capabilityKey: descriptor.key,
        invalidFields: errors,
      });
    }
    return expected;
  }
}

function contract(
  key: string,
  actionContractId: string,
  riskLevel: PluginCapabilityRisk,
  idempotency: PluginCapabilityIdempotency,
  permission: string,
  inputSchemaId: string,
  outputSchemaId: string,
  resourceLock: PluginCapabilityContract['resourceLock'],
): PluginCapabilityContract {
  return {
    key,
    contractVersion: 'v1',
    actionContractId,
    riskLevel,
    idempotency,
    permission,
    inputSchemaId,
    outputSchemaId,
    resourceLock,
    executionLocations: ['AGENT', 'CONTROL_PLANE', 'GATEWAY'],
  };
}

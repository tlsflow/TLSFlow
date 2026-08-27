import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedPluginCapabilityDescriptor } from '../dto/unified-plugins.dto.js';

export type PluginCapabilityRisk = 'LOW' | 'MEDIUM' | 'HIGH';
export type PluginCapabilityIdempotency = 'READ_ONLY' | 'IDEMPOTENT_WRITE' | 'NON_IDEMPOTENT_WRITE';

/** credential.acquire 的输入/输出合同 ID，Manifest 校验与能力注册表共用同一来源。 */
export const CREDENTIAL_ACQUIRE_INPUT_SCHEMA_ID = 'gcac.credential-acquire-input/v1' as const;
export const CREDENTIAL_OUTPUT_SCHEMA_ID = 'gcac.credential-output/v1' as const;

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
  contract('application.discover', 'application.discover.v1', 'LOW', 'READ_ONLY', 'application.read', 'gcac.application-discovery-input/v1', 'gcac.application-discovery/v1', 'NONE'),
  contract('device.connection.test', 'device.connection.test.v1', 'LOW', 'READ_ONLY', 'device.read', 'gcac.connection-test-input/v1', 'gcac.connection-test-result/v1', 'NONE'),
  contract('device.identity.detect', 'device.identity.detect.v1', 'LOW', 'READ_ONLY', 'device.read', 'gcac.device-identity-input/v1', 'gcac.device-identity-result/v1', 'NONE'),
  contract('device.discover', 'device.discover.v1', 'LOW', 'READ_ONLY', 'device.read', 'gcac.device-discovery-input/v1', 'gcac.device-discovery/v2', 'DEVICE'),
  contract('credential.health-check', 'credential.health-check.v1', 'LOW', 'READ_ONLY', 'credential.read', 'gcac.credential-health-check-input/v1', 'gcac.credential-health-result/v1', 'DEVICE'),
  contract('device.logs.read', 'device.logs.read.v1', 'LOW', 'READ_ONLY', 'device.read', 'gcac.device-logs-query/v1', 'gcac.device-logs-page/v1', 'NONE'),
  contract('certificate.discover', 'certificate.discover.v1', 'LOW', 'READ_ONLY', 'certificate.read', 'gcac.certificate-discovery-input/v1', 'gcac.device-discovery/v2', 'DEVICE'),
  contract('certificate.verify', 'certificate.verify.v1', 'MEDIUM', 'READ_ONLY', 'certificate.read', 'gcac.certificate-verify-input/v1', 'gcac.certificate-verify-result/v1', 'TARGET'),
  contract('certificate.deploy', 'certificate.deploy.v1', 'HIGH', 'IDEMPOTENT_WRITE', 'certificate.deploy', 'gcac.certificate-deploy-input/v1', 'gcac.certificate-deploy-result/v1', 'TARGET'),
  contract('certificate.rollback', 'certificate.rollback.v1', 'HIGH', 'IDEMPOTENT_WRITE', 'certificate.deploy', 'gcac.certificate-rollback-input/v1', 'gcac.certificate-deploy-result/v1', 'TARGET'),
  contract('cloud.service.connection-test', 'cloud.service.connection-test.v1', 'LOW', 'READ_ONLY', 'cloud.service.read', 'gcac.cloud-service-connection-test-input/v1', 'gcac.cloud-service-connection-test-result/v1', 'NONE'),
  contract('cloud.service.discover', 'cloud.service.discover.v1', 'LOW', 'READ_ONLY', 'cloud.service.read', 'gcac.cloud-service-discovery-input/v1', 'gcac.cloud-service-discovery-result/v1', 'NONE'),
  contract('ca.account.manage', 'ca.account.manage.v1', 'HIGH', 'IDEMPOTENT_WRITE', 'ca.account.manage', 'gcac.ca-account-input/v1', 'gcac.ca-account-result/v1', 'NONE'),
  contract('ca.order.manage', 'ca.order.manage.v1', 'HIGH', 'IDEMPOTENT_WRITE', 'ca.order.manage', 'gcac.ca-order-input/v1', 'gcac.ca-order-result/v1', 'NONE'),
  contract('ca.challenge.orchestrate', 'ca.challenge.orchestrate.v1', 'HIGH', 'IDEMPOTENT_WRITE', 'ca.challenge.manage', 'gcac.ca-challenge-input/v1', 'gcac.ca-challenge-result/v1', 'NONE'),
  contract('ca.challenge.dns-solver', 'ca.challenge.dns-solver.v1', 'HIGH', 'IDEMPOTENT_WRITE', 'ca.challenge.manage', 'gcac.ca-dns-solver-input/v1', 'gcac.ca-dns-solver-result/v1', 'NONE'),
  contract('ca.certificate.issue', 'ca.certificate.issue.v1', 'HIGH', 'IDEMPOTENT_WRITE', 'ca.certificate.manage', 'gcac.ca-certificate-issue-input/v1', 'gcac.ca-certificate-issue-result/v1', 'NONE'),
  contract('ca.certificate.renew', 'ca.certificate.renew.v1', 'HIGH', 'IDEMPOTENT_WRITE', 'ca.certificate.manage', 'gcac.ca-certificate-renew-input/v1', 'gcac.ca-certificate-renew-result/v1', 'NONE'),
  contract('ca.certificate.revoke', 'ca.certificate.revoke.v1', 'HIGH', 'IDEMPOTENT_WRITE', 'ca.certificate.manage', 'gcac.ca-certificate-revoke-input/v1', 'gcac.ca-certificate-revoke-result/v1', 'NONE'),
  contract('ca.certificate.query', 'ca.certificate.query.v1', 'MEDIUM', 'READ_ONLY', 'ca.operations.read', 'gcac.ca-certificate-query-input/v1', 'gcac.ca-certificate-query-result/v1', 'NONE'),
  contract('ca.certificate.list', 'ca.certificate.list.v1', 'MEDIUM', 'READ_ONLY', 'ca.operations.read', 'gcac.ca-certificate-list-input/v1', 'gcac.ca-certificate-list-result/v1', 'NONE'),
  contract('ca.revocation.evidence', 'ca.revocation.evidence.v1', 'MEDIUM', 'READ_ONLY', 'ca.operations.read', 'gcac.ca-revocation-evidence-input/v1', 'gcac.ca-revocation-evidence-result/v1', 'NONE'),
  {
    key: 'credential.acquire',
    contractVersion: 'v1',
    actionContractId: 'credential.acquire.v1',
    riskLevel: 'HIGH',
    idempotency: 'READ_ONLY',
    permission: 'credential.create',
    inputSchemaId: CREDENTIAL_ACQUIRE_INPUT_SCHEMA_ID,
    outputSchemaId: CREDENTIAL_OUTPUT_SCHEMA_ID,
    resourceLock: 'NONE',
    executionLocations: ['CONTROL_PLANE'],
  },
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

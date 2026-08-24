import { AppError } from '../../../common/errors/app-error.js';
import type { ManagedDeviceDetailDto, ManagedDeviceListQuery, ManagedDevicePageDto } from '../dto/devices.dto.js';
import type { DeviceOnboardingPlatformDescriptor } from '../dto/devices.dto.js';
import { DevicePlatformRegistry } from '../domain/device-platform.registry.js';
import type { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import type { DeviceAssetsApplicationService } from '../../device-assets/application/device-assets.application-service.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type { CreateManagedDeviceOnboardingDto } from '../dto/devices.dto.js';
import { PgDevicesRepository, type DevicesRepository } from '../repository/devices.repository.js';

export class DevicesApplicationService {
  constructor(
    private readonly repository: DevicesRepository = new PgDevicesRepository(),
    private readonly platformRegistry = new DevicePlatformRegistry(),
    private readonly agents?: AgentsApplicationService,
    private readonly deviceAssets?: DeviceAssetsApplicationService,
    private readonly secrets?: SecretService,
  ) {}

  list(tenantId: string, query: ManagedDeviceListQuery): Promise<ManagedDevicePageDto> {
    return this.repository.list(tenantId, query);
  }

  async get(tenantId: string, deviceId: string): Promise<ManagedDeviceDetailDto> {
    const device = await this.repository.get(tenantId, deviceId);
    if (!device) throw new AppError('RESOURCE_NOT_FOUND', '设备不存在', { deviceId });
    return device;
  }

  listOnboardingPlatforms(): DeviceOnboardingPlatformDescriptor[] {
    return this.platformRegistry.list();
  }

  async onboard(tenantId: string, input: CreateManagedDeviceOnboardingDto, actorId: string, requestId: string) {
    const platform = this.platformRegistry.requireSupported(input.platformKey);
    if (platform.onboardingKind === 'AGENT_INSTALL') {
      if (!this.agents) throw new AppError('CAPABILITY_MISSING', 'Agent 安装服务未注册');
      const baseUrl = input.baseUrl?.trim();
      if (!baseUrl) throw new AppError('VALIDATION_FAILED', 'Agent 安装需要 baseUrl', { field: 'baseUrl' });
      const options = { displayName: input.displayName };
      if (platform.handlerKey === 'WINDOWS_GO') return this.agents.createWindowsPowerShellInstallSession(tenantId, options, requestId, baseUrl);
      if (platform.handlerKey === 'WINDOWS_COMPATIBILITY') return this.agents.createWindowsCompatibilityInstallSession(tenantId, options, requestId, baseUrl);
      return this.agents.createLinuxGoInstallSession(tenantId, options, requestId, baseUrl);
    }
    if (!this.deviceAssets || !this.secrets) throw new AppError('CAPABILITY_MISSING', '设备添加服务未注册');
    if (input.tlsVerify === false && input.insecureTlsAcknowledged !== true) {
      throw new AppError('VALIDATION_FAILED', '关闭 TLS 验证必须显式确认高风险', { field: 'insecureTlsAcknowledged' });
    }
    const credentialId = input.credentialId ?? await this.createCredential(tenantId, input, actorId);
    const device = await this.deviceAssets.create(tenantId, {
      displayName: required(input.displayName, 'displayName'),
      managementAddress: required(input.managementAddress, 'managementAddress'),
      managementPort: input.managementPort,
      deviceFamily: 'NETSCALER_ADC',
      credentialId,
      authMode: input.authMode,
      tlsVerify: input.tlsVerify,
    });
    const connection = await this.deviceAssets.testConnection(tenantId, device.id, actorId);
    return { device, connection };
  }

  private async createCredential(tenantId: string, input: CreateManagedDeviceOnboardingDto, actorId: string): Promise<string> {
    const username = required(input.username, 'username');
    const password = required(input.password, 'password');
    const secret = await this.secrets!.create({
      name: `Citrix ADC ${input.displayName ?? input.managementAddress ?? ''}`.trim(),
      type: 'password',
      scopeType: 'team',
      scopeId: tenantId,
      plainText: JSON.stringify({ username, password }),
      createdBy: actorId,
      metadata: { purpose: 'netscaler.nitro.credentials' },
    });
    return secret.secretRef;
  }
}

function required(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  return normalized;
}

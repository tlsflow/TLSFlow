import { AppError } from '../../../common/errors/app-error.js';
import type { ManagedDeviceDetailDto, ManagedDeviceListQuery, ManagedDevicePageDto } from '../dto/devices.dto.js';
import type { DeviceOnboardingPlatformDescriptor } from '../dto/devices.dto.js';
import { DevicePlatformRegistry } from '../domain/device-platform.registry.js';
import { PgDevicesRepository, type DevicesRepository } from '../repository/devices.repository.js';

export class DevicesApplicationService {
  constructor(
    private readonly repository: DevicesRepository = new PgDevicesRepository(),
    private readonly platformRegistry = new DevicePlatformRegistry(),
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
}

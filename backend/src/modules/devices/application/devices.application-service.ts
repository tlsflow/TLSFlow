import type { ManagedDeviceListQuery, ManagedDevicePageDto } from '../dto/devices.dto.js';
import { PgDevicesRepository, type DevicesRepository } from '../repository/devices.repository.js';

export class DevicesApplicationService {
  constructor(private readonly repository: DevicesRepository = new PgDevicesRepository()) {}

  list(tenantId: string, query: ManagedDeviceListQuery): Promise<ManagedDevicePageDto> {
    return this.repository.list(tenantId, query);
  }
}

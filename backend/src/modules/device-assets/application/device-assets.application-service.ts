import { AppError } from '../../../common/errors/app-error.js';
import type { CreateDeviceAssetDto, DeviceAssetDto, UpdateDeviceAssetDto } from '../dto/device-assets.dto.js';
import { DeviceAssetsDomainService } from '../domain/device-assets.domain-service.js';
import type { DeviceAssetsRepository } from '../repository/device-assets.repository.js';

export interface DeviceConnectionTestResult {
  reachable: boolean;
  authenticated: boolean;
  productMatched: boolean;
  productName?: string;
  softwareVersion?: string;
  softwareBuild?: string;
  supportLevel?: string;
  capabilities: Record<string, unknown>;
  warnings: string[];
  errorCode?: string;
}

export interface DeviceConnectionTester {
  test(device: DeviceAssetDto, actorId: string): Promise<DeviceConnectionTestResult>;
}

export class DeviceAssetsApplicationService {
  constructor(
    private readonly repository: DeviceAssetsRepository,
    private readonly connectionTester?: DeviceConnectionTester,
    private readonly domain = new DeviceAssetsDomainService(),
  ) {}

  list(tenantId: string): Promise<DeviceAssetDto[]> {
    return this.repository.list(tenantId);
  }

  async get(tenantId: string, deviceAssetId: string): Promise<DeviceAssetDto> {
    const item = await this.repository.get(tenantId, deviceAssetId);
    if (!item) throw new AppError('RESOURCE_NOT_FOUND', '设备资产不存在', { deviceAssetId });
    return item;
  }

  create(tenantId: string, input: CreateDeviceAssetDto): Promise<DeviceAssetDto> {
    return this.repository.create(tenantId, this.domain.normalizeCreate(input));
  }

  update(tenantId: string, deviceAssetId: string, input: UpdateDeviceAssetDto): Promise<DeviceAssetDto> {
    return this.repository.update(tenantId, deviceAssetId, this.domain.normalizeUpdate(input));
  }

  delete(tenantId: string, deviceAssetId: string): Promise<DeviceAssetDto> {
    return this.repository.softDelete(tenantId, deviceAssetId);
  }

  async testConnection(tenantId: string, deviceAssetId: string, actorId: string): Promise<DeviceConnectionTestResult> {
    if (!this.connectionTester) {
      throw new AppError('CAPABILITY_MISSING', 'NetScaler NITRO 连接测试尚未注册', { code: 'NETSCALER_CAPABILITY_MISSING' });
    }
    return this.connectionTester.test(await this.get(tenantId, deviceAssetId), actorId);
  }
}

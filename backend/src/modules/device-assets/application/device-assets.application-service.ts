import { AppError } from '../../../common/errors/app-error.js';
import type { CreateDeviceAssetDto, DeviceAssetDto, UpdateDeviceAssetDto } from '../dto/device-assets.dto.js';
import { DeviceAssetsDomainService } from '../domain/device-assets.domain-service.js';
import type { DeviceAssetsRepository } from '../repository/device-assets.repository.js';
import type { ApplicationExecutionCompatibilityService } from '../../assets/application/application-execution-compatibility.service.js';

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
  certificateCount?: number;
  fingerprintedCertificateCount?: number;
  errorCode?: string;
}

export interface DeviceConnectionTester {
  test(device: DeviceAssetDto, actorId: string): Promise<DeviceConnectionTestResult>;
}

export class DeviceAssetsApplicationService {
  private executionCompatibility?: Pick<ApplicationExecutionCompatibilityService, 'recheckDeviceAsset'>;

  constructor(
    private readonly repository: DeviceAssetsRepository,
    private readonly connectionTester?: DeviceConnectionTester,
    private readonly domain = new DeviceAssetsDomainService(),
  ) {}

  setApplicationExecutionCompatibilityService(service?: Pick<ApplicationExecutionCompatibilityService, 'recheckDeviceAsset'>): void {
    this.executionCompatibility = service;
  }

  list(tenantId: string): Promise<DeviceAssetDto[]> {
    return this.repository.list(tenantId);
  }

  async get(tenantId: string, deviceAssetId: string): Promise<DeviceAssetDto> {
    const item = await this.repository.get(tenantId, deviceAssetId);
    if (!item) throw new AppError('RESOURCE_NOT_FOUND', '设备资产不存在', { deviceAssetId });
    return item;
  }

  async create(tenantId: string, input: CreateDeviceAssetDto): Promise<DeviceAssetDto> {
    const created = await this.repository.create(tenantId, this.domain.normalizeCreate(input));
    await this.executionCompatibility?.recheckDeviceAsset(tenantId, created.id);
    return created;
  }

  async update(tenantId: string, deviceAssetId: string, input: UpdateDeviceAssetDto): Promise<DeviceAssetDto> {
    const updated = await this.repository.update(tenantId, deviceAssetId, this.domain.normalizeUpdate(input));
    await this.executionCompatibility?.recheckDeviceAsset(tenantId, updated.id);
    return updated;
  }

  async delete(tenantId: string, deviceAssetId: string): Promise<DeviceAssetDto> {
    const deleted = await this.repository.softDelete(tenantId, deviceAssetId);
    await this.executionCompatibility?.recheckDeviceAsset(tenantId, deleted.id);
    return deleted;
  }

  async testConnection(tenantId: string, deviceAssetId: string, actorId: string): Promise<DeviceConnectionTestResult> {
    return this.runDiscovery(tenantId, deviceAssetId, actorId);
  }

  async discover(tenantId: string, deviceAssetId: string, actorId: string): Promise<DeviceConnectionTestResult> {
    return this.runDiscovery(tenantId, deviceAssetId, actorId);
  }

  private async runDiscovery(tenantId: string, deviceAssetId: string, actorId: string): Promise<DeviceConnectionTestResult> {
    if (!this.connectionTester) {
      throw new AppError('CAPABILITY_MISSING', '设备连接与发现必须通过统一插件能力执行', { code: 'DEVICE_PLUGIN_CAPABILITY_REQUIRED' });
    }
    return this.connectionTester.test(await this.get(tenantId, deviceAssetId), actorId);
  }
}

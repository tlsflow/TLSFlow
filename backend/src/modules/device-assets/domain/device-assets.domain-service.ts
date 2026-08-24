import { AppError } from '../../../common/errors/app-error.js';
import type { CreateDeviceAssetDto, UpdateDeviceAssetDto } from '../dto/device-assets.dto.js';

export class DeviceAssetsDomainService {
  normalizeCreate(input: CreateDeviceAssetDto): Required<Pick<CreateDeviceAssetDto, 'managementPort' | 'authMode' | 'tlsVerify'>> & CreateDeviceAssetDto {
    const managementAddress = normalizeAddress(input.managementAddress);
    const displayName = input.displayName.trim();
    const credentialId = input.credentialId.trim();
    if (!displayName) throw new AppError('VALIDATION_FAILED', '设备名称不能为空', { field: 'displayName' });
    if (!credentialId) throw new AppError('VALIDATION_FAILED', '设备凭据不能为空', { field: 'credentialId' });
    if (input.deviceFamily !== 'NETSCALER_ADC') throw new AppError('VALIDATION_FAILED', '不支持的设备类型', { deviceFamily: input.deviceFamily });
    const managementPort = input.managementPort ?? 443;
    if (!Number.isInteger(managementPort) || managementPort < 1 || managementPort > 65535) {
      throw new AppError('VALIDATION_FAILED', '管理端口必须在 1 到 65535 之间', { field: 'managementPort' });
    }
    return {
      ...input,
      displayName,
      managementAddress,
      credentialId,
      managementPort,
      authMode: input.authMode ?? 'AUTO',
      tlsVerify: input.tlsVerify ?? true,
      caSecretId: normalizeOptional(input.caSecretId),
      gatewayId: normalizeOptional(input.gatewayId),
    };
  }

  normalizeUpdate(input: UpdateDeviceAssetDto): UpdateDeviceAssetDto {
    const output: UpdateDeviceAssetDto = { ...input };
    if (input.displayName !== undefined) {
      output.displayName = input.displayName.trim();
      if (!output.displayName) throw new AppError('VALIDATION_FAILED', '设备名称不能为空', { field: 'displayName' });
    }
    if (input.managementAddress !== undefined) output.managementAddress = normalizeAddress(input.managementAddress);
    if (input.managementPort !== undefined && (!Number.isInteger(input.managementPort) || input.managementPort < 1 || input.managementPort > 65535)) {
      throw new AppError('VALIDATION_FAILED', '管理端口必须在 1 到 65535 之间', { field: 'managementPort' });
    }
    if (input.credentialId !== undefined) {
      output.credentialId = input.credentialId.trim();
      if (!output.credentialId) throw new AppError('VALIDATION_FAILED', '设备凭据不能为空', { field: 'credentialId' });
    }
    if (input.caSecretId !== undefined) output.caSecretId = normalizeOptional(input.caSecretId);
    if (input.gatewayId !== undefined) output.gatewayId = normalizeOptional(input.gatewayId);
    return output;
  }
}

function normalizeAddress(value: string): string {
  const address = value.trim().toLowerCase();
  if (!address || address.includes('/') || /^https?:\/\//.test(address)) {
    throw new AppError('VALIDATION_FAILED', '管理地址必须是 IP 或 DNS，不能包含协议和路径', { field: 'managementAddress' });
  }
  if (!/^[a-z0-9:[\]._-]+$/i.test(address)) {
    throw new AppError('VALIDATION_FAILED', '管理地址格式无效', { field: 'managementAddress' });
  }
  return address;
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

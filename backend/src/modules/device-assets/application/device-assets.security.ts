import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import type { DeviceAssetDto } from '../dto/device-assets.dto.js';

export type DeviceAssetAccessLevel = 'read' | 'edit' | 'control';

export interface DeviceAssetSecurityPort {
  assertAccess(request: HttpRequest, accessLevel: DeviceAssetAccessLevel, deviceAssetId?: string): Promise<void>;
  audit(request: HttpRequest, eventType: string, action: string, deviceAssetId: string, detail: Record<string, unknown>): Promise<void>;
}

export class SecurityServicesDeviceAssetPort implements DeviceAssetSecurityPort {
  constructor(private readonly security: SecurityServices) {}

  async assertAccess(request: HttpRequest, accessLevel: DeviceAssetAccessLevel, deviceAssetId = '*'): Promise<void> {
    const actorId = request.context.actorId;
    if (!actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    const decision = await this.security.objectPermissions.can(
      { id: actorId, type: 'user', scope: { tenantId: request.context.tenantId } },
      accessLevel,
      { objectType: 'device_asset', objectId: deviceAssetId, tenantId: request.context.tenantId },
      securityContext(request),
    );
    if (!decision.allowed) throw new AppError('AUTH_FORBIDDEN', '无权访问设备资产', { deviceAssetId, accessLevel });
  }

  async audit(request: HttpRequest, eventType: string, action: string, deviceAssetId: string, detail: Record<string, unknown>): Promise<void> {
    await this.security.audit.write({
      eventType,
      actorType: request.context.actorId ? 'user' : 'system',
      actorId: request.context.actorId ?? 'system',
      action,
      resourceType: 'device_asset',
      resourceId: deviceAssetId,
      result: 'success',
      riskLevel: accessRisk(action),
      context: securityContext(request),
      detail: sanitizeDeviceAuditDetail(detail),
      failClosed: action.includes('delete') || action.includes('test_connection'),
    });
  }
}

export function deviceAuditSummary(device: DeviceAssetDto): Record<string, unknown> {
  return {
    deviceFamily: device.deviceFamily,
    managementAddress: device.managementAddress,
    managementPort: device.managementPort,
    authMode: device.authMode,
    tlsVerify: device.tlsVerify,
    supportTier: device.supportTier,
  };
}

function securityContext(request: HttpRequest) {
  return { requestId: request.context.requestId, sourceIp: request.context.ip };
}

function accessRisk(action: string): 'low' | 'medium' | 'high' {
  if (action.includes('delete') || action.includes('test_connection')) return 'high';
  if (action.includes('create') || action.includes('update')) return 'medium';
  return 'low';
}

function sanitizeDeviceAuditDetail(detail: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(detail).filter(([key]) => !/(password|cookie|secret|credential)/i.test(key)));
}

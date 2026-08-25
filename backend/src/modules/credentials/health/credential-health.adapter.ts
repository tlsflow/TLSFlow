import { AppError } from '../../../common/errors/app-error.js';
import type { DevicesApplicationService } from '../../devices/application/devices.application-service.js';
import type { CredentialHealthAdapter, CredentialHealthAdapterInput, CredentialHealthAdapterResult } from './credential-health.types.js';
import { classifyCredentialHealthError } from './credential-health.types.js';

export interface CredentialHealthCapabilityExecutor {
  executeCapability(tenantId: string, deviceId: string, capabilityKey: string, actorId?: string, requestId?: string): Promise<unknown>;
}

/** 统一适配器只接受插件显式声明的 capability；不按厂商名称猜测登录方式。 */
export class CredentialHealthAdapterRegistry {
  private readonly adapters = new Map<string, CredentialHealthAdapter>();
  register(adapter: CredentialHealthAdapter): this { if (this.adapters.has(adapter.capabilityKey)) throw new AppError('RESOURCE_ALREADY_EXISTS', '凭据检测适配器重复注册', { capabilityKey: adapter.capabilityKey }); this.adapters.set(adapter.capabilityKey, adapter); return this; }
  resolve(capabilityKey = 'credential.health-check'): CredentialHealthAdapter { const adapter = this.adapters.get(capabilityKey); if (!adapter) throw new AppError('CAPABILITY_MISSING', '凭据检测适配器未注册', { capabilityKey }); return adapter; }
}

export class DeviceWorkflowCredentialHealthAdapter implements CredentialHealthAdapter {
  readonly capabilityKey = 'credential.health-check';
  constructor(private readonly devices: CredentialHealthCapabilityExecutor | DevicesApplicationService) {}
  async check(input: CredentialHealthAdapterInput): Promise<CredentialHealthAdapterResult> {
    const deviceId = input.device.hostId ?? input.device.id;
    try {
      const result = await this.devices.executeCapability(input.tenantId, deviceId, this.capabilityKey, 'credential-health-worker', `credential-health:${input.credentialId}:${input.device.id}:${input.generation}`);
      const output = findHealthOutput(result);
      if (!output) return { status: 'ERROR', reasonCode: 'CHECK_RESULT_INVALID', summary: '插件未返回标准凭据检测结果合同', detail: { workflowRun: readId(result) } };
      return normalizeHealthOutput(output);
    } catch (error) { return classifyCredentialHealthError(error); }
  }
}

function findHealthOutput(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const root = value as Record<string, unknown>;
  for (const candidate of [root.credentialHealth, root.healthResult, root.output, root.projection]) {
    const health = readHealthResult(candidate);
    if (health) return health;
  }
  const steps = Array.isArray(root.stepResults) ? root.stepResults : [];
  for (const step of [...steps].reverse()) {
    const extracted = step && typeof step === 'object' && 'extracted' in step
      ? (step as { extracted?: unknown }).extracted
      : undefined;
    if (extracted && typeof extracted === 'object') {
      for (const candidate of [(extracted as Record<string, unknown>).credentialHealth, (extracted as Record<string, unknown>).healthResult, extracted]) {
        const health = readHealthResult(candidate);
        if (health) return health;
      }
    }
  }
  return undefined;
}

function readHealthResult(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if ('apiVersion' in candidate || 'status' in candidate) return candidate;
  for (const nested of [candidate.credentialHealth, candidate.healthResult]) {
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested as Record<string, unknown>;
  }
  return undefined;
}

function normalizeHealthOutput(value: Record<string, unknown>): CredentialHealthAdapterResult {
  if (value.apiVersion !== 'gcac.credential-health-result/v1') return { status: 'ERROR', reasonCode: 'CHECK_RESULT_INVALID', summary: '插件返回了不支持的检测结果合同' };
  const status = value.status;
  if (status !== 'VALID' && status !== 'ERROR' && status !== 'UNREACHABLE') return { status: 'ERROR', reasonCode: 'CHECK_RESULT_INVALID', summary: '插件检测结果状态无效' };
  const reasonCode = typeof value.reasonCode === 'string' ? value.reasonCode : undefined;
  return { status, ...(reasonCode ? { reasonCode } : {}), ...(typeof value.summary === 'string' ? { summary: value.summary.slice(0, 300) } : {}), detail: typeof value.evidence === 'object' && value.evidence ? value.evidence as Record<string, unknown> : {} };
}
function readId(value: unknown): string | undefined { return value && typeof value === 'object' && typeof (value as Record<string, unknown>).id === 'string' ? (value as Record<string, unknown>).id as string : undefined; }

export const credentialHealthStatuses = ['DISABLED', 'UNUSED', 'UNREACHABLE', 'VALID', 'ERROR'] as const;
export type CredentialHealthStatus = typeof credentialHealthStatuses[number];
export type CredentialHealthDeviceStatus = Exclude<CredentialHealthStatus, 'DISABLED' | 'UNUSED'>;

export const credentialHealthReasonCodes = [
  'PASSWORD_INVALID', 'TOKEN_REJECTED', 'CERTIFICATE_REJECTED', 'SECRET_UNREADABLE',
  'PROFILE_INVALID', 'CHECK_CAPABILITY_MISSING', 'NETWORK_UNREACHABLE',
  'REMOTE_SERVICE_ERROR', 'CHECK_RESULT_INVALID',
] as const;
export type CredentialHealthReasonCode = typeof credentialHealthReasonCodes[number];

export interface CredentialHealthState {
  tenantId: string;
  credentialId: string;
  status: CredentialHealthStatus;
  checkedAt?: string;
  nextCheckAt?: string;
  checkingTaskId?: string;
  profileVersion: number;
  generation: number;
  failureCount: number;
  reasonCode?: CredentialHealthReasonCode | string;
  reasonSummary?: string;
  deviceCount: number;
  updatedAt: string;
}

export interface CredentialHealthCheckRecord {
  id: string;
  tenantId: string;
  credentialId: string;
  deviceAssetId: string;
  taskId?: string;
  generation: number;
  profileVersion: number;
  resultStatus: CredentialHealthDeviceStatus;
  reasonCode?: CredentialHealthReasonCode | string;
  reasonSummary?: string;
  checkedAt: string;
  durationMs: number;
  pluginVersionId?: string;
  workflowVersionId?: string;
  secretVersionSummary?: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface CredentialHealthEligibility {
  eligible: boolean;
  profileVersion: number;
  status: CredentialHealthStatus;
  devices: CredentialHealthDevice[];
}

export interface CredentialHealthDevice {
  id: string;
  hostId?: string;
  displayName: string;
  address: string;
  port: number;
  deviceFamily: string;
  credentialId: string;
  pluginVersionId?: string;
  pluginBindingId?: string;
  version: number;
}

export interface CredentialHealthAdapterInput {
  tenantId: string;
  credentialId: string;
  profileVersion: number;
  device: CredentialHealthDevice;
  generation: number;
}

export interface CredentialHealthAdapterResult {
  status: CredentialHealthDeviceStatus;
  reasonCode?: CredentialHealthReasonCode | string;
  summary?: string;
  detail?: Record<string, unknown>;
  pluginVersionId?: string;
  workflowVersionId?: string;
  secretVersionSummary?: string;
}

export interface CredentialHealthAdapter {
  readonly capabilityKey: string;
  check(input: CredentialHealthAdapterInput): Promise<CredentialHealthAdapterResult>;
}

export function aggregateCredentialHealth(input: {
  profileStatus: string;
  deviceCount: number;
  results: readonly Pick<CredentialHealthCheckRecord, 'resultStatus'>[];
}): CredentialHealthStatus {
  if (input.profileStatus !== 'active') return 'DISABLED';
  if (input.deviceCount === 0) return 'UNUSED';
  if (input.results.some((item) => item.resultStatus === 'ERROR')) return 'ERROR';
  if (input.results.some((item) => item.resultStatus === 'UNREACHABLE')) return 'UNREACHABLE';
  return input.results.length === input.deviceCount && input.results.every((item) => item.resultStatus === 'VALID') ? 'VALID' : 'UNREACHABLE';
}

export function classifyCredentialHealthError(error: unknown): CredentialHealthAdapterResult {
  const code = error instanceof Error && 'errorCode' in error
    ? String((error as { errorCode?: unknown }).errorCode ?? '')
    : '';
  const details = error instanceof Error && 'details' in error ? JSON.stringify((error as { details?: unknown }).details ?? {}) : '';
  const message = error instanceof Error ? error.message : String(error);
  const signal = `${code} ${message} ${details}`;
  if (/PASSWORD_INVALID|status[^\d]*(401|403)|\b401\b|\b403\b|invalid password|认证.*拒绝/i.test(signal)) {
    return { status: 'ERROR', reasonCode: 'PASSWORD_INVALID', summary: '设备明确拒绝了凭据认证' };
  }
  if (/status[^\d]*5\d\d|\b5\d\d\b|HTTP_NON_SUCCESS_STATUS|REMOTE_SERVICE_ERROR|远端服务/i.test(signal)) {
    return { status: 'UNREACHABLE', reasonCode: 'REMOTE_SERVICE_ERROR', summary: '设备已连接但远端服务暂时不可用' };
  }
  if (/SECRET|credential.*unreadable|secret/i.test(`${code} ${message}`)) {
    return { status: 'ERROR', reasonCode: 'SECRET_UNREADABLE', summary: '凭据 Secret 无法读取' };
  }
  if (/CAPABILITY|WORKFLOW/i.test(`${code} ${message}`)) {
    return { status: 'ERROR', reasonCode: 'CHECK_CAPABILITY_MISSING', summary: '设备插件未提供凭据检测流程' };
  }
  return { status: 'UNREACHABLE', reasonCode: 'NETWORK_UNREACHABLE', summary: '设备网络暂时不可达' };
}

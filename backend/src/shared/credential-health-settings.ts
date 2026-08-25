/**
 * 中文说明：凭据有效性检测间隔按租户保存，供管理页面和后台调度器共同读取。
 */
export interface CredentialHealthSettings {
  intervalMinutes: number;
}

export const DEFAULT_CREDENTIAL_HEALTH_SETTINGS: Readonly<CredentialHealthSettings> = {
  intervalMinutes: 720,
};

export function normalizeCredentialHealthSettings(value: unknown): CredentialHealthSettings {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const intervalMinutes = Number(record.intervalMinutes);
  return {
    intervalMinutes: Number.isInteger(intervalMinutes) && intervalMinutes >= 1 && intervalMinutes <= 43_200
      ? intervalMinutes
      : DEFAULT_CREDENTIAL_HEALTH_SETTINGS.intervalMinutes,
  };
}

export function mergeCredentialHealthSettings(
  current: Record<string, unknown> | undefined,
  patch: Partial<CredentialHealthSettings>,
): Record<string, unknown> {
  return {
    ...(current ?? {}),
    credentialHealth: normalizeCredentialHealthSettings({
      ...normalizeCredentialHealthSettings(current?.credentialHealth),
      ...patch,
    }),
  };
}

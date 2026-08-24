/**
 * 中文说明：部署任务开关按租户保存。缺少历史字段时关闭可选 Dry-run，
 * 但继续保留审批默认开启。
 */
export interface DeploymentTaskSettings {
  dryRunEnabled: boolean;
  approvalEnabled: boolean;
}

export const DEFAULT_DEPLOYMENT_TASK_SETTINGS: Readonly<DeploymentTaskSettings> = {
  dryRunEnabled: false,
  approvalEnabled: true,
};

export function normalizeDeploymentTaskSettings(value: unknown): DeploymentTaskSettings {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    dryRunEnabled: record.dryRunEnabled === true,
    approvalEnabled: record.approvalEnabled !== false,
  };
}

export function mergeDeploymentTaskSettings(
  current: Record<string, unknown> | undefined,
  patch: Partial<DeploymentTaskSettings>,
): Record<string, unknown> {
  return {
    ...(current ?? {}),
    deploymentTasks: normalizeDeploymentTaskSettings({
      ...normalizeDeploymentTaskSettings(current?.deploymentTasks),
      ...patch,
    }),
  };
}

/**
 * 中文说明：部署任务开关按租户保存。缺少旧字段时保持安全默认值，避免历史租户
 * 因升级后意外跳过预检或审批。
 */
export interface DeploymentTaskSettings {
  dryRunEnabled: boolean;
  approvalEnabled: boolean;
}

export const DEFAULT_DEPLOYMENT_TASK_SETTINGS: Readonly<DeploymentTaskSettings> = {
  dryRunEnabled: true,
  approvalEnabled: true,
};

export function normalizeDeploymentTaskSettings(value: unknown): DeploymentTaskSettings {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    dryRunEnabled: record.dryRunEnabled !== false,
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

/**
 * 中文说明：部署任务开关按租户保存。审批字段保留用于兼容历史数据，
 * 当前部署和自动化统一由外部企业授权入口负责，内部审批永久关闭。
 */
export interface DeploymentTaskSettings {
  dryRunEnabled: boolean;
  approvalEnabled: boolean;
}

export const DEFAULT_DEPLOYMENT_TASK_SETTINGS: Readonly<DeploymentTaskSettings> = {
  dryRunEnabled: false,
  approvalEnabled: false,
};

export function normalizeDeploymentTaskSettings(value: unknown): DeploymentTaskSettings {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    dryRunEnabled: record.dryRunEnabled === true,
    // 中文说明：忽略历史或客户端提交的 true，避免重新打开已冻结的内部审批。
    approvalEnabled: false,
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
      approvalEnabled: false,
    }),
  };
}

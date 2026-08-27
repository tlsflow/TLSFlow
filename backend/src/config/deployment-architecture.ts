export type DeploymentArchitecture = 'small' | 'standard';

export interface DeploymentFeatures {
  readonly browserRuntime: boolean;
}

/**
 * Browser Runtime 默认保持开启以兼容未提供新开关的既有部署。
 * 模板显式设置为 false，用户需要浏览器会话时再打开它。
 */
export function isBrowserRuntimeEnabled(
  value: string | undefined = process.env.BROWSER_RUNTIME_ENABLED,
): boolean {
  return value?.trim().toLowerCase() !== 'false';
}

export function resolveDeploymentArchitecture(
  value: string | undefined = process.env.GCAC_DEPLOYMENT_ARCHITECTURE,
): DeploymentArchitecture {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return 'standard';
  if (normalized === 'small' || normalized === 'standard') return normalized;
  throw new Error('GCAC_DEPLOYMENT_ARCHITECTURE 只允许 small 或 standard');
}

export function deploymentFeatures(
  architecture: DeploymentArchitecture,
  browserRuntimeEnabled: boolean = isBrowserRuntimeEnabled(),
): DeploymentFeatures {
  return {
    browserRuntime: architecture === 'standard' && browserRuntimeEnabled,
  };
}

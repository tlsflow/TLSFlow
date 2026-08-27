export type DeploymentArchitecture = 'small' | 'standard';

export interface DeploymentFeatures {
  readonly browserRuntime: boolean;
}

/**
 * Backend 在标准架构中始终装配 Browser Runtime 能力。
 * Runtime 容器是否拉取和启动由 Docker Compose 控制，不读取 Backend 环境变量。
 *
 * 参数保留用于测试和显式能力裁剪，不作为生产部署开关。
 */
export function isBrowserRuntimeEnabled(value?: string): boolean {
  return value === undefined || value.trim().toLowerCase() !== 'false';
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

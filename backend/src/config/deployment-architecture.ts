export type DeploymentArchitecture = 'small' | 'standard';

export interface DeploymentFeatures {
  readonly browserRuntime: boolean;
}

export function resolveDeploymentArchitecture(
  value: string | undefined = process.env.GCAC_DEPLOYMENT_ARCHITECTURE,
): DeploymentArchitecture {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return 'standard';
  if (normalized === 'small' || normalized === 'standard') return normalized;
  throw new Error('GCAC_DEPLOYMENT_ARCHITECTURE 只允许 small 或 standard');
}

export function deploymentFeatures(architecture: DeploymentArchitecture): DeploymentFeatures {
  return {
    browserRuntime: architecture === 'standard',
  };
}

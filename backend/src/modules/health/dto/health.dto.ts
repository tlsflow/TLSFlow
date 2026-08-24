import type { DeploymentArchitecture, DeploymentFeatures } from '../../../config/deployment-architecture.js';

export interface HealthResponseDto {
  status: 'OK' | 'DEGRADED';
  service: string;
  version: string;
  timestamp: string;
  dependencies: Record<string, 'OK' | 'DEGRADED' | 'UNKNOWN'>;
  deploymentArchitecture: DeploymentArchitecture;
  features: DeploymentFeatures;
}

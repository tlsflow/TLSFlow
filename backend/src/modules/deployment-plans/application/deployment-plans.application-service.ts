import { createModuleMetadata } from '../../placeholder-module.js';

export class DeploymentPlansApplicationService {
  getModuleMetadata() {
    return createModuleMetadata('deployment-plans', '/api/v1/deployment-plans', '009');
  }
}

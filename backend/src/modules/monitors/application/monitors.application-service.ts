import { createModuleMetadata } from '../../placeholder-module.js';

export class MonitorsApplicationService {
  getModuleMetadata() {
    return createModuleMetadata('monitors', '/api/v1/monitors', '027');
  }
}

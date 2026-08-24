import { createModuleMetadata } from '../../placeholder-module.js';

export class ExecutionsApplicationService {
  getModuleMetadata() {
    return createModuleMetadata('executions', '/api/v1/executions', '010');
  }
}

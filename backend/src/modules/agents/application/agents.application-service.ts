import { createModuleMetadata } from '../../placeholder-module.js';

export class AgentsApplicationService {
  getModuleMetadata() {
    return createModuleMetadata('agents', '/api/v1/agents', '011');
  }
}

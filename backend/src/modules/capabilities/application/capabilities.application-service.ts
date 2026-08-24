import { createModuleMetadata } from '../../placeholder-module.js';

export class CapabilitiesApplicationService {
  getModuleMetadata() {
    return createModuleMetadata('capabilities', '/api/v1/capabilities', '008');
  }
}

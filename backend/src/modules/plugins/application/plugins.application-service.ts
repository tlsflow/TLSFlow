import { createModuleMetadata } from '../../placeholder-module.js';

export class PluginsApplicationService {
  getModuleMetadata() {
    return createModuleMetadata('plugins', '/api/v1/plugins', '024');
  }
}

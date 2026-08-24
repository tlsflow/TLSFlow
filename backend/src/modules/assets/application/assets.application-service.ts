import { createModuleMetadata } from '../../placeholder-module.js';

export class AssetsApplicationService {
  getModuleMetadata() {
    return createModuleMetadata('assets', '/api/v1/assets', '007');
  }
}

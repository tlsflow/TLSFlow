import { createModuleMetadata } from '../../placeholder-module.js';

export class SecretsApplicationService {
  getModuleMetadata() {
    return createModuleMetadata('secrets', '/api/v1/secrets', '005');
  }
}

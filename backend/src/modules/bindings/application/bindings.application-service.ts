import { createModuleMetadata } from '../../placeholder-module.js';

export class BindingsApplicationService {
  getModuleMetadata() {
    return createModuleMetadata('bindings', '/api/v1/bindings', '007');
  }
}

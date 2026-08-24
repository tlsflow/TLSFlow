import { createModuleMetadata } from '../../placeholder-module.js';

export class AuditsApplicationService {
  getModuleMetadata() {
    return createModuleMetadata('audits', '/api/v1/audits', '005');
  }
}

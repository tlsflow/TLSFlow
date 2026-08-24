import { createModuleMetadata } from '../../placeholder-module.js';

export class CertificatesApplicationService {
  getModuleMetadata() {
    return createModuleMetadata('certificates', '/api/v1/certificates', '006');
  }
}

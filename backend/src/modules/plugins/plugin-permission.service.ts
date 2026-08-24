import { securityErrors } from '../../shared/security-error.js';
export interface PluginPermissionManifest {
  pluginId: string;
  name: string;
  version: string;
  author: string;
  runtime: string;
  requiredPermissions: string[];
  requiredCapabilities: string[];
  allowedSecretTypes: string[];
  networkAccess: boolean;
}

export class PluginPermissionService {
  validateManifest(manifest: PluginPermissionManifest): void {
    const requiredFields = ['pluginId', 'name', 'version'] as const;
    for (const field of requiredFields) {
      if (!manifest[field as keyof typeof manifest]) {
        throw securityErrors.pluginPermissionDenied({ reason: 'manifest field missing', field });
      }
    }
    if (!manifest.author) {
      throw securityErrors.pluginPermissionDenied({ reason: 'manifest field missing', field: 'author' });
    }
    if (!manifest.runtime) {
      throw securityErrors.pluginPermissionDenied({ reason: 'manifest field missing', field: 'runtime' });
    }
  }

  assertDeclaredPermission(manifest: PluginPermissionManifest, requestedAction: string, requestedSecretType?: string): void {
    this.validateManifest(manifest);
    if (!manifest.requiredPermissions.includes(requestedAction)) {
      throw securityErrors.pluginPermissionDenied({ reason: 'action not declared', requestedAction });
    }
    if (requestedSecretType && !manifest.allowedSecretTypes.includes(requestedSecretType)) {
      throw securityErrors.pluginPermissionDenied({ reason: 'secret type not declared', requestedSecretType });
    }
  }
}

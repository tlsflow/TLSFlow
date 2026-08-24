import { securityErrors } from '../../shared/security-error.js';
import type { PluginPackageManifest } from './dto/plugins.dto.js';

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
  validateManifest(manifest: PluginPermissionManifest | PluginPackageManifest): void {
    const requiredFields = ['pluginId', 'name', 'version'] as const;
    for (const field of requiredFields) {
      if (!manifest[field as keyof typeof manifest]) {
        throw securityErrors.pluginPermissionDenied({ reason: 'manifest field missing', field });
      }
    }
    if (!this.getAuthor(manifest)) {
      throw securityErrors.pluginPermissionDenied({ reason: 'manifest field missing', field: 'author' });
    }
    if (!this.getRuntime(manifest)) {
      throw securityErrors.pluginPermissionDenied({ reason: 'manifest field missing', field: 'runtime' });
    }
  }

  assertDeclaredPermission(manifest: PluginPermissionManifest | PluginPackageManifest, requestedAction: string, requestedSecretType?: string): void {
    this.validateManifest(manifest);
    if (!this.getRequiredPermissions(manifest).includes(requestedAction)) {
      throw securityErrors.pluginPermissionDenied({ reason: 'action not declared', requestedAction });
    }
    if (requestedSecretType && !this.getAllowedSecretTypes(manifest).includes(requestedSecretType)) {
      throw securityErrors.pluginPermissionDenied({ reason: 'secret type not declared', requestedSecretType });
    }
  }

  private getAuthor(manifest: PluginPermissionManifest | PluginPackageManifest): string | undefined {
    return 'author' in manifest ? manifest.author : manifest.publisher;
  }

  private getRuntime(manifest: PluginPermissionManifest | PluginPackageManifest): unknown {
    return manifest.runtime;
  }

  private getRequiredPermissions(manifest: PluginPermissionManifest | PluginPackageManifest): string[] {
    if ('requiredPermissions' in manifest) {
      return manifest.requiredPermissions;
    }
    return manifest.permissions.map((permission) => permission.name);
  }

  private getAllowedSecretTypes(manifest: PluginPermissionManifest | PluginPackageManifest): string[] {
    if ('allowedSecretTypes' in manifest) {
      return manifest.allowedSecretTypes;
    }
    return manifest.permissions
      .filter((permission) => permission.scope === 'secret')
      .flatMap((permission) => permission.values);
  }
}

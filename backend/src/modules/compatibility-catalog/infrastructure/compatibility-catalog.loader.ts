import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CompatibilityProfile } from '../../../shared/contracts/compatibility-profile-contracts.js';
import { AdapterRegistry } from '../domain/adapter-registry.js';
import { parseAdapterManifest } from '../domain/adapter-manifest.schema.js';
import { parseCompatibilityProfile } from '../domain/compatibility-profile.schema.js';

export interface LoadedCompatibilityCatalog {
  registry: AdapterRegistry;
  profiles: CompatibilityProfile[];
}

export function loadCompatibilityCatalog(rootDirectory: string): LoadedCompatibilityCatalog {
  const manifests = loadJsonFiles(join(rootDirectory, 'adapters')).map(parseAdapterManifest);
  const profiles = loadJsonFiles(join(rootDirectory, 'profiles')).map(parseCompatibilityProfile)
    .sort((left, right) => left.profileId.localeCompare(right.profileId) || left.version.localeCompare(right.version));
  return { registry: new AdapterRegistry(manifests), profiles };
}

function loadJsonFiles(directory: string): unknown[] {
  return listJsonFiles(directory).map((filePath) => JSON.parse(readFileSync(filePath, 'utf8')) as unknown);
}

function listJsonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) return listJsonFiles(target);
      return entry.isFile() && entry.name.endsWith('.json') ? [target] : [];
    })
    .sort();
}

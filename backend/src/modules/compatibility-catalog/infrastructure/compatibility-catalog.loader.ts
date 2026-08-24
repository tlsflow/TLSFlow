import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CompatibilityProfile } from '../../../shared/contracts/compatibility-profile-contracts.js';
import type {
  CertificationRecord,
  CompatibilityProfileV2,
  ExecutionRecipe,
  RuntimeBaseline,
} from '../../../shared/contracts/compatibility-governance-contracts.js';
import { AdapterRegistry } from '../domain/adapter-registry.js';
import { parseAdapterManifest } from '../domain/adapter-manifest.schema.js';
import { parseCertificationRecord } from '../domain/certification-record.schema.js';
import { CompatibilityGovernanceRegistry } from '../domain/compatibility-governance-registry.js';
import { assertProfileV1V2Equivalent } from '../domain/compatibility-profile-v2.projection.js';
import { parseCompatibilityProfile } from '../domain/compatibility-profile.schema.js';
import { parseCompatibilityProfileV2 } from '../domain/compatibility-profile-v2.schema.js';
import { parseExecutionRecipe } from '../domain/execution-recipe.schema.js';
import { parseRuntimeBaseline } from '../domain/runtime-baseline.schema.js';

export interface LoadedCompatibilityCatalog {
  registry: AdapterRegistry;
  profiles: CompatibilityProfile[];
  baselines: RuntimeBaseline[];
  recipes: ExecutionRecipe[];
  certifications: CertificationRecord[];
  profilesV2: CompatibilityProfileV2[];
  governance: CompatibilityGovernanceRegistry;
}

export function loadCompatibilityCatalog(rootDirectory: string): LoadedCompatibilityCatalog {
  const manifests = loadJsonFiles(join(rootDirectory, 'adapters')).map(parseAdapterManifest);
  const profileInputs = loadJsonFiles(join(rootDirectory, 'profiles'));
  const profiles = profileInputs.filter(isProfileV1).map(parseCompatibilityProfile)
    .sort((left, right) => left.profileId.localeCompare(right.profileId) || left.version.localeCompare(right.version));
  const profilesV2 = profileInputs.filter(isProfileV2).map(parseCompatibilityProfileV2)
    .sort((left, right) => left.profileId.localeCompare(right.profileId) || left.version.localeCompare(right.version));
  const baselines = loadJsonFiles(join(rootDirectory, 'runtime-baselines')).map(parseRuntimeBaseline);
  const recipes = loadJsonFiles(join(rootDirectory, 'execution-recipes')).map(parseExecutionRecipe);
  const certifications = loadJsonFiles(join(rootDirectory, 'certifications')).map(parseCertificationRecord);
  const registry = new AdapterRegistry(manifests);
  const governance = new CompatibilityGovernanceRegistry({ baselines, recipes, certifications, profiles: profilesV2 });
  governance.validateReferences(new Set(manifests.map((manifest) => manifest.adapterId)));
  assertProfileV1V2Equivalent(profiles, profilesV2, governance);
  return { registry, profiles, baselines, recipes, certifications, profilesV2, governance };
}

function loadJsonFiles(directory: string): unknown[] {
  if (!existsSync(directory)) return [];
  return listJsonFiles(directory).map((filePath) => JSON.parse(readFileSync(filePath, 'utf8')) as unknown);
}

function listJsonFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) return listJsonFiles(target);
      return entry.isFile() && entry.name.endsWith('.json') ? [target] : [];
    })
    .sort();
}

function isProfileV1(input: unknown): input is { apiVersion: 'gcac.compatibility/v1' } {
  return isRecord(input) && input.apiVersion === 'gcac.compatibility/v1';
}

function isProfileV2(input: unknown): input is { apiVersion: 'gcac.compatibility/v2' } {
  return isRecord(input) && input.apiVersion === 'gcac.compatibility/v2';
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

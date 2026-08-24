import {
  AdapterKinds,
  CompatibilityCatalogError,
  type AdapterKind,
  type AdapterManifest,
} from '../../../shared/contracts/adapter-contracts.js';

export class AdapterRegistry {
  private readonly manifests = new Map<string, AdapterManifest>();

  constructor(manifests: AdapterManifest[] = []) {
    for (const manifest of manifests) this.register(manifest);
  }

  register(manifest: AdapterManifest): void {
    const key = manifestKey(manifest.kind, manifest.adapterId, manifest.version);
    const existing = this.manifests.get(key);
    if (existing) {
      throw new CompatibilityCatalogError('ADAPTER_REGISTRATION_CONFLICT', '适配器重复注册', {
        adapterId: manifest.adapterId,
        kind: manifest.kind,
        version: manifest.version,
      });
    }
    this.manifests.set(key, cloneManifest(manifest));
  }

  get(kind: AdapterKind, adapterId: string, version?: string): AdapterManifest | undefined {
    const candidates = this.list(kind).filter((item) => item.adapterId === adapterId && (version === undefined || item.version === version));
    return candidates[0];
  }

  list(kind?: AdapterKind): AdapterManifest[] {
    if (kind !== undefined && !AdapterKinds.includes(kind)) return [];
    return [...this.manifests.values()]
      .filter((item) => kind === undefined || item.kind === kind)
      .sort(compareManifestIdentity)
      .map(cloneManifest);
  }
}

function manifestKey(kind: AdapterKind, adapterId: string, version: string): string {
  return `${kind}:${adapterId}:${version}`;
}

function compareManifestIdentity(left: AdapterManifest, right: AdapterManifest): number {
  return left.kind.localeCompare(right.kind)
    || left.adapterId.localeCompare(right.adapterId)
    || compareVersions(right.version, left.version);
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function cloneManifest(manifest: AdapterManifest): AdapterManifest {
  return {
    ...manifest,
    consumes: [...manifest.consumes],
    produces: [...manifest.produces],
    supportedOperationSchemas: [...manifest.supportedOperationSchemas],
    conflicts: manifest.conflicts.map((item) => ({ ...item })),
    requirements: {
      ...manifest.requirements,
      requiredAll: manifest.requirements.requiredAll.map((item) => ({ ...item })),
      optional: manifest.requirements.optional.map((item) => ({ ...item })),
      anyOfGroups: manifest.requirements.anyOfGroups.map((group) => group.map((item) => ({ ...item }))),
      forbidden: manifest.requirements.forbidden.map((item) => ({ ...item })),
    },
  };
}

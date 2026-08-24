import { createHash, randomBytes } from 'node:crypto';
import { securityErrors } from '../../shared/security-error.js';

export interface KekMaterial {
  version: string;
  key: Buffer;
  createdAt: string;
}

export class KeyManager {
  private readonly keys = new Map<string, KekMaterial[]>();
  private currentVersion: string;

  constructor(initialKey?: Buffer) {
    const version = 'kek_v1';
    const materials = initialKey
      ? [createMaterial(version, Buffer.from(initialKey))]
      : loadDefaultKek(version);
    this.currentVersion = version;
    this.keys.set(version, materials);
  }

  getCurrentKek(): KekMaterial {
    return this.getKek(this.currentVersion);
  }

  getKek(version: string): KekMaterial {
    const materials = this.keys.get(version);
    if (!materials || materials.length === 0) {
      throw securityErrors.secretResolveDenied({ reason: 'kek not found', version });
    }
    const [primary] = materials;
    return { ...primary, key: Buffer.from(primary.key) };
  }

  getKekCandidates(version: string): KekMaterial[] {
    const materials = this.keys.get(version);
    if (!materials || materials.length === 0) {
      throw securityErrors.secretResolveDenied({ reason: 'kek not found', version });
    }
    return materials.map((material) => ({ ...material, key: Buffer.from(material.key) }));
  }

  rotateKek(newKey: Buffer = randomBytes(32)): KekMaterial {
    const nextVersion = `kek_v${this.keys.size + 1}`;
    const material = createMaterial(nextVersion, Buffer.from(newKey));
    this.keys.set(nextVersion, [material]);
    this.currentVersion = nextVersion;
    return { ...material, key: Buffer.from(material.key) };
  }
}

function loadDefaultKek(version: string): KekMaterial[] {
  const configured = process.env.GCAC_SECRET_KEK?.trim();
  if (configured) {
    return normalizeConfiguredKek(version, configured);
  }
  // 保证重启后仍能解密既有 Secret；生产环境应显式配置 GCAC_SECRET_KEK。
  return [createMaterial(version, createHash('sha256').update('gcac-default-secret-kek-v1', 'utf8').digest())];
}

function normalizeConfiguredKek(version: string, value: string): KekMaterial[] {
  const candidates: Buffer[] = [];
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    candidates.push(Buffer.from(value, 'hex'));
  }

  if (candidates.length === 0) {
    try {
      const decoded = Buffer.from(value, 'base64');
      if (decoded.length === 32 && decoded.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')) {
        candidates.push(decoded);
      }
    } catch {
      // ignore and fallback to hash
    }
  }

  // 历史版本会把配置字符串整体做哈希。对 hex/base64 形态保留兼容候选，避免同值不同语义导致全部 Secret 失效。
  candidates.push(createHash('sha256').update(value, 'utf8').digest());

  return dedupeCandidateKeys(candidates).map((candidate) => createMaterial(version, candidate));
}

function dedupeCandidateKeys(keys: Buffer[]): Buffer[] {
  const unique = new Map<string, Buffer>();
  for (const key of keys) {
    unique.set(key.toString('hex'), Buffer.from(key));
  }
  return [...unique.values()];
}

function createMaterial(version: string, key: Buffer): KekMaterial {
  if (key.length !== 32) {
    throw new Error('KEK 必须是 32 字节');
  }
  return { version, key, createdAt: new Date().toISOString() };
}

import { createHash, randomBytes } from 'node:crypto';
import { securityErrors } from '../../shared/security-error.js';

export interface KekMaterial {
  version: string;
  key: Buffer;
  createdAt: string;
}

export class KeyManager {
  private readonly keys = new Map<string, KekMaterial>();
  private currentVersion: string;

  constructor(initialKey?: Buffer) {
    const version = 'kek_v1';
    const key = initialKey ?? loadDefaultKek();
    if (key.length !== 32) {
      throw new Error('KEK 必须是 32 字节');
    }
    this.currentVersion = version;
    this.keys.set(version, { version, key: Buffer.from(key), createdAt: new Date().toISOString() });
  }

  getCurrentKek(): KekMaterial {
    return this.getKek(this.currentVersion);
  }

  getKek(version: string): KekMaterial {
    const material = this.keys.get(version);
    if (!material) {
      throw securityErrors.secretResolveDenied({ reason: 'kek not found', version });
    }
    return { ...material, key: Buffer.from(material.key) };
  }

  rotateKek(newKey: Buffer = randomBytes(32)): KekMaterial {
    if (newKey.length !== 32) {
      throw new Error('KEK 必须是 32 字节');
    }
    const nextVersion = `kek_v${this.keys.size + 1}`;
    const material = { version: nextVersion, key: Buffer.from(newKey), createdAt: new Date().toISOString() };
    this.keys.set(nextVersion, material);
    this.currentVersion = nextVersion;
    return { ...material, key: Buffer.from(material.key) };
  }
}

function loadDefaultKek(): Buffer {
  const configured = process.env.GCAC_SECRET_KEK?.trim();
  if (configured) {
    return normalizeConfiguredKek(configured);
  }
  // 保证重启后仍能解密既有 Secret；生产环境应显式配置 GCAC_SECRET_KEK。
  return createHash('sha256').update('gcac-default-secret-kek-v1', 'utf8').digest();
}

function normalizeConfiguredKek(value: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }
  try {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length === 32 && decoded.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')) {
      return decoded;
    }
  } catch {
    // ignore and fallback to hash
  }
  return createHash('sha256').update(value, 'utf8').digest();
}

import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { LicenseGrant, RevocationList } from './licensing.types.js';

export type TrustKeyDirectory = ReadonlyMap<string, Buffer>;

export interface InstallationKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface LicenseVerificationResult {
  valid: boolean;
  state?: 'active' | 'grace' | 'expired' | 'revoked';
  reason?: string;
}

export function generateInstallationKeyPair(): InstallationKeyPair {
  const pair = generateKeyPairSync('ed25519');
  return {
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    privateKey: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
  };
}

export function verifyLicenseGrant(
  grant: LicenseGrant,
  installationId: string,
  installationPublicKey: string,
  trustKeys: TrustKeyDirectory,
  revokedGrantIds: ReadonlySet<string>,
  now = new Date(),
): LicenseVerificationResult {
  if (!isLicenseGrantShape(grant)) return { valid: false, reason: 'license shape invalid' };
  if (grant.productCode !== 'gcac') return { valid: false, reason: 'product mismatch' };
  if (grant.installationId !== installationId || grant.installationPublicKey !== installationPublicKey) {
    return { valid: false, reason: 'installation mismatch' };
  }
  const key = trustKeys.get(grant.keyId);
  if (!key || !verifySignedPayload(grant as unknown as Record<string, unknown>, key)) return { valid: false, reason: 'signature invalid' };
  if (revokedGrantIds.has(grant.grantId)) return { valid: false, state: 'revoked', reason: 'grant revoked' };

  const startsAt = Date.parse(grant.startsAt);
  const expiresAt = Date.parse(grant.expiresAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(expiresAt) || expiresAt < startsAt) {
    return { valid: false, reason: 'license dates invalid' };
  }
  const timestamp = now.getTime();
  if (timestamp < startsAt) return { valid: false, reason: 'license not started' };
  if (timestamp <= expiresAt) return { valid: true, state: 'active' };
  const graceEndsAt = expiresAt + grant.gracePeriodDays * 86_400_000;
  if (timestamp <= graceEndsAt) return { valid: true, state: 'grace' };
  return { valid: false, state: 'expired', reason: 'license expired' };
}

export function verifyRevocationList(
  list: RevocationList,
  trustKeys: TrustKeyDirectory,
  now = new Date(),
): boolean {
  if (
    list.schemaVersion !== 1
    || !list.listId
    || !list.keyId
    || !Array.isArray(list.revokedGrantIds)
    || !list.revokedGrantIds.every((item) => typeof item === 'string')
    || !verifySignedPayload(list as unknown as Record<string, unknown>, trustKeys.get(list.keyId))
  ) {
    return false;
  }
  const expiresAt = Date.parse(list.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt >= now.getTime();
}

export function verifySignedPayload(payload: Record<string, unknown>, publicKeyDer?: Buffer): boolean {
  if (!publicKeyDer) return false;
  const signature = payload.signature;
  if (typeof signature !== 'string' || signature.length === 0) return false;
  const body = { ...payload };
  delete body.signature;
  try {
    return verify(
      null,
      Buffer.from(canonicalJson(body), 'utf8'),
      createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' }),
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(',')}}`;
}

export function encryptPrivateKey(privateKey: string, storageKey: Buffer): string {
  const iv = createHash('sha256').update(privateKey, 'utf8').digest().subarray(0, 12);
  const cipher = createCipheriv('aes-256-gcm', storageKey, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  return JSON.stringify({
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  });
}

export function decryptPrivateKey(encrypted: string, storageKey: Buffer): string {
  const payload = JSON.parse(encrypted) as { iv: string; authTag: string; ciphertext: string };
  const decipher = createDecipheriv('aes-256-gcm', storageKey, Buffer.from(payload.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function signPayloadForTests(payload: Record<string, unknown>, privateKeyDer: Buffer): string {
  const body = { ...payload };
  delete body.signature;
  return sign(null, Buffer.from(canonicalJson(body), 'utf8'), createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' })).toString('base64url');
}

function isLicenseGrantShape(value: unknown): value is LicenseGrant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const grant = value as Partial<LicenseGrant>;
  return grant.schemaVersion === 1
    && typeof grant.grantId === 'string'
    && typeof grant.keyId === 'string'
    && typeof grant.installationId === 'string'
    && typeof grant.installationPublicKey === 'string'
    && typeof grant.planCode === 'string'
    && Array.isArray(grant.features)
    && grant.features.every((item) => typeof item === 'string')
    && !!grant.quotas
    && typeof grant.issuedAt === 'string'
    && typeof grant.startsAt === 'string'
    && typeof grant.expiresAt === 'string'
    && typeof grant.gracePeriodDays === 'number'
    && typeof grant.signature === 'string';
}

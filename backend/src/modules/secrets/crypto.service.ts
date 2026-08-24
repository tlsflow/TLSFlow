import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { sha256Fingerprint } from '../../common/crypto/fingerprint.js';
import { securityErrors } from '../../shared/security-error.js';
import type { KeyManager } from './key-manager.service.js';

export interface EnvelopeEncryptedPayload {
  encryptedData: string;
  encryptedDek: string;
  kekVersion: string;
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  dekIv: string;
  dekAuthTag: string;
  fingerprint: string;
}

export class CryptoService {
  constructor(private readonly keyManager: KeyManager) {}

  encryptSecret(plainText: string): EnvelopeEncryptedPayload {
    const dataKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
    const encryptedData = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const kek = this.keyManager.getCurrentKek();
    const dekIv = randomBytes(12);
    const dekCipher = createCipheriv('aes-256-gcm', kek.key, dekIv);
    const encryptedDek = Buffer.concat([dekCipher.update(dataKey), dekCipher.final()]);
    const dekAuthTag = dekCipher.getAuthTag();

    return {
      encryptedData: encryptedData.toString('base64'),
      encryptedDek: encryptedDek.toString('base64'),
      kekVersion: kek.version,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      dekIv: dekIv.toString('base64'),
      dekAuthTag: dekAuthTag.toString('base64'),
      fingerprint: sha256Fingerprint(plainText),
    };
  }

  decryptSecret(payload: EnvelopeEncryptedPayload): string {
    try {
      const kek = this.keyManager.getKek(payload.kekVersion);
      const dekDecipher = createDecipheriv('aes-256-gcm', kek.key, Buffer.from(payload.dekIv, 'base64'));
      dekDecipher.setAuthTag(Buffer.from(payload.dekAuthTag, 'base64'));
      const dataKey = Buffer.concat([
        dekDecipher.update(Buffer.from(payload.encryptedDek, 'base64')),
        dekDecipher.final(),
      ]);

      const decipher = createDecipheriv(payload.algorithm, dataKey, Buffer.from(payload.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(payload.encryptedData, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // 绝不返回半截明文。解密失败就是失败。
      throw securityErrors.secretResolveDenied({ reason: 'decrypt failed' });
    }
  }
}

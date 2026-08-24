import type { SecretScopeType, SecretStatus, SecretType, SecretVersionStatus } from '../../shared/security-types.js';

export interface SecretEntity {
  id: string;
  name: string;
  type: SecretType;
  scopeType: SecretScopeType;
  scopeId?: string;
  status: SecretStatus;
  currentVersionId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecretVersionEntity {
  id: string;
  secretId: string;
  versionNo: number;
  encryptedData: string;
  encryptedDek: string;
  kekVersion: string;
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  fingerprint: string;
  status: SecretVersionStatus;
  createdAt: string;
}

export interface AuthPasswordCredentialEntity {
  id: string;
  userId: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthBrowserSessionEntity {
  id: string;
  userId: string;
  tenantId: string;
  secretHash: string;
  createdAt: string;
  expiresAt: string;
  contextVersion?: string;
  revokedAt?: string;
  userAgent?: string;
  ip?: string;
}

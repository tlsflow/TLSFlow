export interface AuthPasswordCredentialEntity {
  id: string;
  userId: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  updatedAt: string;
}

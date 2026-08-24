import type {
  CredentialDelivery,
  CredentialKind,
  CredentialProfileEntity,
  CredentialStatus,
} from '../../../persistence/entities/credential-profile.entity.js';
import type { SecretScopeType } from '../../../shared/security-types.js';
import type { SecretType } from '../../../shared/security-types.js';

export interface CredentialSecretValueInput {
  plainText: string;
  type?: SecretType;
}

export interface CreateCredentialProfileDto {
  name: string;
  kind: CredentialKind;
  scopeType: SecretScopeType;
  scopeId?: string;
  username?: string;
  delivery?: CredentialDelivery;
  secretSlots: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export type CreateCredentialProfileRequestDto = Omit<CreateCredentialProfileDto, 'secretSlots'> & {
  secretValues: Record<string, CredentialSecretValueInput>;
};

export interface RotateCredentialProfileRequestDto {
  secretValues: Record<string, CredentialSecretValueInput>;
  expectedVersion: number;
}

export interface UpdateCredentialProfileDto {
  name?: string;
  scopeType?: SecretScopeType;
  scopeId?: string;
  username?: string;
  delivery?: CredentialDelivery;
  secretSlots?: Record<string, string>;
  metadata?: Record<string, unknown>;
  status?: CredentialStatus;
  expectedVersion: number;
}

export type UpdateCredentialProfileRequestDto = Omit<UpdateCredentialProfileDto, 'secretSlots'> & {
  secretValues?: Record<string, CredentialSecretValueInput>;
};

export type CredentialProfileDto = CredentialProfileEntity;

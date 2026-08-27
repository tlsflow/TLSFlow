import type { ResourceScope } from '../../shared/security-types.js';

export type ThemeMode = 'light' | 'dark';
export type SupportedLocale = 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP' | 'fr-FR' | 'ru-RU' | 'pt-BR' | 'ko-KR';

export interface UserPreferences {
  theme: ThemeMode;
  locale: SupportedLocale;
  defaultCaId?: string;
  version: 1;
}

export interface UserEntity {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  tenantId?: string;
  tenantName?: string;
  identityProvider?: 'local' | 'active_directory' | 'ldap';
  externalId?: string;
  externalSourceId?: string;
  lastSyncedAt?: string;
  syncSource?: 'login' | 'manual_sync';
  preferences?: UserPreferences;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export interface RoleEntity {
  id: string;
  code: string;
  name: string;
  description?: string;
  builtin: boolean;
}

export interface UserRoleEntity {
  userId: string;
  roleId: string;
  createdAt: string;
}

export interface PermissionPolicyEntity {
  id: string;
  subjectType: 'user' | 'group' | 'role' | 'plugin' | 'executor';
  subjectId: string;
  effect: 'allow' | 'deny';
  actions: string[];
  resourceTypes: string[];
  scope: ResourceScope;
  conditions?: Record<string, unknown>;
}

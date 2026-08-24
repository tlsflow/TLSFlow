export type PrincipalType = 'user' | 'group' | 'external_group' | 'system' | 'plugin' | 'executor';
export type ObjectSetKind = 'static' | 'dynamic';
export type AccessLevel = 'read' | 'edit' | 'control';
export type AccessEffect = 'allow' | 'deny';

export interface GroupEntity {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  source: 'local' | 'ldap' | 'active_directory';
  externalSourceId?: string;
  externalRef?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMemberEntity {
  id: string;
  groupId: string;
  userId: string;
  source: 'manual' | 'ldap_sync' | 'login_sync';
  createdAt: string;
}

export interface RoleBindingEntity {
  id: string;
  tenantId: string;
  principalType: PrincipalType;
  principalId: string;
  roleId: string;
  objectSetId: string;
  effect: AccessEffect;
  enabled: boolean;
  validFrom?: string;
  validTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ObjectTypeEntity {
  id: string;
  code: string;
  name: string;
  tableName: string;
  tenantField: string;
  ownerFields?: string[];
  parentTypes?: string[];
  supportedActions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ObjectSetEntity {
  id: string;
  tenantId: string;
  name: string;
  kind: ObjectSetKind;
  objectTypes: string[];
  conditions?: Record<string, unknown>;
  status: 'active' | 'disabled' | 'invalid';
  createdAt: string;
  updatedAt: string;
}

export interface ObjectSetMemberEntity {
  id: string;
  objectSetId: string;
  objectType: string;
  objectId: string;
  tenantId?: string;
  addedBy: string;
  createdAt: string;
}

export interface AccessGrantEntity {
  id: string;
  roleId: string;
  objectSetId: string;
  accessLevel: AccessLevel;
  effect: AccessEffect;
  constraints?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

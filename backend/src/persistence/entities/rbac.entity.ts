import type { ResourceScope } from '../../shared/security-types.js';

export interface UserEntity {
  id: string;
  username: string;
  displayName: string;
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

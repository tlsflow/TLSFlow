import type { PrincipalType } from './object-permission.entity.js';

/** 面向管理员的四个业务授权域。技术对象不能作为业务授权域提交。 */
export const BUSINESS_PERMISSION_DOMAINS = ['certificate', 'application', 'audit', 'settings'] as const;
export type BusinessPermissionDomain = typeof BUSINESS_PERMISSION_DOMAINS[number];

/** 业务授权只有使用者和管理者两个级别。 */
export const BUSINESS_PERMISSION_LEVELS = ['user', 'manager'] as const;
export type BusinessPermissionLevel = typeof BUSINESS_PERMISSION_LEVELS[number];

export type BusinessPermissionEffect = 'allow' | 'deny';
export type BusinessPermissionGrantStatus = 'active' | 'revoked';

export interface BusinessPermissionGrantEntity {
  id: string;
  tenantId: string;
  principalType: Extract<PrincipalType, 'user' | 'group' | 'external_group'>;
  principalId: string;
  roleId: string;
  domain: BusinessPermissionDomain;
  level: BusinessPermissionLevel;
  rootObjectType: string;
  rootObjectId?: string;
  rootScope?: Record<string, unknown>;
  effect: BusinessPermissionEffect;
  status: BusinessPermissionGrantStatus;
  resolverVersion: string;
  relatedResourceVersion: string;
  expandedResourceTypes: string[];
  expandedActions: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  version: number;
}

/** 根对象与关联技术对象的事实关系。关系缺失时 resolver 必须失败关闭。 */
export interface BusinessPermissionRelationEntity {
  id: string;
  tenantId: string;
  rootDomain: BusinessPermissionDomain;
  rootObjectType: string;
  rootObjectId: string;
  relatedObjectType: string;
  relatedObjectId: string;
  relation: string;
  createdAt: string;
  updatedAt: string;
}

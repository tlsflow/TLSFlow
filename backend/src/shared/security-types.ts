export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type AuditResult = 'success' | 'failure' | 'denied';
export type ActorType = 'user' | 'system' | 'agent' | 'plugin' | 'executor';

export type SecretType =
  | 'ssh_key'
  | 'password'
  | 'api_token'
  | 'pfx_password'
  | 'private_key'
  | 'certificate_private_key';

export type SecretScopeType = 'global' | 'team' | 'zone' | 'host' | 'plugin';
export type SecretStatus = 'active' | 'disabled' | 'rotating' | 'deleted';
export type SecretVersionStatus = 'active' | 'disabled' | 'revoked';

export interface ResourceScope {
  tenantId?: string;
  teamId?: string;
  environment?: 'dev' | 'test' | 'staging' | 'prod' | string;
  zoneId?: string;
  assetTag?: string;
  ownerId?: string;
}

export interface ResourceDescriptor {
  type: string;
  id?: string;
  scope?: ResourceScope;
}

export interface SecuritySubject {
  id: string;
  type: 'user' | 'group' | 'role' | 'plugin' | 'executor' | 'system';
  roleIds?: string[];
  scope?: ResourceScope;
}

export interface RequestContext {
  requestId?: string;
  sourceIp?: string;
  actor?: SecuritySubject;
}

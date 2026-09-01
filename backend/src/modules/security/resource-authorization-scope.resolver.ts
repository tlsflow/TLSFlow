import type { SecuritySubject } from '../../shared/security-types.js';
import type { AccessLevel } from '../../persistence/entities/object-permission.entity.js';
import type { ObjectPermissionService, ObjectRef } from './object-permission.service.js';

export interface ResourceAuthorizationParentRef {
  objectType: string;
  objectId: string;
  tenantId: string;
}

export interface ResourceAuthorizationDescriptor {
  resourceType: string;
  parentObjectTypes: readonly string[];
  parentRefs: (item: object, tenantId: string) => ResourceAuthorizationParentRef[];
}

const valueAt = (item: object, path: string): unknown => path.split('.').reduce<unknown>((value, key) => (
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined
), item);

const fixedParent = (resourceType: string, objectType: string, idField: string): ResourceAuthorizationDescriptor => ({
  resourceType,
  parentObjectTypes: [objectType],
  parentRefs: (item, tenantId) => {
    const objectId = valueAt(item, idField);
    return typeof objectId === 'string' && objectId.trim() ? [{ objectType, objectId, tenantId }] : [];
  },
});

const DESCRIPTORS: Readonly<Record<string, ResourceAuthorizationDescriptor>> = {
  monitor_target: fixedParent('monitor_target', 'service_asset', 'serviceAssetId'),
  monitor_probe_result: fixedParent('monitor_probe_result', 'service_asset', 'serviceAssetId'),
  monitor_certificate_observation: fixedParent('monitor_certificate_observation', 'service_asset', 'serviceAssetId'),
  monitor_risk: {
    resourceType: 'monitor_risk',
    parentObjectTypes: ['service_asset', 'certificate_asset', 'certificate_binding', 'execution_run', 'host'],
    parentRefs: (item, tenantId) => [
      ['service_asset', valueAt(item, 'scope.serviceAssetId')],
      ['certificate_asset', valueAt(item, 'scope.certificateAssetId')],
      ['certificate_binding', valueAt(item, 'scope.bindingId')],
      ['execution_run', valueAt(item, 'scope.executionRunId')],
      ['host', valueAt(item, 'scope.hostId')],
    ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '')
      .map(([objectType, objectId]) => ({ objectType, objectId, tenantId })),
  },
};

/** 监控资源权限统一继承父级对象，不为高基数明细创建权限关系。 */
export class ResourceAuthorizationScopeResolver {
  constructor(private readonly objectPermissions: Pick<ObjectPermissionService, 'buildAuthorizedQuery'> & Partial<Pick<ObjectPermissionService, 'can'>>) {}

  describe(resourceType: string): ResourceAuthorizationDescriptor | undefined {
    return DESCRIPTORS[resourceType];
  }

  require(resourceType: string): ResourceAuthorizationDescriptor {
    const descriptor = this.describe(resourceType);
    if (!descriptor) throw new Error(`未登记资源父级归属：${resourceType}`);
    return descriptor;
  }

  async parentObjectIds(subject: SecuritySubject, resourceType: string, accessLevel: AccessLevel): Promise<string[] | undefined> {
    const descriptor = this.require(resourceType);
    if (descriptor.parentObjectTypes.length !== 1) return undefined;
    const authorization = await this.objectPermissions.buildAuthorizedQuery(subject, descriptor.parentObjectTypes[0], accessLevel);
    if (authorization.unrestricted) return undefined;
    return authorization.empty ? [] : [...new Set(authorization.objectIds ?? [])];
  }

  /** 返回多父级资源的授权 ID，undefined 表示该父级不受对象集限制。 */
  async parentObjectIdMap(subject: SecuritySubject, resourceType: string, accessLevel: AccessLevel): Promise<Record<string, string[]> | undefined> {
    const descriptor = this.require(resourceType);
    const entries = await Promise.all(descriptor.parentObjectTypes.map(async (objectType) => {
      const authorization = await this.objectPermissions.buildAuthorizedQuery(subject, objectType, accessLevel);
      if (authorization.unrestricted) return [objectType, undefined] as const;
      return [objectType, authorization.empty ? [] : [...new Set(authorization.objectIds ?? [])]] as const;
    }));
    if (entries.some(([, ids]) => ids === undefined)) return undefined;
    return Object.fromEntries(entries as Array<[string, string[]]>);
  }

  async isAllowed(subject: SecuritySubject, resourceType: string, accessLevel: AccessLevel, item: object, tenantId: string): Promise<boolean> {
    const descriptor = this.require(resourceType);
    const refs = descriptor.parentRefs(item, tenantId);
    if (refs.length === 0) return false;
    for (const ref of refs) {
      if (this.objectPermissions.can) {
        const decision = await this.objectPermissions.can(subject, accessLevel, ref as ObjectRef);
        if (decision.allowed) return true;
        continue;
      }
      const authorization = await this.objectPermissions.buildAuthorizedQuery(subject, ref.objectType, accessLevel);
      if (authorization.unrestricted || authorization.objectIds?.includes(ref.objectId)) return true;
    }
    return false;
  }

  parentKeys(resourceType: string, item: object, tenantId: string): string[] {
    return this.require(resourceType).parentRefs(item, tenantId).map((ref) => `${ref.objectType}:${ref.objectId}`);
  }
}

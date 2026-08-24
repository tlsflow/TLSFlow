import type { SecuritySubject } from '../../../shared/security-types.js';

export interface ReportScopedObject {
  objectType: 'certificate' | 'risk' | 'automation';
  objectId: string;
  tenantId: string;
}

export interface ReportObjectPermissionPort {
  canRead(subject: SecuritySubject, object: ReportScopedObject): Promise<boolean>;
}

export class ReportScopeResolver {
  constructor(private readonly permissions?: ReportObjectPermissionPort) {}

  async filter<T>(subject: SecuritySubject, items: T[], objectOf: (item: T) => ReportScopedObject): Promise<T[]> {
    if (!this.permissions) return items.filter((item) => objectOf(item).tenantId === subject.scope?.tenantId);
    const allowed = await Promise.all(items.map(async (item) => this.permissions!.canRead(subject, objectOf(item))));
    return items.filter((_item, index) => allowed[index]);
  }
}

import type { RequestContext, ResourceDescriptor, SecuritySubject } from '../../shared/security-types.js';
import type { RBACService } from '../../modules/rbac/rbac.service.js';

export function assertPermission(
  rbac: RBACService,
  subject: SecuritySubject,
  action: string,
  resource: ResourceDescriptor,
  context: RequestContext = {},
): void {
  rbac.assertCan(subject, action, resource, context);
}

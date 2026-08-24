import type { RequestContext, ResourceDescriptor, SecuritySubject } from '../../shared/security-types.js';
import type { RBACService } from '../../modules/rbac/rbac.service.js';

export async function assertPermission(
  rbac: RBACService,
  subject: SecuritySubject,
  action: string,
  resource: ResourceDescriptor,
  context: RequestContext = {},
): Promise<void> {
  await rbac.assertCan(subject, action, resource, context);
}

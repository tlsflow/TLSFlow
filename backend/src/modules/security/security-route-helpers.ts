import { AppError } from '../../common/errors/app-error.js';
import type { HttpRequest } from '../../common/http/http-types.js';
import { requireTenantId } from '../../common/http/tenant-context.js';
import { applyAuthorizationFilter, withAuthorization, type PageQuery } from '../../common/pagination/pagination.js';
import type { AccessLevel } from '../../persistence/entities/object-permission.entity.js';
import type { ResourceScope, SecuritySubject } from '../../shared/security-types.js';
import type { ObjectRef } from './object-permission.service.js';
import type { SecurityServices } from './security.controller.js';

export interface RouteSecurityContext {
  request: HttpRequest;
  services: SecurityServices;
  subject: SecuritySubject;
  tenantId: string;
}

export function requireRouteSecurity(request: HttpRequest, security?: SecurityServices): RouteSecurityContext {
  if (!security) throw new AppError('SYSTEM_INTERNAL_ERROR', '安全服务未配置');
  if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
  const tenantId = requireTenantId(request);
  return {
    request,
    services: security,
    tenantId,
    subject: {
      id: request.context.actorId,
      type: 'user',
      scope: {
        tenantId,
        tenantScope: request.context.tenantScope,
      },
    },
  };
}

export async function assertRouteAction(
  context: RouteSecurityContext,
  action: string,
  resourceType: string,
  options: {
    resourceId?: string;
    scope?: ResourceScope;
  } = {},
): Promise<void> {
  await context.services.rbac.assertCan(
    context.subject,
    action,
    {
      type: resourceType,
      ...(options.resourceId ? { id: options.resourceId } : {}),
      scope: {
        tenantId: context.tenantId,
        tenantScope: context.request.context.tenantScope,
        ownerId: context.subject.id,
        ...(options.scope ?? {}),
      },
    },
    requestSecurityContext(context),
  );
}

export async function assertRouteObjectAccess(
  context: RouteSecurityContext,
  accessLevel: AccessLevel,
  object: ObjectRef,
): Promise<void> {
  await context.services.objectPermissions.assertCan(
    context.subject,
    accessLevel,
    {
      ...object,
      tenantId: object.tenantId ?? context.tenantId,
    },
    requestSecurityContext(context),
  );
}

export async function authorizePageQuery(
  context: RouteSecurityContext,
  objectType: string,
  accessLevel: AccessLevel,
  query: PageQuery,
): Promise<PageQuery> {
  return withAuthorization(
    query,
    await context.services.objectPermissions.buildAuthorizedQuery(context.subject, objectType, accessLevel),
  );
}

export async function filterAuthorizedItems<T extends object>(
  context: RouteSecurityContext,
  items: T[],
  objectType: string,
  accessLevel: AccessLevel,
  objectIdField = 'id',
): Promise<T[]> {
  const authorization = await context.services.objectPermissions.buildAuthorizedQuery(context.subject, objectType, accessLevel);
  return applyAuthorizationFilter(items, {
    page: 1,
    pageSize: Math.max(items.length, 1),
    filter: {},
    authorization: {
      ...authorization,
      objectIdField,
    },
  });
}

export function requestSecurityContext(context: RouteSecurityContext) {
  return {
    requestId: context.request.context.requestId,
    sourceIp: context.request.context.ip,
    actor: context.subject,
  };
}

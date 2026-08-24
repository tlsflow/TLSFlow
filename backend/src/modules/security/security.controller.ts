import { AppError } from '../../common/errors/app-error.js';
import type { Router } from '../../common/http/router.js';
import type { HttpRequest } from '../../common/http/http-types.js';
import type { RouteContract } from '../../common/openapi/route-contract.js';
import { validateObject } from '../../common/validation/schema-validation.js';
import type { RiskLevel, SecretScopeType, SecretType, SecuritySubject } from '../../shared/security-types.js';
import { RBACService } from '../rbac/rbac.service.js';
import { AuditService } from '../audits/audit.service.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { SecretService } from '../secrets/secret.service.js';
import { CryptoService } from '../secrets/crypto.service.js';
import { KeyManager } from '../secrets/key-manager.service.js';
import { ExecutionGrantService } from '../executions/execution-grant.service.js';

export interface SecurityServices {
  rbac: RBACService;
  audit: AuditService;
  approvals: ApprovalService;
  secrets: SecretService;
}

export function createSecurityServices(): SecurityServices {
  const audit = new AuditService();
  const approvals = new ApprovalService(undefined, audit);
  const grants = new ExecutionGrantService();
  const secrets = new SecretService(new CryptoService(new KeyManager()), grants, audit);
  const rbac = new RBACService(undefined, undefined, undefined, undefined, audit);
  return { rbac, audit, approvals, secrets };
}

export class SecurityController {
  constructor(private readonly services: SecurityServices = createSecurityServices()) {}

  register(router: Router): void {
    router.post('/api/v1/secrets', '创建 Secret', ['Security'], (request) => this.createSecret(request));
    router.get('/api/v1/secrets/metadata', '查询 Secret 元数据', ['Security'], (request) => this.getSecretMetadata(request));
    router.post('/api/v1/approvals', '创建审批单', ['Security'], (request) => this.createApproval(request));
    router.post('/api/v1/approvals/decide', '审批决策', ['Security'], (request) => this.decideApproval(request));
    router.get('/api/v1/audit-events', '查询审计事件', ['Security'], (request) => this.queryAudits(request));
  }

  private createSecret(request: HttpRequest) {
    const body = validateObject(request.body, {
      name: { type: 'string', required: true },
      type: { type: 'string', required: true },
      scopeType: { type: 'string', required: true },
      plainText: { type: 'string', required: true },
      scopeId: { type: 'string' },
    });
    const subject = this.subjectFromRequest(request);
    this.services.rbac.assertCan(subject, 'secret.create', {
      type: 'secret',
      scope: { tenantId: request.context.tenantId, ownerId: subject.id },
    }, this.securityContext(request, subject));

    return {
      statusCode: 201,
      body: this.services.secrets.create({
        name: String(body.name),
        type: body.type as SecretType,
        scopeType: body.scopeType as SecretScopeType,
        scopeId: body.scopeId === undefined ? undefined : String(body.scopeId),
        plainText: String(body.plainText),
        createdBy: subject.id,
      }, this.securityContext(request, subject)),
    };
  }

  private getSecretMetadata(request: HttpRequest) {
    const id = readQueryString(request, 'id');
    const subject = this.subjectFromRequest(request);
    this.services.rbac.assertCan(subject, 'secret.read', {
      type: 'secret',
      id,
      scope: { tenantId: request.context.tenantId },
    }, this.securityContext(request, subject));
    return this.services.secrets.getMetadata(id);
  }

  private createApproval(request: HttpRequest) {
    const body = validateObject(request.body, {
      operationType: { type: 'string', required: true },
      resourceRefs: { type: 'array', required: true },
      riskLevel: { type: 'string', required: true },
      parameters: { type: 'object', required: true },
      expiresAt: { type: 'string' },
    });
    const subject = this.subjectFromRequest(request);
    this.services.rbac.assertCan(subject, 'approval.create', {
      type: 'approval',
      scope: { tenantId: request.context.tenantId },
    }, this.securityContext(request, subject));
    return {
      statusCode: 201,
      body: this.services.approvals.create({
        operationType: String(body.operationType),
        resourceRefs: body.resourceRefs as Array<{ type: string; id: string }>,
        riskLevel: body.riskLevel as RiskLevel,
        parameters: body.parameters,
        requestedBy: subject.id,
        expiresAt: body.expiresAt === undefined ? undefined : String(body.expiresAt),
      }, this.securityContext(request, subject)),
    };
  }

  private decideApproval(request: HttpRequest) {
    const body = validateObject(request.body, {
      approvalId: { type: 'string', required: true },
      decision: { type: 'string', required: true, enum: ['approved', 'rejected'] },
      comment: { type: 'string' },
    });
    const subject = this.subjectFromRequest(request);
    this.services.rbac.assertCan(subject, 'approval.decide', {
      type: 'approval',
      id: String(body.approvalId),
      scope: { tenantId: request.context.tenantId },
    }, this.securityContext(request, subject));
    return this.services.approvals.decide({
      approvalId: String(body.approvalId),
      decision: body.decision as 'approved' | 'rejected',
      approverId: subject.id,
      comment: body.comment === undefined ? undefined : String(body.comment),
    }, this.securityContext(request, subject));
  }

  private queryAudits(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    return {
      items: this.services.audit.queryWithPermission({
        subject,
        query: {
          actorId: readOptionalQueryString(request, 'actorId'),
          eventType: readOptionalQueryString(request, 'eventType'),
          resourceType: readOptionalQueryString(request, 'resourceType'),
          resourceId: readOptionalQueryString(request, 'resourceId'),
          riskLevel: readOptionalQueryString(request, 'riskLevel') as RiskLevel | undefined,
          resourceScope: { tenantId: request.context.tenantId },
        },
        context: this.securityContext(request, subject),
        assertCan: this.services.rbac.assertCan.bind(this.services.rbac),
      }),
      page: 1,
      pageSize: 200,
      total: this.services.audit.query().length,
    };
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    if (!request.context.actorId) {
      throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    }
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId } };
  }

  private securityContext(request: HttpRequest, actor: SecuritySubject) {
    return {
      requestId: request.context.requestId,
      sourceIp: request.context.ip,
      actor,
    };
  }
}

function readQueryString(request: HttpRequest, key: string): string {
  const value = readOptionalQueryString(request, key);
  if (!value) throw new AppError('VALIDATION_FAILED', `缺少查询参数 ${key}`, { field: key });
  return value;
}

function readOptionalQueryString(request: HttpRequest, key: string): string | undefined {
  const value = request.query[key];
  return Array.isArray(value) ? value[0] : value;
}

export function getSecurityRouteContracts(): RouteContract[] {
  return [
    { method: 'POST', path: '/api/v1/secrets', operationId: 'createSecret', summary: '创建 Secret', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/secrets/metadata', operationId: 'getSecretMetadata', summary: '查询 Secret 元数据', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/approvals', operationId: 'createApproval', summary: '创建审批单', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/approvals/decide', operationId: 'decideApproval', summary: '审批决策', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/audit-events', operationId: 'queryAuditEvents', summary: '查询审计事件', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
  ];
}

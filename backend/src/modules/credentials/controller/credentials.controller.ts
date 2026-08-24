import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { CredentialKind, CredentialStatus } from '../../../persistence/entities/credential-profile.entity.js';
import type { SecretScopeType } from '../../../shared/security-types.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { CredentialsApplicationService } from '../application/credentials.application-service.js';
import type { CreateCredentialProfileRequestDto, RotateCredentialProfileRequestDto, UpdateCredentialProfileRequestDto } from '../dto/credentials.dto.js';

const tags = ['Credentials'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class CredentialsController {
  constructor(
    private readonly service = new CredentialsApplicationService(),
    private readonly security?: SecurityServices,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/credentials', '查询全局凭据列表', tags, (request) => this.list(request));
    router.post('/api/v1/credentials', '创建全局凭据档案', tags, (request) => this.create(request));
    router.get('/api/v1/credentials/detail', '查询全局凭据详情', tags, (request) => this.get(request));
    router.get('/api/v1/credentials/usage', '查询全局凭据使用关系', tags, (request) => this.usage(request));
    router.patch('/api/v1/credentials', '更新全局凭据档案', tags, (request) => this.update(request));
    router.post('/api/v1/credentials/rotate', '轮换全局凭据 Secret', tags, (request) => this.rotate(request));
    router.post('/api/v1/credentials/status', '更新全局凭据状态', tags, (request) => this.updateStatus(request));
    router.delete('/api/v1/credentials/delete', '删除全局凭据档案', tags, (request) => this.delete(request));
  }

  private async list(request: HttpRequest) {
    await this.authorize(request, 'credential.read');
    const items = await this.service.list(tenantId(request), {
      kind: queryString(request, 'kind'),
      scopeType: queryString(request, 'scopeType'),
      status: queryString(request, 'status'),
      search: queryString(request, 'search'),
    });
    return { items, page: 1, pageSize: items.length, total: items.length };
  }

  private async get(request: HttpRequest) {
    const credentialId = requiredQueryString(request, 'id');
    await this.authorize(request, 'credential.read', credentialId);
    return this.service.get(tenantId(request), credentialId);
  }

  private async usage(request: HttpRequest) {
    const credentialId = requiredQueryString(request, 'id');
    await this.authorize(request, 'credential.read', credentialId);
    return this.service.usage(tenantId(request), credentialId);
  }

  private async create(request: HttpRequest) {
    const subject = await this.authorize(request, 'credential.create');
    const body = validateObject(request.body, {
      name: { type: 'string', required: true },
      kind: { type: 'string', required: true },
      scopeType: { type: 'string', required: true },
      scopeId: { type: 'string' },
      username: { type: 'string' },
      delivery: { type: 'object' },
      secretValues: { type: 'object', required: true },
      metadata: { type: 'object' },
    });
    const input: CreateCredentialProfileRequestDto = {
      name: String(body.name),
      kind: body.kind as CredentialKind,
      scopeType: body.scopeType as SecretScopeType,
      scopeId: body.scopeId === undefined ? undefined : String(body.scopeId),
      username: body.username === undefined ? undefined : String(body.username),
      delivery: body.delivery as CreateCredentialProfileRequestDto['delivery'],
      secretValues: body.secretValues as CreateCredentialProfileRequestDto['secretValues'],
      metadata: body.metadata as Record<string, unknown> | undefined,
    };
    return { statusCode: 201, body: await this.service.create(tenantId(request), subject.id, input, securityContext(request, subject)) };
  }

  private async update(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      name: { type: 'string' },
      scopeType: { type: 'string' },
      scopeId: { type: 'string' },
      username: { type: 'string' },
      delivery: { type: 'object' },
      secretValues: { type: 'object' },
      metadata: { type: 'object' },
      expectedVersion: { type: 'number', required: true },
    });
    const credentialId = String(body.id);
    const subject = await this.authorize(request, 'credential.update', credentialId);
    if (body.secretValues !== undefined) await this.authorize(request, 'credential.rotate', credentialId);
    return this.service.update(tenantId(request), credentialId, subject.id, {
      name: body.name === undefined ? undefined : String(body.name),
      scopeType: body.scopeType as SecretScopeType | undefined,
      scopeId: body.scopeId === undefined ? undefined : String(body.scopeId),
      username: body.username === undefined ? undefined : String(body.username),
      delivery: body.delivery as UpdateCredentialProfileRequestDto['delivery'],
      secretValues: body.secretValues as UpdateCredentialProfileRequestDto['secretValues'],
      metadata: body.metadata as Record<string, unknown> | undefined,
      expectedVersion: Number(body.expectedVersion),
    }, securityContext(request, subject));
  }

  private async rotate(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      secretValues: { type: 'object', required: true },
      expectedVersion: { type: 'number', required: true },
    });
    const credentialId = String(body.id);
    const subject = await this.authorize(request, 'credential.rotate', credentialId);
    const input: RotateCredentialProfileRequestDto = {
      secretValues: body.secretValues as RotateCredentialProfileRequestDto['secretValues'],
      expectedVersion: Number(body.expectedVersion),
    };
    return this.service.rotate(tenantId(request), credentialId, subject.id, input, securityContext(request, subject));
  }

  private async updateStatus(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      status: { type: 'string', required: true },
      expectedVersion: { type: 'number', required: true },
    });
    const credentialId = String(body.id);
    const subject = await this.authorize(request, 'credential.disable', credentialId);
    return this.service.update(tenantId(request), credentialId, subject.id, {
      status: body.status as CredentialStatus,
      expectedVersion: Number(body.expectedVersion),
    }, securityContext(request, subject));
  }

  private async delete(request: HttpRequest) {
    const credentialId = requiredBodyString(request, 'id');
    const subject = await this.authorize(request, 'credential.delete', credentialId);
    return this.service.delete(tenantId(request), credentialId, subject.id, securityContext(request, subject));
  }

  private async authorize(request: HttpRequest, action: string, id?: string): Promise<SecuritySubject> {
    const subject = this.subjectFromRequest(request);
    await this.security?.rbac.assertCan(subject, action, {
      type: 'credential', id, scope: { tenantId: request.context.tenantId, ownerId: subject.id },
    }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
    return subject;
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    if (!this.security) {
      return {
        id: request.context.actorId ?? 'system_credentials',
        type: 'system',
        scope: { tenantId: request.context.tenantId },
      };
    }
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId } };
  }
}

function tenantId(request: HttpRequest): string {
  return request.context.tenantId ?? tenantFallback;
}

function queryString(request: HttpRequest, name: string): string | undefined {
  const value = request.query[name];
  return Array.isArray(value) ? value[0] : value;
}

function requiredQueryString(request: HttpRequest, name: string): string {
  const value = queryString(request, name)?.trim();
  if (!value) throw new AppError('VALIDATION_FAILED', `${name} 不能为空`, { field: name });
  return value;
}

function requiredBodyString(request: HttpRequest, name: string): string {
  const value = (request.body as Record<string, unknown> | undefined)?.[name];
  if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_FAILED', `${name} 不能为空`, { field: name });
  return value.trim();
}

function securityContext(request: HttpRequest, actor: SecuritySubject) {
  return { requestId: request.context.requestId, sourceIp: request.context.ip, actor };
}

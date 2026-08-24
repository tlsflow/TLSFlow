import { parsePageQuery } from '../../../common/pagination/pagination.js';
import type { Router } from '../../../common/http/router.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { AppError } from '../../../common/errors/app-error.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import {
  CapabilityConstraintOperators,
  CapabilityDeclarationSources,
  CapabilityDeclarationStatuses,
  CapabilityOwnerTypes,
  CapabilityRiskLevels,
  CapabilityTargetTypes,
} from '../../../shared/enums/core.enums.js';
import { CapabilitiesApplicationService } from '../application/capabilities.application-service.js';
import type {
  CapabilityConstraint,
  CapabilityRequirement,
} from '../../../shared/contracts/capability-contracts.js';

const tags = ['Capabilities'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class CapabilitiesController {
  constructor(private readonly service = new CapabilitiesApplicationService()) {}

  register(router: Router): void {
    router.get('/api/v1/capabilities/definitions', '查询能力字典', tags, () => this.service.listDefinitions());
    router.get('/api/v1/capabilities/declarations', '查询能力声明', tags, (request) => this.listDeclarations(request));
    router.post('/api/v1/capabilities/declarations', '创建标准能力声明', tags, (request) => ({ statusCode: 201, body: this.createDeclaration(request) }));
    router.post('/api/v1/capabilities/declarations/manual', '创建人工能力声明', tags, (request) => ({ statusCode: 201, body: this.createManualDeclaration(request) }));
    router.get('/api/v1/capabilities/requirements', '查询能力需求', tags, (request) => this.listRequirements(request));
    router.post('/api/v1/capabilities/requirements', '注册能力需求', tags, (request) => ({ statusCode: 201, body: this.registerRequirement(request) }));
    router.post('/api/v1/capabilities/match', '执行能力匹配', tags, (request) => this.matchRequirement(request));
    router.post('/api/v1/capabilities/compatibility/evaluate', '计算兼容等级', tags, (request) => ({ statusCode: 201, body: this.evaluateCompatibility(request) }));
  }

  getApplicationService(): CapabilitiesApplicationService {
    return this.service;
  }

  private listDeclarations(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['capabilityKey', 'targetType', 'targetId', 'source', 'status', 'confidence'],
      allowedFilterFields: ['targetType', 'targetId', 'capabilityKey', 'source', 'status'],
    });
    return this.service.listDeclarations(tenantId(request), query);
  }

  private createDeclaration(request: HttpRequest) {
    const body = validateObject(request.body, {
      tenantId: { type: 'string' },
      targetType: { type: 'string', required: true, enum: CapabilityTargetTypes },
      targetId: { type: 'string', required: true },
      capabilityKey: { type: 'string', required: true },
      source: { type: 'string', required: true, enum: CapabilityDeclarationSources.filter((item) => item !== 'manual') },
      confidence: { type: 'number', required: true },
      parameters: { type: 'object' },
      evidence: { type: 'object' },
      detectedAt: { type: 'string' },
      expiresAt: { type: 'string' },
      status: { type: 'string', enum: CapabilityDeclarationStatuses },
      createdBy: { type: 'string' },
      auditRef: { type: 'string' },
    });
    return this.service.createDeclaration({
      ...body,
      tenantId: String(body.tenantId ?? tenantId(request)),
      value: readValue(request.body),
    } as any);
  }

  private createManualDeclaration(request: HttpRequest) {
    const body = validateObject(request.body, {
      tenantId: { type: 'string' },
      targetType: { type: 'string', required: true, enum: CapabilityTargetTypes },
      targetId: { type: 'string', required: true },
      capabilityKey: { type: 'string', required: true },
      confidence: { type: 'number', required: true },
      parameters: { type: 'object' },
      evidence: { type: 'object', required: true },
      expiresAt: { type: 'string' },
      createdBy: { type: 'string', required: true },
      auditRef: { type: 'string', required: true },
    });
    return this.service.createManualDeclaration({
      ...body,
      tenantId: String(body.tenantId ?? tenantId(request)),
      source: 'manual',
      value: readValue(request.body),
    } as any);
  }

  private listRequirements(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['ownerType', 'ownerId', 'riskLevel', 'minConfidence'],
      allowedFilterFields: ['ownerType', 'ownerId', 'riskLevel'],
    });
    return this.service.listRequirements(query);
  }

  private registerRequirement(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string' },
      ownerType: { type: 'string', required: true, enum: CapabilityOwnerTypes },
      ownerId: { type: 'string', required: true },
      requiredAll: { type: 'array', required: true },
      optional: { type: 'array' },
      anyOfGroups: { type: 'array' },
      forbidden: { type: 'array' },
      minConfidence: { type: 'number' },
      allowManual: { type: 'boolean' },
      riskLevel: { type: 'string', required: true, enum: CapabilityRiskLevels },
    });
    return this.service.registerRequirement(this.coerceRequirement(body));
  }

  private matchRequirement(request: HttpRequest) {
    const body = validateObject(request.body, {
      requirement: { type: 'object', required: true },
      context: { type: 'object' },
      declarations: { type: 'array', required: true },
    });
    return this.service.matchRequirement((body.requirement as CapabilityRequirement), body.declarations as any, body.context as any);
  }

  private evaluateCompatibility(request: HttpRequest) {
    const body = validateObject(request.body, {
      tenantId: { type: 'string' },
      targetType: { type: 'string', required: true, enum: CapabilityTargetTypes },
      targetId: { type: 'string', required: true },
      declarations: { type: 'array', required: true },
      criticalCapabilityKeys: { type: 'array' },
      sourceSnapshotId: { type: 'string' },
    });
    return this.service.evaluateCompatibility({
      ...body,
      tenantId: String(body.tenantId ?? tenantId(request)),
      declarations: body.declarations as any,
    } as any);
  }

  private coerceRequirement(input: Record<string, unknown>) {
    return {
      id: input.id as string | undefined,
      ownerType: input.ownerType as CapabilityRequirement['ownerType'],
      ownerId: input.ownerId as string,
      requiredAll: toConstraintList(input.requiredAll, 'requiredAll'),
      optional: toConstraintList(input.optional, 'optional'),
      anyOfGroups: Array.isArray(input.anyOfGroups) ? input.anyOfGroups.map((group, index) => toConstraintList(group, `anyOfGroups[${index}]`)) : [],
      forbidden: toConstraintList(input.forbidden, 'forbidden'),
      minConfidence: input.minConfidence as number | undefined,
      allowManual: input.allowManual as boolean | undefined,
      riskLevel: input.riskLevel as CapabilityRequirement['riskLevel'],
    };
  }
}

export function getCapabilitiesRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/capabilities/definitions', operationId: 'listCapabilityDefinitions', summary: '查询能力字典', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/capabilities/declarations', operationId: 'listCapabilityDeclarations', summary: '查询能力声明', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/capabilities/declarations', operationId: 'createCapabilityDeclaration', summary: '创建标准能力声明', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/capabilities/declarations/manual', operationId: 'createManualCapabilityDeclaration', summary: '创建人工能力声明', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/capabilities/requirements', operationId: 'listCapabilityRequirements', summary: '查询能力需求', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/capabilities/requirements', operationId: 'createCapabilityRequirement', summary: '注册能力需求', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/capabilities/match', operationId: 'matchCapabilityRequirement', summary: '执行能力匹配', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/capabilities/compatibility/evaluate', operationId: 'evaluateCapabilityCompatibility', summary: '计算兼容等级', tags, responseSchema: objectSchema() },
  ];
}

function toConstraintList(value: unknown, field: string): CapabilityConstraint[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new AppError('VALIDATION_FAILED', `${field} 必须是数组`, { field });
  }
    return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new AppError('VALIDATION_FAILED', `${field}[${index}] 必须是对象`, { field: `${field}[${index}]` });
    }
    const constraint = item as Record<string, unknown>;
    if (typeof constraint.capabilityKey !== 'string') throw new AppError('VALIDATION_FAILED', `${field}[${index}].capabilityKey 必须是字符串`, { field: `${field}[${index}].capabilityKey` });
    if (typeof constraint.operator !== 'string' || !CapabilityConstraintOperators.includes(constraint.operator as any)) throw new AppError('VALIDATION_FAILED', `${field}[${index}].operator 不合法`, { field: `${field}[${index}].operator` });
    if (typeof constraint.reason !== 'string') throw new AppError('VALIDATION_FAILED', `${field}[${index}].reason 必须是字符串`, { field: `${field}[${index}].reason` });
    if (typeof constraint.riskIfMissing !== 'string') throw new AppError('VALIDATION_FAILED', `${field}[${index}].riskIfMissing 必须是字符串`, { field: `${field}[${index}].riskIfMissing` });
    return {
      capabilityKey: constraint.capabilityKey,
      operator: constraint.operator as CapabilityConstraint['operator'],
      expected: constraint.expected,
      scope: (constraint.scope && typeof constraint.scope === 'object' && !Array.isArray(constraint.scope)) ? (constraint.scope as Record<string, unknown>) : undefined,
      reason: constraint.reason,
      riskIfMissing: constraint.riskIfMissing,
    };
  });
}

function tenantId(request: HttpRequest): string {
  return request.context.tenantId ?? tenantFallback;
}

function readValue(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(body, 'value')) {
    throw new AppError('VALIDATION_FAILED', 'value 不能为空', { field: 'value' });
  }
  return (body as Record<string, unknown>).value;
}

function objectSchema() {
  return { type: 'object', additionalProperties: true };
}

function pageSchema() {
  return {
    type: 'object',
    required: ['items', 'page', 'pageSize', 'total'],
    properties: {
      items: { type: 'array', items: { type: 'object', additionalProperties: true } },
      page: { type: 'number' },
      pageSize: { type: 'number' },
      total: { type: 'number' },
    },
  };
}

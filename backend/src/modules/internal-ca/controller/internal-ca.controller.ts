import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import type { CaOperationsPermissionAction } from '../ca-operations.security.js';
import type { CaOperationsRecordQueryDto, CreateCaSyncRunsDto } from '../dto/ca-operations.dto.js';
import type {
  CreateAuthorityInput,
  CreateCaProviderInput,
  CreateCaTrustDomainInput,
  CreateCertificateRequestInput,
  CreateProfileInput,
  InternalCaApplicationService,
  PreviewCaInput,
  UpdateCaTrustDomainInput,
} from '../application/internal-ca.application-service.js';

const tags = ['Internal CA'];

export class InternalCaController {
  constructor(
    private readonly service: InternalCaApplicationService,
    private readonly security: SecurityServices,
    ..._unusedAssemblyArguments: unknown[]
  ) {}

  register(router: Router): void {
    router.get('/api/v1/ca-providers', '查询通用 CA Provider', tags, (request) => this.listProviders(request));
    router.post('/api/v1/ca-providers', '创建通用 CA Provider', tags, (request) => this.createProvider(request));
    router.delete('/api/v1/ca-providers/:id', '删除未绑定的 CA Provider', tags, (request) => this.deleteProvider(request));
    router.post('/api/v1/ca-providers/:id/test', '检查 CA Provider 合同状态', tags, (request) => this.testProvider(request));
    router.get('/api/v1/ca-operations/tree', '查询 CA 运营资源树', tags, (request) => this.listOperationsTree(request));
    router.get('/api/v1/ca-operations/records', '查询 CA 运营记录', tags, (request) => this.listOperationRecords(request));
    router.get('/api/v1/ca-operations/records/:recordKey', '查询 CA 运营记录详情', tags, (request) => this.getOperationRecord(request));
    router.post('/api/v1/ca-operations/sync-runs', '创建 CA 历史同步运行', tags, (request) => this.createSyncRuns(request));
    router.get('/api/v1/ca-operations/sync-runs', '查询 CA 历史同步运行', tags, (request) => this.listSyncRuns(request));
    router.get('/api/v1/ca-trust-domains', '查询 CA 信任域', tags, (request) => this.listTrustDomains(request));
    router.post('/api/v1/ca-trust-domains', '创建 CA 信任域', tags, (request) => this.createTrustDomain(request));
    router.patch('/api/v1/ca-trust-domains/:id', '更新 CA 信任域', tags, (request) => this.updateTrustDomain(request));
    router.get('/api/v1/certificate-authorities', '查询证书机构', tags, (request) => this.listAuthorities(request));
    router.post('/api/v1/certificate-authorities/preview', '预览 CA 拓扑风险', tags, (request) => this.previewAuthority(request));
    router.post('/api/v1/certificate-authorities', '创建证书机构对象', tags, (request) => this.createAuthority(request));
    router.get('/api/v1/certificate-profiles', '查询证书 Profile', tags, (request) => this.listProfiles(request));
    router.post('/api/v1/certificate-profiles', '创建证书 Profile', tags, (request) => this.createProfile(request));
    router.post('/api/v1/certificate-profiles/:id/versions', '创建证书 Profile 版本', tags, (request) => this.createProfileVersion(request));
    router.get('/api/v1/certificate-requests', '查询证书申请', tags, (request) => this.listRequests(request));
    router.post('/api/v1/certificate-requests', '创建证书申请对象', tags, (request) => this.createRequest(request));
    router.post('/api/v1/certificate-requests/:id/approve', '审批证书申请', tags, (request) => this.approveRequest(request));
    router.post('/api/v1/certificate-requests/:id/retry', '请求插件重试签发', tags, (request) => this.issueRequest(request));
    router.post('/api/v1/certificate-requests/:id/query', '查询插件签发结果', tags, (request) => this.queryRequest(request));
    router.post('/api/v1/certificate-requests/:id/activate', '确认应用证书已安装', tags, (request) => this.activateRequest(request));
    router.get('/api/v1/certificate-renewals', '查询证书续期任务', tags, (request) => this.listRenewals(request));
    router.post('/api/v1/certificate-renewals/scan', '创建通用证书续期任务', tags, (request) => this.scanRenewals(request));
    router.get('/api/v1/certificate-revocations', '查询证书吊销任务', tags, (request) => this.listRevocations(request));
    router.post('/api/v1/certificate-revocations', '创建证书吊销任务', tags, (request) => this.createRevocation(request));
    router.post('/api/v1/certificate-revocations/:id/approve', '审批证书吊销任务', tags, (request) => this.approveRevocation(request));
    router.get('/api/v1/ca-trust-distributions', '查询 CA 信任分发任务', tags, (request) => this.listTrustDistributions(request));
    router.post('/api/v1/ca-trust-distributions', '创建 CA 信任分发任务', tags, (request) => this.createTrustDistribution(request));
    router.post('/api/v1/ca-trust-distributions/:id/approve', '审批 CA 信任分发任务', tags, (request) => this.approveTrustDistribution(request));
    router.post('/api/v1/ca-trust-distributions/:id/complete', '回传 CA 信任分发验证结果', tags, (request) => this.completeTrustDistribution(request));
    router.get('/api/v1/reports/certificate-reuse/overview', '查询证书复用风险摘要', tags, (request) => this.certificateReuseOverview(request));
    router.get('/api/v1/reports/certificate-reuse/items', '查询证书复用风险明细', tags, (request) => this.certificateReuseItems(request));
    router.get('/api/v1/reports/certificate-reuse/export', '导出证书复用风险', tags, (request) => this.exportCertificateReuse(request));
    router.post('/api/v1/reports/certificate-reuse/:id/remediation-preview', '预览证书复用风险整改', tags, (request) => this.previewCertificateReuseRemediation(request));
    router.get('/api/v1/ca-nodes', '查询受控 CA Node', tags, (request) => this.listNodes(request));
    router.post('/api/v1/ca-nodes/enrollment-tokens', '创建 CA Node 注册令牌', tags, (request) => this.createNodeEnrollmentToken(request));
    router.post('/api/v1/ca-nodes/register', '注册 CA Node', tags, (request) => this.registerNode(request));
    router.post('/api/v1/ca-nodes/heartbeat', '上报 CA Node 心跳', tags, (request) => this.heartbeatNode(request));
    router.post('/api/v1/ca-nodes/tasks/lease', '获取 CA Node 任务', tags, (request) => this.leaseNodeTask(request));
    router.post('/api/v1/ca-nodes/tasks/:id/result', '回传 CA Node 任务结果', tags, (request) => this.completeNodeTask(request));
  }

  private async listProviders(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'ca_provider');
    return this.service.listProviders(tenantId(request));
  }

  private async createProvider(request: HttpRequest) {
    await this.assertAction(request, 'ca.provider.manage', 'ca_provider');
    return { statusCode: 201, body: await this.service.createProvider(tenantId(request), objectBody(request) as unknown as CreateCaProviderInput, actorId(request), request.context) };
  }

  private async deleteProvider(request: HttpRequest) {
    await this.assertAction(request, 'ca.provider.manage', 'ca_provider');
    return this.service.deleteProvider(tenantId(request), pathId(request), actorId(request), request.context);
  }

  private async testProvider(request: HttpRequest) {
    await this.assertAction(request, 'ca.provider.manage', 'ca_provider');
    return this.service.testProvider(tenantId(request), pathId(request));
  }

  private async listOperationsTree(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'caOperation');
    return this.service.listCaOperationsTree(tenantId(request), async () => true);
  }

  private async listOperationRecords(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'caOperation');
    return this.service.listCaOperationsRecords(tenantId(request), operationQuery(request));
  }

  private async getOperationRecord(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'caOperation');
    return this.service.getCaOperationsRecord(tenantId(request), lastPathSegment(request));
  }

  private async createSyncRuns(request: HttpRequest) {
    const rawBody = objectBody(request);
    const body = rawBody as unknown as CreateCaSyncRunsDto;
    await this.assertAction(request, body.mode === 'full' ? 'ca.operations.sync.full' : 'ca.operations.sync', 'certificate_authority');
    return { statusCode: 202, body: await this.service.createCaSyncRuns({
      tenantId: tenantId(request), providerId: requiredString(rawBody, 'providerId'), caId: requiredString(rawBody, 'caId'),
      objectTypes: body.objectTypes, mode: body.mode, actor: subjectFromRequest(request), context: request.context,
    }) };
  }

  private async listSyncRuns(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'caOperation');
    return { items: await this.service.listCaSyncRuns(tenantId(request), optionalQuery(request, 'caId')) };
  }

  private async listTrustDomains(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'ca_trust_domain');
    return this.service.listTrustDomains(tenantId(request));
  }

  private async createTrustDomain(request: HttpRequest) {
    await this.assertAction(request, 'ca.authority.manage', 'ca_trust_domain');
    return { statusCode: 201, body: await this.service.createTrustDomain(tenantId(request), objectBody(request) as unknown as CreateCaTrustDomainInput, actorId(request), request.context) };
  }

  private async updateTrustDomain(request: HttpRequest) {
    await this.assertAction(request, 'ca.authority.manage', 'ca_trust_domain');
    return this.service.updateTrustDomain(tenantId(request), pathId(request), objectBody(request) as unknown as UpdateCaTrustDomainInput, actorId(request), request.context);
  }

  private async listAuthorities(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'certificate_authority');
    return this.service.listAuthorities(tenantId(request));
  }

  private async previewAuthority(request: HttpRequest) {
    await this.assertAction(request, 'ca.authority.manage', 'certificate_authority');
    return this.service.previewAuthority(objectBody(request) as unknown as PreviewCaInput);
  }

  private async createAuthority(request: HttpRequest) {
    await this.assertAction(request, 'ca.authority.manage', 'certificate_authority');
    const body = objectBody(request);
    return { statusCode: 201, body: await this.service.createAuthority(tenantId(request), { ...body, actorId: actorId(request) } as unknown as CreateAuthorityInput, request.context) };
  }

  private async listProfiles(request: HttpRequest) {
    await this.assertAction(request, 'ca.template.mapping.read', 'certificate_profile');
    return this.service.listProfiles(tenantId(request));
  }

  private async createProfile(request: HttpRequest) {
    await this.assertAction(request, 'ca.template.mapping.manage', 'certificate_profile');
    const body = objectBody(request);
    return { statusCode: 201, body: await this.service.createProfile(tenantId(request), { ...body, actorId: actorId(request) } as unknown as CreateProfileInput) };
  }

  private async createProfileVersion(request: HttpRequest) {
    await this.assertAction(request, 'ca.template.mapping.manage', 'certificate_profile');
    return this.service.createProfileVersion(tenantId(request), pathId(request), objectBody(request), actorId(request));
  }

  private async listRequests(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'certificate_request');
    return this.service.listRequests(tenantId(request));
  }

  private async createRequest(request: HttpRequest) {
    await this.assertAction(request, 'ca.request.retry', 'certificate_request');
    const body = objectBody(request);
    return { statusCode: 201, body: await this.service.createCertificateRequest(tenantId(request), { ...body, actorId: actorId(request) } as unknown as CreateCertificateRequestInput, request.context) };
  }

  private async approveRequest(request: HttpRequest) {
    await this.assertAction(request, 'ca.request.approve', 'certificate_request');
    return this.service.approveRequest(tenantId(request), pathId(request), actorId(request), optionalString(objectBody(request).approvalId), request.context);
  }

  private async issueRequest(request: HttpRequest) {
    await this.assertAction(request, 'ca.request.retry', 'certificate_request');
    return this.service.issueRequest(tenantId(request), pathId(request), actorId(request), request.context);
  }

  private async queryRequest(request: HttpRequest) {
    await this.assertAction(request, 'ca.request.retry', 'certificate_request');
    return this.service.refreshRequestIssuance(tenantId(request), pathId(request), actorId(request), request.context);
  }

  private async activateRequest(request: HttpRequest) {
    await this.assertAction(request, 'ca.request.approve', 'certificate_request');
    return this.service.markRequestActive(tenantId(request), pathId(request));
  }

  private async listRenewals(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'certificate_renewal');
    return this.service.listRenewals(tenantId(request));
  }

  private async scanRenewals(request: HttpRequest) {
    await this.assertAction(request, 'ca.request.retry', 'certificate_renewal');
    return this.service.scheduleDueRenewals(tenantId(request), actorId(request), new Date(), request.context);
  }

  private async listRevocations(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'certificate_revocation');
    return this.service.listRevocations(tenantId(request));
  }

  private async createRevocation(request: HttpRequest) {
    await this.assertAction(request, 'ca.certificate.revoke', 'certificate_revocation');
    const body = objectBody(request);
    return { statusCode: 201, body: await this.service.requestRevocation(tenantId(request), requiredString(body, 'certificateVersionId'), requiredString(body, 'reason'), actorId(request), request.context) };
  }

  private async approveRevocation(request: HttpRequest) {
    await this.assertAction(request, 'ca.certificate.revoke', 'certificate_revocation');
    return this.service.approveRevocation(tenantId(request), pathId(request), requiredString(objectBody(request), 'approvalId'), actorId(request));
  }

  private async listTrustDistributions(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'trust_distribution');
    return this.service.listTrustDistributions(tenantId(request));
  }

  private async createTrustDistribution(request: HttpRequest) {
    await this.assertAction(request, 'ca.authority.manage', 'trust_distribution');
    const body = objectBody(request);
    if (!body.targetScope || typeof body.targetScope !== 'object' || Array.isArray(body.targetScope)) throw new AppError('VALIDATION_FAILED', 'targetScope 必须是对象');
    return { statusCode: 201, body: await this.service.createTrustDistribution(tenantId(request), requiredString(body, 'caId'), body.targetScope as Record<string, unknown>, actorId(request), request.context) };
  }

  private async approveTrustDistribution(request: HttpRequest) {
    await this.assertAction(request, 'ca.authority.manage', 'trust_distribution');
    return this.service.approveTrustDistribution(tenantId(request), pathId(request), requiredString(objectBody(request), 'approvalId'));
  }

  private async completeTrustDistribution(request: HttpRequest) {
    await this.assertAction(request, 'ca.authority.manage', 'trust_distribution');
    const body = objectBody(request);
    const verification = body.verification && typeof body.verification === 'object' && !Array.isArray(body.verification) ? body.verification as Record<string, unknown> : {};
    return this.service.completeTrustDistribution(tenantId(request), pathId(request), body.verified === true, verification);
  }

  private async certificateReuseOverview(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'certificate_reuse_risk');
    return this.service.certificateReuseRiskOverview(tenantId(request));
  }

  private async certificateReuseItems(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'certificate_reuse_risk');
    return this.service.analyzeCertificateReuseRisks(tenantId(request));
  }

  private async exportCertificateReuse(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'certificate_reuse_risk');
    return { statusCode: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="certificate-reuse-risks.csv"' }, body: await this.service.exportCertificateReuseRisks(tenantId(request)) };
  }

  private async previewCertificateReuseRemediation(request: HttpRequest) {
    await this.assertAction(request, 'ca.authority.manage', 'certificate_reuse_risk');
    return this.service.previewCertificateReuseRemediation(tenantId(request), pathId(request));
  }

  private async listNodes(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'ca_node');
    return this.service.listNodes(tenantId(request), optionalQuery(request, 'providerId'));
  }

  private async createNodeEnrollmentToken(request: HttpRequest) {
    await this.assertAction(request, 'ca.provider.manage', 'ca_node');
    const body = objectBody(request);
    return this.service.createNodeEnrollmentToken(tenantId(request), requiredString(body, 'providerId'), actorId(request), optionalNumber(body, 'ttlMinutes') ?? 15);
  }

  private async registerNode(request: HttpRequest) {
    return { statusCode: 201, body: await this.service.registerNode(objectBody(request) as never) };
  }

  private async heartbeatNode(request: HttpRequest) {
    const body = objectBody(request);
    const node = await this.authenticateNode(request, body);
    return this.service.heartbeatNode(node.tenantId, node.id, body as never);
  }

  private async leaseNodeTask(request: HttpRequest) {
    const node = await this.authenticateNode(request, objectBody(request));
    return this.service.leaseNodeTask(node.tenantId, node.id);
  }

  private async completeNodeTask(request: HttpRequest) {
    const body = objectBody(request);
    const node = await this.authenticateNode(request, body);
    return this.service.completeNodeTask(node.tenantId, node.id, pathId(request), body as never);
  }

  private authenticateNode(request: HttpRequest, body: Record<string, unknown>) {
    return this.service.verifyNodeRequest({
      tenantId: String(request.headers['x-tenant-id'] ?? tenantId(request)),
      nodeId: String(request.headers['x-gcac-node-id'] ?? requiredString(body, 'nodeId')),
      method: request.method,
      path: request.path,
      timestamp: String(request.headers['x-gcac-timestamp'] ?? ''),
      nonce: String(request.headers['x-gcac-nonce'] ?? ''),
      signature: String(request.headers['x-gcac-signature'] ?? ''),
      body,
    });
  }

  private async assertAction(request: HttpRequest, action: CaOperationsPermissionAction, resourceType: string): Promise<void> {
    const subject = subjectFromRequest(request);
    await this.security.rbac.assertCan(subject, action, {
      type: resourceType,
      scope: { tenantId: tenantId(request), tenantScope: request.context.tenantScope, ownerId: subject.id, resourceType },
    }, request.context);
  }
}

export function getInternalCaRouteContracts(): RouteContract[] {
  const responseSchema = { type: 'object', additionalProperties: true } as const;
  const arraySchema = { type: 'array', items: responseSchema } as const;
  const routes: Array<[RouteContract['method'], string, string, string, typeof responseSchema | typeof arraySchema]> = [
    ['GET', '/api/v1/ca-providers', 'listCaProviders', '查询通用 CA Provider', arraySchema],
    ['POST', '/api/v1/ca-providers', 'createCaProvider', '创建通用 CA Provider', responseSchema],
    ['DELETE', '/api/v1/ca-providers/:id', 'deleteCaProvider', '删除未绑定的 CA Provider', responseSchema],
    ['POST', '/api/v1/ca-providers/:id/test', 'testCaProvider', '检查 CA Provider 合同状态', responseSchema],
    ['GET', '/api/v1/ca-operations/tree', 'listCaOperationsTree', '查询 CA 运营资源树', responseSchema],
    ['GET', '/api/v1/ca-operations/records', 'listCaOperationRecords', '查询 CA 运营记录', responseSchema],
    ['GET', '/api/v1/ca-operations/records/:recordKey', 'getCaOperationRecord', '查询 CA 运营记录详情', responseSchema],
    ['POST', '/api/v1/ca-operations/sync-runs', 'createCaSyncRuns', '创建 CA 历史同步运行', responseSchema],
    ['GET', '/api/v1/ca-operations/sync-runs', 'listCaSyncRuns', '查询 CA 历史同步运行', responseSchema],
    ['GET', '/api/v1/ca-trust-domains', 'listCaTrustDomains', '查询 CA 信任域', arraySchema],
    ['POST', '/api/v1/ca-trust-domains', 'createCaTrustDomain', '创建 CA 信任域', responseSchema],
    ['PATCH', '/api/v1/ca-trust-domains/:id', 'updateCaTrustDomain', '更新 CA 信任域', responseSchema],
    ['GET', '/api/v1/certificate-authorities', 'listCertificateAuthorities', '查询证书机构', arraySchema],
    ['POST', '/api/v1/certificate-authorities/preview', 'previewCertificateAuthority', '预览 CA 拓扑风险', responseSchema],
    ['POST', '/api/v1/certificate-authorities', 'createCertificateAuthority', '创建证书机构对象', arraySchema],
    ['GET', '/api/v1/certificate-profiles', 'listCertificateProfiles', '查询证书 Profile', arraySchema],
    ['POST', '/api/v1/certificate-profiles', 'createCertificateProfile', '创建证书 Profile', responseSchema],
    ['POST', '/api/v1/certificate-profiles/:id/versions', 'createCertificateProfileVersion', '创建证书 Profile 版本', responseSchema],
    ['GET', '/api/v1/certificate-requests', 'listCertificateRequests', '查询证书申请', arraySchema],
    ['POST', '/api/v1/certificate-requests', 'createCertificateRequest', '创建证书申请对象', responseSchema],
    ['POST', '/api/v1/certificate-requests/:id/approve', 'approveCertificateRequest', '审批证书申请', responseSchema],
    ['POST', '/api/v1/certificate-requests/:id/retry', 'retryCertificateRequest', '请求插件重试签发', responseSchema],
    ['POST', '/api/v1/certificate-requests/:id/query', 'queryCertificateRequest', '查询插件签发结果', responseSchema],
    ['POST', '/api/v1/certificate-requests/:id/activate', 'activateCertificateRequest', '确认应用证书已安装', responseSchema],
    ['GET', '/api/v1/certificate-renewals', 'listCertificateRenewals', '查询证书续期任务', arraySchema],
    ['POST', '/api/v1/certificate-renewals/scan', 'scanCertificateRenewals', '创建通用证书续期任务', arraySchema],
    ['GET', '/api/v1/certificate-revocations', 'listCertificateRevocations', '查询证书吊销任务', arraySchema],
    ['POST', '/api/v1/certificate-revocations', 'createCertificateRevocation', '创建证书吊销任务', responseSchema],
    ['POST', '/api/v1/certificate-revocations/:id/approve', 'approveCertificateRevocation', '审批证书吊销任务', responseSchema],
    ['GET', '/api/v1/ca-trust-distributions', 'listCaTrustDistributions', '查询 CA 信任分发任务', arraySchema],
    ['POST', '/api/v1/ca-trust-distributions', 'createCaTrustDistribution', '创建 CA 信任分发任务', responseSchema],
    ['POST', '/api/v1/ca-trust-distributions/:id/approve', 'approveCaTrustDistribution', '审批 CA 信任分发任务', responseSchema],
    ['POST', '/api/v1/ca-trust-distributions/:id/complete', 'completeCaTrustDistribution', '回传 CA 信任分发验证结果', responseSchema],
    ['GET', '/api/v1/reports/certificate-reuse/overview', 'getCertificateReuseRiskOverview', '查询证书复用风险摘要', responseSchema],
    ['GET', '/api/v1/reports/certificate-reuse/items', 'listCertificateReuseRisks', '查询证书复用风险明细', arraySchema],
    ['GET', '/api/v1/reports/certificate-reuse/export', 'exportCertificateReuseRisks', '导出证书复用风险', responseSchema],
    ['POST', '/api/v1/reports/certificate-reuse/:id/remediation-preview', 'previewCertificateReuseRemediation', '预览证书复用风险整改', responseSchema],
    ['GET', '/api/v1/ca-nodes', 'listCaNodes', '查询受控 CA Node', arraySchema],
    ['POST', '/api/v1/ca-nodes/enrollment-tokens', 'createCaNodeEnrollmentToken', '创建 CA Node 注册令牌', responseSchema],
    ['POST', '/api/v1/ca-nodes/register', 'registerCaNode', '注册 CA Node', responseSchema],
    ['POST', '/api/v1/ca-nodes/heartbeat', 'heartbeatCaNode', '上报 CA Node 心跳', responseSchema],
    ['POST', '/api/v1/ca-nodes/tasks/lease', 'leaseCaNodeTask', '获取 CA Node 任务', responseSchema],
    ['POST', '/api/v1/ca-nodes/tasks/:id/result', 'completeCaNodeTask', '回传 CA Node 任务结果', responseSchema],
  ];
  return routes.map(([method, path, operationId, summary, responseSchema]) => ({ method, path, operationId, summary, tags, responseSchema }));
}

function tenantId(request: HttpRequest): string {
  return requireTenantId(request);
}

function actorId(request: HttpRequest): string {
  return request.context.actorId ?? 'system';
}

function subjectFromRequest(request: HttpRequest): SecuritySubject {
  const id = actorId(request);
  return {
    id,
    type: id === 'system' ? 'system' : 'user',
    scope: { tenantId: tenantId(request), tenantScope: request.context.tenantScope },
  };
}

function objectBody(request: HttpRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw new AppError('VALIDATION_FAILED', '请求体必须是对象');
  return request.body as Record<string, unknown>;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_FAILED', `${key} 不能为空`, { key });
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalQuery(request: HttpRequest, key: string): string | undefined {
  const value = request.query[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function pathId(request: HttpRequest): string {
  return lastPathSegment(request);
}

function lastPathSegment(request: HttpRequest): string {
  const value = request.path.split('/').filter(Boolean).at(-1);
  if (!value) throw new AppError('VALIDATION_FAILED', '路径缺少资源 ID');
  return value;
}

function operationQuery(request: HttpRequest): CaOperationsRecordQueryDto {
  const view = optionalQuery(request, 'view');
  if (!view || !['request', 'issuance', 'revocation', 'template'].includes(view)) throw new AppError('CA_OPERATIONS_QUERY_INVALID', '运营查询视图无效');
  const status = request.query.status;
  const statuses = typeof status === 'string' ? status.split(',').filter(Boolean) : Array.isArray(status) ? status : undefined;
  return {
    caId: requiredQuery(request, 'caId'),
    view: view as CaOperationsRecordQueryDto['view'],
    status: statuses as CaOperationsRecordQueryDto['status'],
    source: (typeof request.query.source === 'string' ? request.query.source.split(',').filter(Boolean) : undefined) as CaOperationsRecordQueryDto['source'],
    query: optionalQuery(request, 'query'),
    from: optionalQuery(request, 'from'),
    to: optionalQuery(request, 'to'),
    sort: optionalQuery(request, 'sort'),
    cursor: optionalQuery(request, 'cursor'),
    limit: optionalNumber(request.query as Record<string, unknown>, 'limit'),
  };
}

function requiredQuery(request: HttpRequest, key: string): string {
  const value = optionalQuery(request, key);
  if (!value) throw new AppError('VALIDATION_FAILED', `查询参数 ${key} 不能为空`, { key });
  return value;
}

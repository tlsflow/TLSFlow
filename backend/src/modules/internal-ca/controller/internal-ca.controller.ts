import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
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
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class InternalCaController {
  constructor(private readonly service: InternalCaApplicationService, private readonly security: SecurityServices) {}

  register(router: Router): void {
    router.get('/api/v1/ca-providers', '查询 CA Provider', tags, (request) => this.listProviders(request));
    router.post('/api/v1/ca-providers', '创建 CA Provider', tags, (request) => this.createProvider(request));
    router.post('/api/v1/ca-providers/:id/test', '测试 CA Provider', tags, (request) => this.testProvider(request));
    router.get('/api/v1/ca-trust-domains', '查询 CA 信任域', tags, (request) => this.listTrustDomains(request));
    router.post('/api/v1/ca-trust-domains', '创建 CA 信任域', tags, (request) => this.createTrustDomain(request));
    router.patch('/api/v1/ca-trust-domains/:id', '更新 CA 信任域', tags, (request) => this.updateTrustDomain(request));
    router.get('/api/v1/certificate-authorities', '查询证书机构', tags, (request) => this.listAuthorities(request));
    router.post('/api/v1/certificate-authorities/preview', '预览 CA 拓扑风险', tags, (request) => this.previewAuthority(request));
    router.post('/api/v1/certificate-authorities', '创建证书机构', tags, (request) => this.createAuthority(request));
    router.get('/api/v1/certificate-profiles', '查询证书 Profile', tags, (request) => this.listProfiles(request));
    router.post('/api/v1/certificate-profiles', '创建证书 Profile', tags, (request) => this.createProfile(request));
    router.post('/api/v1/certificate-profiles/:id/versions', '创建证书 Profile 版本', tags, (request) => this.createProfileVersion(request));
    router.get('/api/v1/certificate-requests', '查询证书申请', tags, (request) => this.listRequests(request));
    router.post('/api/v1/certificate-requests', '创建证书申请', tags, (request) => this.createRequest(request));
    router.post('/api/v1/certificate-requests/:id/approve', '审批证书申请', tags, (request) => this.approveRequest(request));
    router.post('/api/v1/certificate-requests/:id/retry', '重试证书签发', tags, (request) => this.retryRequest(request));
    router.post('/api/v1/certificate-requests/:id/query', '查询远程签发结果', tags, (request) => this.queryRequest(request));
    router.post('/api/v1/certificate-requests/:id/activate', '确认应用证书已安装', tags, (request) => this.activateRequest(request));
    router.get('/api/v1/certificate-renewals', '查询证书续期任务', tags, (request) => this.listRenewals(request));
    router.post('/api/v1/certificate-renewals/scan', '扫描并创建到期续期任务', tags, (request) => this.scanRenewals(request));
    router.get('/api/v1/certificate-revocations', '查询证书吊销任务', tags, (request) => this.listRevocations(request));
    router.post('/api/v1/certificate-revocations', '创建证书吊销任务', tags, (request) => this.createRevocation(request));
    router.post('/api/v1/certificate-revocations/:id/approve', '审批并执行证书吊销', tags, (request) => this.approveRevocation(request));
    router.get('/api/v1/ca-trust-distributions', '查询 CA 信任分发任务', tags, (request) => this.listTrustDistributions(request));
    router.post('/api/v1/ca-trust-distributions', '创建 CA 信任分发任务', tags, (request) => this.createTrustDistribution(request));
    router.post('/api/v1/ca-trust-distributions/:id/approve', '审批 CA 信任分发任务', tags, (request) => this.approveTrustDistribution(request));
    router.post('/api/v1/ca-trust-distributions/:id/complete', '回传 CA 信任分发验证结果', tags, (request) => this.completeTrustDistribution(request));
    router.get('/api/v1/reports/certificate-reuse/overview', '查询证书复用风险摘要', tags, (request) => this.certificateReuseOverview(request));
    router.get('/api/v1/reports/certificate-reuse/items', '查询证书复用风险明细', tags, (request) => this.certificateReuseItems(request));
    router.get('/api/v1/reports/certificate-reuse/export', '导出证书复用风险', tags, (request) => this.exportCertificateReuse(request));
    router.post('/api/v1/reports/certificate-reuse/:id/remediation-preview', '预览证书复用风险整改', tags, (request) => this.previewCertificateReuseRemediation(request));
    router.get('/api/v1/ca-nodes', '查询 CA Node', tags, (request) => this.listNodes(request));
    router.post('/api/v1/ca-nodes/enrollment-tokens', '创建 CA Node 注册令牌', tags, (request) => this.createNodeEnrollmentToken(request));
    router.post('/api/v1/ca-nodes/register', '注册 CA Node', tags, (request) => this.registerNode(request));
    router.post('/api/v1/ca-nodes/heartbeat', '上报 CA Node 心跳', tags, (request) => this.heartbeatNode(request));
    router.post('/api/v1/ca-nodes/tasks/lease', '获取 CA Node 任务', tags, (request) => this.leaseNodeTask(request));
    router.post('/api/v1/ca-nodes/tasks/:id/result', '回传 CA Node 任务结果', tags, (request) => this.completeNodeTask(request));
    router.post('/api/v1/adcs-agents/install-sessions', '创建 AD CS Agent 一键安装会话', tags, (request) => this.createAdcsAgentInstallSession(request));
    router.get('/api/v1/adcs-agents/install.ps1', '下载 AD CS Agent 安装脚本', tags, (request) => this.getAdcsAgentInstallScript(request));
    router.get('/api/v1/adcs-agents/binary', '下载 AD CS Agent 程序', tags, (request) => this.getAdcsAgentBinary(request));
  }

  private async listProviders(request: HttpRequest) {
    await this.assertRead(request, 'ca_provider');
    return this.service.listProviders(tenantId(request));
  }

  private async createProvider(request: HttpRequest) {
    await this.assertManage(request, 'ca_provider');
    const body = objectBody(request);
    return {
      statusCode: 201,
      body: await this.service.createProvider(tenantId(request), body as unknown as CreateCaProviderInput, actorId(request), request.context),
    };
  }

  private async testProvider(request: HttpRequest) {
    await this.assertManage(request, 'ca_provider');
    return this.service.testProvider(tenantId(request), pathId(request));
  }

  private async listTrustDomains(request: HttpRequest) {
    await this.assertRead(request, 'certificate_authority');
    return this.service.listTrustDomains(tenantId(request));
  }

  private async createTrustDomain(request: HttpRequest) {
    await this.assertManage(request, 'certificate_authority');
    return {
      statusCode: 201,
      body: await this.service.createTrustDomain(
        tenantId(request),
        objectBody(request) as unknown as CreateCaTrustDomainInput,
        actorId(request),
        request.context,
      ),
    };
  }

  private async updateTrustDomain(request: HttpRequest) {
    await this.assertManage(request, 'certificate_authority');
    return this.service.updateTrustDomain(
      tenantId(request),
      pathId(request),
      objectBody(request) as unknown as UpdateCaTrustDomainInput,
      actorId(request),
      request.context,
    );
  }

  private async listAuthorities(request: HttpRequest) {
    await this.assertRead(request, 'certificate_authority');
    return this.service.listAuthorities(tenantId(request));
  }

  private async previewAuthority(request: HttpRequest) {
    await this.assertManage(request, 'certificate_authority');
    return this.service.previewAuthority(objectBody(request) as unknown as PreviewCaInput);
  }

  private async createAuthority(request: HttpRequest) {
    await this.assertManage(request, 'certificate_authority');
    const body = objectBody(request);
    return {
      statusCode: 201,
      body: await this.service.createAuthority(tenantId(request), { ...body, actorId: actorId(request) } as unknown as CreateAuthorityInput, request.context),
    };
  }

  private async listProfiles(request: HttpRequest) {
    await this.assertRead(request, 'certificate_profile');
    return this.service.listProfiles(tenantId(request));
  }

  private async createProfile(request: HttpRequest) {
    await this.assertManage(request, 'certificate_profile');
    const body = objectBody(request);
    return {
      statusCode: 201,
      body: await this.service.createProfile(tenantId(request), { ...body, actorId: actorId(request) } as unknown as CreateProfileInput),
    };
  }

  private async createProfileVersion(request: HttpRequest) {
    await this.assertManage(request, 'certificate_profile');
    return {
      statusCode: 201,
      body: await this.service.createProfileVersion(tenantId(request), pathId(request), objectBody(request), actorId(request)),
    };
  }

  private async listRequests(request: HttpRequest) {
    await this.assertRead(request, 'certificate_request');
    return this.service.listRequests(tenantId(request));
  }

  private async createRequest(request: HttpRequest) {
    await this.assertManage(request, 'certificate_request');
    const body = objectBody(request);
    return {
      statusCode: 201,
      body: await this.service.createCertificateRequest(tenantId(request), { ...body, actorId: actorId(request) } as unknown as CreateCertificateRequestInput, request.context),
    };
  }

  private async approveRequest(request: HttpRequest) {
    await this.assertApprove(request);
    const body = objectBody(request);
    return this.service.approveRequest(tenantId(request), pathId(request), actorId(request), requiredString(body, 'approvalId'), request.context);
  }

  private async retryRequest(request: HttpRequest) {
    await this.assertManage(request, 'certificate_request');
    return this.service.issueRequest(tenantId(request), pathId(request), actorId(request), request.context);
  }

  private async queryRequest(request: HttpRequest) {
    await this.assertManage(request, 'certificate_request');
    return this.service.refreshRequestIssuance(tenantId(request), pathId(request), actorId(request), request.context);
  }

  private async activateRequest(request: HttpRequest) {
    await this.assertManage(request, 'certificate_request');
    return this.service.markRequestActive(tenantId(request), pathId(request));
  }

  private async listRenewals(request: HttpRequest) {
    await this.assertRead(request, 'certificate_renewal');
    return this.service.listRenewals(tenantId(request));
  }

  private async scanRenewals(request: HttpRequest) {
    await this.assertManage(request, 'certificate_renewal');
    return this.service.scheduleDueRenewals(tenantId(request), actorId(request), new Date(), request.context);
  }

  private async listRevocations(request: HttpRequest) {
    await this.assertRead(request, 'certificate_revocation');
    return this.service.listRevocations(tenantId(request));
  }

  private async createRevocation(request: HttpRequest) {
    await this.assertManage(request, 'certificate_revocation');
    const body = objectBody(request);
    return { statusCode: 201, body: await this.service.requestRevocation(
      tenantId(request), requiredString(body, 'certificateVersionId'), requiredString(body, 'reason'), actorId(request), request.context,
    ) };
  }

  private async approveRevocation(request: HttpRequest) {
    await this.assertApprove(request);
    const body = objectBody(request);
    return this.service.approveRevocation(tenantId(request), pathId(request), requiredString(body, 'approvalId'), actorId(request));
  }

  private async listTrustDistributions(request: HttpRequest) {
    await this.assertRead(request, 'trust_distribution');
    return this.service.listTrustDistributions(tenantId(request));
  }

  private async createTrustDistribution(request: HttpRequest) {
    await this.assertManage(request, 'trust_distribution');
    const body = objectBody(request);
    const targetScope = body.targetScope;
    if (!targetScope || typeof targetScope !== 'object' || Array.isArray(targetScope)) throw new AppError('VALIDATION_FAILED', 'targetScope 必须是对象');
    return { statusCode: 201, body: await this.service.createTrustDistribution(
      tenantId(request), requiredString(body, 'caId'), targetScope as Record<string, unknown>, actorId(request), request.context,
    ) };
  }

  private async approveTrustDistribution(request: HttpRequest) {
    await this.assertApprove(request);
    return this.service.approveTrustDistribution(tenantId(request), pathId(request), requiredString(objectBody(request), 'approvalId'));
  }

  private async completeTrustDistribution(request: HttpRequest) {
    await this.assertManage(request, 'trust_distribution');
    const body = objectBody(request);
    const verification = body.verification && typeof body.verification === 'object' && !Array.isArray(body.verification)
      ? body.verification as Record<string, unknown>
      : {};
    return this.service.completeTrustDistribution(tenantId(request), pathId(request), body.verified === true, verification);
  }

  private async certificateReuseOverview(request: HttpRequest) {
    await this.assertRead(request, 'certificate_reuse_risk');
    return this.service.certificateReuseRiskOverview(tenantId(request));
  }

  private async certificateReuseItems(request: HttpRequest) {
    await this.assertRead(request, 'certificate_reuse_risk');
    return this.service.analyzeCertificateReuseRisks(tenantId(request));
  }

  private async exportCertificateReuse(request: HttpRequest) {
    await this.assertRead(request, 'certificate_reuse_risk');
    return {
      statusCode: 200,
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="certificate-reuse-risks.csv"' },
      body: await this.service.exportCertificateReuseRisks(tenantId(request)),
    };
  }

  private async previewCertificateReuseRemediation(request: HttpRequest) {
    await this.assertManage(request, 'certificate_reuse_risk');
    return this.service.previewCertificateReuseRemediation(tenantId(request), pathId(request));
  }

  private async listNodes(request: HttpRequest) {
    await this.assertRead(request, 'ca_node');
    return this.service.listNodes(tenantId(request), optionalQuery(request, 'providerId'));
  }

  private async createNodeEnrollmentToken(request: HttpRequest) {
    await this.assertManage(request, 'ca_node');
    const body = objectBody(request);
    return this.service.createNodeEnrollmentToken(
      tenantId(request),
      requiredString(body, 'providerId'),
      actorId(request),
      optionalNumber(body, 'ttlMinutes') ?? 15,
    );
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
    const body = objectBody(request);
    const node = await this.authenticateNode(request, body);
    return this.service.leaseNodeTask(node.tenantId, node.id);
  }

  private async completeNodeTask(request: HttpRequest) {
    const body = objectBody(request);
    const node = await this.authenticateNode(request, body);
    return this.service.completeNodeTask(node.tenantId, node.id, pathId(request), body as never);
  }

  private authenticateNode(request: HttpRequest, body: Record<string, unknown>) {
    return this.service.verifyNodeRequest({
      tenantId: String(request.headers['x-tenant-id'] ?? ''),
      nodeId: String(request.headers['x-gcac-node-id'] ?? requiredString(body, 'nodeId')),
      method: request.method,
      path: request.path,
      timestamp: String(request.headers['x-gcac-timestamp'] ?? ''),
      nonce: String(request.headers['x-gcac-nonce'] ?? ''),
      signature: String(request.headers['x-gcac-signature'] ?? ''),
      body,
    });
  }

  private async createAdcsAgentInstallSession(request: HttpRequest) {
    await this.assertManage(request, 'ca_node');
    return {
      statusCode: 201,
      body: await this.service.createAdcsAgentInstallSession(
        tenantId(request), objectBody(request), actorId(request), publicBaseUrl(request), request.context,
      ),
    };
  }

  private async getAdcsAgentInstallScript(request: HttpRequest) {
    const context = await this.service.getAdcsAgentInstallContext(requiredQuery(request, 'token'));
    return {
      statusCode: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      body: renderAdcsAgentInstallScript({ ...context, controlPlaneUrl: publicBaseUrl(request) }),
    };
  }

  private async getAdcsAgentBinary(_request: HttpRequest) {
    const candidates = [
      resolve(process.cwd(), '../agents/windows-adcs-agent/gcac-adcs-agent.exe'),
      resolve(process.cwd(), 'agents/windows-adcs-agent/gcac-adcs-agent.exe'),
    ];
    for (const path of candidates) {
      try {
        return {
          statusCode: 200,
          headers: {
            'content-type': 'application/vnd.microsoft.portable-executable',
            'content-disposition': 'attachment; filename="gcac-adcs-agent.exe"',
            'cache-control': 'no-store',
          },
          body: await readFile(path),
        };
      } catch {
        // 继续尝试下一条部署路径。
      }
    }
    throw new AppError('RESOURCE_NOT_FOUND', 'AD CS Agent 二进制文件尚未构建');
  }

  private async assertRead(request: HttpRequest, resourceType: string): Promise<void> {
    await this.assertCanAny(request, ['certificate.read', 'certificate.asset.read'], resourceType);
  }

  private async assertManage(request: HttpRequest, resourceType: string): Promise<void> {
    await this.assertCanAny(request, ['certificate.import', 'certificate.asset.update'], resourceType);
  }

  private async assertApprove(request: HttpRequest): Promise<void> {
    await this.assertCanAny(request, ['approval.decide', 'certificate.import'], 'certificate_request');
  }

  private async assertCanAny(request: HttpRequest, actions: string[], resourceType: string): Promise<void> {
    const subject = subjectFromRequest(request);
    let lastError: unknown;
    for (const action of actions) {
      try {
        await this.security.rbac.assertCan(subject, action, {
          type: resourceType,
          scope: { tenantId: request.context.tenantId, ownerId: subject.id },
        }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

export function getInternalCaRouteContracts(): RouteContract[] {
  const responseSchema = { type: 'object', additionalProperties: true } as const;
  const arraySchema = { type: 'array', items: responseSchema } as const;
  return [
    { method: 'GET', path: '/api/v1/ca-providers', operationId: 'listCaProviders', summary: '查询 CA Provider', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/ca-providers', operationId: 'createCaProvider', summary: '创建 CA Provider', tags, responseSchema },
    { method: 'POST', path: '/api/v1/ca-providers/:id/test', operationId: 'testCaProvider', summary: '测试 CA Provider', tags, responseSchema },
    { method: 'GET', path: '/api/v1/certificate-authorities', operationId: 'listCertificateAuthorities', summary: '查询证书机构', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/certificate-authorities/preview', operationId: 'previewCertificateAuthority', summary: '预览 CA 拓扑风险', tags, responseSchema },
    { method: 'POST', path: '/api/v1/certificate-authorities', operationId: 'createCertificateAuthority', summary: '创建证书机构', tags, responseSchema: arraySchema },
    { method: 'GET', path: '/api/v1/certificate-profiles', operationId: 'listCertificateProfiles', summary: '查询证书 Profile', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/certificate-profiles', operationId: 'createCertificateProfile', summary: '创建证书 Profile', tags, responseSchema },
    { method: 'POST', path: '/api/v1/certificate-profiles/:id/versions', operationId: 'createCertificateProfileVersion', summary: '创建证书 Profile 版本', tags, responseSchema },
    { method: 'GET', path: '/api/v1/certificate-requests', operationId: 'listCertificateRequests', summary: '查询证书申请', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/certificate-requests', operationId: 'createCertificateRequest', summary: '创建证书申请', tags, responseSchema },
    { method: 'POST', path: '/api/v1/certificate-requests/:id/approve', operationId: 'approveCertificateRequest', summary: '审批证书申请', tags, responseSchema },
    { method: 'POST', path: '/api/v1/certificate-requests/:id/retry', operationId: 'retryCertificateRequest', summary: '重试证书签发', tags, responseSchema },
    { method: 'POST', path: '/api/v1/certificate-requests/:id/query', operationId: 'queryCertificateRequestIssuance', summary: '查询远程签发结果', tags, responseSchema },
    { method: 'POST', path: '/api/v1/certificate-requests/:id/activate', operationId: 'activateCertificateRequest', summary: '确认应用证书已安装', tags, responseSchema },
    { method: 'GET', path: '/api/v1/certificate-renewals', operationId: 'listCertificateRenewals', summary: '查询证书续期任务', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/certificate-renewals/scan', operationId: 'scanCertificateRenewals', summary: '扫描并创建到期续期任务', tags, responseSchema: arraySchema },
    { method: 'GET', path: '/api/v1/certificate-revocations', operationId: 'listCertificateRevocations', summary: '查询证书吊销任务', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/certificate-revocations', operationId: 'createCertificateRevocation', summary: '创建证书吊销任务', tags, responseSchema },
    { method: 'POST', path: '/api/v1/certificate-revocations/:id/approve', operationId: 'approveCertificateRevocation', summary: '审批并执行证书吊销', tags, responseSchema },
    { method: 'GET', path: '/api/v1/ca-trust-distributions', operationId: 'listCaTrustDistributions', summary: '查询 CA 信任分发任务', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/ca-trust-distributions', operationId: 'createCaTrustDistribution', summary: '创建 CA 信任分发任务', tags, responseSchema },
    { method: 'POST', path: '/api/v1/ca-trust-distributions/:id/approve', operationId: 'approveCaTrustDistribution', summary: '审批 CA 信任分发任务', tags, responseSchema },
    { method: 'POST', path: '/api/v1/ca-trust-distributions/:id/complete', operationId: 'completeCaTrustDistribution', summary: '回传 CA 信任分发验证结果', tags, responseSchema },
    { method: 'GET', path: '/api/v1/reports/certificate-reuse/overview', operationId: 'getCertificateReuseRiskOverview', summary: '查询证书复用风险摘要', tags, responseSchema },
    { method: 'GET', path: '/api/v1/reports/certificate-reuse/items', operationId: 'listCertificateReuseRisks', summary: '查询证书复用风险明细', tags, responseSchema: arraySchema },
    { method: 'GET', path: '/api/v1/reports/certificate-reuse/export', operationId: 'exportCertificateReuseRisks', summary: '导出证书复用风险', tags, responseSchema },
    { method: 'POST', path: '/api/v1/reports/certificate-reuse/:id/remediation-preview', operationId: 'previewCertificateReuseRemediation', summary: '预览证书复用风险整改', tags, responseSchema },
    { method: 'GET', path: '/api/v1/ca-nodes', operationId: 'listCaNodes', summary: '查询 CA Node', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/ca-nodes/enrollment-tokens', operationId: 'createCaNodeEnrollmentToken', summary: '创建 CA Node 注册令牌', tags, responseSchema },
    { method: 'POST', path: '/api/v1/ca-nodes/register', operationId: 'registerCaNode', summary: '注册 CA Node', tags, responseSchema },
    { method: 'POST', path: '/api/v1/ca-nodes/heartbeat', operationId: 'heartbeatCaNode', summary: '上报 CA Node 心跳', tags, responseSchema },
    { method: 'POST', path: '/api/v1/ca-nodes/tasks/lease', operationId: 'leaseCaNodeTask', summary: '获取 CA Node 任务', tags, responseSchema },
    { method: 'POST', path: '/api/v1/ca-nodes/tasks/:id/result', operationId: 'completeCaNodeTask', summary: '回传 CA Node 任务结果', tags, responseSchema },
    { method: 'POST', path: '/api/v1/adcs-agents/install-sessions', operationId: 'createAdcsAgentInstallSession', summary: '创建 AD CS Agent 一键安装会话', tags, responseSchema },
    { method: 'GET', path: '/api/v1/adcs-agents/install.ps1', operationId: 'getAdcsAgentInstallScript', summary: '下载 AD CS Agent 安装脚本', tags, responseSchema },
    { method: 'GET', path: '/api/v1/adcs-agents/binary', operationId: 'getAdcsAgentBinary', summary: '下载 AD CS Agent 程序', tags, responseSchema },
  ];
}

function tenantId(request: HttpRequest): string {
  return request.context.tenantId ?? tenantFallback;
}

function actorId(request: HttpRequest): string {
  if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少操作者身份');
  return request.context.actorId;
}

function subjectFromRequest(request: HttpRequest): SecuritySubject {
  return { id: actorId(request), type: 'user', scope: { tenantId: request.context.tenantId } };
}

function objectBody(request: HttpRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new AppError('VALIDATION_FAILED', '请求体必须是对象');
  }
  return { ...(request.body as Record<string, unknown>) };
}

function pathId(request: HttpRequest): string {
  const value = request.query.id;
  const queryId = Array.isArray(value) ? value[0] : value;
  const segments = request.path.split('/').filter(Boolean);
  const actionIndex = segments.findIndex((segment) => ['test', 'versions', 'approve', 'retry', 'activate', 'result', 'complete', 'remediation-preview'].includes(segment));
  const id = queryId ?? (actionIndex > 0 ? segments[actionIndex - 1] : undefined);
  if (!id) throw new AppError('VALIDATION_FAILED', 'id 不能为空');
  return id;
}

function optionalQuery(request: HttpRequest, name: string): string | undefined {
  const value = request.query[name];
  return Array.isArray(value) ? value[0] : value;
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  return value.trim();
}

function optionalNumber(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new AppError('VALIDATION_FAILED', `${field} 必须是数字`, { field });
  return number;
}

function requiredQuery(request: HttpRequest, name: string): string {
  const value = optionalQuery(request, name)?.trim();
  if (!value) throw new AppError('VALIDATION_FAILED', `${name} 不能为空`);
  return value;
}

function publicBaseUrl(request: HttpRequest): string {
  const configured = process.env.GCAC_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const protocol = String(request.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim();
  const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '127.0.0.1:3000').split(',')[0].trim();
  return `${protocol}://${host}`;
}

function renderAdcsAgentInstallScript(input: { controlPlaneUrl: string; tenantId: string; providerId: string; token: string }): string {
  const manifest = JSON.stringify(input).replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop'",
    "$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()",
    "if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw '请使用管理员 PowerShell 执行安装命令。' }",
    `$manifest = '${manifest}' | ConvertFrom-Json`,
    "$installRoot = 'C:\\Program Files\\GCAC\\ADCSAgent'",
    "$dataRoot = 'C:\\ProgramData\\GCAC\\ADCSAgent'",
    "$configPath = Join-Path $dataRoot 'agent.config.json'",
    "$binaryPath = Join-Path $installRoot 'gcac-adcs-agent.exe'",
    "$serviceName = 'gcac-adcs-agent'",
    "New-Item -ItemType Directory -Force -Path $installRoot, $dataRoot | Out-Null",
    "$binaryUrl = ([string]$manifest.controlPlaneUrl).TrimEnd('/') + '/api/v1/adcs-agents/binary'",
    "Invoke-WebRequest -UseBasicParsing -Uri $binaryUrl -OutFile $binaryPath",
    "$config = [ordered]@{ controlPlaneUrl = $manifest.controlPlaneUrl; tenantId = $manifest.tenantId; providerId = $manifest.providerId; enrollmentToken = $manifest.token; nodeName = $env:COMPUTERNAME; pollSeconds = 10; dataDir = $dataRoot }",
    "$utf8 = New-Object System.Text.UTF8Encoding($false)",
    "[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 8), $utf8)",
    "icacls.exe $dataRoot /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\\Administrators:(OI)(CI)F' | Out-Null",
    "& $binaryPath preflight --config $configPath",
    "if ($LASTEXITCODE -ne 0) { throw 'AD CS 环境预检失败，服务未安装。' }",
    "$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue",
    "if ($null -ne $existing) { Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue; sc.exe delete $serviceName | Out-Null; Start-Sleep -Seconds 1 }",
    "$serviceCommand = ('\"{0}\" service run --config \"{1}\"' -f $binaryPath, $configPath)",
    "New-Service -Name $serviceName -BinaryPathName $serviceCommand -DisplayName 'GCAC AD CS Agent' -Description 'GCAC Microsoft AD CS management adapter' -StartupType Automatic | Out-Null",
    "sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/15000/restart/30000 | Out-Null",
    "Start-Service -Name $serviceName",
    "Start-Sleep -Seconds 3",
    "$service = Get-Service -Name $serviceName",
    "if ($service.Status -ne 'Running') { throw 'AD CS Agent 服务启动失败。' }",
    "Write-Host ('GCAC AD CS Agent 安装完成，服务状态：' + $service.Status) -ForegroundColor Green",
  ].join('\r\n');
}

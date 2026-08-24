import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import type { CaOperationsPermissionAction } from '../ca-operations.security.js';
import type { CaOperationsRecordQueryDto } from '../dto/ca-operations.dto.js';
import type { CreateCaSyncRunsDto } from '../dto/ca-operations.dto.js';
import type {
  CreateAuthorityInput,
  AcmeProviderConfigurationInput,
  CreateCaProviderInput,
  CreateCaTrustDomainInput,
  CreateCertificateRequestInput,
  CreateProfileInput,
  InternalCaApplicationService,
  PreviewCaInput,
  UpdateCaTrustDomainInput,
} from '../application/internal-ca.application-service.js';
import type { AcmeAccountService } from '../application/acme-account.service.js';
import type { AcmeCertificateService } from '../application/acme-certificate.service.js';
import type { AcmeOrderService } from '../application/acme-order.service.js';
import type { AcmeRenewalPolicyService } from '../application/acme-renewal-policy.service.js';
import type { AcmeRenewalScheduler } from '../application/acme-renewal-scheduler.js';
import type { AcmeRenewalWorker } from '../application/acme-renewal-worker.js';
import type { AcmeRepository } from '../repository/acme.repository.js';
import { listAcmeDnsProviders } from '../providers/acme-dns-provider.registry.js';
import { structuredLogger } from '../../../common/logging/structured-logger.js';

const tags = ['Internal CA'];

export interface InternalCaAcmeServices {
  accounts: AcmeAccountService;
  certificates: AcmeCertificateService;
  orders: AcmeOrderService;
  policies: AcmeRenewalPolicyService;
  repository: AcmeRepository;
  scheduler: AcmeRenewalScheduler;
  worker: AcmeRenewalWorker;
}

export class InternalCaController {
  constructor(
    private readonly service: InternalCaApplicationService,
    private readonly security: SecurityServices,
    private readonly acme?: InternalCaAcmeServices,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/ca-providers', '查询 CA Provider', tags, (request) => this.listProviders(request));
    router.get('/api/v1/ca-operations/tree', '查询 CA 运营资源树', tags, (request) => this.listCaOperationsTree(request));
    router.get('/api/v1/ca-operations/records', '查询 CA 运营记录', tags, (request) => this.listCaOperationsRecords(request));
    router.get('/api/v1/ca-operations/records/:recordKey', '查询 CA 运营记录详情', tags, (request) => this.getCaOperationsRecord(request));
    router.post('/api/v1/ca-operations/sync-runs', '创建 CA 历史同步运行', tags, (request) => this.createCaSyncRuns(request));
    router.get('/api/v1/ca-operations/sync-runs', '查询 CA 历史同步运行', tags, (request) => this.listCaSyncRuns(request));
    router.post('/api/v1/ca-providers', '创建 CA Provider', tags, (request) => this.createProvider(request));
    router.delete('/api/v1/ca-providers/:id', '删除未绑定的 CA Provider', tags, (request) => this.deleteProvider(request));
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
    router.get('/api/v1/acme/accounts', '查询 ACME Account', tags, (request) => this.listAcmeAccounts(request));
    router.post('/api/v1/acme/accounts', '创建 ACME Account', tags, (request) => this.createAcmeAccount(request));
    router.get('/api/v1/acme/accounts/:id', '查询 ACME Account 详情', tags, (request) => this.getAcmeAccount(request));
    router.get('/api/v1/acme/providers', '查询 ACME 颁发者配置', tags, (request) => this.listAcmeProviderSettings(request));
    router.post('/api/v1/acme/providers', '创建 ACME 颁发者配置', tags, (request) => this.createAcmeProvider(request));
    router.patch('/api/v1/acme/providers/:id', '更新 ACME 颁发者配置', tags, (request) => this.updateAcmeProvider(request));
    router.post('/api/v1/acme/providers/:id/test', '测试 ACME 颁发者连接', tags, (request) => this.testAcmeProvider(request));
    router.get('/api/v1/acme/dns-providers', '查询 ACME DNS 提供商', tags, (request) => this.listAcmeDnsProviders(request));
    router.post('/api/v1/acme/certificates', '创建简化 ACME 证书配置', tags, (request) => this.createAcmeCertificate(request));
    router.patch('/api/v1/acme/certificates/:id', '更新 ACME 证书自动化配置', tags, (request) => this.updateAcmeCertificate(request));
    router.delete('/api/v1/acme/certificates/:id', '删除 ACME 证书自动化配置', tags, (request) => this.deleteAcmeCertificate(request));
    router.post('/api/v1/acme/certificates/:id/renew', '手动续签指定 ACME 证书', tags, (request) => this.manualRenewAcmeCertificate(request));
    router.get('/api/v1/acme/orders', '查询 ACME Order', tags, (request) => this.listAcmeOrders(request));
    router.post('/api/v1/acme/orders', '创建 ACME Order', tags, (request) => this.createAcmeOrder(request));
    router.get('/api/v1/acme/orders/:id', '查询 ACME Order 详情', tags, (request) => this.getAcmeOrder(request));
    router.post('/api/v1/acme/orders/:id/reconcile', '恢复 ACME Order 状态', tags, (request) => this.reconcileAcmeOrder(request));
    router.post('/api/v1/acme/orders/:id/finalize', 'Finalize ACME Order', tags, (request) => this.finalizeAcmeOrder(request));
    router.get('/api/v1/acme/renewal-policies', '查询 ACME 续签策略', tags, (request) => this.listAcmePolicies(request));
    router.post('/api/v1/acme/renewal-policies', '创建 ACME 续签策略', tags, (request) => this.createAcmePolicy(request));
    router.patch('/api/v1/acme/renewal-policies/:id', '更新 ACME 续签策略', tags, (request) => this.updateAcmePolicy(request));
    router.get('/api/v1/acme/renewal-jobs', '查询 ACME 续签任务', tags, (request) => this.listAcmeRenewalJobs(request));
    router.post('/api/v1/acme/renewal-jobs/scan', '扫描 ACME 到期证书', tags, (request) => this.scanAcmeRenewalJobs(request));
    router.post('/api/v1/acme/renewal-jobs/run', '执行 ACME 续签任务', tags, (request) => this.runAcmeRenewalJobs(request));
    router.post('/api/v1/acme/renewal-jobs/:id/retry', '重试 ACME 续签任务', tags, (request) => this.retryAcmeRenewalJob(request));
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
    router.get('/api/v1/ca-nodes/tasks/stream', '建立 CA Node 任务推送通道', tags, (request) => this.streamNodeTasks(request));
    router.post('/api/v1/ca-nodes/tasks/:id/result', '回传 CA Node 任务结果', tags, (request) => this.completeNodeTask(request));
    router.post('/api/v1/adcs-agents/install-sessions', '创建 AD CS Agent 一键安装会话', tags, (request) => this.createAdcsAgentInstallSession(request));
    router.post('/api/v1/adcs-agents/providers/:id/update-sessions', '创建 AD CS Agent 更新会话', tags, (request) => this.createAdcsAgentUpdateSession(request));
    router.post('/api/v1/adcs-agents/providers/:id/inspection-tasks', '创建 AD CS 结构化视图探针任务', tags, (request) => this.createAdcsViewInspectionTask(request));
    router.get('/api/v1/adcs-agents/inspection-tasks/:id', '查询 AD CS 结构化视图探针任务', tags, (request) => this.getAdcsViewInspectionTask(request));
    router.get('/api/v1/adcs-agents/install.ps1', '下载 AD CS Agent 安装脚本', tags, (request) => this.getAdcsAgentInstallScript(request));
    router.get('/api/v1/adcs-agents/binary', '下载 AD CS Agent 程序', tags, (request) => this.getAdcsAgentBinary(request));
  }

  private async listProviders(request: HttpRequest) {
    await this.assertRead(request, 'ca_provider');
    return this.service.listProviders(tenantId(request));
  }

  private async listCaOperationsTree(request: HttpRequest) {
    const subject = subjectFromRequest(request);
    await this.assertCaOperationsRead(request);
    return this.service.listCaOperationsTree(tenantId(request), async (authority) => {
      const decision = await this.security.rbac.can(subject, 'ca.operations.read', {
        type: 'certificate_authority',
        id: authority.id,
        scope: {
          tenantId: request.context.tenantId,
          trustDomainId: authority.trustDomainId,
          caId: authority.id,
          providerId: authority.providerId,
          resourceType: 'certificate_authority',
          resourceId: authority.id,
        },
      }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
      return decision.allowed;
    });
  }

  private async listCaOperationsRecords(request: HttpRequest) {
    const query = caOperationsRecordQuery(request);
    const authority = (await this.service.listAuthorities(tenantId(request))).find((item) => item.id === query.caId);
    if (!authority) throw new AppError('RESOURCE_NOT_FOUND', '证书机构不存在', { caId: query.caId });
    await this.assertCaOperationsRead(request, authority);
    return this.service.listCaOperationsRecords(tenantId(request), query);
  }

  private async getCaOperationsRecord(request: HttpRequest) {
    const record = await this.service.getCaOperationsRecord(tenantId(request), pathId(request));
    const authority = (await this.service.listAuthorities(tenantId(request))).find((item) => item.id === record.caId);
    if (!authority) throw new AppError('RESOURCE_NOT_FOUND', '证书机构不存在', { caId: record.caId });
    await this.assertCaOperationsRead(request, authority);
    const provider = (await this.service.listProviders(tenantId(request))).find((item) => item.id === authority.providerId);
    return { ...record, allowedActions: await this.allowedCaOperationsActions(request, authority, provider?.capabilities, record) };
  }

  private async createCaSyncRuns(request: HttpRequest) {
    const body = objectBody(request) as unknown as CreateCaSyncRunsDto;
    if (!body.providerId || !body.caId || !Array.isArray(body.objectTypes) || !['incremental', 'full'].includes(body.mode)) {
      throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 同步请求参数无效');
    }
    if (body.mode === 'full' && body.confirmed !== true) {
      throw new AppError('VALIDATION_FAILED', '全量 CA 历史同步必须显式确认');
    }
    const authority = (await this.service.listAuthorities(tenantId(request))).find((item) => item.id === body.caId);
    if (!authority || authority.providerId !== body.providerId) throw new AppError('RESOURCE_NOT_FOUND', 'CA 或 Provider 不存在或不匹配');
    await this.assertCaSync(request, authority, body.mode);
    const runs = await this.service.createCaSyncRuns({
      tenantId: tenantId(request), providerId: body.providerId, caId: body.caId, objectTypes: body.objectTypes,
      mode: body.mode, actor: subjectFromRequest(request),
      context: { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subjectFromRequest(request) },
    });
    return { statusCode: 201, body: { items: runs } };
  }

  private async listCaSyncRuns(request: HttpRequest) {
    const caId = queryValue(request, 'caId');
    if (caId) {
      const authority = (await this.service.listAuthorities(tenantId(request))).find((item) => item.id === caId);
      if (!authority) throw new AppError('RESOURCE_NOT_FOUND', '证书机构不存在', { caId });
      await this.assertCaOperationsRead(request, authority);
    } else {
      await this.assertCaOperationsRead(request);
    }
    return { items: await this.service.listCaSyncRuns(tenantId(request), caId) };
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
    await this.assertApprove(request, 'ca.request.approve');
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

  private requireAcme(): InternalCaAcmeServices {
    if (!this.acme) throw new AppError('CA_CAPABILITY_UNSUPPORTED', 'ACME 生命周期服务未接入');
    return this.acme;
  }

  private async listAcmeAccounts(request: HttpRequest) {
    await this.assertRead(request, 'ca_provider');
    return this.requireAcme().accounts.list(tenantId(request), optionalQuery(request, 'providerId'));
  }

  private async createAcmeAccount(request: HttpRequest) {
    await this.assertManage(request, 'ca_provider');
    const body = objectBody(request);
    return {
      statusCode: 201,
      body: await this.requireAcme().accounts.create({
        tenantId: tenantId(request),
        providerId: requiredString(body, 'providerId'),
        accountKeySecretRef: requiredString(body, 'accountKeySecretRef'),
        contact: Array.isArray(body.contact) ? body.contact.map(String) : undefined,
        termsOfServiceAgreed: body.termsOfServiceAgreed === undefined ? undefined : body.termsOfServiceAgreed === true,
        eabKeyIdSecretRef: optionalString(body.eabKeyIdSecretRef),
        eabHmacSecretRef: optionalString(body.eabHmacSecretRef),
        actorId: actorId(request),
      }),
    };
  }

  private async getAcmeAccount(request: HttpRequest) {
    await this.assertRead(request, 'ca_provider');
    return this.requireAcme().accounts.get(tenantId(request), pathId(request));
  }

  private async listAcmeProviderSettings(request: HttpRequest) {
    await this.assertRead(request, 'ca_provider');
    return this.service.listAcmeProviderSettings(tenantId(request));
  }

  private async createAcmeProvider(request: HttpRequest) {
    await this.assertManage(request, 'ca_provider');
    return {
      statusCode: 201,
      body: await this.service.createAcmeProvider(
        tenantId(request),
        objectBody(request) as unknown as AcmeProviderConfigurationInput,
        actorId(request),
        request.context,
      ),
    };
  }

  private async updateAcmeProvider(request: HttpRequest) {
    await this.assertManage(request, 'ca_provider');
    return this.service.updateAcmeProvider(
      tenantId(request),
      pathId(request),
      objectBody(request) as unknown as AcmeProviderConfigurationInput,
      actorId(request),
      request.context,
    );
  }

  private async testAcmeProvider(request: HttpRequest) {
    await this.assertManage(request, 'ca_provider');
    return this.service.testProvider(tenantId(request), pathId(request));
  }

  private async listAcmeDnsProviders(request: HttpRequest) {
    await this.assertRead(request, 'certificate_request');
    return listAcmeDnsProviders();
  }

  private async createAcmeCertificate(request: HttpRequest) {
    await this.assertManage(request, 'certificate_renewal');
    const body = objectBody(request);
    await this.service.ensureBuiltinAcmeProvider(tenantId(request), actorId(request));
    return {
      statusCode: 201,
      body: await this.requireAcme().certificates.create({
        tenantId: tenantId(request),
        name: optionalString(body.name),
        domains: Array.isArray(body.domains) ? body.domains.map(String) : [],
        contactEmail: requiredString(body, 'contactEmail'),
        providerId: optionalString(body.providerId),
        challengeType: requiredString(body, 'challengeType') as never,
        dnsProvider: optionalString(body.dnsProvider),
        dnsCredentialId: optionalString(body.dnsCredentialId),
        dnsPropagationSeconds: optionalNumber(body, 'dnsPropagationSeconds'),
        keyType: (optionalString(body.keyType) as 'rsa' | 'ecdsa' | undefined),
        autoRenew: body.autoRenew !== false,
        renewalWindowDays: optionalNumber(body, 'renewalWindowDays') ?? 7,
        termsOfServiceAgreed: body.termsOfServiceAgreed === true,
        actorId: actorId(request),
      }),
    };
  }

  private async manualRenewAcmeCertificate(request: HttpRequest) {
    await this.assertManage(request, 'certificate_renewal');
    const tenant = tenantId(request);
    const actor = actorId(request);
    const job = await this.requireAcme().scheduler.scheduleManualRenewal(
      tenant,
      pathId(request),
      actor,
      new Date(),
    );
    void this.requireAcme().worker.runJob(tenant, job.id, actor, request.context).catch((error: unknown) => {
      structuredLogger.warn('手动 ACME 续签任务唤醒失败', {
        renewalJobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      }, { module: 'acme-renewal-worker' });
    });
    return {
      statusCode: 202,
      body: job,
    };
  }

  private async updateAcmeCertificate(request: HttpRequest) {
    await this.assertManage(request, 'certificate_renewal');
    const body = objectBody(request);
    return this.requireAcme().certificates.update({
      tenantId: tenantId(request),
      certificateAssetId: pathId(request),
      name: optionalString(body.name),
      domains: Array.isArray(body.domains) ? body.domains.map(String) : [],
      contactEmail: requiredString(body, 'contactEmail'),
      providerId: requiredString(body, 'providerId'),
      challengeType: requiredString(body, 'challengeType') as never,
      dnsProvider: optionalString(body.dnsProvider),
      dnsCredentialId: optionalString(body.dnsCredentialId),
      dnsPropagationSeconds: optionalNumber(body, 'dnsPropagationSeconds'),
      keyType: optionalString(body.keyType) as 'rsa' | 'ecdsa' | undefined,
      autoRenew: body.autoRenew !== false,
      renewalWindowDays: optionalNumber(body, 'renewalWindowDays') ?? 7,
      actorId: actorId(request),
    });
  }

  private async deleteAcmeCertificate(request: HttpRequest) {
    await this.assertManage(request, 'certificate_renewal');
    return this.requireAcme().certificates.delete(
      tenantId(request),
      pathId(request),
      actorId(request),
      request.context,
    );
  }

  private async listAcmeOrders(request: HttpRequest) {
    await this.assertRead(request, 'certificate_request');
    return this.requireAcme().orders.list(tenantId(request), optionalQuery(request, 'status') as never);
  }

  private async createAcmeOrder(request: HttpRequest) {
    await this.assertManage(request, 'certificate_request');
    const body = objectBody(request);
    return {
      statusCode: 201,
      body: await this.requireAcme().orders.create({
        tenantId: tenantId(request),
        providerId: requiredString(body, 'providerId'),
        accountId: requiredString(body, 'accountId'),
        certificateRequestId: requiredString(body, 'certificateRequestId'),
        challengeType: requiredString(body, 'challengeType') as never,
        idempotencyKey: requiredString(body, 'idempotencyKey'),
        actorId: actorId(request),
      }),
    };
  }

  private async getAcmeOrder(request: HttpRequest) {
    await this.assertRead(request, 'certificate_request');
    return this.requireAcme().orders.get(tenantId(request), pathId(request));
  }

  private async reconcileAcmeOrder(request: HttpRequest) {
    await this.assertManage(request, 'certificate_request');
    return this.requireAcme().orders.reconcile(tenantId(request), pathId(request), actorId(request));
  }

  private async finalizeAcmeOrder(request: HttpRequest) {
    await this.assertManage(request, 'certificate_request');
    return this.requireAcme().orders.finalize(tenantId(request), pathId(request), actorId(request));
  }

  private async listAcmePolicies(request: HttpRequest) {
    await this.assertRead(request, 'certificate_renewal');
    return this.requireAcme().policies.list(tenantId(request));
  }

  private async createAcmePolicy(request: HttpRequest) {
    await this.assertManage(request, 'certificate_renewal');
    const body = objectBody(request);
    return {
      statusCode: 201,
      body: await this.requireAcme().policies.create({
        tenantId: tenantId(request),
        certificateAssetId: optionalString(body.certificateAssetId),
        bindingId: optionalString(body.bindingId),
        providerId: requiredString(body, 'providerId'),
        accountId: requiredString(body, 'accountId'),
        enabled: body.enabled !== false,
        renewalWindowDays: optionalNumber(body, 'renewalWindowDays'),
        challengeType: requiredString(body, 'challengeType') as never,
        rotateKeyOnRenewal: body.rotateKeyOnRenewal !== false,
        maxAttempts: optionalNumber(body, 'maxAttempts'),
        backoffSeconds: optionalNumber(body, 'backoffSeconds'),
        maintenanceWindow: body.maintenanceWindow && typeof body.maintenanceWindow === 'object' && !Array.isArray(body.maintenanceWindow)
          ? body.maintenanceWindow as Record<string, unknown>
          : undefined,
        actorId: actorId(request),
      }),
    };
  }

  private async updateAcmePolicy(request: HttpRequest) {
    await this.assertManage(request, 'certificate_renewal');
    return this.requireAcme().policies.update(tenantId(request), pathId(request), {
      ...objectBody(request),
      actorId: actorId(request),
    });
  }

  private async listAcmeRenewalJobs(request: HttpRequest) {
    await this.assertRead(request, 'certificate_renewal');
    return this.requireAcme().repository.listRenewalJobs(tenantId(request));
  }

  private async scanAcmeRenewalJobs(request: HttpRequest) {
    await this.assertManage(request, 'certificate_renewal');
    return this.requireAcme().scheduler.runOnce(optionalNumber(objectBody(request), 'limit') ?? 50, new Date());
  }

  private async runAcmeRenewalJobs(request: HttpRequest) {
    await this.assertManage(request, 'certificate_renewal');
    return this.requireAcme().worker.runOnce(optionalNumber(objectBody(request), 'limit') ?? 10, actorId(request), request.context);
  }

  private async retryAcmeRenewalJob(request: HttpRequest) {
    await this.assertManage(request, 'certificate_renewal');
    return this.requireAcme().repository.retryRenewalJob(tenantId(request), pathId(request), new Date().toISOString());
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
    await this.assertApprove(request, 'ca.certificate.revoke');
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
    await this.assertApprove(request, 'ca.authority.manage');
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

  private async streamNodeTasks(request: HttpRequest) {
    const node = await this.authenticateNode(request, {});
    await this.service.heartbeatNode(node.tenantId, node.id, { healthStatus: 'online' });
    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
      stream: async (response: import('node:http').ServerResponse) => {
        let closed = false;
        let dispatching = false;
        let dispatchRequested = false;
        const writeEvent = (event: string, data: unknown) => {
          if (closed || response.writableEnded || response.destroyed) return;
          response.write(`event: ${event}\n`);
          response.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        const dispatch = async (): Promise<void> => {
          if (closed) return;
          if (dispatching) {
            dispatchRequested = true;
            return;
          }
          dispatching = true;
          try {
            const task = await this.service.leaseNodeTask(node.tenantId, node.id);
            if (task) writeEvent('task', task);
          } catch {
            writeEvent('error', { message: 'CA Node 任务推送失败' });
          } finally {
            dispatching = false;
            if (dispatchRequested) {
              dispatchRequested = false;
              void dispatch();
            }
          }
        };
        const unsubscribe = this.service.subscribeNodeTasks(node.providerId, () => { void dispatch(); });
        const heartbeat = setInterval(() => {
          writeEvent('heartbeat', { emittedAt: new Date().toISOString() });
          void this.service.heartbeatNode(node.tenantId, node.id, { healthStatus: 'online' }).catch(cleanup);
          void dispatch();
        }, 20_000);
        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
        };
        response.on('close', cleanup);
        response.on('error', cleanup);
        writeEvent('connected', { nodeId: node.id, providerId: node.providerId });
        await dispatch();
      },
    };
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
        tenantId(request), objectBody(request), actorId(request), agentInstallPublicBaseUrl(request), request.context,
      ),
    };
  }

  private async createAdcsAgentUpdateSession(request: HttpRequest) {
    await this.assertManage(request, 'ca_node');
    return {
      statusCode: 201,
      body: await this.service.createAdcsAgentUpdateSession(
        tenantId(request), pathId(request), actorId(request), agentInstallPublicBaseUrl(request), request.context,
      ),
    };
  }

  private async createAdcsViewInspectionTask(request: HttpRequest) {
    await this.assertManage(request, 'ca_provider');
    const body = objectBody(request);
    return {
      statusCode: 201,
      body: await this.service.createAdcsViewInspectionTask(
        tenantId(request),
        pathSegmentBefore(request, 'inspection-tasks'),
        optionalNumber(body, 'limit') ?? 20,
        actorId(request),
        request.context,
      ),
    };
  }

  private async getAdcsViewInspectionTask(request: HttpRequest) {
    await this.assertManage(request, 'ca_provider');
    return this.service.getAdcsViewInspectionTask(tenantId(request), lastPathSegment(request));
  }

  private async deleteProvider(request: HttpRequest) {
    await this.assertManage(request, 'ca_provider');
    return this.service.deleteProvider(tenantId(request), pathId(request), actorId(request), request.context);
  }

  private async getAdcsAgentInstallScript(request: HttpRequest) {
    const context = await this.service.getAdcsAgentInstallContext(requiredQuery(request, 'token'));
    return {
      statusCode: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      body: renderAdcsAgentInstallScript({ ...context, controlPlaneUrl: agentInstallPublicBaseUrl(request) }),
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
    await this.assertCaOperationsAction(request, 'ca.operations.read', resourceType, ['certificate.read', 'certificate.asset.read']);
  }

  private async assertCaOperationsRead(request: HttpRequest, authority?: { id: string; providerId: string; trustDomainId?: string }): Promise<void> {
    const subject = subjectFromRequest(request);
    await this.security.rbac.assertCan(subject, 'ca.operations.read', {
      type: authority ? 'certificate_authority' : 'caOperation',
      id: authority?.id,
      scope: {
        tenantId: request.context.tenantId,
        trustDomainId: authority?.trustDomainId,
        caId: authority?.id,
        providerId: authority?.providerId,
        resourceType: authority ? 'certificate_authority' : 'caOperation',
        resourceId: authority?.id,
      },
    }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
  }

  private async assertCaSync(
    request: HttpRequest,
    authority: { id: string; providerId: string; trustDomainId?: string },
    mode: 'incremental' | 'full',
  ): Promise<void> {
    const subject = subjectFromRequest(request);
    const action = mode === 'full' ? 'ca.operations.sync.full' : 'ca.operations.sync';
    await this.security.rbac.assertCan(subject, action, {
      type: 'certificate_authority', id: authority.id,
      scope: {
        tenantId: request.context.tenantId, trustDomainId: authority.trustDomainId, caId: authority.id,
        providerId: authority.providerId, resourceType: 'certificate_authority', resourceId: authority.id,
      },
    }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
  }

  private async allowedCaOperationsActions(
    request: HttpRequest,
    authority: { id: string; providerId: string; trustDomainId?: string },
    capabilities: { signCsr: boolean; revokeCertificate: boolean } | undefined,
    record: { objectType: string; normalizedStatus: string; recordKey: string },
  ): Promise<string[]> {
    const candidates: CaOperationsPermissionAction[] = [];
    if (record.objectType === 'request' && record.normalizedStatus === 'pending' && capabilities?.signCsr) candidates.push('ca.request.approve');
    if (record.objectType === 'request' && ['rejected', 'failed'].includes(record.normalizedStatus) && capabilities?.signCsr) candidates.push('ca.request.retry');
    if (record.objectType === 'issuance' && record.normalizedStatus === 'issued' && capabilities?.revokeCertificate) candidates.push('ca.certificate.revoke');
    const subject = subjectFromRequest(request);
    const context = { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject };
    const decisions = await Promise.all(candidates.map(async (action) => ({
      action,
      decision: await this.security.rbac.can(subject, action, {
        type: 'caOperation', id: record.recordKey,
        scope: {
          tenantId: request.context.tenantId, trustDomainId: authority.trustDomainId, caId: authority.id,
          providerId: authority.providerId, resourceType: 'caOperation', resourceId: record.recordKey,
        },
      }, context),
    })));
    return decisions.filter(({ decision }) => decision.allowed).map(({ action }) => action);
  }

  private async assertManage(request: HttpRequest, resourceType: string): Promise<void> {
    await this.assertCaOperationsAction(request, actionForManagedResource(resourceType), resourceType, ['certificate.import', 'certificate.asset.update']);
  }

  private async assertApprove(request: HttpRequest, action: CaOperationsPermissionAction): Promise<void> {
    await this.assertCaOperationsAction(request, action, 'certificate_request', ['approval.decide', 'certificate.import']);
  }

  private async assertCaOperationsAction(
    request: HttpRequest,
    action: CaOperationsPermissionAction,
    resourceType: string,
    legacyActions: string[],
  ): Promise<void> {
    const subject = subjectFromRequest(request);
    let lastError: unknown;
    for (const candidateAction of [action, ...legacyActions]) {
      try {
        await this.security.rbac.assertCan(subject, candidateAction, {
          type: resourceType,
          scope: { tenantId: request.context.tenantId, ownerId: subject.id, resourceType },
        }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

function actionForManagedResource(resourceType: string): CaOperationsPermissionAction {
  if (resourceType === 'ca_provider' || resourceType === 'ca_node') return 'ca.provider.manage';
  if (resourceType === 'certificate_profile') return 'ca.template.mapping.manage';
  if (resourceType === 'certificate_request') return 'ca.request.retry';
  if (resourceType === 'certificate_revocation') return 'ca.certificate.revoke';
  return 'ca.authority.manage';
}

export function getInternalCaRouteContracts(): RouteContract[] {
  const responseSchema = { type: 'object', additionalProperties: true } as const;
  const arraySchema = { type: 'array', items: responseSchema } as const;
  return [
    { method: 'GET', path: '/api/v1/ca-providers', operationId: 'listCaProviders', summary: '查询 CA Provider', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/ca-providers', operationId: 'createCaProvider', summary: '创建 CA Provider', tags, responseSchema },
    { method: 'DELETE', path: '/api/v1/ca-providers/:id', operationId: 'deleteCaProvider', summary: '删除未绑定的 CA Provider', tags, responseSchema },
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
    { method: 'GET', path: '/api/v1/acme/accounts', operationId: 'listAcmeAccounts', summary: '查询 ACME Account', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/acme/accounts', operationId: 'createAcmeAccount', summary: '创建 ACME Account', tags, responseSchema },
    { method: 'GET', path: '/api/v1/acme/accounts/:id', operationId: 'getAcmeAccount', summary: '查询 ACME Account 详情', tags, responseSchema },
    { method: 'GET', path: '/api/v1/acme/providers', operationId: 'listAcmeProviderSettings', summary: '查询 ACME 颁发者配置', tags, responseSchema },
    { method: 'POST', path: '/api/v1/acme/providers', operationId: 'createAcmeProvider', summary: '创建 ACME 颁发者配置', tags, responseSchema },
    { method: 'PATCH', path: '/api/v1/acme/providers/:id', operationId: 'updateAcmeProvider', summary: '更新 ACME 颁发者配置', tags, responseSchema },
    { method: 'POST', path: '/api/v1/acme/providers/:id/test', operationId: 'testAcmeProvider', summary: '测试 ACME 颁发者连接', tags, responseSchema },
    { method: 'GET', path: '/api/v1/acme/dns-providers', operationId: 'listAcmeDnsProviders', summary: '查询 ACME DNS 提供商', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/acme/certificates', operationId: 'createAcmeCertificate', summary: '创建简化 ACME 证书配置', tags, responseSchema },
    { method: 'PATCH', path: '/api/v1/acme/certificates/:id', operationId: 'updateAcmeCertificate', summary: '更新 ACME 证书自动化配置', tags, responseSchema },
    { method: 'DELETE', path: '/api/v1/acme/certificates/:id', operationId: 'deleteAcmeCertificate', summary: '删除 ACME 证书自动化配置', tags, responseSchema },
    { method: 'POST', path: '/api/v1/acme/certificates/:id/renew', operationId: 'manualRenewAcmeCertificate', summary: '手动续签指定 ACME 证书', tags, responseSchema },
    { method: 'GET', path: '/api/v1/acme/orders', operationId: 'listAcmeOrders', summary: '查询 ACME Order', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/acme/orders', operationId: 'createAcmeOrder', summary: '创建 ACME Order', tags, responseSchema },
    { method: 'GET', path: '/api/v1/acme/orders/:id', operationId: 'getAcmeOrder', summary: '查询 ACME Order 详情', tags, responseSchema },
    { method: 'POST', path: '/api/v1/acme/orders/:id/reconcile', operationId: 'reconcileAcmeOrder', summary: '恢复 ACME Order 状态', tags, responseSchema },
    { method: 'POST', path: '/api/v1/acme/orders/:id/finalize', operationId: 'finalizeAcmeOrder', summary: 'Finalize ACME Order', tags, responseSchema },
    { method: 'GET', path: '/api/v1/acme/renewal-policies', operationId: 'listAcmeRenewalPolicies', summary: '查询 ACME 续签策略', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/acme/renewal-policies', operationId: 'createAcmeRenewalPolicy', summary: '创建 ACME 续签策略', tags, responseSchema },
    { method: 'PATCH', path: '/api/v1/acme/renewal-policies/:id', operationId: 'updateAcmeRenewalPolicy', summary: '更新 ACME 续签策略', tags, responseSchema },
    { method: 'GET', path: '/api/v1/acme/renewal-jobs', operationId: 'listAcmeRenewalJobs', summary: '查询 ACME 续签任务', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/acme/renewal-jobs/scan', operationId: 'scanAcmeRenewalJobs', summary: '扫描 ACME 到期证书', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/acme/renewal-jobs/run', operationId: 'runAcmeRenewalJobs', summary: '执行 ACME 续签任务', tags, responseSchema: arraySchema },
    { method: 'POST', path: '/api/v1/acme/renewal-jobs/:id/retry', operationId: 'retryAcmeRenewalJob', summary: '重试 ACME 续签任务', tags, responseSchema },
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
    { method: 'GET', path: '/api/v1/ca-nodes/tasks/stream', operationId: 'streamCaNodeTasks', summary: '建立 CA Node 任务推送通道', tags, responseSchema },
    { method: 'POST', path: '/api/v1/ca-nodes/tasks/:id/result', operationId: 'completeCaNodeTask', summary: '回传 CA Node 任务结果', tags, responseSchema },
    { method: 'POST', path: '/api/v1/adcs-agents/install-sessions', operationId: 'createAdcsAgentInstallSession', summary: '创建 AD CS Agent 一键安装会话', tags, responseSchema },
    { method: 'POST', path: '/api/v1/adcs-agents/providers/:id/update-sessions', operationId: 'createAdcsAgentUpdateSession', summary: '创建 AD CS Agent 更新会话', tags, responseSchema },
    { method: 'POST', path: '/api/v1/adcs-agents/providers/:id/inspection-tasks', operationId: 'createAdcsViewInspectionTask', summary: '创建 AD CS 结构化视图探针任务', tags, responseSchema },
    { method: 'GET', path: '/api/v1/adcs-agents/inspection-tasks/:id', operationId: 'getAdcsViewInspectionTask', summary: '查询 AD CS 结构化视图探针任务', tags, responseSchema },
    { method: 'GET', path: '/api/v1/adcs-agents/install.ps1', operationId: 'getAdcsAgentInstallScript', summary: '下载 AD CS Agent 安装脚本', tags, responseSchema },
    { method: 'GET', path: '/api/v1/adcs-agents/binary', operationId: 'getAdcsAgentBinary', summary: '下载 AD CS Agent 程序', tags, responseSchema },
  ];
}

function tenantId(request: HttpRequest): string {
  return requireTenantId(request);
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

function caOperationsRecordQuery(request: HttpRequest): CaOperationsRecordQueryDto {
  const caId = queryValue(request, 'caId');
  const view = queryValue(request, 'view');
  if (!caId || !view) throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 运营查询缺少 caId 或 view');
  const limitValue = queryValue(request, 'limit');
  const limit = limitValue === undefined ? undefined : Number(limitValue);
  if (limitValue !== undefined && !Number.isInteger(limit)) throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 运营分页大小无效');
  return {
    caId, view: view as CaOperationsRecordQueryDto['view'], status: queryValues(request, 'status') as CaOperationsRecordQueryDto['status'],
    source: queryValues(request, 'source') as CaOperationsRecordQueryDto['source'], query: queryValue(request, 'query'),
    from: queryValue(request, 'from'), to: queryValue(request, 'to'), sort: queryValue(request, 'sort'),
    cursor: queryValue(request, 'cursor'), limit,
  };
}

function queryValue(request: HttpRequest, name: string): string | undefined {
  const value = request.query[name];
  return Array.isArray(value) ? value[0] : value;
}

function queryValues(request: HttpRequest, name: string): string[] | undefined {
  const value = request.query[name];
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value]).flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean);
}

export function pathId(request: HttpRequest): string {
  const value = request.query.id;
  const queryId = Array.isArray(value) ? value[0] : value;
  const segments = request.path.split('/').filter(Boolean);
  const actionIndex = segments.findIndex((segment) => ['test', 'versions', 'approve', 'retry', 'activate', 'result', 'complete', 'remediation-preview', 'update-sessions', 'reconcile', 'finalize', 'promote', 'renew'].includes(segment));
  const id = queryId ?? (actionIndex > 0 ? segments[actionIndex - 1] : segments.at(-1));
  if (!id) throw new AppError('VALIDATION_FAILED', 'id 不能为空');
  return id;
}

function pathSegmentBefore(request: HttpRequest, segment: string): string {
  const segments = request.path.split('/').filter(Boolean);
  const index = segments.indexOf(segment);
  const value = index > 0 ? segments[index - 1] : undefined;
  if (!value) throw new AppError('VALIDATION_FAILED', '路径参数不能为空', { segment });
  return value;
}

function lastPathSegment(request: HttpRequest): string {
  const value = request.path.split('/').filter(Boolean).at(-1);
  if (!value) throw new AppError('VALIDATION_FAILED', '路径参数不能为空');
  return value;
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

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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

export function agentInstallPublicBaseUrl(request: HttpRequest): string {
  const configured = process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL?.trim() || process.env.GCAC_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const protocol = String(request.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim();
  const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '127.0.0.1:3000').split(',')[0].trim();
  return `${protocol}://${host}`;
}

export function renderAdcsAgentInstallScript(input: { controlPlaneUrl: string; tenantId: string; providerId: string; token: string }): string {
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
    "$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue",
    "if ($null -ne $existing) {",
    "  Stop-Service -Name $serviceName -Force -ErrorAction Stop",
    "  $existing.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))",
    "}",
    "$binaryUrl = ([string]$manifest.controlPlaneUrl).TrimEnd('/') + '/api/v1/adcs-agents/binary'",
    "Invoke-WebRequest -UseBasicParsing -Uri $binaryUrl -OutFile $binaryPath",
    "$config = [ordered]@{ controlPlaneUrl = $manifest.controlPlaneUrl; tenantId = $manifest.tenantId; providerId = $manifest.providerId; enrollmentToken = $manifest.token; nodeName = $env:COMPUTERNAME; dataDir = $dataRoot }",
    "if (Test-Path $configPath) {",
    "  $existingConfig = Get-Content -Raw -Encoding UTF8 $configPath | ConvertFrom-Json",
    "  if ([string]$existingConfig.providerId -eq [string]$manifest.providerId -and -not [string]::IsNullOrWhiteSpace([string]$existingConfig.nodeId)) {",
    "    $config.nodeId = [string]$existingConfig.nodeId",
    "    $config.enrollmentToken = ''",
    "    if (-not [string]::IsNullOrWhiteSpace([string]$existingConfig.caConfig)) { $config.caConfig = [string]$existingConfig.caConfig }",
    "  }",
    "}",
    "$utf8 = New-Object System.Text.UTF8Encoding($false)",
    "[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 8), $utf8)",
    "icacls.exe $dataRoot /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\\Administrators:(OI)(CI)F' | Out-Null",
    "& $binaryPath preflight --config $configPath",
    "if ($LASTEXITCODE -ne 0) { throw 'AD CS 环境预检失败，服务未安装。' }",
    "if ($null -ne $existing) { sc.exe delete $serviceName | Out-Null; Start-Sleep -Seconds 1 }",
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

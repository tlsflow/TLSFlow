import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import { SecurityError } from '../../../shared/security-error.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { enqueueTaskBestEffort, type TaskEnqueuer } from '../../tasks/task-enqueue.js';
import type { CaOperationsPermissionAction } from '../ca-operations.security.js';
import type { CaOperationsRecordQueryDto, CreateCaSyncRunsDto } from '../dto/ca-operations.dto.js';
import type {
  AcmeProviderConfigurationInput,
  CreateAuthorityInput,
  CreateCaProviderInput,
  UpdateCaProviderInput,
  CreateProviderActionBindingInput,
  CreateCaTrustDomainInput,
  CreateCertificateRequestInput,
  CreateProfileInput,
  InternalCaApplicationService,
  PreviewCaInput,
  UpdateCaTrustDomainInput,
} from '../application/internal-ca.application-service.js';
import type { CertificateLifecycleService, CreateCertificateRotationInput } from '../application/certificate-lifecycle.service.js';
import type { AcmeAccountService } from '../application/acme-account.service.js';
import type { AcmeCertificateService } from '../application/acme-certificate.service.js';
import type { AcmeOrderService } from '../application/acme-order.service.js';
import type { AcmeRenewalPolicyService } from '../application/acme-renewal-policy.service.js';
import { renewalTaskIdempotencyKey, renewalTaskPayload, type AcmeRenewalScheduler } from '../application/acme-renewal-scheduler.js';
import type { AcmeRenewalWorker } from '../application/acme-renewal-worker.js';
import type { AcmeRepository } from '../repository/acme.repository.js';
import { listAcmeDnsProviders } from '../providers/acme-dns-provider.registry.js';

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
    private readonly tasks?: TaskEnqueuer,
    private readonly lifecycle?: CertificateLifecycleService,
  ) {}

  register(router: Router): void {
    // 证书 CDP 由客户端匿名读取；路径同时包含租户和 CA，避免跨租户返回 CRL。
    router.get('/api/v1/public/ca-crl/:tenantId/:caId', '读取公开 CA CRL', tags, (request) => this.getPublicCrl(request));
    router.get('/api/v1/ca-providers', '查询通用 CA Provider', tags, (request) => this.listProviders(request));
    router.post('/api/v1/ca-providers', '创建通用 CA Provider', tags, (request) => this.createProvider(request));
    router.patch('/api/v1/ca-providers/:id', '更新 CA Provider', tags, (request) => this.updateProvider(request));
    router.delete('/api/v1/ca-providers/:id', '删除或停用 CA Provider 登记', tags, (request) => this.deleteProvider(request));
    router.post('/api/v1/ca-providers/:id/test', '检查 CA Provider 合同状态', tags, (request) => this.testProvider(request));
    router.get('/api/v1/ca-providers/:id/action-bindings', '查询 CA Provider 固定动作绑定', tags, (request) => this.listProviderActionBindings(request));
    router.post('/api/v1/ca-providers/:id/action-bindings', '创建 CA Provider 固定动作绑定', tags, (request) => this.createProviderActionBinding(request));
    router.get('/api/v1/ca-operations/tree', '查询 CA 运营资源树', tags, (request) => this.listOperationsTree(request));
    router.get('/api/v1/ca-operations/records', '查询 CA 运营记录', tags, (request) => this.listOperationRecords(request));
    router.get('/api/v1/ca-operations/records/:recordKey', '查询 CA 运营记录详情', tags, (request) => this.getOperationRecord(request));
    router.post('/api/v1/ca-operations/sync-runs', '创建 CA 历史同步运行', tags, (request) => this.createSyncRuns(request));
    router.get('/api/v1/ca-operations/sync-runs', '查询 CA 历史同步运行', tags, (request) => this.listSyncRuns(request));
    router.get('/api/v1/ca-trust-domains', '查询 CA 信任域', tags, (request) => this.listTrustDomains(request));
    router.post('/api/v1/ca-trust-domains', '创建 CA 信任域', tags, (request) => this.createTrustDomain(request));
    router.patch('/api/v1/ca-trust-domains/:id', '更新 CA 信任域', tags, (request) => this.updateTrustDomain(request));
    router.get('/api/v1/certificate-authorities', '查询证书机构', tags, (request) => this.listAuthorities(request));
    router.delete('/api/v1/certificate-authorities/:id', '退休证书机构', tags, (request) => this.deleteAuthority(request));
    router.post('/api/v1/certificate-authorities/preview', '预览 CA 拓扑风险', tags, (request) => this.previewAuthority(request));
    router.post('/api/v1/certificate-authorities', '创建证书机构对象', tags, (request) => this.createAuthority(request));
    router.get('/api/v1/certificate-profiles', '查询证书 Profile', tags, (request) => this.listProfiles(request));
    router.post('/api/v1/certificate-profiles', '创建证书 Profile', tags, (request) => this.createProfile(request));
    router.post('/api/v1/certificate-profiles/:id/versions', '创建证书 Profile 版本', tags, (request) => this.createProfileVersion(request));
    router.get('/api/v1/certificate-policies', '查询租户证书策略', tags, (request) => this.listCertificatePolicies(request));
    router.post('/api/v1/certificate-policies/:id/versions', '创建证书策略版本', tags, (request) => this.createCertificatePolicyVersion(request));
    router.get('/api/v1/certificate-requests', '查询证书申请', tags, (request) => this.listRequests(request));
    router.post('/api/v1/certificate-requests', '创建证书申请对象', tags, (request) => this.createRequest(request));
    router.post('/api/v1/certificate-requests/:id/approve', '审批证书申请', tags, (request) => this.approveRequest(request));
    router.post('/api/v1/certificate-requests/:id/retry', '请求插件重试签发', tags, (request) => this.issueRequest(request));
    router.post('/api/v1/certificate-requests/:id/query', '查询插件签发结果', tags, (request) => this.queryRequest(request));
    router.post('/api/v1/certificate-requests/:id/activate', '确认应用证书已安装', tags, (request) => this.activateRequest(request));
    router.get('/api/v1/certificate-renewals', '查询证书续期任务', tags, (request) => this.listRenewals(request));
    router.post('/api/v1/certificate-renewals/scan', '创建通用证书续期任务', tags, (request) => this.scanRenewals(request));
    router.get('/api/v1/acme/status', '查询宿主 ACME 能力状态', tags, (request) => this.getAcmeStatus(request));
    router.get('/api/v1/acme/accounts', '查询 ACME Account', tags, (request) => this.listAcmeAccounts(request));
    router.post('/api/v1/acme/accounts', '创建 ACME Account', tags, (request) => this.createAcmeAccount(request));
    router.get('/api/v1/acme/accounts/:id', '查询 ACME Account 详情', tags, (request) => this.getAcmeAccount(request));
    router.get('/api/v1/acme/provider-profiles', '查询 ACME Provider Profile', tags, (request) => this.listAcmeProviderProfiles(request));
    router.post('/api/v1/acme/providers/probe-directory', '探测未保存的 ACME Directory', tags, (request) => this.probeAcmeDirectory(request));
    router.get('/api/v1/acme/providers', '查询 ACME 颁发者配置', tags, (request) => this.listAcmeProviderSettings(request));
    router.post('/api/v1/acme/providers', '创建 ACME 颁发者配置', tags, (request) => this.createAcmeProvider(request));
    router.patch('/api/v1/acme/providers/:id', '更新 ACME 颁发者配置', tags, (request) => this.updateAcmeProvider(request));
    router.post('/api/v1/acme/providers/:id/test', '测试 ACME 颁发者连接', tags, (request) => this.testAcmeProvider(request));
    router.get('/api/v1/acme/dns-providers', '查询 LEGO DNS Provider', tags, (request) => this.listAcmeDnsProviders(request));
    router.post('/api/v1/acme/certificates', '创建简化 ACME 证书配置', tags, (request) => this.createAcmeCertificate(request));
    router.patch('/api/v1/acme/certificates/:id', '更新 ACME 证书自动化配置', tags, (request) => this.updateAcmeCertificate(request));
    router.delete('/api/v1/acme/certificates/:id', '删除 ACME 证书自动化配置', tags, (request) => this.deleteAcmeCertificate(request));
    router.post('/api/v1/acme/certificates/:id/renew', '手动续签指定 ACME 证书', tags, (request) => this.manualRenewAcmeCertificate(request));
    router.get('/api/v1/acme/orders', '查询 ACME Order', tags, (request) => this.listAcmeOrders(request));
    router.get('/api/v1/acme/orders/:id', '查询 ACME Order 详情', tags, (request) => this.getAcmeOrder(request));
    router.post('/api/v1/acme/orders/:id/reconcile', '恢复 ACME Order 状态', tags, (request) => this.reconcileAcmeOrder(request));
    router.post('/api/v1/acme/orders/:id/finalize', 'Finalize ACME Order', tags, (request) => this.finalizeAcmeOrder(request));
    router.get('/api/v1/acme/renewal-policies', '查询 ACME 续签策略', tags, (request) => this.listAcmePolicies(request));
    router.patch('/api/v1/acme/renewal-policies/:id', '更新 ACME 续签策略', tags, (request) => this.updateAcmePolicy(request));
    router.get('/api/v1/acme/renewal-jobs', '查询 ACME 续签任务', tags, (request) => this.listAcmeRenewalJobs(request));
    router.post('/api/v1/acme/renewal-jobs/scan', '扫描 ACME 到期证书', tags, (request) => this.scanAcmeRenewalJobs(request));
    router.post('/api/v1/acme/renewal-jobs/:id/retry', '重试 ACME 续签任务', tags, (request) => this.retryAcmeRenewalJob(request));
    router.post('/api/v1/acme/renewal-jobs/:id/cancel', '取消 ACME 续签任务', tags, (request) => this.cancelAcmeRenewalJob(request));
    router.get('/api/v1/certificate-revocations', '查询证书吊销任务', tags, (request) => this.listRevocations(request));
    router.post('/api/v1/certificate-revocations', '创建证书吊销任务', tags, (request) => this.createRevocation(request));
    router.post('/api/v1/certificate-revocations/:id/approve', '审批证书吊销任务', tags, (request) => this.approveRevocation(request));
    router.get('/api/v1/ca-crl-publications', '查询 CA CRL 发布记录', tags, (request) => this.listCrlPublications(request));
    router.post('/api/v1/certificate-authorities/:id/crl/publish', '发布内置 CA CRL', tags, (request) => this.publishCrl(request));
    router.get('/api/v1/certificate-rotations', '查询证书换钥轮换任务', tags, (request) => this.listRotations(request));
    router.post('/api/v1/certificate-rotations', '创建证书换钥轮换任务', tags, (request) => this.createRotation(request));
    router.get('/api/v1/certificate-rotations/:id', '查询证书换钥轮换详情', tags, (request) => this.getRotation(request));
    router.get('/api/v1/certificate-rotations/:id/install-action', '生成轮换证书安装动作', tags, (request) => this.getRotationInstallAction(request));
    router.post('/api/v1/certificate-rotations/:id/tls-verify', '回传轮换 TLS 验证结果', tags, (request) => this.markRotationTlsVerified(request));
    router.get('/api/v1/ca-trust-distributions', '查询 CA 信任分发任务', tags, (request) => this.listTrustDistributions(request));
    router.post('/api/v1/ca-trust-distributions', '创建 CA 信任分发任务', tags, (request) => this.createTrustDistribution(request));
    router.post('/api/v1/ca-trust-distributions/:id/approve', '审批 CA 信任分发任务', tags, (request) => this.approveTrustDistribution(request));
    router.post('/api/v1/ca-trust-distributions/:id/complete', '回传 CA 信任分发验证结果', tags, (request) => this.completeTrustDistribution(request));
    router.get('/api/v1/reports/certificate-reuse/overview', '查询证书复用风险摘要', tags, (request) => this.certificateReuseOverview(request));
    router.get('/api/v1/reports/certificate-reuse/items', '查询证书复用风险明细', tags, (request) => this.certificateReuseItems(request));
    router.get('/api/v1/reports/certificate-reuse/export', '导出证书复用风险', tags, (request) => this.exportCertificateReuse(request));
    router.post('/api/v1/reports/certificate-reuse/:id/remediation-preview', '预览证书复用风险整改', tags, (request) => this.previewCertificateReuseRemediation(request));
  }

  private async listProviders(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'ca_provider');
    return this.service.listProviders(tenantId(request));
  }

  private async createProvider(request: HttpRequest) {
    await this.assertAction(request, 'ca.provider.manage', 'ca_provider');
    return { statusCode: 201, body: await this.service.createProvider(tenantId(request), objectBody(request) as unknown as CreateCaProviderInput, actorId(request), request.context) };
  }

  private async updateProvider(request: HttpRequest) {
    await this.assertAction(request, 'ca.provider.manage', 'ca_provider');
    return this.service.updateProvider(tenantId(request), pathId(request), objectBody(request) as unknown as UpdateCaProviderInput, actorId(request), request.context);
  }

  private async deleteProvider(request: HttpRequest) {
    await this.assertAction(request, 'ca.provider.manage', 'ca_provider');
    return this.service.deleteProvider(tenantId(request), pathId(request), actorId(request), request.context);
  }

  private async testProvider(request: HttpRequest) {
    await this.assertAction(request, 'ca.provider.manage', 'ca_provider');
    return this.service.testProvider(tenantId(request), pathId(request));
  }

  private async listProviderActionBindings(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'ca_provider_action_binding');
    return this.service.listProviderActionBindings(tenantId(request), providerIdFromBindingPath(request));
  }

  private async createProviderActionBinding(request: HttpRequest) {
    await this.assertAction(request, 'ca.provider.manage', 'ca_provider_action_binding');
    const body = objectBody(request);
    return {
      statusCode: 201,
      body: await this.service.createProviderActionBinding(tenantId(request), {
        ...body,
        providerId: providerIdFromBindingPath(request),
      } as unknown as CreateProviderActionBindingInput, actorId(request), request.context),
    };
  }

  private async listOperationsTree(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'caOperation');
    return this.service.listCaOperationsTree(tenantId(request), async (authority) => (
      await this.security.rbac.can(
        subjectFromRequest(request),
        'ca.operations.read',
        this.authorityResource(request, authority),
        request.context,
      )
    ).allowed);
  }

  private async listOperationRecords(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'caOperation');
    const query = operationQuery(request);
    await this.assertAuthorityRead(request, query.caId);
    return this.service.listCaOperationsRecords(tenantId(request), query);
  }

  private async getOperationRecord(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'caOperation');
    const record = await this.service.getCaOperationsRecord(tenantId(request), lastPathSegment(request));
    await this.assertAuthorityRead(request, record.caId);
    return record;
  }

  private async createSyncRuns(request: HttpRequest) {
    const rawBody = objectBody(request);
    const body = rawBody as unknown as CreateCaSyncRunsDto;
    await this.assertAction(request, body.mode === 'full' ? 'ca.operations.sync.full' : 'ca.operations.sync', 'certificate_authority');
    const runs = await this.service.createCaSyncRuns({
      tenantId: tenantId(request), providerId: requiredString(rawBody, 'providerId'), caId: requiredString(rawBody, 'caId'),
      objectTypes: body.objectTypes, mode: body.mode, actor: subjectFromRequest(request), context: request.context,
    });
    for (const run of runs) {
      enqueueTaskBestEffort(this.tasks, {
        tenantId: run.tenantId,
        taskType: 'CA_RECORD_SYNC',
        requestedBy: run.requestedBy,
        triggerSource: 'ca.sync.manual',
        idempotencyKey: `ca-record-sync:${run.id}`,
        payload: { syncRunId: run.id },
        resourceRefs: [
          { resourceType: 'caSyncRun', resourceId: run.id },
          { resourceType: 'certificateAuthority', resourceId: run.caId },
        ],
      });
    }
    return { statusCode: 202, body: runs };
  }

  private async listSyncRuns(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'caOperation');
    const caId = optionalQuery(request, 'caId');
    if (caId) await this.assertAuthorityRead(request, caId);
    return { items: await this.service.listCaSyncRuns(tenantId(request), caId) };
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

  private async deleteAuthority(request: HttpRequest) {
    await this.assertAction(request, 'ca.authority.manage', 'certificate_authority');
    return this.service.deleteAuthority(tenantId(request), pathId(request), actorId(request), request.context);
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

  private async listCertificatePolicies(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'certificate_policy');
    return this.service.listCertificatePolicies(tenantId(request));
  }

  private async createCertificatePolicyVersion(request: HttpRequest) {
    await this.assertAction(request, 'ca.template.mapping.manage', 'certificate_policy');
    return this.service.createCertificatePolicyVersion(tenantId(request), pathId(request), objectBody(request), actorId(request), request.context);
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

  private requireAcme(): InternalCaAcmeServices {
    if (!this.acme) throw new AppError('CA_CAPABILITY_UNSUPPORTED', '宿主 ACME 生命周期服务未接入');
    return this.acme;
  }

  private async getAcmeStatus(request: HttpRequest) {
    await this.assertAcmeRead(request, 'certificate_request');
    const provider = await this.service.ensureBuiltinAcmeProvider(tenantId(request), actorId(request));
    return {
      status: 'READY',
      provider: {
        id: provider.id,
        name: provider.name,
        preset: provider.configuration?.preset ?? 'letsencrypt',
      },
      capabilities: {
        hostAcme: true,
        dnsCredentialProfiles: true,
        http01: true,
        runnerRequired: false,
      },
    };
  }

  private async listAcmeAccounts(request: HttpRequest) {
    await this.assertAcmeRead(request, 'ca_provider');
    return this.requireAcme().accounts.list(tenantId(request), optionalQuery(request, 'providerId'));
  }

  private async createAcmeAccount(request: HttpRequest) {
    await this.assertAction(request, 'ca.provider.manage', 'ca_provider');
    const body = objectBody(request);
    return {
      statusCode: 201,
      body: await this.requireAcme().accounts.create({
        tenantId: tenantId(request),
        providerId: requiredString(body, 'providerId'),
        accountKeySecretRef: optionalString(body.accountKeySecretRef),
        contact: Array.isArray(body.contact) ? body.contact.map(String) : undefined,
        termsOfServiceAgreed: body.termsOfServiceAgreed !== false,
        eabSecretRef: optionalString(body.eabSecretRef),
        eabKeyIdSecretRef: optionalString(body.eabKeyIdSecretRef),
        eabHmacSecretRef: optionalString(body.eabHmacSecretRef),
        actorId: actorId(request),
      }),
    };
  }

  private async getAcmeAccount(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'ca_provider');
    return this.requireAcme().accounts.get(tenantId(request), pathId(request));
  }

  private async listAcmeProviderSettings(request: HttpRequest) {
    await this.assertAcmeRead(request, 'ca_provider');
    return this.service.listAcmeProviderSettings(tenantId(request));
  }

  private async listAcmeProviderProfiles(request: HttpRequest) {
    await this.assertAcmeRead(request, 'ca_provider');
    return { items: this.service.listAcmeProviderProfiles() };
  }

  private async createAcmeProvider(request: HttpRequest) {
    await this.assertAction(request, 'ca.provider.manage', 'ca_provider');
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

  private async probeAcmeDirectory(request: HttpRequest) {
    await this.assertAction(request, 'ca.provider.manage', 'ca_provider');
    return this.service.probeAcmeDirectory(
      tenantId(request),
      objectBody(request) as unknown as AcmeProviderConfigurationInput,
    );
  }

  private async updateAcmeProvider(request: HttpRequest) {
    await this.assertAction(request, 'ca.provider.manage', 'ca_provider');
    return this.service.updateAcmeProvider(
      tenantId(request),
      pathId(request),
      objectBody(request) as unknown as AcmeProviderConfigurationInput,
      actorId(request),
      request.context,
    );
  }

  private async testAcmeProvider(request: HttpRequest) {
    await this.assertAction(request, 'ca.provider.manage', 'ca_provider');
    return this.service.testProvider(tenantId(request), pathId(request));
  }

  private async listAcmeDnsProviders(request: HttpRequest) {
    await this.assertAcmeRead(request, 'certificate_request');
    return listAcmeDnsProviders();
  }

  private async createAcmeCertificate(request: HttpRequest) {
    await this.assertAcmeWrite(request, 'certificate.create', 'certificate_renewal');
    const body = objectBody(request);
    await this.service.ensureBuiltinAcmeProvider(tenantId(request), actorId(request));
    const certificate = await this.requireAcme().certificates.create({
      tenantId: tenantId(request),
      name: optionalString(body.name),
      domains: Array.isArray(body.domains) ? body.domains.map(String) : [],
      contactEmail: requiredString(body, 'contactEmail'),
      providerId: optionalString(body.providerId),
      challengeType: (optionalString(body.challengeType) ?? 'dns-01') as never,
      dnsProvider: optionalString(body.dnsProvider),
      dnsCredentialId: optionalString(body.dnsCredentialId),
      dnsPropagationSeconds: optionalNumber(body, 'dnsPropagationSeconds'),
      keyType: optionalString(body.keyType) as 'rsa' | 'ecdsa' | undefined,
      autoRenew: body.autoRenew !== false,
      renewalWindowDays: optionalNumber(body, 'renewalWindowDays') ?? 7,
      termsOfServiceAgreed: body.termsOfServiceAgreed !== false,
      actorId: actorId(request),
    });
    enqueueTaskBestEffort(this.tasks, {
      tenantId: tenantId(request),
      taskType: 'ACME_CERTIFICATE_ISSUE',
      requestedBy: actorId(request),
      triggerSource: 'acme.certificate.create',
      idempotencyKey: `acme-issue:${certificate.asset.id}`,
      payload: { certificateAssetId: certificate.asset.id, certificateRequestId: certificate.certificateRequestId, renewalJobId: certificate.renewalJobId },
      resourceRefs: [
        { resourceType: 'certificateAsset', resourceId: certificate.asset.id },
        { resourceType: 'acmeRenewalJob', resourceId: certificate.renewalJobId },
      ],
    });
    return { statusCode: 201, body: certificate };
  }

  private async updateAcmeCertificate(request: HttpRequest) {
    await this.assertAcmeWrite(request, 'certificate.lifecycle', 'certificate_renewal');
    const body = objectBody(request);
    const assetId = pathId(request);
    const policy = (await this.requireAcme().policies.list(tenantId(request)))
      .find((item) => item.certificateAssetId === assetId);
    const providerId = optionalString(body.providerId) ?? policy?.providerId;
    const challengeType = optionalString(body.challengeType) ?? policy?.challengeType;
    if (!providerId || !challengeType) {
      throw new AppError('VALIDATION_FAILED', '历史 ACME 证书缺少自动化配置，请选择 Provider 和验证方式', {
        certificateAssetId: assetId,
      });
    }
    return this.requireAcme().certificates.update({
      tenantId: tenantId(request),
      certificateAssetId: assetId,
      name: optionalString(body.name),
      domains: Array.isArray(body.domains) ? body.domains.map(String) : [],
      contactEmail: requiredString(body, 'contactEmail'),
      providerId,
      challengeType: challengeType as never,
      dnsProvider: optionalString(body.dnsProvider),
      dnsCredentialId: optionalString(body.dnsCredentialId),
      dnsPropagationSeconds: optionalNumber(body, 'dnsPropagationSeconds'),
      keyType: optionalString(body.keyType) as 'rsa' | 'ecdsa' | undefined,
      autoRenew: body.autoRenew !== false,
      renewalWindowDays: optionalNumber(body, 'renewalWindowDays') ?? policy?.renewalWindowDays ?? 7,
      actorId: actorId(request),
    });
  }

  private async deleteAcmeCertificate(request: HttpRequest) {
    await this.assertAcmeWrite(request, 'certificate.lifecycle', 'certificate_renewal');
    return this.requireAcme().certificates.delete(tenantId(request), pathId(request), actorId(request), request.context);
  }

  private async manualRenewAcmeCertificate(request: HttpRequest) {
    await this.assertAcmeWrite(request, 'certificate.lifecycle', 'certificate_renewal');
    const tenant = tenantId(request);
    const actor = actorId(request);
    const assetId = pathId(request);
    const job = await this.requireAcme().scheduler.scheduleManualRenewal(tenant, assetId, actor, new Date());
    enqueueTaskBestEffort(this.tasks, {
      tenantId: tenant,
      taskType: 'ACME_CERTIFICATE_RENEWAL',
      requestedBy: actor,
      triggerSource: 'acme.certificate.manual-renewal',
      idempotencyKey: renewalTaskIdempotencyKey(job),
      payload: renewalTaskPayload(job),
      resourceRefs: [{ resourceType: 'acmeRenewalJob', resourceId: job.id }, { resourceType: 'certificateAsset', resourceId: assetId }],
    });
    return { statusCode: 202, body: job };
  }

  private async listAcmeOrders(request: HttpRequest) {
    await this.assertAcmeRead(request, 'certificate_request');
    return this.requireAcme().orders.list(tenantId(request), optionalQuery(request, 'status') as never);
  }

  private async getAcmeOrder(request: HttpRequest) {
    await this.assertAcmeRead(request, 'certificate_request');
    return this.requireAcme().orders.get(tenantId(request), pathId(request));
  }

  private async reconcileAcmeOrder(request: HttpRequest) {
    await this.assertAction(request, 'ca.request.retry', 'certificate_request');
    return this.requireAcme().orders.reconcile(tenantId(request), pathId(request), actorId(request));
  }

  private async finalizeAcmeOrder(request: HttpRequest) {
    await this.assertAction(request, 'ca.request.retry', 'certificate_request');
    return this.requireAcme().orders.finalize(tenantId(request), pathId(request), actorId(request));
  }

  private async listAcmePolicies(request: HttpRequest) {
    await this.assertAcmeRead(request, 'certificate_renewal');
    return this.requireAcme().policies.list(tenantId(request));
  }

  private async updateAcmePolicy(request: HttpRequest) {
    await this.assertAcmeWrite(request, 'certificate.lifecycle', 'certificate_renewal');
    return this.requireAcme().policies.update(tenantId(request), pathId(request), {
      ...objectBody(request),
      actorId: actorId(request),
    });
  }

  private async listAcmeRenewalJobs(request: HttpRequest) {
    await this.assertAcmeRead(request, 'certificate_renewal');
    return this.requireAcme().repository.listRenewalJobs(tenantId(request));
  }

  private async scanAcmeRenewalJobs(request: HttpRequest) {
    await this.assertAction(request, 'ca.request.retry', 'certificate_renewal');
    const jobs = await this.requireAcme().scheduler.runOnce(optionalNumber(objectBody(request), 'limit') ?? 50, new Date());
    return { items: jobs };
  }

  private async retryAcmeRenewalJob(request: HttpRequest) {
    await this.assertAction(request, 'ca.request.retry', 'certificate_renewal');
    const job = await this.requireAcme().repository.retryRenewalJob(tenantId(request), pathId(request), new Date().toISOString());
    enqueueTaskBestEffort(this.tasks, {
      tenantId: job.tenantId,
      taskType: 'ACME_CERTIFICATE_RENEWAL',
      requestedBy: actorId(request),
      triggerSource: 'acme.certificate.retry',
      idempotencyKey: renewalTaskIdempotencyKey(job),
      payload: renewalTaskPayload(job),
      resourceRefs: [{ resourceType: 'acmeRenewalJob', resourceId: job.id }],
    });
    return job;
  }

  private async cancelAcmeRenewalJob(request: HttpRequest) {
    await this.assertAcmeWrite(request, 'certificate.lifecycle', 'certificate_renewal');
    const body = objectBody(request);
    const reason = optionalString(body.reason) ?? '用户请求取消 ACME 续签任务';
    return this.requireAcme().repository.cancelRenewalJob(
      tenantId(request),
      pathId(request),
      new Date().toISOString(),
      reason,
    );
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

  private async listCrlPublications(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'ca_crl_publication');
    return this.service.listCrlPublications(tenantId(request), optionalQuery(request, 'caId'));
  }

  private async getPublicCrl(request: HttpRequest) {
    const parts = request.path.split('/').filter(Boolean);
    const tenantId = decodeURIComponent(parts.at(-2) ?? '');
    const caId = decodeURIComponent(parts.at(-1) ?? '');
    if (!tenantId || !caId) throw new AppError('VALIDATION_FAILED', '公开 CRL 路径缺少租户或 CA ID');
    const format = request.query.format === 'pem' ? 'pem' : 'der';
    const result = await this.service.getPublicCrl(tenantId, caId, format);
    return {
      statusCode: 200,
      headers: {
        'content-type': result.contentType,
        'cache-control': 'public, max-age=300, must-revalidate',
        etag: result.etag,
        'x-gcac-crl-number': String(result.crlNumber),
      },
      body: result.body,
    };
  }

  private async publishCrl(request: HttpRequest) {
    await this.assertAction(request, 'ca.certificate.revoke', 'ca_crl_publication');
    return { statusCode: 201, body: await this.service.publishCrl(tenantId(request), pathId(request), actorId(request)) };
  }

  private requireLifecycle(): CertificateLifecycleService {
    if (!this.lifecycle) throw new AppError('CA_CAPABILITY_UNSUPPORTED', '证书生命周期服务未接入');
    return this.lifecycle;
  }

  private async listRotations(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'certificate_rotation');
    return this.requireLifecycle().listRotations(tenantId(request));
  }

  private async createRotation(request: HttpRequest) {
    await this.assertAction(request, 'ca.request.retry', 'certificate_rotation');
    const body = objectBody(request);
    return {
      statusCode: 201,
      body: await this.requireLifecycle().createRotation({
        ...body,
        tenantId: tenantId(request),
        applicationAssetId: requiredString(body, 'applicationAssetId'),
        sourceCertificateVersionId: requiredString(body, 'sourceCertificateVersionId'),
        idempotencyKey: requiredString(body, 'idempotencyKey'),
        actorId: actorId(request),
      } as unknown as CreateCertificateRotationInput),
    };
  }

  private async getRotation(request: HttpRequest) {
    await this.assertAction(request, 'ca.operations.read', 'certificate_rotation');
    return this.requireLifecycle().getRotation(tenantId(request), pathId(request));
  }

  private async getRotationInstallAction(request: HttpRequest) {
    await this.assertAction(request, 'ca.request.retry', 'certificate_rotation');
    return this.requireLifecycle().getInstallAction(tenantId(request), pathId(request));
  }

  private async markRotationTlsVerified(request: HttpRequest) {
    await this.assertAction(request, 'ca.request.retry', 'certificate_rotation');
    const body = objectBody(request);
    const tlsEvidence = body.tlsEvidence && typeof body.tlsEvidence === 'object' && !Array.isArray(body.tlsEvidence)
      ? body.tlsEvidence as Record<string, unknown>
      : {};
    return this.requireLifecycle().markTlsVerified({
      tenantId: tenantId(request),
      rotationId: pathId(request),
      certificateVersionId: requiredString(body, 'certificateVersionId'),
      tlsEvidence,
      actorId: actorId(request),
      context: request.context,
    });
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

  private async assertAction(request: HttpRequest, action: CaOperationsPermissionAction, resourceType: string): Promise<void> {
    const subject = subjectFromRequest(request);
    await this.security.rbac.assertCan(subject, action, {
      type: resourceType,
      scope: { tenantId: tenantId(request), tenantScope: request.context.tenantScope, ownerId: subject.id, resourceType },
    }, request.context);
  }

  /**
   * ACME 是证书管理能力，不应因为独立 CA 运营菜单权限缺失而在证书页面不可用。
   * 兼容旧租户仍持有 ca.operations.read 的情况，读取权限按新旧合同顺序回退。
   */
  private async assertAcmeRead(request: HttpRequest, resourceType: string): Promise<void> {
    const subject = subjectFromRequest(request);
    const certificateResource = {
      type: 'certificate_asset',
      scope: {
        tenantId: tenantId(request),
        tenantScope: request.context.tenantScope,
        ownerId: subject.id,
        resourceType: 'certificate_asset',
      },
    };
    for (const action of ['certificate.asset.read', 'certificate.read'] as const) {
      try {
        await this.security.rbac.assertCan(subject, action, certificateResource, request.context);
        return;
      } catch (error) {
        if (!isPermissionDenied(error)) throw error;
      }
    }
    await this.security.rbac.assertCan(subject, 'ca.operations.read', {
      type: resourceType,
      scope: {
        tenantId: tenantId(request),
        tenantScope: request.context.tenantScope,
        ownerId: subject.id,
        resourceType,
      },
    }, request.context);
  }

  /**
   * ACME 的申请、续签和删除属于证书生命周期写操作。
   * 保留 ca.request.retry 回退，避免旧租户权限在迁移期间突然失效。
   */
  private async assertAcmeWrite(request: HttpRequest, action: string, resourceType: string): Promise<void> {
    const subject = subjectFromRequest(request);
    const certificateResource = {
      type: 'certificate_asset',
      scope: {
        tenantId: tenantId(request),
        tenantScope: request.context.tenantScope,
        ownerId: subject.id,
        resourceType: 'certificate_asset',
      },
    };
    for (const candidate of [action, action === 'certificate.create' ? 'certificate.lifecycle' : 'certificate.create'] as const) {
      try {
        await this.security.rbac.assertCan(subject, candidate, certificateResource, request.context);
        return;
      } catch (error) {
        if (!isPermissionDenied(error)) throw error;
      }
    }
    await this.security.rbac.assertCan(subject, 'ca.request.retry', {
      type: resourceType,
      scope: {
        tenantId: tenantId(request),
        tenantScope: request.context.tenantScope,
        ownerId: subject.id,
        resourceType,
      },
    }, request.context);
  }

  private async assertAuthorityRead(request: HttpRequest, caId: string): Promise<void> {
    const authority = (await this.service.listAuthorities(tenantId(request))).find((item) => item.id === caId);
    if (!authority) throw new AppError('RESOURCE_NOT_FOUND', '证书机构不存在', { caId });
    await this.security.rbac.assertCan(
      subjectFromRequest(request),
      'ca.operations.read',
      this.authorityResource(request, authority),
      request.context,
    );
  }

  private authorityResource(request: HttpRequest, authority: { id: string; providerId: string; trustDomainId?: string }) {
    return {
      type: 'certificate_authority',
      id: authority.id,
      scope: {
        tenantId: tenantId(request),
        tenantScope: request.context.tenantScope,
        trustDomainId: authority.trustDomainId,
        caId: authority.id,
        providerId: authority.providerId,
        resourceType: 'certificate_authority',
        resourceId: authority.id,
      },
    };
  }
}

export function getInternalCaRouteContracts(): RouteContract[] {
  const responseSchema = { type: 'object', additionalProperties: true } as const;
  const arraySchema = { type: 'array', items: responseSchema } as const;
  const routes: Array<[RouteContract['method'], string, string, string, NonNullable<RouteContract['responseSchema']>]> = [
    ['GET', '/api/v1/public/ca-crl/:tenantId/:caId', 'getPublicCaCrl', '读取公开 CA CRL', { type: 'string', format: 'binary' }],
    ['GET', '/api/v1/ca-providers', 'listCaProviders', '查询通用 CA Provider', arraySchema],
    ['POST', '/api/v1/ca-providers', 'createCaProvider', '创建通用 CA Provider', responseSchema],
    ['PATCH', '/api/v1/ca-providers/:id', 'updateCaProvider', '更新 CA Provider', responseSchema],
    ['DELETE', '/api/v1/ca-providers/:id', 'deleteCaProvider', '删除或停用 CA Provider 登记', responseSchema],
    ['POST', '/api/v1/ca-providers/:id/test', 'testCaProvider', '检查 CA Provider 合同状态', responseSchema],
    ['GET', '/api/v1/ca-providers/:id/action-bindings', 'listCaProviderActionBindings', '查询 CA Provider 固定动作绑定', arraySchema],
    ['POST', '/api/v1/ca-providers/:id/action-bindings', 'createCaProviderActionBinding', '创建 CA Provider 固定动作绑定', responseSchema],
    ['GET', '/api/v1/ca-operations/tree', 'listCaOperationsTree', '查询 CA 运营资源树', responseSchema],
    ['GET', '/api/v1/ca-operations/records', 'listCaOperationRecords', '查询 CA 运营记录', responseSchema],
    ['GET', '/api/v1/ca-operations/records/:recordKey', 'getCaOperationRecord', '查询 CA 运营记录详情', responseSchema],
    ['POST', '/api/v1/ca-operations/sync-runs', 'createCaSyncRuns', '创建 CA 历史同步运行', responseSchema],
    ['GET', '/api/v1/ca-operations/sync-runs', 'listCaSyncRuns', '查询 CA 历史同步运行', responseSchema],
    ['GET', '/api/v1/ca-trust-domains', 'listCaTrustDomains', '查询 CA 信任域', arraySchema],
    ['POST', '/api/v1/ca-trust-domains', 'createCaTrustDomain', '创建 CA 信任域', responseSchema],
    ['PATCH', '/api/v1/ca-trust-domains/:id', 'updateCaTrustDomain', '更新 CA 信任域', responseSchema],
    ['GET', '/api/v1/certificate-authorities', 'listCertificateAuthorities', '查询证书机构', arraySchema],
    ['DELETE', '/api/v1/certificate-authorities/:id', 'deleteCertificateAuthority', '退休证书机构', responseSchema],
    ['POST', '/api/v1/certificate-authorities/preview', 'previewCertificateAuthority', '预览 CA 拓扑风险', responseSchema],
    ['POST', '/api/v1/certificate-authorities', 'createCertificateAuthority', '创建证书机构对象', arraySchema],
    ['GET', '/api/v1/certificate-profiles', 'listCertificateProfiles', '查询证书 Profile', arraySchema],
    ['POST', '/api/v1/certificate-profiles', 'createCertificateProfile', '创建证书 Profile', responseSchema],
    ['POST', '/api/v1/certificate-profiles/:id/versions', 'createCertificateProfileVersion', '创建证书 Profile 版本', responseSchema],
    ['GET', '/api/v1/certificate-policies', 'listCertificatePolicies', '查询租户证书策略', arraySchema],
    ['POST', '/api/v1/certificate-policies/:id/versions', 'createCertificatePolicyVersion', '创建证书策略版本', responseSchema],
    ['GET', '/api/v1/certificate-requests', 'listCertificateRequests', '查询证书申请', arraySchema],
    ['POST', '/api/v1/certificate-requests', 'createCertificateRequest', '创建证书申请对象', responseSchema],
    ['POST', '/api/v1/certificate-requests/:id/approve', 'approveCertificateRequest', '审批证书申请', responseSchema],
    ['POST', '/api/v1/certificate-requests/:id/retry', 'retryCertificateRequest', '请求插件重试签发', responseSchema],
    ['POST', '/api/v1/certificate-requests/:id/query', 'queryCertificateRequest', '查询插件签发结果', responseSchema],
    ['POST', '/api/v1/certificate-requests/:id/activate', 'activateCertificateRequest', '确认应用证书已安装', responseSchema],
    ['GET', '/api/v1/certificate-renewals', 'listCertificateRenewals', '查询证书续期任务', arraySchema],
    ['POST', '/api/v1/certificate-renewals/scan', 'scanCertificateRenewals', '创建通用证书续期任务', arraySchema],
    ['GET', '/api/v1/acme/status', 'getAcmeStatus', '查询宿主 ACME 能力状态', responseSchema],
    ['GET', '/api/v1/acme/accounts', 'listAcmeAccounts', '查询 ACME Account', arraySchema],
    ['POST', '/api/v1/acme/accounts', 'createAcmeAccount', '创建 ACME Account', responseSchema],
    ['GET', '/api/v1/acme/accounts/:id', 'getAcmeAccount', '查询 ACME Account 详情', responseSchema],
    ['GET', '/api/v1/acme/provider-profiles', 'listAcmeProviderProfiles', '查询 ACME Provider Profile', arraySchema],
    ['POST', '/api/v1/acme/providers/probe-directory', 'probeAcmeDirectory', '探测未保存的 ACME Directory', responseSchema],
    ['GET', '/api/v1/acme/providers', 'listAcmeProviders', '查询 ACME 颁发者配置', arraySchema],
    ['POST', '/api/v1/acme/providers', 'createAcmeProvider', '创建 ACME 颁发者配置', responseSchema],
    ['PATCH', '/api/v1/acme/providers/:id', 'updateAcmeProvider', '更新 ACME 颁发者配置', responseSchema],
    ['POST', '/api/v1/acme/providers/:id/test', 'testAcmeProvider', '测试 ACME 颁发者连接', responseSchema],
    ['GET', '/api/v1/acme/dns-providers', 'listAcmeDnsProviders', '查询 LEGO DNS Provider', arraySchema],
    ['POST', '/api/v1/acme/certificates', 'createAcmeCertificate', '创建简化 ACME 证书配置', responseSchema],
    ['PATCH', '/api/v1/acme/certificates/:id', 'updateAcmeCertificate', '更新 ACME 证书自动化配置', responseSchema],
    ['DELETE', '/api/v1/acme/certificates/:id', 'deleteAcmeCertificate', '删除 ACME 证书自动化配置', responseSchema],
    ['POST', '/api/v1/acme/certificates/:id/renew', 'manualRenewAcmeCertificate', '手动续签指定 ACME 证书', responseSchema],
    ['GET', '/api/v1/acme/orders', 'listAcmeOrders', '查询 ACME Order', arraySchema],
    ['GET', '/api/v1/acme/orders/:id', 'getAcmeOrder', '查询 ACME Order 详情', responseSchema],
    ['POST', '/api/v1/acme/orders/:id/reconcile', 'reconcileAcmeOrder', '恢复 ACME Order 状态', responseSchema],
    ['POST', '/api/v1/acme/orders/:id/finalize', 'finalizeAcmeOrder', 'Finalize ACME Order', responseSchema],
    ['GET', '/api/v1/acme/renewal-policies', 'listAcmeRenewalPolicies', '查询 ACME 续签策略', arraySchema],
    ['PATCH', '/api/v1/acme/renewal-policies/:id', 'updateAcmeRenewalPolicy', '更新 ACME 续签策略', responseSchema],
    ['GET', '/api/v1/acme/renewal-jobs', 'listAcmeRenewalJobs', '查询 ACME 续签任务', arraySchema],
    ['POST', '/api/v1/acme/renewal-jobs/scan', 'scanAcmeRenewalJobs', '扫描 ACME 到期证书', arraySchema],
    ['POST', '/api/v1/acme/renewal-jobs/:id/retry', 'retryAcmeRenewalJob', '重试 ACME 续签任务', responseSchema],
    ['POST', '/api/v1/acme/renewal-jobs/:id/cancel', 'cancelAcmeRenewalJob', '取消 ACME 续签任务', responseSchema],
    ['GET', '/api/v1/certificate-revocations', 'listCertificateRevocations', '查询证书吊销任务', arraySchema],
    ['POST', '/api/v1/certificate-revocations', 'createCertificateRevocation', '创建证书吊销任务', responseSchema],
    ['POST', '/api/v1/certificate-revocations/:id/approve', 'approveCertificateRevocation', '审批证书吊销任务', responseSchema],
    ['GET', '/api/v1/ca-crl-publications', 'listCaCrlPublications', '查询 CA CRL 发布记录', arraySchema],
    ['POST', '/api/v1/certificate-authorities/:id/crl/publish', 'publishCaCrl', '发布内置 CA CRL', responseSchema],
    ['GET', '/api/v1/certificate-rotations', 'listCertificateRotations', '查询证书换钥轮换任务', arraySchema],
    ['POST', '/api/v1/certificate-rotations', 'createCertificateRotation', '创建证书换钥轮换任务', responseSchema],
    ['GET', '/api/v1/certificate-rotations/:id', 'getCertificateRotation', '查询证书换钥轮换详情', responseSchema],
    ['GET', '/api/v1/certificate-rotations/:id/install-action', 'getCertificateRotationInstallAction', '生成轮换证书安装动作', responseSchema],
    ['POST', '/api/v1/certificate-rotations/:id/tls-verify', 'markCertificateRotationTlsVerified', '回传轮换 TLS 验证结果', responseSchema],
    ['GET', '/api/v1/ca-trust-distributions', 'listCaTrustDistributions', '查询 CA 信任分发任务', arraySchema],
    ['POST', '/api/v1/ca-trust-distributions', 'createCaTrustDistribution', '创建 CA 信任分发任务', responseSchema],
    ['POST', '/api/v1/ca-trust-distributions/:id/approve', 'approveCaTrustDistribution', '审批 CA 信任分发任务', responseSchema],
    ['POST', '/api/v1/ca-trust-distributions/:id/complete', 'completeCaTrustDistribution', '回传 CA 信任分发验证结果', responseSchema],
    ['GET', '/api/v1/reports/certificate-reuse/overview', 'getCertificateReuseRiskOverview', '查询证书复用风险摘要', responseSchema],
    ['GET', '/api/v1/reports/certificate-reuse/items', 'listCertificateReuseRisks', '查询证书复用风险明细', arraySchema],
    ['GET', '/api/v1/reports/certificate-reuse/export', 'exportCertificateReuseRisks', '导出证书复用风险', responseSchema],
    ['POST', '/api/v1/reports/certificate-reuse/:id/remediation-preview', 'previewCertificateReuseRemediation', '预览证书复用风险整改', responseSchema],
  ];
  return routes.map(([method, path, operationId, summary, responseSchema]) => ({
    method,
    path,
    operationId,
    summary,
    tags,
    responseSchema,
    ...(path.startsWith('/api/v1/public/ca-crl/') ? { responseContentType: 'application/pkix-crl' } : {}),
  }));
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
  const segments = request.path.split('/').filter(Boolean);
  const actionIndex = segments.findIndex((segment) => ['test', 'versions', 'approve', 'retry', 'activate', 'result', 'complete', 'remediation-preview', 'reconcile', 'finalize', 'renew', 'cancel', 'crl', 'install-action', 'tls-verify'].includes(segment));
  const value = actionIndex > 0 ? segments[actionIndex - 1] : segments.at(-1);
  if (!value) throw new AppError('VALIDATION_FAILED', '路径缺少资源 ID');
  return value;
}

function providerIdFromBindingPath(request: HttpRequest): string {
  const segments = request.path.split('/').filter(Boolean);
  const providerIndex = segments.indexOf('ca-providers');
  const value = providerIndex >= 0 ? segments[providerIndex + 1] : undefined;
  if (!value) throw new AppError('VALIDATION_FAILED', '路径缺少 CA Provider ID');
  return value;
}

function lastPathSegment(request: HttpRequest): string {
  const value = request.path.split('/').filter(Boolean).at(-1);
  if (!value) throw new AppError('VALIDATION_FAILED', '路径缺少资源 ID');
  return value;
}

function isPermissionDenied(error: unknown): boolean {
  return error instanceof SecurityError && error.errorCode === 'SEC_PERMISSION_DENIED';
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

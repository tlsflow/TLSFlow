import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { applicationCertificateLifecycleStatuses, applicationCertificateProviderTypes, applicationCertificateSupplyModes } from '../schema/application-certificate-supply.schema.js';
import type { CertificateSupplyPreviewDto, UpdateApplicationCertificatePolicyDto } from '../dto/application-certificate-supply.dto.js';
import { ApplicationCertificateSupplyApplicationService } from '../application/application-certificate-supply.application-service.js';

const tags = ['ApplicationCertificateSupply'];

export class ApplicationCertificateSupplyController {
  constructor(
    private readonly security: SecurityServices | undefined,
    private readonly service: ApplicationCertificateSupplyApplicationService,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/application-assets/:applicationAssetId/certificate-supply-policy', '查询应用证书供应策略', tags, (request) => this.get(request));
    router.put('/api/v1/application-assets/:applicationAssetId/certificate-supply-policy', '保存应用证书供应策略', tags, (request) => this.update(request));
    router.post('/api/v1/application-assets/:applicationAssetId/certificate-supply-policy/preview', '预览应用证书供应策略', tags, (request) => this.preview(request));
    router.post('/api/v1/application-assets/:applicationAssetId/certificate-supply-policy/deploy', '创建专属证书部署任务', tags, (request) => this.deploy(request));
  }

  private async get(request: HttpRequest) {
    const applicationAssetId = this.readApplicationAssetId(request);
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_asset.read', 'service_asset', request, applicationAssetId);
    return this.service.get(requireTenantId(request), applicationAssetId);
  }

  private async update(request: HttpRequest) {
    const applicationAssetId = this.readApplicationAssetId(request);
    const body = validateObject(request.body, policySchema());
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_asset.manage', 'service_asset', request, applicationAssetId);
    return this.service.update(requireTenantId(request), applicationAssetId, body as unknown as UpdateApplicationCertificatePolicyDto, subject.id);
  }

  private async preview(request: HttpRequest) {
    const applicationAssetId = this.readApplicationAssetId(request);
    const body = validateObject(request.body, { ...policySchema(), supplyMode: { type: 'string', required: true, enum: applicationCertificateSupplyModes } });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_asset.read', 'service_asset', request, applicationAssetId);
    return this.service.preview(requireTenantId(request), applicationAssetId, body as unknown as CertificateSupplyPreviewDto);
  }

  private async deploy(request: HttpRequest) {
    const applicationAssetId = this.readApplicationAssetId(request);
    const body = validateObject(request.body, { reapply: { type: 'boolean' } });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'application.deployment.execute', 'service_asset', request, applicationAssetId);
    return {
      statusCode: 202,
      body: this.service.enqueueDedicatedDeployment({
        tenantId: requireTenantId(request),
        applicationAssetId,
        actorId: subject.id,
        reapply: body.reapply === true,
      }),
    };
  }

  private readApplicationAssetId(request: HttpRequest): string {
    const matched = request.path.match(/\/application-assets\/([^/]+)\/certificate-supply-policy/);
    const id = matched?.[1];
    if (!id) throw new AppError('VALIDATION_FAILED', 'applicationAssetId 不能为空', { field: 'applicationAssetId' });
    return id;
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    if (!this.security) return { id: request.context.actorId ?? 'system_application_certificate_supply', type: 'system', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
  }

  private async assertCan(subject: SecuritySubject, action: string, resourceType: string, request: HttpRequest, resourceId: string): Promise<void> {
    if (!this.security) return;
    await this.security.rbac.assertCan(subject, action, {
      type: resourceType,
      id: resourceId,
      scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope, ownerId: subject.id },
    }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
  }
}

export function getApplicationCertificateSupplyRouteContracts(): RouteContract[] {
  return [
    {
      method: 'GET',
      path: '/api/v1/application-assets/:applicationAssetId/certificate-supply-policy',
      operationId: 'getApplicationCertificateSupplyPolicy',
      summary: '查询应用证书供应策略',
      tags,
      responseSchema: { type: 'object', additionalProperties: true },
    },
    {
      method: 'POST',
      path: '/api/v1/application-assets/:applicationAssetId/certificate-supply-policy/deploy',
      operationId: 'enqueueApplicationCertificateDeployment',
      summary: '创建专属证书部署任务',
      tags,
      requestSchema: { type: 'object', additionalProperties: false, properties: { reapply: { type: 'boolean' } } },
      responseSchema: { type: 'object', additionalProperties: true },
    },
    {
      method: 'PUT',
      path: '/api/v1/application-assets/:applicationAssetId/certificate-supply-policy',
      operationId: 'updateApplicationCertificateSupplyPolicy',
      summary: '保存应用证书供应策略',
      tags,
      requestSchema: policyOpenApiSchema(),
      responseSchema: { type: 'object', additionalProperties: true },
    },
    {
      method: 'POST',
      path: '/api/v1/application-assets/:applicationAssetId/certificate-supply-policy/preview',
      operationId: 'previewApplicationCertificateSupplyPolicy',
      summary: '预览应用证书供应策略',
      tags,
      requestSchema: policyOpenApiSchema(),
      responseSchema: { type: 'object', additionalProperties: true },
    },
  ];
}

function policySchema() {
  return {
    supplyMode: { type: 'string' as const, required: true, enum: applicationCertificateSupplyModes },
    certificateAssetId: { type: 'string' as const },
    certificateVersionId: { type: 'string' as const },
    providerType: { type: 'string' as const, enum: applicationCertificateProviderTypes },
    providerId: { type: 'string' as const },
    certificateAuthorityId: { type: 'string' as const },
    acmeProviderProfileId: { type: 'string' as const },
    dnsProviderId: { type: 'string' as const },
    credentialRef: { type: 'string' as const },
    certificateProfileVersionId: { type: 'string' as const },
    custodyMode: { type: 'string' as const, enum: ['agent_local', 'device_local', 'managed_secret'] },
    deploymentArtifactMode: { type: 'string' as const, enum: ['certificate_only', 'certificate_with_private_key'] },
    autoRenew: { type: 'boolean' as const },
    renewalWindowDays: { type: 'number' as const },
    rotateKeyOnRenewal: { type: 'boolean' as const },
    status: { type: 'string' as const, enum: applicationCertificateLifecycleStatuses },
  };
}

function policyOpenApiSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['supplyMode'],
    properties: {
      supplyMode: { type: 'string', enum: [...applicationCertificateSupplyModes] },
      certificateAssetId: { type: 'string' },
      certificateVersionId: { type: 'string' },
      providerType: { type: 'string', enum: [...applicationCertificateProviderTypes] },
      providerId: { type: 'string' },
      certificateAuthorityId: { type: 'string' },
      acmeProviderProfileId: { type: 'string' },
      dnsProviderId: { type: 'string' },
      credentialRef: { type: 'string', description: '仅允许 SecretRef，不接受明文凭据' },
      certificateProfileVersionId: { type: 'string' },
      custodyMode: { type: 'string', enum: ['agent_local', 'device_local', 'managed_secret'] },
      deploymentArtifactMode: { type: 'string', enum: ['certificate_only', 'certificate_with_private_key'] },
      autoRenew: { type: 'boolean' },
      renewalWindowDays: { type: 'number' },
      rotateKeyOnRenewal: { type: 'boolean' },
      status: { type: 'string', enum: [...applicationCertificateLifecycleStatuses] },
    },
  };
}

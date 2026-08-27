import assert from 'node:assert/strict';
import test from 'node:test';
import { DeploymentPlansApplicationService } from './application/deployment-plans.application-service.js';

test('仅域名应用资产创建远程部署计划时返回稳定的目标缺失错误码', async () => {
  const service = new DeploymentPlansApplicationService({
    assets: {
      getServiceAsset: async () => ({
        id: 'app-domain-only', tenantId: 'tenant-domain-only', address: 'domain-only.example.com',
        addressType: 'DNS', port: 443, protocol: 'HTTPS', displayName: 'Domain only', status: 'ACTIVE',
        metadata: {}, createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z', version: 1,
      }),
      getApplicationAssetTargetByApplicationAssetId: async () => undefined,
    } as never,
  });

  await assert.rejects(
    (service as any).buildManagedCreateInputFromApplicationAsset({
      tenantId: 'tenant-domain-only', applicationAssetId: 'app-domain-only',
      targetCertificateVersionId: 'cert-version-1', actorId: 'admin', idempotencyKey: 'domain-only-plan',
    }),
    (error: unknown) => {
      const value = error as { errorCode?: string; details?: Record<string, unknown> };
      return value.errorCode === 'VALIDATION_FAILED' && value.details?.code === 'CERTIFICATE_DEPLOYMENT_TARGET_REQUIRED';
    },
  );
});

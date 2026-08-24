import { structuredLogger } from '../../common/logging/structured-logger.js';
import type { SecretService } from './secret.service.js';

export async function auditSecretDecryptability(secrets: SecretService): Promise<void> {
  const allSecrets = await secrets.listAllMetadataForDiagnostics();
  let failed = 0;

  for (const secret of allSecrets) {
    try {
      await secrets.resolveForService({
        secretRef: secret.secretRef,
        tenantId: secret.tenantId,
        expectedType: secret.type,
        purpose: 'secret.health_check',
        actorId: 'system',
      });
    } catch (error) {
      failed += 1;
      structuredLogger.warn('检测到无法解密的 Secret', {
        secretId: secret.id,
        secretName: secret.name,
        secretType: secret.type,
        secretRef: secret.secretRef,
        errorCode: typeof error === 'object' && error && 'errorCode' in error ? (error as { errorCode?: unknown }).errorCode : undefined,
      }, { module: 'secret-health-check', resourceType: 'secret', resourceId: secret.id });
    }
  }

  if (failed > 0) {
    structuredLogger.warn('Secret 解密健康检查发现异常数据', {
      total: allSecrets.length,
      failed,
    }, { module: 'secret-health-check' });
  }
}

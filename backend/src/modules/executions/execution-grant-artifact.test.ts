import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ExecutionGrantService } from './execution-grant.service.js';

describe('ExecutionGrantService ArtifactRef', () => {
  it('只允许当前步骤声明的 SecretRef 和 ArtifactRef，并支持立即回收', async () => {
    const service = new ExecutionGrantService();
    const grant = await service.create({
      tenantId: 'tenant-grant-test',
      runId: 'run-1', stepId: 'step-1:upload:1', executorType: '017.CURL_HTTP',
      allowedSecretRefs: ['secret://api_token/sec-1#current'],
      allowedArtifactRefs: ['artifact://certificate/version-1/leaf.pem'],
      allowedActions: ['workflow.step.execute'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await service.validate({ grantId: grant.id, tenantId: 'tenant-grant-test', runId: 'run-1', stepId: 'step-1:upload:1', executorType: '017.CURL_HTTP', secretRef: 'secret://api_token/sec-1#current', artifactRef: 'artifact://certificate/version-1/leaf.pem', action: 'workflow.step.execute' });
    await assert.rejects(() => service.validate({ grantId: grant.id, tenantId: 'tenant-grant-test', runId: 'run-1', stepId: 'step-1:upload:1', executorType: '017.CURL_HTTP', artifactRef: 'artifact://certificate/version-1/private-key.pem' }), (error: any) => error.errorCode === 'SEC_EXECUTOR_GRANT_DENIED');

    await service.revoke(grant.id);
    await assert.rejects(() => service.validate({ grantId: grant.id, tenantId: 'tenant-grant-test', runId: 'run-1', stepId: 'step-1:upload:1', executorType: '017.CURL_HTTP' }), (error: any) => error.errorCode === 'SEC_EXECUTOR_GRANT_DENIED');
  });
});

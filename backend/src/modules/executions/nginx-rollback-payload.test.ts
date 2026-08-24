import assert from 'node:assert/strict';
import test from 'node:test';
import { DeploymentPlansRepository } from '../deployment-plans/repository/deployment-plans.repository.js';
import { ExecutionsApplicationService } from './application/executions.application-service.js';
import type { ExecutionStepDto } from './dto/executions.dto.js';
import { testTaskEnqueuer } from './deployment-input-runtime-snapshot.test-fixture.js';

function createService() {
  return new ExecutionsApplicationService({
    deploymentPlansRepository: new DeploymentPlansRepository(),
    tasks: testTaskEnqueuer(),
  });
}

test('NGINX rollback payload 只验证 sourceRunId 和 rollbackContext 传播', async () => {
  const service = createService();
  const manifest = {
    version: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    cert: {
      path: '/var/lib/gcac/nginx-certs/example/fullchain.pem',
      backupPath: '/var/lib/gcac/backups/run_source/fullchain.pem.bak',
      existed: true,
      sha256: 'b'.repeat(64),
    },
    key: {
      path: '/var/lib/gcac/nginx-certs/example/privkey.pem',
      backupPath: '/var/lib/gcac/backups/run_source/privkey.pem.bak',
      existed: true,
      sha256: 'c'.repeat(64),
    },
    certBackup: {
      certificateFingerprintSha256: 'd'.repeat(64),
    },
  };

  const created = await service.createApplyRun({
    deploymentPlanId: 'plan_nginx_rb_payload',
    deploymentPlanTargetIds: ['target_nginx_rb'],
    type: 'apply',
    idempotencyKey: 'idem_nginx_rb_source',
    actorId: 'tester',
    tenantId: 'tenant_1',
    executorTypeByTargetId: new Map([['target_nginx_rb', 'AGENT']]),
    agentPayloadByTargetId: new Map([['target_nginx_rb', {
      actionType: 'agent.plan.execute',
      actionSchemaVersion: '1.0',
      deploymentInputSnapshotRef: {
        apiVersion: 'gcac.deployment-input-snapshot/v1',
        snapshotId: 'dpis_nginx_rb',
        revision: 1,
        resolvedSha256: 'e'.repeat(64),
      },
      pluginRuntimeCapability: {
        runtime: 'AGENT_V2',
        capabilityKey: 'certificate.deploy',
      },
      bindingSelector: {
        certPath: '/var/lib/gcac/nginx-certs/example/fullchain.pem',
        keyPath: '/var/lib/gcac/nginx-certs/example/privkey.pem',
        serverNames: ['example.com'],
      },
      executionPolicy: {
        testCommand: '/usr/sbin/nginx -t',
        reloadCommand: '/usr/bin/systemctl reload nginx',
      },
    }]]),
  });

  const sourceSteps = (await service.listSteps({
    tenantId: 'tenant_1',
    executionRunId: created.run.id,
  }) as ExecutionStepDto[]).sort((left: ExecutionStepDto, right: ExecutionStepDto) => left.stepNo - right.stepNo);
  const backupStep = sourceSteps.find((step: ExecutionStepDto) => step.stepType === 'BACKUP');
  const installStep = sourceSteps.find((step: ExecutionStepDto) => step.stepType === 'INSTALL');

  assert.ok(backupStep);
  assert.ok(installStep);

  await service.updateStepForTest(backupStep!.id, {
    inputSnapshot: {
      ...backupStep!.inputSnapshot,
      resultDetail: {
        backupManifestPath: '/var/lib/gcac/backups/run_source/backup-manifest.json',
        backupManifest: manifest,
      },
    },
  }, 'tenant_1');

  await service.updateStepForTest(installStep!.id, {
    inputSnapshot: {
      ...installStep!.inputSnapshot,
      resultDetail: {
        backupManifestPath: '/var/lib/gcac/backups/run_source/backup-manifest.json',
        backupManifest: manifest,
        installedCertificateSha256: 'a'.repeat(64),
        workflowRun: {
          stepResults: [{
            name: 'buildDeploymentSnapshot',
            extracted: {
              deploymentSnapshot: {
                bindingInformation: '*:443:example.com',
                certificateFingerprintSha256: 'd'.repeat(64),
              },
            },
          }],
        },
      },
    },
  }, 'tenant_1');

  await service.markFailedForTest(created.run.id, 'tester', 'tenant_1');

  const rollback = await service.rollback({
    runId: created.run.id,
    idempotencyKey: 'idem_nginx_rb_rollback',
    actorId: 'tester',
    tenantId: 'tenant_1',
  });
  const rollbackStep = rollback.steps.find((step: ExecutionStepDto) => step.stepType === 'ROLLBACK');
  const verifyStep = rollback.steps.find((step: ExecutionStepDto) => step.stepType === 'VERIFY');

  assert.ok(rollbackStep);
  assert.ok(verifyStep);
  assert.equal(rollbackStep!.inputSnapshot.actionType, 'agent.plan.execute');
  assert.equal(rollbackStep!.inputSnapshot.operation, 'rollback');
  assert.equal(rollbackStep!.inputSnapshot.sourceRunId, created.run.id);
  assert.equal(rollbackStep!.inputSnapshot.rollbackContext.sourceRunId, created.run.id);
  assert.equal(
    rollbackStep!.inputSnapshot.rollbackContext.backupManifestPath,
    '/var/lib/gcac/backups/run_source/backup-manifest.json',
  );
  assert.deepEqual(rollbackStep!.inputSnapshot.rollbackContext.backupManifest, manifest);
  assert.equal(
    rollbackStep!.inputSnapshot.rollbackContext.installedCertificateSha256,
    'a'.repeat(64),
  );
  assert.equal(rollbackStep!.inputSnapshot.rollbackContext.rollbackCertificateSha256, 'd'.repeat(64));
  assert.equal(rollbackStep!.inputSnapshot.expectedCertificateFingerprintSha256, 'd'.repeat(64));
  assert.equal(rollbackStep!.inputSnapshot.certificateVerification.expectedFingerprintSha256, 'd'.repeat(64));
  assert.deepEqual(rollbackStep!.inputSnapshot.stepOutputs, {
    buildDeploymentSnapshot: {
      extracted: {
        deploymentSnapshot: {
          bindingInformation: '*:443:example.com',
          certificateFingerprintSha256: 'd'.repeat(64),
        },
      },
    },
  });
  assert.equal(rollbackStep!.inputSnapshot.artifact, undefined);
  assert.equal(verifyStep!.inputSnapshot.expectedCertificateFingerprintSha256, 'd'.repeat(64));
  assert.equal(verifyStep!.inputSnapshot.certificateVerification.expectedFingerprintSha256, 'd'.repeat(64));
  assert.equal(verifyStep!.inputSnapshot.artifact, undefined);
});

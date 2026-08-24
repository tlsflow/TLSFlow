import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import { DeploymentInputPreflightService } from './application/deployment-input-preflight.service.js';

test('聚合预检展开统一 Resolver 的全部结构化问题', () => {
  const service = new DeploymentInputPreflightService();
  const error = new AppError('VALIDATION_FAILED', '统一部署输入校验失败', {
    issues: [
      { category: 'CONNECTION', code: 'DEPLOYMENT_CONNECTION_REQUIRED', severity: 'ERROR', slot: 'management', path: 'connections.management.host', bindingLayer: 'DEVICE', messageKey: 'deploymentInputs.issues.DEPLOYMENT_CONNECTION_REQUIRED' },
      { category: 'CREDENTIAL', code: 'DEPLOYMENT_CREDENTIAL_REQUIRED', severity: 'ERROR', slot: 'managementCredential', path: 'credentials.managementCredential', messageKey: 'deploymentInputs.issues.DEPLOYMENT_CREDENTIAL_REQUIRED' },
      { category: 'ARTIFACT', code: 'DEPLOYMENT_ARTIFACT_REQUIRED', severity: 'ERROR', slot: 'certificate', path: 'artifacts.certificate', messageKey: 'deploymentInputs.issues.DEPLOYMENT_ARTIFACT_REQUIRED' },
    ],
  });

  const issues = service.collect('ARTIFACT', [{ status: 'rejected', reason: error }], [4]);
  assert.deepEqual(issues.map((issue) => ({ stage: issue.stage, targetIndex: issue.targetIndex, category: issue.category, code: issue.code, slot: issue.slot, path: issue.path })), [
    { stage: 'INPUT', targetIndex: 4, category: 'CONNECTION', code: 'DEPLOYMENT_CONNECTION_REQUIRED', slot: 'management', path: 'connections.management.host' },
    { stage: 'INPUT', targetIndex: 4, category: 'CREDENTIAL', code: 'DEPLOYMENT_CREDENTIAL_REQUIRED', slot: 'managementCredential', path: 'credentials.managementCredential' },
    { stage: 'INPUT', targetIndex: 4, category: 'ARTIFACT', code: 'DEPLOYMENT_ARTIFACT_REQUIRED', slot: 'certificate', path: 'artifacts.certificate' },
  ]);
});

test('普通阶段错误保持原有预检结构', () => {
  const service = new DeploymentInputPreflightService();
  const issues = service.collect('VERSION', [{ status: 'rejected', reason: new AppError('RESOURCE_NOT_FOUND', '版本不存在', { versionId: 'missing' }) }]);
  assert.deepEqual(issues, [{ stage: 'VERSION', targetIndex: 0, errorCode: 'RESOURCE_NOT_FOUND', message: '版本不存在', details: { versionId: 'missing' } }]);
});

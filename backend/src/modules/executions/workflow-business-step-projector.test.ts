import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { projectWorkflowBusinessSteps } from './application/workflow-business-step-projector.js';
import type { WorkflowRunResult } from '../workflow-templates/dto/workflow-templates.dto.js';

describe('projectWorkflowBusinessSteps', () => {
  it('投影 stage、foreach 子步骤和逆序补偿依赖', () => {
    const run: WorkflowRunResult = {
      id: 'workflow-run-1', mode: 'real_test', executionBranch: 'deploy', plannedOnly: false, status: 'rolled_back', renderedSteps: [], logs: [],
      stepResults: [
        { name: 'backup', type: 'checkpoint', stage: 'backup', status: 'success', attempts: 1, plan: {}, extracted: {}, assertions: [], logs: [] },
        {
          name: 'bind_sites', type: 'foreach', stage: 'install', status: 'failed', attempts: 1, plan: {}, extracted: {}, assertions: [], logs: [],
          children: [
            { name: 'bind_sites[0].bind', type: 'http', stage: 'install', status: 'success', attempts: 1, plan: {}, extracted: {}, assertions: [], logs: [] },
            { name: 'bind_sites[1].bind', type: 'http', stage: 'install', status: 'failed', attempts: 1, plan: {}, extracted: {}, assertions: [], logs: [], errorCode: 'REMOTE_FAILED' },
          ],
        },
      ],
      rollbackResults: [
        { name: 'restore_binding', type: 'http', stage: 'install', status: 'success', attempts: 1, plan: {}, extracted: {}, assertions: [], logs: [] },
        { name: 'remove_upload', type: 'http', stage: 'install', status: 'success', attempts: 1, plan: {}, extracted: {}, assertions: [], logs: [] },
      ],
    };

    const projected = projectWorkflowBusinessSteps('execution-step-1', run);
    assert.deepEqual(projected.map((step) => step.name), ['backup', 'bind_sites', 'bind_sites[0].bind', 'bind_sites[1].bind', 'rollback.restore_binding', 'rollback.remove_upload']);
    assert.equal(projected[0]!.stepType, 'BACKUP');
    assert.equal(projected[2]!.stepType, 'INSTALL');
    assert.deepEqual(projected[1]!.dependsOn, [1]);
    assert.deepEqual(projected[4]!.dependsOn, [4]);
    assert.deepEqual(projected[5]!.dependsOn, [5]);
    assert.equal(projected[4]!.compensation, true);
  });
});

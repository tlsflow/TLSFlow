const RESOLVED_SHA256 = 'f'.repeat(64);

import { computeAgentPlanDigest, type AgentPlanV1 } from '../agents/security/agent-security.contract.js';
import type { TaskEnqueuer } from '../tasks/task-enqueue.js';
import type { TaskRun } from '../tasks/task.types.js';

/** 只为执行调度单测提供统一任务控制面替身，不提供任何旧队列执行能力。 */
export function testTaskEnqueuer(): TaskEnqueuer {
  let sequence = 0;
  return {
    async enqueue(input): Promise<TaskRun> {
      sequence += 1;
      const now = new Date().toISOString();
      return {
        id: `task_test_${sequence}`,
        tenantId: input.tenantId,
        taskType: input.taskType,
        definitionVersion: input.definitionVersion ?? 1,
        category: 'EXECUTION',
        status: 'QUEUED',
        requestedBy: input.requestedBy,
        triggerSource: input.triggerSource,
        resourceSummary: input.resourceSummary,
        idempotencyKey: input.idempotencyKey,
        parentTaskId: input.parentTaskId,
        payload: input.payload ?? {},
        availableAt: input.availableAt ?? now,
        createdAt: now,
      };
    },
  };
}

export function withTestDeploymentInputSnapshot(
  deploymentPlanId: string,
  deploymentPlanTargetId: string,
  payload: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...payload,
    deploymentInputSnapshotRef: {
      apiVersion: 'gcac.deployment-input-snapshot/v1',
      snapshotId: snapshotId(deploymentPlanId, deploymentPlanTargetId),
      revision: 1,
      resolvedSha256: RESOLVED_SHA256,
    },
  };
}

/**
 * 为执行创建阶段提供完整的 Agent v2 Plan 草案和授权请求。
 * Token/Decision 必须由后续生产编译器通过 Policy Authority 签发，测试调用方不得预置。
 */
export function withTestAgentV2ExecutionAuthorization(
  deploymentPlanId: string,
  deploymentPlanTargetId: string,
  payload: Record<string, unknown> = {},
): Record<string, unknown> {
  const pluginVersionId = `plugin-version-agent-v2-${deploymentPlanTargetId}`;
  const capability = 'filesystem.atomic_replace';
  const operationType = capability;
  const operationPath = `/var/lib/gcac/test/${deploymentPlanTargetId}/certificate.pem`;
  const planBase = {
    planVersion: 'gcac.agent-security/v1' as const,
    planId: `agent-plan-${deploymentPlanTargetId}`,
    agentId: `agent-${deploymentPlanTargetId}`,
    tenantId: 'tenant_1',
    pluginId: 'web.nginx',
    pluginVersionId,
    capability,
    operations: [{
      operationId: `operation-${deploymentPlanTargetId}`,
      operationType,
      stage: 'execute' as const,
      input: { path: operationPath },
      dependsOn: [],
      idempotencyKey: `idempotency-${deploymentPlanTargetId}`,
      timeoutSeconds: 30,
    }],
    planDigest: '',
    tokenId: `token-${deploymentPlanTargetId}`,
    policyDecisionId: `decision-${deploymentPlanTargetId}`,
    nonce: `nonce-${deploymentPlanTargetId}`,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    writeEffect: true,
  } satisfies AgentPlanV1;
  const plan = { ...planBase, planDigest: computeAgentPlanDigest(planBase) };

  return {
    ...payload,
    actionType: 'agent.plan.execute',
    actionSchemaVersion: '1.0',
    agentId: plan.agentId,
    pluginBindingId: `plugin-binding-${deploymentPlanTargetId}`,
    pluginRuntimeCapability: {
      runtime: 'AGENT_V2',
      pluginId: plan.pluginId,
      pluginVersionId: plan.pluginVersionId,
      capabilityKey: plan.capability,
    },
    plan,
    executionAuthorization: {
      planId: deploymentPlanId,
      actions: [operationType],
      allowedPaths: ['/var/lib/gcac/test'],
      allowedServices: [],
      artifactDigests: [],
      policyRef: `policy-${deploymentPlanTargetId}`,
      policyVersion: '1',
      lifetimeSeconds: 300,
    },
  };
}

/** 仅供执行调度单元测试使用，模拟已持久化的不可变密封快照。 */
export const testDeploymentInputSnapshotsRepository = {
  async get(_tenantId: string, id: string) {
    const identity = readSnapshotId(id);
    if (!identity) return undefined;
    return {
      id,
      tenantId: _tenantId,
      deploymentPlanId: identity.deploymentPlanId,
      deploymentPlanTargetId: identity.deploymentPlanTargetId,
      revision: 1,
      snapshot: { resolvedSha256: RESOLVED_SHA256 },
    };
  },
  async getRuntimeSnapshot(_tenantId: string, id: string) {
    if (!readSnapshotId(id)) return undefined;
    return {
      apiVersion: 'gcac.deployment-input-runtime-snapshot/v1',
      contract: { apiVersion: 'gcac.deployment-input/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} },
      effectiveBinding: {
        inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} },
        provenance: {},
      },
      resolvedDeploymentInput: {
        apiVersion: 'gcac.resolved-deployment-input/v1',
        contractVersion: 'gcac.deployment-input/v1',
        assetContext: {}, variables: {}, connections: {}, credentials: {}, artifacts: {},
        provenance: {}, sensitivePaths: [], issues: [], executable: true, resolvedSha256: RESOLVED_SHA256,
      },
      deploymentArtifact: {
        certificateVersionId: 'certver_test',
        certificateFormatId: 'certfmt_test',
        format: 'pem',
        containsPrivateKey: false,
      },
    };
  },
};

function snapshotId(deploymentPlanId: string, deploymentPlanTargetId: string): string {
  return `dpis_test::${deploymentPlanId}::${deploymentPlanTargetId}`;
}

function readSnapshotId(id: string): { deploymentPlanId: string; deploymentPlanTargetId: string } | undefined {
  const [prefix, deploymentPlanId, deploymentPlanTargetId, extra] = id.split('::');
  if (prefix !== 'dpis_test' || !deploymentPlanId || !deploymentPlanTargetId || extra !== undefined) return undefined;
  return { deploymentPlanId, deploymentPlanTargetId };
}

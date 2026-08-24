const RESOLVED_SHA256 = 'f'.repeat(64);

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

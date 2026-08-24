import type { DeploymentInputSnapshotV1 } from '../dto/deployment-input-snapshot.dto.js';

export function readDeploymentInputSnapshotV1(value: unknown): DeploymentInputSnapshotV1 | undefined {
  if (!isRecord(value)) return undefined;
  if (value.apiVersion !== 'gcac.deployment-input-snapshot/v1' || value.snapshotVersion !== 1) return undefined;
  if (typeof value.resolvedAt !== 'string' || typeof value.contractVersion !== 'string') return undefined;
  if (!isRecord(value.identity) || !isRecord(value.input) || !isRecord(value.sources)) return undefined;
  if (!Array.isArray(value.sensitivePaths) || !Array.isArray(value.issues)) return undefined;
  if (typeof value.executable !== 'boolean' || typeof value.resolvedSha256 !== 'string') return undefined;
  if (!isRecord(value.redaction)
    || typeof value.redaction.sensitivePathCount !== 'number'
    || typeof value.redaction.genericRuleMatchCount !== 'number') return undefined;
  return value as unknown as DeploymentInputSnapshotV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

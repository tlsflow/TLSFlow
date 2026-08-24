import type { ResolvedDeploymentInputV1 } from '../dto/resolved-deployment-input.dto.js';

export function readResolvedDeploymentInputV1(value: unknown): ResolvedDeploymentInputV1 | undefined {
  const input = readRecord(value);
  if (input?.apiVersion !== 'gcac.resolved-deployment-input/v1') return undefined;
  if (input.contractVersion !== 'gcac.deployment-input/v1') return undefined;
  if (!readRecord(input.assetContext) || !readRecord(input.variables) || !readRecord(input.connections)
    || !readRecord(input.credentials) || !readRecord(input.artifacts) || !readRecord(input.provenance)
    || !Array.isArray(input.sensitivePaths) || !Array.isArray(input.issues)
    || typeof input.executable !== 'boolean' || typeof input.resolvedSha256 !== 'string') return undefined;
  return input as unknown as ResolvedDeploymentInputV1;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

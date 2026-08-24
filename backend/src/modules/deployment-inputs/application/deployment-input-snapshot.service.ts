import { RedactionService } from '../../audits/redaction.service.js';
import type {
  DeploymentInputSnapshotIdentityV1,
  DeploymentInputSnapshotV1,
  RedactedDeploymentInputV1,
} from '../dto/deployment-input-snapshot.dto.js';
import type { ResolvedDeploymentInputV1 } from '../dto/resolved-deployment-input.dto.js';

const REDACTED_VALUE = '[REDACTED]';

export class DeploymentInputSnapshotService {
  constructor(private readonly redaction = new RedactionService()) {}

  build(
    resolved: ResolvedDeploymentInputV1,
    identity: DeploymentInputSnapshotIdentityV1,
    resolvedAt = new Date().toISOString(),
  ): DeploymentInputSnapshotV1 {
    const input: RedactedDeploymentInputV1 = structuredClone({
      assetContext: resolved.assetContext,
      variables: resolved.variables,
      connections: resolved.connections,
      credentials: resolved.credentials,
      artifacts: resolved.artifacts,
    });

    // 凭据槽位只允许通过来源摘要追溯，快照中连凭据结构也不保留。
    for (const credentialSlot of Object.keys(input.credentials)) input.credentials[credentialSlot] = REDACTED_VALUE;
    for (const path of resolved.sensitivePaths) redactPath(input as unknown as Record<string, unknown>, path);
    const genericRedaction = this.redaction.redact(input);

    return {
      apiVersion: 'gcac.deployment-input-snapshot/v1',
      snapshotVersion: 1,
      resolvedAt,
      contractVersion: resolved.contractVersion,
      identity: compactIdentity(identity),
      input: genericRedaction.value,
      sources: structuredClone(resolved.provenance),
      sensitivePaths: [...resolved.sensitivePaths].sort(),
      issues: structuredClone(resolved.issues),
      executable: resolved.executable,
      resolvedSha256: resolved.resolvedSha256,
      redaction: {
        sensitivePathCount: resolved.sensitivePaths.length,
        genericRuleMatchCount: genericRedaction.matches.length,
      },
    };
  }
}

function compactIdentity(identity: DeploymentInputSnapshotIdentityV1): DeploymentInputSnapshotIdentityV1 {
  return Object.fromEntries(Object.entries(identity).filter(([, value]) => typeof value === 'string' && value.length > 0));
}

function redactPath(root: Record<string, unknown>, path: string): void {
  const segments = path.split('.').filter(Boolean);
  if (segments.length === 0) return;
  let current: unknown = root;
  for (const segment of segments.slice(0, -1)) {
    if (!isRecord(current)) return;
    current = current[segment];
  }
  if (!isRecord(current)) return;
  const leaf = segments.at(-1)!;
  if (Object.prototype.hasOwnProperty.call(current, leaf)) current[leaf] = REDACTED_VALUE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

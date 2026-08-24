const RUNTIME_MATERIAL_CONTAINER_KEYS = new Set([
  'resolvedInput',
  'resolvedDeploymentInput',
  'deploymentArtifact',
  'artifact',
  'effectiveInputBindings',
  'inputBindings',
  'workflowCertificateMaterials',
]);

const SENSITIVE_KEY_PATTERN = /(password|passphrase|token|secret|private.?key|pfx|pkcs.?12|jks|credential)/i;

/**
 * 计划目标与执行步骤只能持久化调度元数据和密封快照引用。
 * 完整 Binding、凭据引用及证书材料只能进入密封运行快照。
 */
export function sanitizeDeploymentInputPersistencePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeValue(structuredClone(payload)) as Record<string, unknown>;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !RUNTIME_MATERIAL_CONTAINER_KEYS.has(key) && !SENSITIVE_KEY_PATTERN.test(key))
    .map(([key, child]) => [key, sanitizeValue(child)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

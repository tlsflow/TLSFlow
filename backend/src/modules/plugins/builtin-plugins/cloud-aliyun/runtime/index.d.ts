export interface CloudAliyunRuntimeDescriptor {
  pluginId: string;
  pluginVersionId: string;
}

export interface CloudAliyunDiscoveryResource {
  apiVersion: 'gcac.cloud-service/v1';
  kind: 'CloudServiceResource';
  stableKey: string;
  pluginId: string;
  pluginVersionId: string;
  provider: 'cloud.aliyun';
  resourceId: string;
  resourceType: string;
  region: string;
  displayName?: string;
  frameworkKey?: string;
  frameworkDisplayName?: string;
  targetType?: string;
  targetKey?: string;
  bindingKey?: string;
  supportedCapabilities?: string[];
  executionLocations?: Array<'CONTROL_PLANE' | 'GATEWAY'>;
  metadata?: Record<string, unknown>;
}

export interface CloudAliyunRuntimeHostApi {
  call(method: string, input: Record<string, unknown>, grantRefs?: string[]): Promise<{
    ok: boolean;
    data?: Record<string, unknown>;
  }>;
}

export interface CloudAliyunRuntimeExecutionContext extends Record<string, unknown> {
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  capability: string;
  actionId: string;
  actionContractVersion: string;
  packageHash: string;
  manifestHash: string;
  resourceHash: string;
  planDigest: string;
  idempotencyKey: string;
  deadlineAt: string;
  signal: AbortSignal;
  grantRefs: string[];
  writeEffect: boolean;
  input: Record<string, unknown>;
}

export interface CloudAliyunRuntimeExecutor {
  descriptor: Record<string, unknown>;
  execute(
    context: CloudAliyunRuntimeExecutionContext,
    hostApi: CloudAliyunRuntimeHostApi,
  ): Promise<Record<string, unknown> & { success: boolean }>;
}

export function createPluginRunnerExecutor(): CloudAliyunRuntimeExecutor;

export function normalizeDiscoveryResponse(
  body: unknown,
  descriptor: CloudAliyunRuntimeDescriptor,
): CloudAliyunDiscoveryResource[];

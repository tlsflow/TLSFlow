export type CorePersistenceMode = 'memory' | 'postgres';

export interface CorePersistenceProfile {
  mode: CorePersistenceMode;
  strict?: boolean;
}

export interface CorePersistenceRequirement {
  module: string;
  provided: boolean;
  reason: string;
}

export function collectMissingCorePersistence(
  profile: CorePersistenceProfile,
  requirements: CorePersistenceRequirement[],
): CorePersistenceRequirement[] {
  if (profile.mode !== 'postgres') {
    return [];
  }
  return requirements.filter((item) => item.provided === false);
}

export function buildCorePersistenceErrorMessage(missing: CorePersistenceRequirement[]): string {
  return [
    'PostgreSQL 模式已启用，但以下核心模块仍未显式注入持久化实现：',
    ...missing.map((item) => `- ${item.module}: ${item.reason}`),
    '继续静默回退到内存仓储只会制造“看似接库、实际丢数据”的假象。',
  ].join('\n');
}

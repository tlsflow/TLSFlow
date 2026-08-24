/**
 * 插件目录刷新前后用于展示的版本快照。
 * 这里只保留业务视图需要的字段，避免把完整插件记录写入任务事件。
 */
export interface PluginRefreshVersionSnapshot {
  id: string;
  pluginId: string;
  version: string;
  status: string;
}

export type PluginRefreshChangeType = 'ADDED' | 'UPDATED' | 'REMOVED' | 'UNCHANGED';

export interface PluginRefreshChange {
  pluginId: string;
  before?: PluginRefreshVersionSnapshot;
  after?: PluginRefreshVersionSnapshot;
  changeType: PluginRefreshChangeType;
}

export interface PluginRefreshProjectionResult {
  attempted: number;
  projected: number;
  skipped: number;
  failed: Array<{ tenantId: string; agentId: string; error: string }>;
}

export interface PluginRefreshResult {
  refreshedAt: string;
  versions: PluginRefreshVersionSnapshot[];
  beforeVersions?: PluginRefreshVersionSnapshot[];
  changes?: PluginRefreshChange[];
  projection?: PluginRefreshProjectionResult;
}

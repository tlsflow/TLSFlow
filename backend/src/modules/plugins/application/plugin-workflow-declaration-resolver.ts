import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';

/**
 * 发布清单中一个不可变的 Workflow 声明。
 * workflowKey 标识具体工作流，capabilityKey 标识它向宿主暴露的标准能力。
 */
export interface PluginWorkflowDeclaration {
  key: string;
  capabilityKey: string;
  path: string;
}

export type PluginWorkflowDeclarationResolver = (
  pluginId: string,
  pluginVersion: string,
) => readonly PluginWorkflowDeclaration[] | undefined;

/** 从同一份已验证的发布清单构造发布器和开发切换共用的解析器。 */
export function createPluginWorkflowDeclarationResolver(
  entries: readonly { pluginId: string; version: string; workflows: readonly PluginWorkflowDeclaration[] }[],
): PluginWorkflowDeclarationResolver {
  const declarations = new Map(entries.map((entry) => [
    `${entry.pluginId}@${entry.version}`,
    entry.workflows.map((workflow) => ({ ...workflow })),
  ]));
  return (pluginId, pluginVersion) => {
    const workflows = declarations.get(`${pluginId}@${pluginVersion}`);
    return workflows?.map((workflow) => ({ ...workflow }));
  };
}

/** 仅允许声明式资源使用 Manifest 中显式的 Workflow 键。 */
export function resolveManifestWorkflowDeclarations(
  record: UnifiedPluginVersionRecord,
): PluginWorkflowDeclaration[] {
  return Object.entries(record.manifest.resources.workflows ?? {}).map(([key, path]) => ({
    key,
    capabilityKey: key,
    path,
  }));
}

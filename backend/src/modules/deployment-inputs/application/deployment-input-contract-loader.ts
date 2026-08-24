import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';
import type { WorkflowTemplateVersion } from '../../workflow-templates/dto/workflow-templates.dto.js';
import type { DeploymentInputContractV1 } from '../dto/deployment-input-contract.dto.js';
import { validateDeploymentInputContractV1 } from '../schema/deployment-input-contract.schema.js';

export class DeploymentInputContractLoader {
  fromPlugin(plugin: UnifiedPluginVersionRecord, capabilityKey: string): DeploymentInputContractV1 {
    if (plugin.runtime === 'TRUSTED_JS') {
      throw new AppError('VALIDATION_FAILED', 'TRUSTED_JS 插件暂不通过 Workflow 方式加载部署输入契约', { pluginVersionId: plugin.id, capabilityKey });
    }
    const path = plugin.runtime === 'AGENT_ATOMIC'
      ? plugin.manifest.resources.agentRecipes?.[capabilityKey]
      : plugin.manifest.resources.workflows?.[capabilityKey];
    const content = path ? plugin.resources[path] : undefined;
    if (!path || !content) throw new AppError('VALIDATION_FAILED', '插件能力缺少部署输入契约资源', { pluginVersionId: plugin.id, capabilityKey });
    const parsed = parseJson(content, { pluginVersionId: plugin.id, capabilityKey, path });
    if (!isRecord(parsed) || parsed.inputContract === undefined) throw new AppError('VALIDATION_FAILED', '插件能力资源必须声明 DeploymentInputContractV1', { pluginVersionId: plugin.id, capabilityKey, path });
    return validateDeploymentInputContractV1(parsed.inputContract);
  }

  fromWorkflowVersion(version: WorkflowTemplateVersion): DeploymentInputContractV1 {
    if (!version.content.inputContract) throw new AppError('VALIDATION_FAILED', '工作流版本必须声明 DeploymentInputContractV1', { workflowVersionId: version.id });
    return validateDeploymentInputContractV1(version.content.inputContract);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(content: string, details: Record<string, unknown>): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new AppError('VALIDATION_FAILED', '部署输入契约资源不是有效 JSON', { ...details, cause: error instanceof Error ? error.message : String(error) });
  }
}

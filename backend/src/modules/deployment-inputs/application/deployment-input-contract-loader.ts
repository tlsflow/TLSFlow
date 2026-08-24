import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';
import { isPluginRunnerWorkflowVersion } from '../../plugins/schema/plugin-workflow.schema.js';
import type { WorkflowTemplateVersion } from '../../workflow-templates/dto/workflow-templates.dto.js';
import type { DeploymentInputContractV1 } from '../dto/deployment-input-contract.dto.js';
import { validateDeploymentInputContractV1 } from '../schema/deployment-input-contract.schema.js';
import { validateCertificateUpdateInputContract } from '../certificate-update/certificate-update.contract.js';

export class DeploymentInputContractLoader {
  fromPlugin(plugin: UnifiedPluginVersionRecord, capabilityKey: string): DeploymentInputContractV1 {
    if (plugin.runtime !== 'WORKFLOW_DSL' && plugin.runtime !== 'AGENT_PLAN') {
      throw new AppError('VALIDATION_FAILED', '只有 Agent Plan 或 Workflow DSL 插件可以声明宿主部署输入契约', { pluginVersionId: plugin.id, capabilityKey });
    }
    const path = plugin.manifest.resources.inputContracts?.[capabilityKey]
      ?? (plugin.runtime === 'AGENT_PLAN'
        ? plugin.manifest.resources.agentPlans?.[capabilityKey]
        : plugin.manifest.resources.workflows?.[capabilityKey]);
    const content = path ? plugin.resources[path] : undefined;
    if (!path || !content) throw new AppError('VALIDATION_FAILED', '插件能力缺少部署输入契约资源', { pluginVersionId: plugin.id, capabilityKey });
    const parsed = parseJson(content, { pluginVersionId: plugin.id, capabilityKey, path });
    if (!isRecord(parsed)) throw new AppError('VALIDATION_FAILED', '插件输入合同资源必须是对象', { pluginVersionId: plugin.id, capabilityKey, path });
    // 六个证书包使用独立的 CertificateUpdateInputContractV1，内部仍嵌入
    // 通用 DeploymentInputContractV1，保证现有解析器保持单一入口。
    const inputContract = parsed.inputContract ?? parsed.deploymentInputContract;
    if (inputContract === undefined) throw new AppError('VALIDATION_FAILED', '插件能力资源必须声明 DeploymentInputContractV1', { pluginVersionId: plugin.id, capabilityKey, path });
    if (parsed.apiVersion === 'gcac.certificate-update-input/v1') {
      const certificateContract = validateCertificateUpdateInputContract(parsed);
      if (certificateContract.pluginId !== plugin.pluginId) throw new AppError('VALIDATION_FAILED', '证书输入合同 Plugin ID 与 Manifest 不一致', { pluginVersionId: plugin.id, capabilityKey });
      return validateDeploymentInputContractV1(certificateContract.deploymentInputContract);
    }
    return validateDeploymentInputContractV1(inputContract);
  }

  fromWorkflowVersion(version: WorkflowTemplateVersion): DeploymentInputContractV1 {
    if (isPluginRunnerWorkflowVersion(version) || (version.content as unknown as { kind?: unknown }).kind !== 'CurlSshWorkflow') {
      throw new AppError('VALIDATION_FAILED', 'PluginWorkflow 不得进入旧 DeploymentInputContract 路径', { workflowVersionId: version.id });
    }
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

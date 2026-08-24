import { AppError } from '../../../common/errors/app-error.js';
import type { WorkflowDslV1, WorkflowVariableDefinition } from '../../workflow-templates/dto/workflow-templates.dto.js';
import type { CertificateArtifactBindingV1 } from '../dto/plugin-bindings.dto.js';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';

export function buildPluginCertificateArtifactBindings(
  plugin: UnifiedPluginVersionRecord,
  capabilityKey: string,
  certificateFormatId: string,
): Record<string, CertificateArtifactBindingV1> {
  const resourcePath = plugin.manifest.resources.workflows?.[capabilityKey];
  const contentText = resourcePath ? plugin.resources[resourcePath] : undefined;
  if (!resourcePath || !contentText) {
    throw new AppError('VALIDATION_FAILED', '插件能力缺少可解析的 Workflow 资源', {
      code: 'PLUGIN_WORKFLOW_RESOURCE_MISSING',
      pluginVersionId: plugin.id,
      capabilityKey,
      resourcePath,
    });
  }

  const workflow = parseWorkflow(contentText, plugin.id, capabilityKey);
  const bindings = Object.fromEntries(Object.entries(workflow.variables)
    .filter((entry): entry is [string, WorkflowVariableDefinition] => entry[1]?.type === 'certificate')
    .map(([variableName, definition]) => [variableName, buildBinding(variableName, definition, certificateFormatId)]));
  if (Object.keys(bindings).length === 0) {
    throw new AppError('VALIDATION_FAILED', '插件证书部署 Workflow 没有声明 certificate 变量产物契约', {
      code: 'PLUGIN_CERTIFICATE_ARTIFACT_CONTRACT_MISSING',
      pluginVersionId: plugin.id,
      capabilityKey,
    });
  }
  return bindings;
}

function parseWorkflow(contentText: string, pluginVersionId: string, capabilityKey: string): WorkflowDslV1 {
  try {
    return JSON.parse(contentText) as WorkflowDslV1;
  } catch (error) {
    throw new AppError('VALIDATION_FAILED', '插件 Workflow JSON 无法解析', {
      code: 'PLUGIN_WORKFLOW_INVALID_JSON',
      pluginVersionId,
      capabilityKey,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildBinding(
  variableName: string,
  definition: WorkflowVariableDefinition,
  certificateFormatId: string,
): CertificateArtifactBindingV1 {
  const outputs = definition.artifactContract?.outputs ?? {};
  const outputBindings = Object.fromEntries(Object.entries(outputs).map(([outputName, output]) => [
    outputName,
    standardOutputKey(outputName, String(output.role ?? '')),
  ]));
  const missingRequiredOutputs = Object.entries(outputs)
    .filter(([, output]) => output.required !== false)
    .map(([outputName]) => outputName)
    .filter((outputName) => !outputBindings[outputName]);
  if (Object.keys(outputBindings).length === 0 || missingRequiredOutputs.length > 0) {
    throw new AppError('VALIDATION_FAILED', '插件证书产物契约无法映射到宿主标准输出', {
      code: 'PLUGIN_CERTIFICATE_ARTIFACT_MAPPING_MISSING',
      variableName,
      missingRequiredOutputs,
    });
  }
  return { certificateFormatId, outputBindings };
}

function standardOutputKey(outputName: string, role: string): string {
  const normalizedRole = role.trim().toLowerCase();
  if (normalizedRole === 'public_certificate') return 'leafPem';
  if (normalizedRole === 'private_key') return 'privateKeyPem';
  if (normalizedRole === 'certificate_chain') return 'orderedChainPem';
  if (normalizedRole === 'fingerprint_sha256') return 'fingerprintSha256';
  if (normalizedRole === 'pkcs12_bundle') return 'pfxBase64';
  return outputName.trim();
}

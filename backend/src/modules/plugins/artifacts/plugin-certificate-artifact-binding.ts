import { AppError } from '../../../common/errors/app-error.js';
import type { DeploymentArtifactSlotV1 } from '../../deployment-inputs/dto/deployment-input-contract.dto.js';
import type { DeploymentArtifactBindingV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import { DeploymentInputContractLoader } from '../../deployment-inputs/application/deployment-input-contract-loader.js';

export function buildPluginCertificateArtifactBindings(
  plugin: UnifiedPluginVersionRecord,
  capabilityKey: string,
  certificateFormatId: string,
): Record<string, DeploymentArtifactBindingV1> {
  const contract = new DeploymentInputContractLoader().fromPlugin(plugin, capabilityKey);
  const bindings = Object.fromEntries(Object.entries(contract.artifacts)
    .filter(([, definition]) => definition.kind === 'certificate' && definition.required)
    .map(([artifactName, definition]) => [artifactName, buildBinding(artifactName, definition, certificateFormatId)]));
  if (Object.keys(bindings).length === 0) {
    throw new AppError('VALIDATION_FAILED', '插件能力没有声明必需的证书 Artifact Slot', {
      code: 'PLUGIN_CERTIFICATE_ARTIFACT_CONTRACT_MISSING',
      pluginVersionId: plugin.id,
      capabilityKey,
    });
  }
  return bindings;
}

/**
 * 将应用资产提交的证书绑定与 Contract 推导出的宿主标准映射合并。
 *
 * 应用资产层是整槽覆盖，只有证书格式而没有 outputBindings 时不能遮住
 * 必填产物输出；宿主应补齐缺失映射，同时保留用户明确配置的输出键。
 */
export function mergePluginCertificateArtifactBindings(
  plugin: UnifiedPluginVersionRecord,
  capabilityKey: string,
  certificateFormatId: string,
  submitted: Record<string, DeploymentArtifactBindingV1>,
): Record<string, DeploymentArtifactBindingV1> {
  const defaults = buildPluginCertificateArtifactBindings(plugin, capabilityKey, certificateFormatId);
  const merged = structuredClone(submitted);
  for (const [artifactName, defaultBinding] of Object.entries(defaults)) {
    const current = submitted[artifactName];
    if (!current) {
      merged[artifactName] = defaultBinding;
      continue;
    }
    const outputBindings = { ...defaultBinding.outputBindings };
    for (const [outputName, outputKey] of Object.entries(current.outputBindings ?? {})) {
      if (typeof outputKey === 'string' && outputKey.trim()) outputBindings[outputName] = outputKey;
    }
    merged[artifactName] = {
      ...structuredClone(current),
      certificateFormatId,
      outputBindings,
    };
  }
  return merged;
}

function buildBinding(
  artifactName: string,
  definition: DeploymentArtifactSlotV1,
  certificateFormatId: string,
): DeploymentArtifactBindingV1 {
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
      artifactName,
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
  if (normalizedRole === 'pkcs12_password') return 'pfxPassword';
  return outputName.trim();
}

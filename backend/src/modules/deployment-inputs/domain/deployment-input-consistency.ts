import { AppError } from '../../../common/errors/app-error.js';
import type { DeploymentInputContractV1 } from '../dto/deployment-input-contract.dto.js';
import type { CertificateLocationV1 } from '../dto/certificate-location.dto.js';
import type { ResolvedDeploymentInputV1 } from '../dto/resolved-deployment-input.dto.js';

const certificateLocationPathPrefix = 'target.certificateLocation.';

export function validateDiscoveredLocationConsistency(
  location: CertificateLocationV1 | undefined,
  contract: DeploymentInputContractV1,
  resolvedInput: ResolvedDeploymentInputV1,
): void {
  if (!location || location.confidence !== 'EXACT') return;

  for (const [variableName, definition] of Object.entries(contract.variables)) {
    if (definition.source.kind !== 'asset' || !definition.source.path.startsWith(certificateLocationPathPrefix)) continue;
    const locationKey = definition.source.path.slice(certificateLocationPathPrefix.length) as keyof CertificateLocationV1;
    const discoveredValue = location[locationKey];
    if (typeof discoveredValue !== 'string' || discoveredValue.trim() === '') continue;
    const resolvedValue = resolvedInput.variables[variableName];
    if (typeof resolvedValue !== 'string' || resolvedValue.trim() === '' || resolvedValue === discoveredValue) continue;
    const provenance = resolvedInput.provenance[`variables.${variableName}`];
    if (provenance?.source !== 'default') continue;
    throw new AppError('VALIDATION_FAILED', '插件默认路径与 Agent 精确发现的站点证书位置不一致', {
      code: 'DEPLOYMENT_INPUT_DEFAULT_OVERRIDES_DISCOVERED_LOCATION',
      variableName,
      discoveredValue,
      resolvedValue,
      discoveredAt: location.observedAt,
    });
  }
}

import { AppError } from '../../../common/errors/app-error.js';
import { UnifiedDeploymentInputResolver } from '../domain/unified-deployment-input.resolver.js';
import type { DeploymentAssetContextV1 } from '../dto/deployment-asset-context.dto.js';
import type { DeploymentInputContractV1 } from '../dto/deployment-input-contract.dto.js';
import type { InputBindingsV1 } from '../dto/input-bindings.dto.js';
import type {
  ResolveDeploymentInputPhase,
  ResolvedArtifactV1,
  ResolvedDeploymentInputV1,
  RuntimeCredentialV1,
} from '../dto/resolved-deployment-input.dto.js';
import { EffectiveBindingResolver, type ResolveEffectiveBindingRequest } from './effective-binding.resolver.js';

export interface ResolveProductionDeploymentInputRequest {
  phase: ResolveDeploymentInputPhase;
  contract: DeploymentInputContractV1;
  assetContext: DeploymentAssetContextV1;
  bindingLayers: Omit<ResolveEffectiveBindingRequest, 'contract'>;
  executionOverrides?: InputBindingsV1;
  credentialSnapshots?: Record<string, RuntimeCredentialV1>;
  artifactSnapshots?: Record<string, ResolvedArtifactV1>;
  systemValues?: Record<string, unknown>;
  stepOutputs?: Record<string, unknown>;
}

export class ProductionDeploymentInputResolverService {
  constructor(
    private readonly bindings = new EffectiveBindingResolver(),
    private readonly inputs = new UnifiedDeploymentInputResolver(),
  ) {}

  resolve(request: ResolveProductionDeploymentInputRequest): ResolvedDeploymentInputV1 {
    const effectiveBinding = this.bindings.resolve({
      contract: request.contract,
      ...request.bindingLayers,
    });
    const resolved = this.inputs.resolve({
      phase: request.phase,
      contract: request.contract,
      assetContext: request.assetContext,
      effectiveBinding,
      executionOverrides: request.executionOverrides,
      credentialSnapshots: request.credentialSnapshots,
      artifactSnapshots: request.artifactSnapshots,
      systemValues: request.systemValues,
      stepOutputs: request.stepOutputs,
    });
    if (!resolved.executable) {
      throw new AppError('VALIDATION_FAILED', '统一部署输入校验失败', {
        code: 'DEPLOYMENT_INPUT_INVALID',
        phase: request.phase,
        issues: resolved.issues,
      });
    }
    return resolved;
  }
}

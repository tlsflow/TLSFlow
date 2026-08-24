import type { DeploymentInputContractV1, DeploymentConnectionFieldV1 } from '../dto/deployment-input-contract.dto.js';
import type {
  BuildDeploymentInputProjectionRequest,
  DeploymentConnectionProjectionV1,
  DeploymentInputFieldProjectionV1,
  DeploymentInputProjectionV1,
} from '../dto/deployment-input-projection.dto.js';

export class DeploymentInputProjectionService {
  project(request: BuildDeploymentInputProjectionRequest): DeploymentInputProjectionV1 {
    const { contract, resolvedInput } = request;
    const variables = Object.entries(contract.variables).map(([slot, definition]) => ({
      slot,
      type: definition.type,
      required: definition.required,
      configurationMode: definition.configurationMode,
      bindingPolicy: definition.bindingPolicy,
      source: definition.source,
      default: definition.default,
      enum: definition.enum,
      sensitive: definition.sensitive,
      descriptionKey: definition.descriptionKey,
      ui: definition.ui,
      value: definition.bindingPolicy === 'fixed' && !definition.sensitive ? resolvedInput.variables[slot] : undefined,
    } satisfies DeploymentInputFieldProjectionV1));
    const fixedValues = variables.filter((item) => item.bindingPolicy === 'fixed' && item.value !== undefined).map((item) => ({ slot: item.slot, value: item.value, source: item.source }));
    const runtimeValues = variables
      .filter((item) => item.configurationMode === 'runtime')
      .map((item) => ({ slot: item.slot, source: item.source, lifecycle: contract.variables[item.slot]!.lifecycle }))
      .filter((item): item is DeploymentInputProjectionV1['runtimeValues'][number] => item.lifecycle === 'runtime_injected' || item.lifecycle === 'step_output');
    const connections = Object.entries(contract.connections).map(([slot, definition]) => ({
      slot,
      transport: definition.transport,
      credentialSlot: definition.credentialSlot,
      fields: connectionFields(definition),
      descriptionKey: definition.descriptionKey,
      ui: definition.ui,
    } satisfies DeploymentConnectionProjectionV1));
    const credentials = Object.entries(contract.credentials).map(([slot, definition]) => ({
      slot,
      allowedKinds: [...definition.allowedKinds],
      required: definition.required,
      configurationMode: definition.configurationMode,
      selectedCredentialId: resolvedInput.credentials[slot]?.credentialId,
      descriptionKey: definition.descriptionKey,
      ui: definition.ui,
    }));
    const artifacts = Object.entries(contract.artifacts).map(([slot, definition]) => ({
      slot,
      kind: definition.kind,
      required: definition.required,
      configurationMode: definition.configurationMode,
      outputs: definition.artifactContract.outputs,
      descriptionKey: definition.descriptionKey,
      ui: definition.ui,
    }));
    return {
      contractVersion: contract.apiVersion,
      requiredVariables: variables.filter((item) => item.configurationMode === 'required'),
      advancedVariables: variables.filter((item) => item.configurationMode === 'advanced'),
      connections,
      credentials,
      artifacts,
      fixedValues,
      runtimeValues,
      issues: resolvedInput.issues,
      saveable: resolvedInput.executable && !resolvedInput.issues.some((issue) => issue.severity === 'ERROR'),
    };
  }
}

function connectionFields(definition: DeploymentInputContractV1['connections'][string]): Record<string, DeploymentInputFieldProjectionV1> {
  const fields: Record<string, DeploymentInputFieldProjectionV1> = {};
  for (const [slot, field] of Object.entries({ host: definition.host, port: definition.port, username: definition.username, 'tls.verifyPeer': definition.tls?.verifyPeer, 'tls.serverName': definition.tls?.serverName, 'hostKey.expectedFingerprint': definition.hostKey?.expectedFingerprint })) {
    if (!field) continue;
    fields[slot] = fieldProjection(field);
  }
  return fields;
}

function fieldProjection(field: DeploymentConnectionFieldV1): DeploymentInputFieldProjectionV1 {
  return {
    slot: '',
    type: field.type,
    required: field.required,
    configurationMode: field.configurationMode,
    bindingPolicy: field.bindingPolicy,
    source: field.source,
    default: field.default,
    sensitive: field.sensitive,
    descriptionKey: field.descriptionKey,
    ui: field.ui,
  };
}

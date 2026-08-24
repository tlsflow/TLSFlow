import type { DeploymentInputContractV1, DeploymentConnectionFieldV1 } from '../dto/deployment-input-contract.dto.js';
import type { InputBindingsV1 } from '../dto/input-bindings.dto.js';
import type {
  BuildDeploymentInputProjectionRequest,
  DeploymentConnectionProjectionV1,
  DeploymentInputFieldProjectionV1,
  DeploymentInputProjectionV1,
} from '../dto/deployment-input-projection.dto.js';

export class DeploymentInputProjectionService {
  project(request: BuildDeploymentInputProjectionRequest): DeploymentInputProjectionV1 {
    const { contract, resolvedInput, effectiveBinding } = request;
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
      value: definition.sensitive ? undefined : resolvedInput.variables[slot],
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
      fields: connectionFields(definition, effectiveBinding?.inputBindings.connections[slot], resolvedInput.connections[slot]),
      descriptionKey: definition.descriptionKey,
      ui: definition.ui,
    } satisfies DeploymentConnectionProjectionV1));
    const credentials = Object.entries(contract.credentials).map(([slot, definition]) => ({
      slot,
      allowedKinds: [...definition.allowedKinds],
      required: definition.required,
      configurationMode: definition.configurationMode,
      selectedCredentialId: effectiveBinding?.inputBindings.credentials[slot]?.credentialId,
      descriptionKey: definition.descriptionKey,
      ui: definition.ui,
    }));
    const artifacts = Object.entries(contract.artifacts).map(([slot, definition]) => ({
      slot,
      kind: definition.kind,
      required: definition.required,
      configurationMode: definition.configurationMode,
      outputs: definition.artifactContract.outputs,
      binding: effectiveBinding?.inputBindings.artifacts[slot],
      descriptionKey: definition.descriptionKey,
      ui: definition.ui,
    }));
    return {
      contractVersion: contract.apiVersion,
      requiredVariables: variables.filter(isRequiredEditableField),
      advancedVariables: variables.filter((item) => item.configurationMode !== 'runtime' && !isRequiredEditableField(item)),
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

function isRequiredEditableField(item: DeploymentInputFieldProjectionV1): boolean {
  return item.configurationMode === 'required' && item.bindingPolicy === 'required_binding';
}

function connectionFields(
  definition: DeploymentInputContractV1['connections'][string],
  binding?: InputBindingsV1['connections'][string],
  resolved?: { host?: string; port?: number; username?: string; tls?: { enabled?: boolean; verifyPeer?: boolean; serverName?: string }; hostKey?: { expectedFingerprint?: string } },
): Record<string, DeploymentInputFieldProjectionV1> {
  const fields: Record<string, DeploymentInputFieldProjectionV1> = {};
  for (const [slot, field] of Object.entries({ host: definition.host, port: definition.port, username: definition.username, 'tls.enabled': definition.tls?.enabled, 'tls.verifyPeer': definition.tls?.verifyPeer, 'tls.serverName': definition.tls?.serverName, 'hostKey.expectedFingerprint': definition.hostKey?.expectedFingerprint })) {
    if (!field) continue;
    fields[slot] = fieldProjection(slot, field, readConnectionBindingValue(binding, slot), readConnectionBindingValue(resolved, slot));
  }
  return fields;
}

function fieldProjection(slot: string, field: DeploymentConnectionFieldV1, bindingValue?: unknown, resolvedValue?: unknown): DeploymentInputFieldProjectionV1 {
  return {
    slot,
    type: field.type,
    required: field.required,
    configurationMode: field.configurationMode,
    bindingPolicy: field.bindingPolicy,
    source: field.source,
    default: field.default,
    sensitive: field.sensitive,
    descriptionKey: field.descriptionKey,
    ui: field.ui,
    value: field.sensitive ? undefined : resolvedValue ?? bindingValue,
  };
}

function readConnectionBindingValue(binding: InputBindingsV1['connections'][string] | undefined, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => current && typeof current === 'object' ? (current as Record<string, unknown>)[segment] : undefined, binding);
}

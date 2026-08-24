export type AgentActionDispatchMode = 'direct_required';
export type AgentActionResolutionKind = 'AGENT_V2';

export interface AgentActionContract {
  schemaVersions: string[];
  riskBoundary: 'CONTROL' | 'DEPLOYMENT';
  acceptsSecrets: boolean;
}

export interface AgentActionDispatchDescriptor {
  actionType: string;
  mode: AgentActionDispatchMode;
  kind: AgentActionResolutionKind;
  contract: AgentActionContract;
}

export interface AgentActionDispatchResolution {
  requestedActionType: string;
  actionType: string;
  mode: AgentActionDispatchMode;
  kind: AgentActionResolutionKind;
  contract: AgentActionContract;
}

export type RequiredAgentActionResolution =
  | { ok: true; resolution: AgentActionDispatchResolution }
  | { ok: false; requestedActionType?: string; errorCode: 'AGENT_ACTION_UNREGISTERED' | 'AGENT_ACTION_SCHEMA_UNSUPPORTED' };

export class AgentActionDispatchRegistry {
  private readonly descriptors = new Map<string, AgentActionDispatchDescriptor>();

  constructor(descriptors: AgentActionDispatchDescriptor[] = defaultAgentActionDispatchDescriptors()) {
    for (const descriptor of descriptors) this.register(descriptor);
  }

  register(descriptor: AgentActionDispatchDescriptor): void {
    const actionType = normalizeActionType(descriptor.actionType);
    if (!actionType) throw new Error('Agent action dispatch descriptor 缺少 actionType');
    if (this.descriptors.has(actionType)) throw new Error(`Agent action dispatch 重复注册：${actionType}`);
    this.descriptors.set(actionType, { ...descriptor, actionType });
  }

  resolve(snapshot: Record<string, unknown>): AgentActionDispatchResolution | undefined {
    const requestedActionType = readActionType(snapshot);
    if (!requestedActionType) return undefined;
    const actionType = normalizeActionType(requestedActionType);
    const descriptor = this.descriptors.get(actionType);
    if (!descriptor) return undefined;
    return {
      requestedActionType,
      actionType,
      mode: descriptor.mode,
      kind: descriptor.kind,
      contract: { ...descriptor.contract, schemaVersions: [...descriptor.contract.schemaVersions] },
    };
  }

  requireResolution(snapshot: Record<string, unknown>): RequiredAgentActionResolution {
    const requestedActionType = readActionType(snapshot);
    const resolution = this.resolve(snapshot);
    if (!resolution) return { ok: false, requestedActionType, errorCode: 'AGENT_ACTION_UNREGISTERED' };
    const requestedSchemaVersion = readSchemaVersion(snapshot);
    if (requestedSchemaVersion && !resolution.contract.schemaVersions.includes(requestedSchemaVersion)) {
      return { ok: false, requestedActionType, errorCode: 'AGENT_ACTION_SCHEMA_UNSUPPORTED' };
    }
    return { ok: true, resolution };
  }

  list(): AgentActionDispatchDescriptor[] {
    return [...this.descriptors.values()]
      .sort((left, right) => left.actionType.localeCompare(right.actionType));
  }
}

export function defaultAgentActionDispatchDescriptors(): AgentActionDispatchDescriptor[] {
  return [
    {
      actionType: 'agent.fact.collect',
      mode: 'direct_required',
      kind: 'AGENT_V2',
      contract: { schemaVersions: ['1.0'], riskBoundary: 'CONTROL', acceptsSecrets: false },
    },
    {
      actionType: 'agent.plan.validate',
      mode: 'direct_required',
      kind: 'AGENT_V2',
      contract: { schemaVersions: ['1.0'], riskBoundary: 'DEPLOYMENT', acceptsSecrets: false },
    },
    {
      actionType: 'agent.plan.execute',
      mode: 'direct_required',
      kind: 'AGENT_V2',
      contract: { schemaVersions: ['1.0'], riskBoundary: 'DEPLOYMENT', acceptsSecrets: false },
    },
    {
      actionType: 'agent.execution.receipt',
      mode: 'direct_required',
      kind: 'AGENT_V2',
      contract: { schemaVersions: ['1.0'], riskBoundary: 'CONTROL', acceptsSecrets: false },
    },
  ];
}

function readActionType(snapshot: Record<string, unknown>): string | undefined {
  const value = snapshot.actionType;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeActionType(value: string): string {
  return value.trim().toLowerCase();
}

function readSchemaVersion(snapshot: Record<string, unknown>): string | undefined {
  const value = snapshot.actionSchemaVersion;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

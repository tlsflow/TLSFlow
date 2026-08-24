export type AgentActionDispatchMode = 'direct_required';
export type AgentActionResolutionKind = 'ATOMIC_PLAN' | 'HISTORICAL_PLUGIN_ALIAS' | 'DIRECT_STANDARD';

export interface AgentActionContract {
  schemaVersions: string[];
  riskBoundary: 'CONTROL' | 'DEPLOYMENT';
  acceptsSecrets: boolean;
}

export interface AgentActionDispatchDescriptor {
  actionType: string;
  aliases: string[];
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
  aliased: boolean;
}

export type RequiredAgentActionResolution =
  | { ok: true; resolution: AgentActionDispatchResolution }
  | { ok: false; requestedActionType?: string; errorCode: 'AGENT_ACTION_UNREGISTERED' | 'AGENT_ACTION_SCHEMA_UNSUPPORTED' };

export class AgentActionDispatchRegistry {
  private readonly descriptors = new Map<string, AgentActionDispatchDescriptor>();
  private readonly aliases = new Map<string, string>();

  constructor(descriptors: AgentActionDispatchDescriptor[] = defaultAgentActionDispatchDescriptors()) {
    for (const descriptor of descriptors) this.register(descriptor);
  }

  register(descriptor: AgentActionDispatchDescriptor): void {
    const actionType = normalizeActionType(descriptor.actionType);
    if (!actionType) throw new Error('Agent action dispatch descriptor 缺少 actionType');
    if (this.descriptors.has(actionType)) throw new Error(`Agent action dispatch 重复注册：${actionType}`);
    const aliases = [...new Set(descriptor.aliases.map(normalizeActionType).filter(Boolean))].sort();
    this.descriptors.set(actionType, { ...descriptor, actionType, aliases });
    for (const alias of [actionType, ...aliases]) {
      const existing = this.aliases.get(alias);
      if (existing) throw new Error(`Agent action alias 冲突：${alias} -> ${existing}/${actionType}`);
      this.aliases.set(alias, actionType);
    }
  }

  resolve(snapshot: Record<string, unknown>): AgentActionDispatchResolution | undefined {
    const requestedActionType = readActionType(snapshot);
    if (!requestedActionType) return undefined;
    const actionType = this.aliases.get(normalizeActionType(requestedActionType));
    if (!actionType) return undefined;
    const descriptor = this.descriptors.get(actionType);
    if (!descriptor) return undefined;
    return {
      requestedActionType,
      actionType,
      mode: descriptor.mode,
      kind: descriptor.kind,
      contract: { ...descriptor.contract, schemaVersions: [...descriptor.contract.schemaVersions] },
      aliased: normalizeActionType(requestedActionType) !== actionType,
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
    if (resolution.kind === 'DIRECT_STANDARD' && resolution.contract.riskBoundary === 'DEPLOYMENT') {
      return { ok: false, requestedActionType, errorCode: 'AGENT_ACTION_UNREGISTERED' };
    }
    return { ok: true, resolution };
  }

  list(): AgentActionDispatchDescriptor[] {
    return [...this.descriptors.values()]
      .map((item) => ({ ...item, aliases: [...item.aliases] }))
      .sort((left, right) => left.actionType.localeCompare(right.actionType));
  }
}

export function defaultAgentActionDispatchDescriptors(): AgentActionDispatchDescriptor[] {
  return [
    {
      actionType: 'certificate.deploy',
      aliases: ['windows.iis.deploy_certificate', 'linux.nginx.deploy_certificate'],
      mode: 'direct_required',
      kind: 'HISTORICAL_PLUGIN_ALIAS',
      contract: { schemaVersions: ['legacy'], riskBoundary: 'DEPLOYMENT', acceptsSecrets: true },
    },
    {
      actionType: 'agent.atomic_plan.execute',
      aliases: [],
      mode: 'direct_required',
      kind: 'ATOMIC_PLAN',
      contract: { schemaVersions: ['1.0'], riskBoundary: 'DEPLOYMENT', acceptsSecrets: false },
    },
  ];
}

function readActionType(snapshot: Record<string, unknown>): string | undefined {
  for (const field of ['actionType', 'type']) {
    const value = snapshot[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeActionType(value: string): string {
  return value.trim().toLowerCase();
}

function readSchemaVersion(snapshot: Record<string, unknown>): string | undefined {
  const value = snapshot.actionSchemaVersion;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

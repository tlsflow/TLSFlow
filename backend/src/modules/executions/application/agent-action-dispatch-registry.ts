export type AgentActionDispatchMode = 'direct_preferred' | 'queued';

export interface AgentActionDispatchDescriptor {
  actionType: string;
  aliases: string[];
  mode: AgentActionDispatchMode;
}

export interface AgentActionDispatchResolution {
  requestedActionType: string;
  actionType: string;
  mode: AgentActionDispatchMode;
  aliased: boolean;
}

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
      aliased: normalizeActionType(requestedActionType) !== actionType,
    };
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
      mode: 'direct_preferred',
    },
    {
      actionType: 'agent.atomic_plan.execute',
      aliases: [],
      mode: 'direct_preferred',
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

import type { AdapterContext, GatewayAdapterDescriptor, GatewayTask } from './gateway-agent.types.js';

function mockDescriptor(type: 'ssh' | 'winrm' | 'curl', displayName: string, supportedActions: string[]): GatewayAdapterDescriptor {
  return {
    type,
    displayName,
    capabilities: [`adapter.${type}`, `gateway.${type}.mock`],
    supportedActions,
    mockSafe: true,
    precheck(ctx: AdapterContext) {
      if (!ctx.gatewayId) return { ok: false, reason: '缺少 gatewayId' };
      return { ok: true };
    },
    run(ctx: AdapterContext, task: GatewayTask) {
      const supported = supportedActions.includes(task.action);
      return {
        success: supported,
        status: supported ? 'success' : 'failed',
        summary: supported ? `${displayName} mock 已接受动作 ${task.action}` : `${displayName} mock 不支持动作 ${task.action}`,
        evidence: [
          {
            taskId: task.id,
            operatorId: task.operatorId,
            planId: task.planId,
            executionRunId: task.executionRunId,
            stepId: task.stepId,
            gatewayId: ctx.gatewayId,
            delegatedTargetId: task.delegatedTargetId,
            adapter: type,
            credentialSessionId: ctx.credentialSessionId,
            credentialLeaseId: task.credentialLeaseId,
            action: task.action,
            result: supported ? 'success' : 'failed',
            evidenceRef: `mock://${task.id}/${type}/${task.action}`,
            kind: type === 'curl' ? 'response_summary' : 'command_summary',
            summary: `${type} mock descriptor 未执行真实协议`,
            metadata: {
              mockSafe: true,
              action: task.action,
              targetId: task.target.id,
            },
          },
        ],
      };
    },
  };
}

export const sshMockAdapter = mockDescriptor('ssh', 'SSH Mock Adapter', ['read', 'write', 'exec', 'upload']);
export const winRmMockAdapter = mockDescriptor('winrm', 'WinRM Mock Adapter', ['read', 'write', 'exec', 'upload']);
export const curlMockAdapter = mockDescriptor('curl', 'CURL Mock Adapter', ['read', 'write']);

export class MockAdapterRuntime {
  private readonly adapters = new Map<string, GatewayAdapterDescriptor>();

  constructor(descriptors: GatewayAdapterDescriptor[] = [sshMockAdapter, winRmMockAdapter, curlMockAdapter]) {
    descriptors.forEach((descriptor) => this.register(descriptor));
  }

  register(descriptor: GatewayAdapterDescriptor): void {
    this.adapters.set(descriptor.type, descriptor);
  }

  get(type: string): GatewayAdapterDescriptor | undefined {
    return this.adapters.get(type);
  }

  list(): GatewayAdapterDescriptor[] {
    return [...this.adapters.values()];
  }

  capabilities(): string[] {
    return this.list().flatMap((adapter) => adapter.capabilities);
  }

  async run(ctx: AdapterContext, task: GatewayTask) {
    const adapter = this.adapters.get(task.adapter);
    if (!adapter) throw new Error(`Adapter 不可用: ${task.adapter}`);
    const precheck = await adapter.precheck(ctx);
    if (!precheck.ok) throw new Error(precheck.reason ?? 'Adapter 预检失败');
    return adapter.run(ctx, task);
  }
}

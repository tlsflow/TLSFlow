import { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import type { AgentTaskEnvelope, AgentTaskLogEntry } from '../agents/schema/agents.schema.js';
import type { ControlPlaneTaskLogInput, DetectedCapabilities, FullAgentConfig, FullAgentIdentity, StepExecutionResultLike } from './full-agent.types.js';

export class MockControlPlaneClient {
  private sequence = 0;

  constructor(
    private readonly service = new AgentsApplicationService(),
    private readonly requestPrefix = 'full-agent-mock',
  ) {}

  async register(config: FullAgentConfig, detected?: DetectedCapabilities): Promise<FullAgentIdentity> {
    const registration = await this.service.register(config.tenantId, {
      agentKey: config.agentKey,
      hostname: config.hostname,
      version: config.version,
      osType: config.osType,
      arch: config.arch,
      labels: ['full-agent', 'mock-local'],
      role: 'full_agent',
      zone: 'local',
    }, this.nextRequestId());

    if (detected) {
      await this.service.reportCapabilities(config.tenantId, {
        agentId: registration.id,
        compatibilityLevel: detected.compatibilityLevel,
        capabilities: detected.capabilities,
      }, this.nextRequestId());
    }

    return {
      agentId: registration.id,
      agentKey: registration.agentKey,
      role: 'full_agent',
      tenantId: config.tenantId,
      hostname: registration.descriptor.hostname,
      version: registration.descriptor.version,
      osType: registration.descriptor.osType,
      arch: registration.descriptor.arch ?? config.arch,
      registeredAt: registration.registeredAt,
      capabilityVersion: detected?.capabilityVersion,
    };
  }

  heartbeat(identity: FullAgentIdentity, running = 0, queued = 0) {
    return this.service.heartbeat(identity.tenantId, {
      agentId: identity.agentId,
      status: 'ONLINE',
      version: identity.version,
      taskSummary: { running, queued },
    }, this.nextRequestId());
  }

  enqueueTask(identity: FullAgentIdentity, input: Omit<Parameters<AgentsApplicationService['enqueueTask']>[1], 'agentId'>): Promise<AgentTaskEnvelope> {
    return this.service.enqueueTask(identity.tenantId, { agentId: identity.agentId, ...input }, this.nextRequestId());
  }

  async pullTask(identity: FullAgentIdentity): Promise<AgentTaskEnvelope | undefined> {
    return (await this.service.pullTasks(identity.tenantId, identity.agentId, 1))[0];
  }

  ack(identity: FullAgentIdentity, task: AgentTaskEnvelope, leaseId: string): Promise<AgentTaskEnvelope> {
    return this.service.ackTask(identity.tenantId, { agentId: identity.agentId, taskId: task.id, leaseId });
  }

  log(identity: FullAgentIdentity, input: ControlPlaneTaskLogInput): Promise<AgentTaskLogEntry & { ackedSequence: number; lastAckedSequence: number }> {
    return this.service.submitLog(identity.tenantId, {
      agentId: identity.agentId,
      taskId: input.taskId,
      sequence: input.sequence,
      level: input.level ?? 'info',
      message: input.message,
    }, this.nextRequestId());
  }

  result(identity: FullAgentIdentity, task: AgentTaskEnvelope, leaseId: string, result: StepExecutionResultLike): Promise<AgentTaskEnvelope> {
    return this.service.submitResult(identity.tenantId, {
      agentId: identity.agentId,
      taskId: task.id,
      leaseId,
      success: result.success,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      detail: result.detail,
    });
  }

  listLogs(identity: FullAgentIdentity, taskId: string): Promise<AgentTaskLogEntry[]> {
    return this.service.listTaskLogs(identity.tenantId, taskId);
  }

  getService(): AgentsApplicationService {
    return this.service;
  }

  private nextRequestId(): string {
    this.sequence += 1;
    return `${this.requestPrefix}-${this.sequence}`;
  }
}

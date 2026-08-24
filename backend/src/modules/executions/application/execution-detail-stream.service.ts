import { EventEmitter } from 'node:events';
import type { AgentTaskLogEntry } from '../../agents/schema/agents.schema.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from '../schema/executions.schema.js';

export type ExecutionDetailStreamEvent =
  | {
      type: 'snapshot';
      runId: string;
      tenantId?: string;
      run?: ExecutionRunEntity;
      step?: ExecutionStepEntity;
      log?: AgentTaskLogEntry;
      emittedAt: string;
    }
  | {
      type: 'run';
      runId: string;
      tenantId?: string;
      run: ExecutionRunEntity;
      emittedAt: string;
    }
  | {
      type: 'step';
      runId: string;
      tenantId?: string;
      step: ExecutionStepEntity;
      emittedAt: string;
    }
  | {
      type: 'log';
      runId: string;
      tenantId?: string;
      log: AgentTaskLogEntry;
      emittedAt: string;
    };

type Listener = (event: ExecutionDetailStreamEvent) => void;

export class ExecutionDetailStreamService {
  private readonly emitter = new EventEmitter();

  subscribe(runId: string, listener: Listener): () => void {
    this.emitter.on(this.channel(runId), listener);
    return () => {
      this.emitter.off(this.channel(runId), listener);
    };
  }

  publish(event: ExecutionDetailStreamEvent): void {
    this.emitter.emit(this.channel(event.runId), event);
  }

  publishRun(run: ExecutionRunEntity): void {
    this.publish({
      type: 'run',
      runId: run.id,
      tenantId: run.tenantId,
      run,
      emittedAt: new Date().toISOString(),
    });
  }

  publishStep(step: ExecutionStepEntity): void {
    this.publish({
      type: 'step',
      runId: step.executionRunId,
      tenantId: step.tenantId,
      step,
      emittedAt: new Date().toISOString(),
    });
  }

  publishLog(runId: string, tenantId: string | undefined, log: AgentTaskLogEntry): void {
    this.publish({
      type: 'log',
      runId,
      tenantId,
      log,
      emittedAt: new Date().toISOString(),
    });
  }

  private channel(runId: string): string {
    return `execution:${runId}`;
  }
}

import type { ExecutionStepEntity } from '../schema/executions.schema.js';
import { StepGraphBuilder } from './step-graph-builder.js';

export interface SchedulerPick {
  selected: ExecutionStepEntity[];
  runningCount: number;
  runnableCount: number;
  blockedCount: number;
}

export class Scheduler {
  constructor(private readonly graphBuilder: StepGraphBuilder = new StepGraphBuilder()) {}

  pickNext(steps: ExecutionStepEntity[], concurrencyLimit: number): SchedulerPick {
    const graph = this.graphBuilder.build(steps);
    const runningCount = graph.running.length;
    const availableSlots = Math.max(concurrencyLimit - runningCount, 0);
    const selected = graph.runnable.slice(0, availableSlots);
    return {
      selected,
      runningCount,
      runnableCount: graph.runnable.length,
      blockedCount: graph.blocked.length,
    };
  }
}

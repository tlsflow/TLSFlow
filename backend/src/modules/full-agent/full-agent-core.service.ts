import { newId } from '../../shared/id.js';
import { redactSensitive } from '../../common/logging/redact.js';
import { CapabilityDetector } from './capability-detector.js';
import { MockControlPlaneClient } from './control-plane-client.mock.js';
import type { CapabilityDetectorFixture, FullAgentConfig, FullAgentIdentity, FullAgentRunOnceResult } from './full-agent.types.js';
import { LocalTaskLedger } from './local-task-ledger.js';
import { MockLocalExecutor } from './mock-local-executor.js';

export class FullAgentCoreService {
  private identity?: FullAgentIdentity;

  constructor(
    private readonly config: FullAgentConfig,
    private readonly controlPlane = new MockControlPlaneClient(),
    private readonly ledger = new LocalTaskLedger(),
    private readonly detector = new CapabilityDetector(),
    private readonly executor = new MockLocalExecutor(),
  ) {}

  register(fixture?: CapabilityDetectorFixture): FullAgentIdentity {
    const detected = this.detector.detect(this.config, fixture);
    this.identity = this.controlPlane.register(this.config, detected);
    return this.identity;
  }

  heartbeat() {
    const identity = this.requireIdentity();
    const recoverable = this.ledger.recoverable().length;
    return this.controlPlane.heartbeat(identity, 0, recoverable);
  }

  runOnce(): FullAgentRunOnceResult {
    const identity = this.requireIdentity();
    const heartbeat = this.heartbeat();
    const task = this.controlPlane.pullTask(identity);
    if (!task) return { identity, heartbeat, logs: [] };

    const localTask = this.ledger.accept(task);
    if (localTask.result) {
      return { identity, heartbeat, task: localTask, execution: localTask.result, logs: this.controlPlane.listLogs(identity, task.id) };
    }

    const leaseId = newId('lease');
    this.controlPlane.ack(identity, task, leaseId);
    this.ledger.markRunning(task.id, leaseId);
    this.controlPlane.log(identity, { taskId: task.id, sequence: 1, message: `开始执行 Full Agent mock task ${task.id}` });

    const execution = this.executor.execute({ task, dryRun: this.config.dryRunDefault });
    this.controlPlane.log(identity, {
      taskId: task.id,
      sequence: 2,
      level: execution.success ? 'info' : 'error',
      message: JSON.stringify(redactSensitive({ status: execution.status, detail: execution.detail })),
    });
    const completed = this.ledger.complete(task.id, execution);
    const submittedResult = this.controlPlane.result(identity, task, leaseId, execution);

    return {
      identity,
      heartbeat,
      task: completed,
      execution,
      submittedResult,
      logs: this.controlPlane.listLogs(identity, task.id),
    };
  }

  getControlPlaneClient(): MockControlPlaneClient {
    return this.controlPlane;
  }

  getLedger(): LocalTaskLedger {
    return this.ledger;
  }

  private requireIdentity(): FullAgentIdentity {
    if (!this.identity) throw new Error('Full Agent 尚未注册');
    return this.identity;
  }
}

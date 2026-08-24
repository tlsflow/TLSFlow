import type {
  AgentStatus,
  CertificateBindingStatus,
  DeploymentPlanStatus,
  ExecutionRunStatus,
  ExecutionStepStatus
} from '../enums/core.enums.js';

// 状态机只描述合法跳转，不做业务编排。业务模块必须调用这里，别在服务里散落字符串判断。
export type StateMachineName = 'deploymentPlan' | 'executionRun' | 'executionStep' | 'certificateBinding' | 'agent';

type TransitionMap<TState extends string> = Readonly<Record<TState, readonly TState[]>>;

export const deploymentPlanTransitions: TransitionMap<DeploymentPlanStatus> = {
  DRAFT: ['PENDING_APPROVAL', 'READY', 'CANCELLED'],
  PENDING_APPROVAL: ['READY', 'CANCELLED'],
  READY: ['RUNNING', 'CANCELLED'],
  RUNNING: ['SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED'],
  SUCCESS: [],
  PARTIAL_SUCCESS: ['ROLLED_BACK', 'FAILED'],
  FAILED: ['ROLLED_BACK'],
  CANCELLED: [],
  ROLLED_BACK: []
};

export const executionRunTransitions: TransitionMap<ExecutionRunStatus> = {
  PENDING: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['RUNNING', 'TIMEOUT', 'CANCELLED'],
  RUNNING: ['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED'],
  SUCCESS: [],
  FAILED: ['ROLLBACK_RUNNING'],
  TIMEOUT: ['ROLLBACK_RUNNING'],
  CANCELLED: [],
  ROLLBACK_RUNNING: ['ROLLBACK_SUCCESS', 'ROLLBACK_FAILED'],
  ROLLBACK_SUCCESS: [],
  ROLLBACK_FAILED: []
};

export const executionStepTransitions: TransitionMap<ExecutionStepStatus> = {
  PENDING: ['RUNNING', 'SKIPPED'],
  RUNNING: ['SUCCESS', 'FAILED', 'TIMEOUT'],
  SUCCESS: [],
  FAILED: [],
  SKIPPED: [],
  TIMEOUT: []
};

export const certificateBindingTransitions: TransitionMap<CertificateBindingStatus> = {
  DISCOVERED: ['MANAGED', 'IGNORED', 'ERROR'],
  MANAGED: ['DRIFTED', 'EXPIRED', 'ERROR', 'IGNORED'],
  DRIFTED: ['MANAGED', 'IGNORED', 'ERROR'],
  EXPIRED: ['MANAGED', 'IGNORED', 'ERROR'],
  ERROR: ['DISCOVERED', 'MANAGED', 'IGNORED'],
  IGNORED: ['DISCOVERED', 'MANAGED']
};

export const agentTransitions: TransitionMap<AgentStatus> = {
  UNKNOWN: ['ONLINE', 'OFFLINE', 'DISABLED'],
  ONLINE: ['OFFLINE', 'DISABLED', 'UPGRADING'],
  OFFLINE: ['ONLINE', 'DISABLED'],
  DISABLED: ['OFFLINE', 'ONLINE'],
  UPGRADING: ['ONLINE', 'OFFLINE', 'DISABLED']
};

const machines = {
  deploymentPlan: deploymentPlanTransitions,
  executionRun: executionRunTransitions,
  executionStep: executionStepTransitions,
  certificateBinding: certificateBindingTransitions,
  agent: agentTransitions
} as const;

export class InvalidStateTransitionError extends Error {
  constructor(machine: StateMachineName, from: string, to: string) {
    super(`非法状态跳转：${machine} 不允许从 ${from} 跳到 ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export function canTransition(machine: StateMachineName, from: string, to: string): boolean {
  const transitions = machines[machine] as Readonly<Record<string, readonly string[]>>;
  return transitions[from]?.includes(to) ?? false;
}

export function assertTransition(machine: StateMachineName, from: string, to: string): void {
  if (!canTransition(machine, from, to)) {
    throw new InvalidStateTransitionError(machine, from, to);
  }
}

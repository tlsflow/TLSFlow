import { createHash, randomUUID } from 'node:crypto';
import { canonicalize } from '../../shared/canonical-json.js';
import { LegacyCapabilityGate } from './legacy-capability-gate.js';
import type {
  LegacyAction,
  LegacyActionType,
  LegacyAgentProfile,
  LegacyTask,
  LegacyTaskTranslation,
  ScriptPackagePlan,
  UnifiedLegacyStep,
} from './legacy-agent.types.js';

const ACTION_CAPABILITIES: Record<LegacyActionType, string[]> = {
  write_file: ['file.write'],
  exec: ['process.exec'],
  backup: ['backup.create'],
  restore: ['backup.restore'],
  verify_file: ['verify.basic'],
  verify_tls: ['verify.tls'],
  cleanup: ['file.write'],
};

const DEFAULT_ACTIONS: LegacyAction[] = [
  {
    name: 'backup-current-material',
    type: 'backup',
    params: { target: 'certificate_material' },
    sensitive: false,
    onFailure: 'stop',
    timeoutSeconds: 60,
  },
  {
    name: 'write-certificate-placeholder',
    type: 'write_file',
    params: { source: 'certificateRef', destination: 'targetPaths.cert' },
    sensitive: true,
    onFailure: 'rollback',
    timeoutSeconds: 60,
  },
  {
    name: 'run-service-command',
    type: 'exec',
    params: { command: 'operator_confirmed_reload_command' },
    sensitive: false,
    onFailure: 'rollback',
    timeoutSeconds: 120,
  },
  {
    name: 'verify-installed-certificate',
    type: 'verify_file',
    params: { expected: 'certificateFingerprint' },
    sensitive: false,
    onFailure: 'stop',
    timeoutSeconds: 60,
  },
];

export class LegacyTaskTranslator {
  constructor(private readonly gate = new LegacyCapabilityGate()) {}

  translate(profile: LegacyAgentProfile, step: UnifiedLegacyStep): LegacyTaskTranslation {
    const actions = normalizeActions(step.actions ?? DEFAULT_ACTIONS);
    const actionCapabilities = actions.flatMap((action) => ACTION_CAPABILITIES[action.type]);
    const requiredCapabilities = unique([...step.requiredCapabilities, ...actionCapabilities]);
    const gate = this.gate.evaluate(profile, requiredCapabilities);

    if (gate.selectedPath === 'legacy_task' && gate.decision === 'allow') {
      return {
        mode: 'legacy_task',
        gate,
        legacyTask: buildLegacyTask(step, actions, requiredCapabilities),
      };
    }

    if (gate.selectedPath === 'script_package') {
      return {
        mode: 'script_package_plan',
        gate,
        scriptPackagePlan: buildScriptPackagePlan(step, requiredCapabilities),
      };
    }

    return {
      mode: gate.selectedPath === 'manual_result' ? 'manual_result' : 'monitor_only',
      gate,
    };
  }
}

function buildLegacyTask(step: UnifiedLegacyStep, actions: LegacyAction[], requiredCapabilities: string[]): LegacyTask {
  return {
    taskId: step.taskId,
    executionId: step.executionId,
    stepId: step.stepId,
    targetId: step.targetId,
    idempotencyKey: step.idempotencyKey,
    risk: step.risk,
    requiredCapabilities,
    actions,
    timeoutSeconds: sumTimeout(actions),
    workingDirectory: step.workingDirectory,
    secretRefs: step.secretRefs,
    expectedResult: step.expectedVerification,
    rollbackHints: { command: step.rollbackCommand, backupPolicy: step.backupPolicy },
  };
}

function buildScriptPackagePlan(step: UnifiedLegacyStep, requiredCapabilities: string[]): ScriptPackagePlan {
  return {
    packageId: stablePackageId(step),
    tenantId: step.tenantId,
    planId: step.planId,
    executionId: step.executionId,
    stepId: step.stepId,
    targetId: step.targetId,
    idempotencyKey: step.idempotencyKey,
    risk: step.risk,
    requiredCapabilities,
    certificateRef: step.certificateRef,
    certificateFingerprint: step.certificateFingerprint,
    certificateFormat: step.certificateFormat,
    targetPaths: step.targetPaths,
    installCommand: step.installCommand,
    verifyCommand: step.verifyCommand,
    rollbackCommand: step.rollbackCommand,
    backupPolicy: step.backupPolicy ?? { required: true, retentionDays: 7 },
    expectedVerification: step.expectedVerification,
    expiresAt: step.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function normalizeActions(actions: LegacyAction[]): LegacyAction[] {
  return actions.map((action) => {
    if (!ACTION_CAPABILITIES[action.type]) {
      throw new Error(`LEGACY_TASK_UNSUPPORTED_ACTION:${action.type}`);
    }
    return {
      ...action,
      timeoutSeconds: finitePositive(action.timeoutSeconds, 60),
      onFailure: action.onFailure,
      sensitive: action.sensitive,
    };
  });
}

function stablePackageId(step: UnifiedLegacyStep): string {
  const digest = createHash('sha256').update(canonicalize({
    idempotencyKey: step.idempotencyKey,
    planId: step.planId,
    stepId: step.stepId,
    targetId: step.targetId,
  })).digest('hex').slice(0, 24);
  return `spkg_${digest || randomUUID().replaceAll('-', '').slice(0, 24)}`;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sumTimeout(actions: LegacyAction[]): number {
  return actions.reduce((total, action) => total + action.timeoutSeconds, 0);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

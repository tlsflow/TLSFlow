export type LegacyRuntimeKind = 'native_static' | 'script_host' | 'service_wrapper';
export type LegacyOsFamily = 'windows' | 'linux' | 'unix' | 'unknown';
export type LegacyProtocolMode = 'mtls_stream' | 'https_polling' | 'offline_result';
export type LegacyCompatibilityLevel = 'L2' | 'L3' | 'L4' | 'L5';
export type LegacyRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type LegacyDegradePath = 'legacy_task' | 'gateway' | 'script_package' | 'manual_result' | 'monitor_only';

export interface LegacyCapabilityFact {
  key: string;
  value: boolean | string | number;
  confidence?: number;
  evidenceRef?: string;
}

export interface LegacyAgentProfile {
  agentId: string;
  tenantId: string;
  hostId?: string;
  runtimeKind: LegacyRuntimeKind;
  osFamily: LegacyOsFamily;
  osVersionText?: string;
  arch?: string;
  protocolMode: LegacyProtocolMode;
  supportsAutoUpgrade: boolean;
  compatibilityLevel: LegacyCompatibilityLevel;
  riskLabels?: string[];
  lastCapabilityReportId?: string;
  capabilities: LegacyCapabilityFact[];
}

export interface LegacyGateSuggestion {
  path: LegacyDegradePath;
  reason: string;
  requiredOperatorAction?: string;
}

export interface LegacyCapabilityGateResult {
  decision: 'allow' | 'degrade' | 'block';
  selectedPath: LegacyDegradePath;
  compatibilityLevel: LegacyCompatibilityLevel;
  missingCapabilities: string[];
  risk: LegacyRiskLevel;
  reasons: string[];
  suggestions: LegacyGateSuggestion[];
}

export type LegacyActionType = 'write_file' | 'exec' | 'backup' | 'restore' | 'verify_file' | 'verify_tls' | 'cleanup';
export type LegacyActionFailurePolicy = 'stop' | 'continue' | 'rollback';

export interface LegacyAction {
  name: string;
  type: LegacyActionType;
  params: Record<string, unknown>;
  runAs?: string;
  sensitive: boolean;
  onFailure: LegacyActionFailurePolicy;
  timeoutSeconds: number;
}

export interface LegacyTask {
  taskId: string;
  executionId: string;
  stepId: string;
  targetId: string;
  idempotencyKey: string;
  risk: LegacyRiskLevel;
  requiredCapabilities: string[];
  actions: LegacyAction[];
  timeoutSeconds: number;
  workingDirectory?: string;
  secretRefs?: string[];
  expectedResult?: Record<string, unknown>;
  rollbackHints?: Record<string, unknown>;
}

export interface UnifiedLegacyStep {
  taskId: string;
  executionId: string;
  stepId: string;
  tenantId: string;
  planId: string;
  targetId: string;
  idempotencyKey: string;
  risk: LegacyRiskLevel;
  requiredCapabilities: string[];
  workingDirectory?: string;
  certificateRef: string;
  certificateFingerprint: string;
  certificateFormat: ScriptPackageManifest['certificateFormat'];
  targetPaths?: ScriptPackageManifest['targetPaths'];
  installCommand?: string;
  verifyCommand?: string;
  rollbackCommand?: string;
  expectedVerification: Record<string, unknown>;
  backupPolicy?: ScriptPackageManifest['backupPolicy'];
  actions?: LegacyAction[];
  secretRefs?: string[];
  expiresAt?: string;
}

export interface LegacyTaskTranslation {
  mode: 'legacy_task' | 'script_package_plan' | 'manual_result' | 'monitor_only';
  gate: LegacyCapabilityGateResult;
  legacyTask?: LegacyTask;
  scriptPackagePlan?: ScriptPackagePlan;
}

export interface ScriptPackagePlan {
  packageId: string;
  tenantId: string;
  planId: string;
  executionId?: string;
  stepId?: string;
  targetId: string;
  idempotencyKey: string;
  risk: LegacyRiskLevel;
  requiredCapabilities: string[];
  certificateRef: string;
  certificateFingerprint: string;
  certificateFormat: ScriptPackageManifest['certificateFormat'];
  targetPaths?: ScriptPackageManifest['targetPaths'];
  installCommand?: string;
  verifyCommand?: string;
  rollbackCommand?: string;
  backupPolicy: ScriptPackageManifest['backupPolicy'];
  expectedVerification: ScriptPackageManifest['expectedVerification'];
  expiresAt: string;
}

export interface ScriptPackageManifest {
  manifestId: string;
  packageId: string;
  manifestVersion: string;
  tenantId: string;
  planId: string;
  executionId?: string;
  stepId?: string;
  targetId: string;
  certificateFingerprint: string;
  certificateFormat: 'pem' | 'pfx' | 'jks' | 'p7b' | 'der';
  targetPaths?: {
    cert?: string;
    key?: string;
    keystore?: string;
  };
  commands: {
    install: string;
    verify: string;
    rollback: string;
  };
  backupPolicy: {
    required: boolean;
    backupRefHint?: string;
    retentionDays?: number;
  };
  expectedVerification: Record<string, unknown>;
  expiresAt: string;
  artifactHashes: Record<'install' | 'verify' | 'rollback' | 'resultTemplate', string>;
  signature: string;
}

export interface ScriptPackageArtifact {
  name: 'install' | 'verify' | 'rollback' | 'resultTemplate';
  filename: string;
  content: string;
  sha256: string;
}

export interface ScriptPackageBundle {
  manifest: ScriptPackageManifest;
  artifacts: ScriptPackageArtifact[];
}

export interface ScriptPackageResult {
  manifestId: string;
  packageId: string;
  planId: string;
  targetId: string;
  phase: 'install' | 'verify' | 'rollback';
  status: 'success' | 'failed' | 'partial' | 'manual_unverified';
  certificateFingerprint?: string;
  backupRef?: string;
  exitCode?: number;
  startedAt?: string;
  finishedAt?: string;
  logs?: string[];
  evidenceRef?: string;
  artifactHashes: Partial<Record<'install' | 'verify' | 'rollback' | 'resultTemplate', string>>;
  operator: string;
  auditRef: string;
}

export interface ScriptPackageResultIngest {
  accepted: boolean;
  resultStatus: ScriptPackageResult['status'];
  verificationState: 'verified' | 'manual_unverified' | 'failed';
  reasons: string[];
  auditRef: string;
}

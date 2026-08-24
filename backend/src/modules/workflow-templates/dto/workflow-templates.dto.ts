import type { DeploymentInputContractV1 } from '../../deployment-inputs/dto/deployment-input-contract.dto.js';
import type { ResolvedDeploymentInputV1 } from '../../deployment-inputs/dto/resolved-deployment-input.dto.js';

export type WorkflowTemplateStatus = 'draft' | 'published' | 'disabled';
export type WorkflowTemplateVersionStatus = 'draft' | 'published' | 'disabled';
export type WorkflowStepType = 'http' | 'ssh' | 'sftp' | 'scp' | 'browser' | 'condition' | 'transform' | 'foreach' | 'checkpoint' | 'checkpoint_verify' | 'wait' | 'manual';
export type WorkflowVariableType = 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array' | 'file';
export type WorkflowStage = 'prepare' | 'backup' | 'install' | 'refresh' | 'verify';
export type WorkflowTestRunMode = 'render_only' | 'mock' | 'real_test';
export type WorkflowRunStatus = 'success' | 'failed' | 'rolled_back';
export type WorkflowFileTransferContentEncoding = 'utf8' | 'base64';
export type WorkflowCredentialKind = 'USERNAME_PASSWORD' | 'SSH_KEY' | 'BEARER_TOKEN' | 'API_KEY' | 'CLIENT_CERTIFICATE' | 'BROWSER_SESSION';
export type WorkflowConfigurationMode = 'required' | 'advanced' | 'runtime';
export type WorkflowVariableLifecycle = 'pre_execution' | 'runtime_injected' | 'step_output';
export type WorkflowBindingPolicy = 'fixed' | 'default_overridable' | 'required_binding';
export type WorkflowSshProgram = 'systemctl' | 'service' | 'sc.exe';
export type WorkflowSshArgumentTemplate = 'systemctl.reload' | 'systemctl.restart' | 'service.reload' | 'service.restart' | 'sc.query';
export type WorkflowVariableSource =
  | { kind: 'asset'; path: string }
  | { kind: 'default' }
  | { kind: 'derived'; resolver: 'endpoint_url' | 'authority' | 'binding_information' }
  | { kind: 'system'; key: string }
  | { kind: 'step_output'; step: string; output: string };

export interface WorkflowConnectionFieldDefinition {
  configurationMode?: Exclude<WorkflowConfigurationMode, 'runtime'>;
  source?: 'binding' | 'asset' | 'credential' | 'dsl_default';
  assetPath?: string;
  default?: string | number;
}

export interface WorkflowConnectionDefinition {
  protocol: 'ssh' | 'http';
  host: WorkflowConnectionFieldDefinition;
  port: WorkflowConnectionFieldDefinition;
  username?: WorkflowConnectionFieldDefinition;
  credential?: WorkflowConnectionFieldDefinition & { slot: string };
  hostKey?: { configurationMode?: Exclude<WorkflowConfigurationMode, 'runtime'>; policy: 'strict' | 'trust_on_first_use' | 'manual_approval_required' };
}

export interface WorkflowConnectionBinding {
  host?: string;
  port?: number;
  username?: string;
  credentialRef?: string;
  credential?: WorkflowCredentialBinding;
  expectedHostKeyFingerprint?: string;
}

export interface WorkflowCredentialBinding {
  credentialId: string;
  kind: WorkflowCredentialKind;
  username?: string;
  delivery?: { location?: 'header' | 'query' | 'cookie'; name?: string };
  secretRefs: Record<string, string>;
}

export type WorkflowCredentialValue = string;

export interface WorkflowVariableDefinition {
  type: WorkflowVariableType;
  configurationMode?: WorkflowConfigurationMode;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  sensitive?: boolean;
  description?: string;
  source?: WorkflowVariableSource;
  lifecycle?: WorkflowVariableLifecycle;
  bindingPolicy?: WorkflowBindingPolicy;
  ui?: { label?: string; group?: string; order?: number; help?: string };
}

export interface WorkflowMetadata {
  name: string;
  displayName?: string;
  description?: string;
  category?: string;
  tags?: string[];
  version?: string;
  logoUrl?: string;
  platforms?: string[];
  updateMethods?: WorkflowTemplateUpdateMethod[];
  maintainer?: string;
  homepage?: string;
}

export interface WorkflowRetryPolicy {
  count?: number;
  intervalSeconds?: number;
  retryOnStatus?: number[];
  retryOnNetworkError?: boolean;
}

export interface WorkflowCondition {
  variable: string;
  equals?: unknown;
  notEquals?: unknown;
  exists?: boolean;
}

export interface WorkflowExtractor {
  name: string;
  type: 'jsonPath' | 'outputPath' | 'firstOf' | 'header' | 'regex' | 'statusCode' | 'textContains';
  path?: string;
  paths?: string[];
  header?: string;
  pattern?: string;
  value?: string;
  optional?: boolean;
  sensitive?: boolean;
}

export type WorkflowAssertion =
  | { type: 'statusCode'; equals: number }
  | { type: 'jsonPath'; path: string; equals: unknown }
  | { type: 'header'; name: string; exists?: boolean; equals?: string }
  | { type: 'contains'; value: string }
  | { type: 'regex'; pattern: string }
  | { type: 'certificateFingerprint'; actual: string; expected: string };

export interface WorkflowHttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  connectionRef: string;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  headerRefs?: Record<string, string>;
  bodyType?: 'json' | 'form' | 'multipart' | 'raw' | 'none';
  body?: unknown;
  form?: Record<string, string | number | boolean>;
  formCredentialRefs?: Record<string, WorkflowCredentialValue>;
  multipart?: Record<string, { value?: string | number | boolean; filename?: string; contentType?: string; secretRef?: string }>;
  auth?:
    | { type: 'none' }
    | { type: 'basic'; username: string; credential: WorkflowCredentialValue }
    | { type: 'bearer'; credential: WorkflowCredentialValue }
    | { type: 'api_key'; credential: WorkflowCredentialValue; in?: 'header' | 'query'; name: string }
    | { type: 'cookie'; secretRef: string; name?: string }
    | { type: 'custom_header'; secretRef: string; headerName: string }
    | { type: 'mtls'; certSecretRef: string; keySecretRef: string };
  tls?: { verify?: boolean | string; caSecretRef?: string; clientCertSecretRef?: string; clientKeySecretRef?: string; sni?: string; allowInsecure?: boolean };
  timeoutSeconds?: number;
  maxResponseBytes?: number;
  successStatusCodes?: number[];
  failOnNon2xx?: boolean;
}

export interface WorkflowSshConnection {
  host: string;
  port?: number;
  username: string;
  credential: WorkflowCredentialBinding;
  expectedHostKeyFingerprint?: string;
  hostKeyPolicy?: 'strict' | 'trust_on_first_use' | 'manual_approval_required';
}

export interface WorkflowSshStepConfig {
  connectionRef: string;
  program: WorkflowSshProgram;
  args: string[];
  argumentTemplate: WorkflowSshArgumentTemplate;
  timeoutSeconds?: number;
}

export interface WorkflowBrowserExtraction {
  name: string;
  source: 'cookie' | 'header' | 'local_storage' | 'session_storage' | 'url' | 'text';
  key?: string;
  optional?: boolean;
  sensitive?: boolean;
}

export interface WorkflowBrowserStepConfig {
  action: 'navigate' | 'extract' | 'verify';
  url?: string;
  extractions?: WorkflowBrowserExtraction[];
  verification?: {
    url?: string;
    statusCode?: number;
    textContains?: string;
  };
}

export interface WorkflowFileTransferStepConfig {
  direction: 'upload' | 'download';
  connectionRef: string;
  remotePath: string;
  contentRef?: string;
  contentEncoding?: WorkflowFileTransferContentEncoding;
  localPath?: string;
  temporaryPath?: string;
  expectedHash?: string;
  expectedSize?: number;
  verifyHash?: boolean;
  mode?: string;
  owner?: string;
  group?: string;
  timeoutSeconds?: number;
}

export interface WorkflowStepBase {
  name: string;
  type: WorkflowStepType;
  stage?: WorkflowStage;
  when?: WorkflowCondition;
  retry?: WorkflowRetryPolicy;
  extract?: WorkflowExtractor[] | Record<string, Omit<WorkflowExtractor, 'name'>>;
  assert?: WorkflowAssertion[];
}

export interface WorkflowHttpStep extends WorkflowStepBase {
  type: 'http';
  request: WorkflowHttpRequest;
}

export interface WorkflowSshStep extends WorkflowStepBase {
  type: 'ssh';
  ssh: WorkflowSshStepConfig;
}

export interface WorkflowBrowserStep extends WorkflowStepBase {
  type: 'browser';
  browser: WorkflowBrowserStepConfig;
}

export interface WorkflowSftpStep extends WorkflowStepBase {
  type: 'sftp';
  sftp: WorkflowFileTransferStepConfig;
}

export interface WorkflowScpStep extends WorkflowStepBase {
  type: 'scp';
  scp: WorkflowFileTransferStepConfig;
}

export interface WorkflowConditionStep extends WorkflowStepBase {
  type: 'condition';
  condition: WorkflowCondition;
  description?: string;
}

export interface WorkflowTransformOutput {
  expression: string;
  format?: 'raw' | 'jsonString';
  sensitive?: boolean;
  optional?: boolean;
}

export interface WorkflowTransformStepConfig {
  engine: 'jsonata';
  input?: unknown;
  outputs: Record<string, WorkflowTransformOutput>;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
}

export interface WorkflowTransformStep extends WorkflowStepBase {
  type: 'transform';
  transform: WorkflowTransformStepConfig;
}

export interface WorkflowForeachStep extends WorkflowStepBase {
  type: 'foreach';
  foreach: {
    itemsPath: string;
    itemVariable: string;
    indexVariable?: string;
    maxItems?: number;
    continueOnError?: boolean;
    steps: WorkflowStep[];
  };
}

export interface WorkflowCheckpointStep extends WorkflowStepBase {
  type: 'checkpoint';
  checkpoint: {
    name: string;
    capture: Record<string, string>;
    normalizedHash?: boolean;
    requiredForRollback: boolean;
  };
}

export interface WorkflowCheckpointVerifyStep extends WorkflowStepBase {
  type: 'checkpoint_verify';
  checkpointVerify: {
    valuePath: string;
    expectedHash: string;
  };
}

export interface WorkflowWaitStep extends WorkflowStepBase {
  type: 'wait';
  seconds: number;
}

export interface WorkflowManualStep extends WorkflowStepBase {
  type: 'manual';
  instruction: string;
}

export type WorkflowStep = WorkflowHttpStep | WorkflowSshStep | WorkflowSftpStep | WorkflowScpStep | WorkflowBrowserStep | WorkflowConditionStep | WorkflowTransformStep | WorkflowForeachStep | WorkflowCheckpointStep | WorkflowCheckpointVerifyStep | WorkflowWaitStep | WorkflowManualStep;

export interface WorkflowDslV1 {
  apiVersion: 'gcac.workflow/v1';
  kind: 'CurlSshWorkflow';
  metadata: WorkflowMetadata;
  inputContract: DeploymentInputContractV1;
  steps: WorkflowStep[];
  rollback?: WorkflowStep[];
}

export interface CreateWorkflowTemplateInput {
  content: WorkflowDslV1;
  changeSummary?: string;
  pluginSource?: WorkflowPluginSource;
}

export type WorkflowTemplateOrigin = 'plugin_internal' | 'user';
export type WorkflowOwnerType = 'SYSTEM' | 'TENANT';

export interface WorkflowPluginSource {
  sourceType: 'PLUGIN_CAPABILITY';
  pluginId: string;
  pluginVersionId: string;
  capabilityKey: 'certificate.deploy' | 'certificate.rollback';
  sourceWorkflowVersionId: string;
  sourceContentHash: string;
  createdAt: string;
  /** @deprecated 历史来源证据保留读取兼容，不参与运行时。 */
  sourceWorkflowTemplateId?: string;
}

export interface WorkflowSourceCandidate {
  pluginId: string;
  pluginVersionId: string;
  pluginVersion: string;
  displayName: string;
  workflowName: string;
  workflowDisplayName?: string;
  workflowResourcePath: string;
  capabilityKey: 'certificate.deploy' | 'certificate.rollback';
  workflowTemplateId: string;
  workflowVersionId: string;
  workflowContentHash: string;
  workflowVersion: number;
  stepCount: number;
  rollbackCount: number;
}

export interface CreateWorkflowFromPluginInput {
  pluginVersionId: string;
  capabilityKey: 'certificate.deploy' | 'certificate.rollback';
  name: string;
  changeSummary?: string;
}

export interface CreateWorkflowDraftFromPluginInput extends CreateWorkflowFromPluginInput {
  templateId: string;
}

export interface RenameWorkflowTemplateInput {
  templateId: string;
  name: string;
}

export interface UpdateWorkflowTemplateInput {
  templateId: string;
  content: WorkflowDslV1;
  changeSummary?: string;
  pluginSource?: WorkflowPluginSource;
  allowDuplicateContent?: boolean;
}

export interface UpdateWorkflowTemplateVersionNoteInput {
  versionId: string;
  changeSummary?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  origin: WorkflowTemplateOrigin;
  ownerType: WorkflowOwnerType;
  ownerId?: string;
  tenantId?: string;
  status: WorkflowTemplateStatus;
  currentVersionId?: string;
  currentVersion?: number;
  currentVersionLabel?: string;
  createdAt: string;
  updatedAt: string;
}

/** 工作流目录读模型附带的插件能力摘要，不参与模板持久化。 */
export interface WorkflowListItem extends WorkflowTemplate {
  capabilities?: string[];
}

export interface WorkflowTemplateVersion {
  id: string;
  templateId: string;
  version: number;
  dslVersion: 'v1';
  content: WorkflowDslV1;
  contentHash: string;
  /** P2 Runner 载荷的固定执行模式；旧宿主 DSL 版本不设置该字段。 */
  executionMode?: 'PLUGIN_RUNNER';
  status: WorkflowTemplateVersionStatus;
  changeSummary?: string;
  pluginSource?: WorkflowPluginSource;
  createdAt: string;
}

export interface WorkflowTemplateRecord {
  template: WorkflowTemplate;
  versions: WorkflowTemplateVersion[];
}

export type WorkflowTemplateUpdateMethod = 'ssh' | 'curl';

export interface WorkflowRuntimeInput {
  templateVersionId: string;
  resolvedInput: ResolvedDeploymentInputV1;
  stepOutputs?: Record<string, unknown>;
  systemValues?: Record<string, unknown>;
  mockResponses?: Record<string, WorkflowMockStepOutput>;
  mode: WorkflowTestRunMode;
  /**
   * render_only 下是否仍调用宿主 dispatcher 做无副作用安全预检。
   * 仅由宿主执行适配器使用，不能被 DSL 自身开启授权。
   */
  dispatchInRenderOnly?: boolean;
  /**
   * 执行同一 WorkflowVersion 的哪一条分支。
   * 未提供时按 deploy 处理，并保留旧调用方的自动回滚兼容行为。
   */
  executionBranch?: WorkflowExecutionBranch;
}

export type WorkflowExecutionBranch = 'deploy' | 'rollback';

export interface WorkflowStepRuntimeInput extends Omit<WorkflowRuntimeInput, 'templateVersionId'> {
  content: WorkflowDslV1;
  stepName: string;
}

export interface WorkflowMockStepOutput {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: unknown;
  stdout?: string;
  exitCode?: number;
}

export interface WorkflowRenderedStep {
  name: string;
  type: WorkflowStepType;
  stage?: WorkflowStage;
  skipped?: boolean;
  reason?: string;
  request?: unknown;
  preview: unknown;
}

export interface WorkflowStepRunResult {
  name: string;
  type: WorkflowStepType;
  stage?: WorkflowStage;
  status: 'success' | 'failed' | 'skipped';
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  attempts: number;
  plan: unknown;
  extracted: Record<string, unknown>;
  assertions: Array<{ type: string; passed: boolean; message: string }>;
  logs: string[];
  children?: WorkflowStepRunResult[];
}

export interface WorkflowRunResult {
  id: string;
  mode: WorkflowTestRunMode;
  executionBranch: WorkflowExecutionBranch;
  plannedOnly: boolean;
  status: WorkflowRunStatus;
  renderedSteps: WorkflowRenderedStep[];
  stepResults: WorkflowStepRunResult[];
  rollbackResults: WorkflowStepRunResult[];
  logs: string[];
}

export interface WorkflowProgressStep {
  name: string;
  type: WorkflowStepType;
  stage?: WorkflowStage;
  status: 'queued' | 'running' | 'success' | 'failed' | 'skipped';
  startedAt?: string;
  finishedAt?: string;
  attempts: number;
  errorCode?: string;
  errorMessage?: string;
  assertions: Array<{ type: string; passed: boolean; message: string }>;
  logs: string[];
}

export interface WorkflowRunProgress {
  id: string;
  mode: WorkflowTestRunMode;
  status: 'running' | 'success' | 'failed' | 'rolled_back';
  totalSteps: number;
  completedSteps: number;
  activeStep?: string;
  steps: WorkflowProgressStep[];
  logs: string[];
  updatedAt: string;
}

export type WorkflowProgressReporter = (progress: WorkflowRunProgress) => Promise<void> | void;

export interface WorkflowSingleStepRunResult {
  id: string;
  mode: WorkflowTestRunMode;
  plannedOnly: boolean;
  renderedStep: WorkflowRenderedStep;
  stepResult: WorkflowStepRunResult;
  stepOutput?: unknown;
  logs: string[];
}

export interface WorkflowExecutorDispatchInput {
  runId: string;
  step: WorkflowStep;
  renderedPlan: unknown;
  attempt: number;
  rollback: boolean;
}

export interface WorkflowExecutorDispatchResult extends WorkflowMockStepOutput {
  success: boolean;
  logs?: string[];
  raw?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

export type WorkflowExecutorDispatcher = (input: WorkflowExecutorDispatchInput) => Promise<WorkflowExecutorDispatchResult>;

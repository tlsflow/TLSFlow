export type WorkflowTemplateStatus = 'draft' | 'published' | 'disabled';
export type WorkflowTemplateVersionStatus = 'draft' | 'published' | 'disabled';
export type WorkflowStepType = 'http' | 'ssh' | 'sftp' | 'scp' | 'condition' | 'transform' | 'wait' | 'manual';
export type WorkflowVariableType = 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'file' | 'credential' | 'certificate';
export type WorkflowStage = 'prepare' | 'backup' | 'install' | 'refresh' | 'verify';
export type WorkflowTestRunMode = 'render_only' | 'mock' | 'real_test';
export type WorkflowRunStatus = 'success' | 'failed' | 'rolled_back';
export type WorkflowFileTransferContentEncoding = 'utf8' | 'base64';
export type WorkflowCredentialKind = 'username_password' | 'ssh_key' | 'curl_bearer' | 'curl_api_key';
export type WorkflowCredentialSecretType = 'password' | 'ssh_key' | 'api_token';
export type WorkflowCertificateArtifactRole = 'public_certificate' | 'private_key' | 'certificate_chain' | 'bundle';

export interface WorkflowCredentialBinding {
  id: string;
  kind: WorkflowCredentialKind;
  type: WorkflowCredentialSecretType;
  username?: string;
  apiKeyName?: string;
  apiKeyIn?: 'header' | 'query';
}

export type WorkflowCredentialValue = WorkflowCredentialBinding | string;

export interface WorkflowCertificateArtifactOutputContract {
  role: WorkflowCertificateArtifactRole | string;
  required?: boolean;
  format?: string;
  encoding?: WorkflowFileTransferContentEncoding | string;
  description?: string;
}

export interface WorkflowCertificateArtifactContract {
  outputs: Record<string, WorkflowCertificateArtifactOutputContract>;
}

export interface WorkflowVariableDefinition {
  type: WorkflowVariableType;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  sensitive?: boolean;
  description?: string;
  artifactContract?: WorkflowCertificateArtifactContract;
}

export interface WorkflowMetadata {
  name: string;
  displayName?: string;
  category?: string;
  tags?: string[];
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
  tls?: { verify?: boolean; caSecretRef?: string; clientCertSecretRef?: string; clientKeySecretRef?: string; sni?: string; allowInsecure?: boolean };
  timeoutSeconds?: number;
  maxResponseBytes?: number;
  successStatusCodes?: number[];
  failOnNon2xx?: boolean;
}

export interface WorkflowSshConnection {
  host: string;
  port?: number;
  username: string;
  credential: WorkflowCredentialValue;
  expectedHostKeyFingerprint?: string;
  hostKeyPolicy?: 'strict' | 'trust_on_first_use' | 'manual_approval_required';
}

export interface WorkflowSshDialogueItem {
  expect: string;
  send: string;
  sensitive?: boolean;
}

export interface WorkflowSshStepConfig {
  mode: 'command' | 'script' | 'interactive';
  connection: WorkflowSshConnection;
  command?: string;
  commands?: string[];
  script?: string;
  dialogue?: WorkflowSshDialogueItem[];
  timeoutSeconds?: number;
}

export interface WorkflowFileTransferStepConfig {
  direction: 'upload' | 'download';
  connection: WorkflowSshConnection;
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

export interface WorkflowWaitStep extends WorkflowStepBase {
  type: 'wait';
  seconds: number;
}

export interface WorkflowManualStep extends WorkflowStepBase {
  type: 'manual';
  instruction: string;
}

export type WorkflowStep = WorkflowHttpStep | WorkflowSshStep | WorkflowSftpStep | WorkflowScpStep | WorkflowConditionStep | WorkflowTransformStep | WorkflowWaitStep | WorkflowManualStep;

export interface WorkflowDslV1 {
  apiVersion: 'gcac.workflow/v1';
  kind: 'CurlSshWorkflow';
  metadata: WorkflowMetadata;
  variables: Record<string, WorkflowVariableDefinition>;
  steps: WorkflowStep[];
  rollback?: WorkflowStep[];
}

export interface CreateWorkflowTemplateInput {
  content: WorkflowDslV1;
  changeSummary?: string;
}

export interface UpdateWorkflowTemplateInput {
  templateId: string;
  content: WorkflowDslV1;
  changeSummary?: string;
}

export interface UpdateWorkflowTemplateVersionNoteInput {
  versionId: string;
  changeSummary?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  status: WorkflowTemplateStatus;
  currentVersionId?: string;
  currentVersion?: number;
  currentVersionLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTemplateVersion {
  id: string;
  templateId: string;
  version: number;
  dslVersion: 'v1';
  content: WorkflowDslV1;
  contentHash: string;
  status: WorkflowTemplateVersionStatus;
  changeSummary?: string;
  createdAt: string;
}

export interface WorkflowTemplateRecord {
  template: WorkflowTemplate;
  versions: WorkflowTemplateVersion[];
}

export type WorkflowFileTemplateSource = 'builtin' | 'user';

export interface WorkflowFileTemplate {
  id: string;
  source: WorkflowFileTemplateSource;
  fileName: string;
  relativePath: string;
  valid: boolean;
  updatedAt: string;
  metadata?: WorkflowMetadata;
  stepCount?: number;
  rollbackCount?: number;
  error?: string;
}

export interface CreateWorkflowTemplateFromFileInput {
  fileTemplateId: string;
  changeSummary?: string;
}

export interface ApplyWorkflowTemplateFromFileInput {
  templateId: string;
  fileTemplateId: string;
  changeSummary?: string;
}

export interface WorkflowRuntimeInput {
  templateVersionId: string;
  userVariables?: Record<string, unknown>;
  assetVariables?: Record<string, unknown>;
  certificateMaterials?: Record<string, Record<string, unknown>>;
  mockResponses?: Record<string, WorkflowMockStepOutput>;
  mode: WorkflowTestRunMode;
}

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
}

export interface WorkflowRunResult {
  id: string;
  mode: WorkflowTestRunMode;
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

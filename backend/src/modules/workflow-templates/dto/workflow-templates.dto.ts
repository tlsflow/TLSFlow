export type WorkflowTemplateStatus = 'draft' | 'published' | 'disabled';
export type WorkflowTemplateVersionStatus = 'draft' | 'published' | 'disabled';
export type WorkflowStepType = 'http' | 'ssh' | 'wait' | 'manual';
export type WorkflowVariableType = 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'file' | 'secret' | 'certificate';
export type WorkflowTestRunMode = 'render_only' | 'mock' | 'real_test';
export type WorkflowRunStatus = 'success' | 'failed' | 'rolled_back';

export interface WorkflowVariableDefinition {
  type: WorkflowVariableType;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  sensitive?: boolean;
  description?: string;
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
}

export interface WorkflowCondition {
  variable: string;
  equals?: unknown;
  notEquals?: unknown;
  exists?: boolean;
}

export interface WorkflowExtractor {
  name: string;
  type: 'jsonPath' | 'header' | 'regex' | 'statusCode' | 'textContains';
  path?: string;
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
  headers?: Record<string, string>;
  body?: unknown;
  timeoutSeconds?: number;
}

export interface WorkflowSshConnection {
  host: string;
  port?: number;
  username: string;
  credentialSecretRef: string;
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
  script?: string;
  dialogue?: WorkflowSshDialogueItem[];
  timeoutSeconds?: number;
}

export interface WorkflowStepBase {
  name: string;
  type: WorkflowStepType;
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

export interface WorkflowWaitStep extends WorkflowStepBase {
  type: 'wait';
  seconds: number;
}

export interface WorkflowManualStep extends WorkflowStepBase {
  type: 'manual';
  instruction: string;
}

export type WorkflowStep = WorkflowHttpStep | WorkflowSshStep | WorkflowWaitStep | WorkflowManualStep;

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

export interface WorkflowTemplate {
  id: string;
  name: string;
  status: WorkflowTemplateStatus;
  currentVersionId?: string;
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

export interface WorkflowRuntimeInput {
  templateVersionId: string;
  userVariables?: Record<string, unknown>;
  assetVariables?: Record<string, unknown>;
  certificateMaterials?: Record<string, Record<string, unknown>>;
  secretRefs?: Record<string, Record<string, unknown> | string>;
  mockResponses?: Record<string, WorkflowMockStepOutput>;
  mode: WorkflowTestRunMode;
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
  skipped?: boolean;
  reason?: string;
  request?: unknown;
  preview: unknown;
}

export interface WorkflowStepRunResult {
  name: string;
  type: WorkflowStepType;
  status: 'success' | 'failed' | 'skipped';
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

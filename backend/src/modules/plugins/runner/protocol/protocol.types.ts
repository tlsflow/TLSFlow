/**
 * Runner IPC 只承载一个已经冻结的 plugin.action。
 * Workflow、rollback、checkpoint 和全局变量属于 DSL Runtime，绝不能进入此协议。
 */
export const pluginRunnerProtocolVersion = 'gcac.plugin-runner/v2' as const;

export type PluginRunnerMessageType =
  | 'hello'
  | 'hello_result'
  | 'execute'
  | 'execute_result'
  | 'host_call'
  | 'host_result'
  | 'cancel'
  | 'cancel_result'
  | 'ping'
  | 'pong'
  | 'shutdown'
  | 'shutdown_result';

export type PluginExecutionStatus = 'SUCCESS' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';
export type PluginRunnerErrorCode =
  | 'PLUGIN_RUNNER_START_FAILED'
  | 'PLUGIN_RUNNER_HANDSHAKE_FAILED'
  | 'PLUGIN_RUNNER_TIMEOUT'
  | 'PLUGIN_RUNNER_CRASHED'
  | 'PLUGIN_HOST_CALL_DENIED'
  | 'PLUGIN_CONTRACT_INVALID'
  | 'PLUGIN_OPERATION_CANCELLED'
  | 'PLUGIN_OPERATION_UNKNOWN_STATE'
  | 'PLUGIN_RUNNER_PROTOCOL_VIOLATION'
  | 'PLUGIN_RUNNER_BUSY'
  | 'PLUGIN_RUNNER_DRAINING'
  | 'PLUGIN_RUNNER_VERSION_MISMATCH';

export interface PluginRunnerError {
  code: PluginRunnerErrorCode | string;
  message: string;
  retryable: boolean;
  mayBeUnknown: boolean;
  details?: Record<string, unknown>;
  secretRedacted: true;
}

export interface PluginRunnerWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  secretRedacted: true;
}

export interface PluginRunnerMessageBase {
  protocolVersion: typeof pluginRunnerProtocolVersion;
  messageType: PluginRunnerMessageType;
  requestId: string;
  sentAt: string;
  pluginVersionId?: string;
  tenantId?: string;
  executionId?: string;
  executionStepId?: string;
}

/** 当前 Action 的不可变身份，所有执行相关消息都携带它。 */
export interface PluginActionMessageBinding {
  workflowVersionId: string;
  pluginId: string;
  capability: string;
  actionId: string;
  actionContractVersion: string;
  inputSchemaSha256: string;
  outputSchemaSha256: string;
  packageHash: string;
  manifestHash: string;
  resourceHash: string;
  planDigest: string;
  writeEffect: boolean;
}

export interface PluginRunnerHello extends PluginRunnerMessageBase {
  messageType: 'hello';
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  runner: {
    pid: number;
    sdkVersion: string;
    runnerVersion: string;
  };
  capabilities: string[];
  permissions: string[];
  packageHash: string;
  resourceHash: string;
  manifestHash: string;
}

export interface PluginRunnerHelloResult extends PluginRunnerMessageBase {
  messageType: 'hello_result';
  pluginVersionId: string;
  accepted: boolean;
  pluginId: string;
  pluginVersion: string;
  runnerVersion: string;
  sdkVersion: string;
  capabilities: string[];
  permissions: string[];
  packageHash: string;
  resourceHash: string;
  manifestHash: string;
  error?: PluginRunnerError;
}

export interface PluginRunnerExecute extends PluginRunnerMessageBase, PluginActionMessageBinding {
  messageType: 'execute';
  pluginVersionId: string;
  tenantId: string;
  executionId: string;
  executionStepId: string;
  grantRefs: string[];
  idempotencyKey: string;
  input: Record<string, unknown>;
  deadlineAt: string;
}

export interface PluginRunnerExecuteResult extends PluginRunnerMessageBase, PluginActionMessageBinding {
  messageType: 'execute_result';
  pluginVersionId: string;
  tenantId: string;
  executionId: string;
  executionStepId: string;
  success: boolean;
  status: PluginExecutionStatus;
  /** 只表示当前 Action 的结构化返回值。 */
  output: Record<string, unknown>;
  /** 外部系统回执仅供宿主审计和 UNKNOWN 恢复使用。 */
  externalReceipt?: Record<string, unknown>;
  warnings: PluginRunnerWarning[];
  error?: PluginRunnerError;
}

export interface PluginRunnerHostCall extends PluginRunnerMessageBase, PluginActionMessageBinding {
  messageType: 'host_call';
  pluginVersionId: string;
  tenantId: string;
  executionId: string;
  executionStepId: string;
  method: string;
  input: Record<string, unknown>;
  grantRefs: string[];
  idempotencyKey: string;
  deadlineAt: string;
  timeoutMs: number;
}

export interface PluginRunnerHostResult extends PluginRunnerMessageBase, PluginActionMessageBinding {
  messageType: 'host_result';
  pluginVersionId: string;
  tenantId: string;
  executionId: string;
  executionStepId: string;
  ok: boolean;
  output?: Record<string, unknown>;
  error?: PluginRunnerError;
}

export interface PluginRunnerCancel extends PluginRunnerMessageBase {
  messageType: 'cancel';
  pluginVersionId: string;
  tenantId: string;
  executionId: string;
  executionStepId: string;
  targetRequestId: string;
  reason: string;
}

export interface PluginRunnerCancelResult extends PluginRunnerMessageBase {
  messageType: 'cancel_result';
  pluginVersionId: string;
  tenantId: string;
  executionId: string;
  executionStepId: string;
  targetRequestId: string;
  accepted: boolean;
  status: 'ACCEPTED' | 'ALREADY_COMPLETED' | 'UNKNOWN';
}

export interface PluginRunnerPing extends PluginRunnerMessageBase {
  messageType: 'ping';
  pluginVersionId: string;
  nonce: string;
}

export interface PluginRunnerPong extends PluginRunnerMessageBase {
  messageType: 'pong';
  pluginVersionId: string;
  nonce: string;
}

export interface PluginRunnerShutdown extends PluginRunnerMessageBase {
  messageType: 'shutdown';
  pluginVersionId: string;
  reason: 'DRAIN' | 'HOST_EXIT' | 'VERSION_SWITCH' | 'DOCKER_STOP';
  graceMs: number;
}

export interface PluginRunnerShutdownResult extends PluginRunnerMessageBase {
  messageType: 'shutdown_result';
  pluginVersionId: string;
  accepted: boolean;
  status: 'DRAINING' | 'SHUTDOWN';
}

export type PluginRunnerInboundMessage =
  | PluginRunnerHelloResult
  | PluginRunnerExecuteResult
  | PluginRunnerHostCall
  | PluginRunnerCancelResult
  | PluginRunnerPong
  | PluginRunnerShutdownResult;

export type PluginRunnerOutboundMessage =
  | PluginRunnerHello
  | PluginRunnerExecute
  | PluginRunnerHostResult
  | PluginRunnerCancel
  | PluginRunnerPing
  | PluginRunnerShutdown;

export type PluginRunnerMessage = PluginRunnerInboundMessage | PluginRunnerOutboundMessage;

export function isPluginRunnerMessageType(value: unknown): value is PluginRunnerMessageType {
  return typeof value === 'string' && [
    'hello', 'hello_result', 'execute', 'execute_result', 'host_call', 'host_result',
    'cancel', 'cancel_result', 'ping', 'pong', 'shutdown', 'shutdown_result',
  ].includes(value);
}

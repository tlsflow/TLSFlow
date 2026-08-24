import type { PluginRunnerMessageType } from './protocol.types.js';

export const pluginRunnerLimits = {
  maxMessageBytes: 64 * 1024,
  maxStdoutBytes: 4 * 1024 * 1024,
  maxStderrBytes: 32 * 1024,
  maxDepth: 16,
  maxArrayItems: 100,
  maxObjectProperties: 200,
  startupTimeoutMs: 5_000,
  helloTimeoutMs: 2_000,
  executeTimeoutMs: 120_000,
  hostCallTimeoutMs: 30_000,
  shutdownGraceMs: 2_000,
  heartbeatIntervalMs: 10_000,
  maxConcurrentHostCalls: 16,
  maxCompletedInboundRequestIds: 2048,
  maxExpiredRequestIds: 2048,
  maxResidentMemoryBytes: 512 * 1024 * 1024,
  maxCpuTimeMs: 120_000,
  resourcePollIntervalMs: 250,
} as const;

export const pluginRunnerMessageTypes: readonly PluginRunnerMessageType[] = [
  'hello', 'hello_result', 'execute', 'execute_result', 'host_call', 'host_result',
  'cancel', 'cancel_result', 'ping', 'pong', 'shutdown', 'shutdown_result',
];

export const requestResponsePairs: Readonly<Record<string, string>> = {
  hello: 'hello_result',
  execute: 'execute_result',
  host_call: 'host_result',
  cancel: 'cancel_result',
  ping: 'pong',
  shutdown: 'shutdown_result',
};

export const retryPolicy = {
  readOnly: { retryable: true, maxAttempts: 2 },
  write: { retryable: false, maxAttempts: 1 },
  unknownExternalState: { retryable: false, maxAttempts: 0 },
} as const;

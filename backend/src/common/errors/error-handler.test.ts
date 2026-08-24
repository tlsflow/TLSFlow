import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REDACTED_VALUE, redactSensitive } from '../logging/redact.js';
import { StructuredLogger, type LogEvent } from '../logging/structured-logger.js';
import { runWithRequestContext } from '../tracing/request-context.js';
import { AppError } from './app-error.js';
import { toErrorResponse } from './error-handler.js';

describe('错误响应和日志脱敏', () => {
  it('敏感字段会被递归脱敏', () => {
    const result = redactSensitive({
      username: 'admin',
      password: '123456',
      nested: { authorization: 'Bearer abc.def', privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----' },
    }) as Record<string, unknown>;
    assert.equal(result.username, 'admin');
    assert.equal(result.password, REDACTED_VALUE);
    assert.deepEqual(result.nested, { authorization: REDACTED_VALUE, privateKey: REDACTED_VALUE });
  });

  it('业务错误响应包含 requestId 且不裸露敏感字段', () => {
    const handled = runWithRequestContext(
      { requestId: 'req_test', traceId: 'trace_test' },
      () => toErrorResponse(new AppError('VALIDATION_FAILED', '请求参数不合法', { token: 'abc', field: 'name' })),
    );
    assert.equal(handled.statusCode, 400);
    assert.equal(handled.body.errorCode, 'VALIDATION_FAILED');
    assert.equal(handled.body.requestId, 'req_test');
    assert.equal(handled.body.traceId, 'trace_test');
    assert.deepEqual(handled.body.details, { token: REDACTED_VALUE, field: 'name' });
  });

  it('结构化日志继承请求上下文并脱敏', () => {
    const events: LogEvent[] = [];
    const logger = new StructuredLogger((event) => events.push(event));
    runWithRequestContext({ requestId: 'req_log', traceId: 'trace_log', tenantId: 'tenant_1', actorId: 'actor_1' }, () => {
      logger.info('测试日志', { cookie: 'sid=abc', normal: 'ok' }, { module: 'unit' });
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].requestId, 'req_log');
    assert.equal(events[0].tenantId, 'tenant_1');
    assert.deepEqual(events[0].details, { cookie: REDACTED_VALUE, normal: 'ok' });
  });
});

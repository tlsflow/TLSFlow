import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';

describe('健康检查 API', () => {
  it('健康检查接口返回统一 JSON 和 requestId 响应头', async () => {
    const app = createApp();
    const response = await app.inject({ method: 'GET', path: '/api/v1/health', headers: { 'x-request-id': 'req_integration' } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['x-request-id'], 'req_integration');
    assert.equal((response.body as { status: string }).status, 'OK');
  });

  it('不存在的接口返回统一错误响应', async () => {
    const app = createApp();
    const response = await app.inject({ method: 'GET', path: '/api/v1/not-exists', headers: { 'x-request-id': 'req_404' } });
    assert.equal(response.statusCode, 404);
    const body = response.body as { errorCode: string; requestId: string };
    assert.equal(body.errorCode, 'RESOURCE_NOT_FOUND');
    assert.equal(body.requestId, 'req_404');
  });
});

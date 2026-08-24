import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  PolicyAuthorityProcessClientV1,
  resolveProductionPolicyAuthorityProcessConfig,
} from './policy-authority-process.js';

test('Policy Authority 生产进程配置缺失时失败关闭', () => {
  assert.throws(
    () => resolveProductionPolicyAuthorityProcessConfig({ NODE_ENV: 'production' }),
    /GCAC_POLICY_AUTHORITY_EXECUTABLE_PATH|失败关闭/,
  );
});

test('Policy Authority IPC 客户端通过独立子进程完成握手和健康检查', async () => {
  const fixture = resolve(process.cwd(), 'dist/modules/agents/security/fixtures/policy-authority-ipc.fixture.js');
  const client = new PolicyAuthorityProcessClientV1({
    executablePath: process.execPath,
    workingDirectory: process.cwd(),
    args: [fixture],
    environment: { NODE_ENV: 'test' },
    startupTimeoutMs: 2_000,
    requestTimeoutMs: 2_000,
  });

  try {
    assert.deepEqual(await client.health(), {
      serviceVersion: 'gcac.agent-security/v1',
      authorityId: 'authority-fixture',
      activeKeyId: 'key-fixture',
      keySetIssuedAt: '2026-08-11T00:00:00.000Z',
    });
  } finally {
    await client.close();
  }
});

test('Policy Authority IPC 响应方法不匹配时失败关闭', async () => {
  const fixture = resolve(process.cwd(), 'dist/modules/agents/security/fixtures/policy-authority-ipc.fixture.js');
  const client = new PolicyAuthorityProcessClientV1({
    executablePath: process.execPath,
    workingDirectory: process.cwd(),
    args: [fixture, 'wrong-method'],
    environment: { NODE_ENV: 'test' },
    startupTimeoutMs: 2_000,
    requestTimeoutMs: 2_000,
  });

  try {
    await assert.rejects(() => client.health(), /method 不匹配/);
    assert.equal((client as unknown as { child?: unknown }).child, undefined);
  } finally {
    await client.close();
  }
});

test('Policy Authority IPC health 版本不匹配时失败关闭', async () => {
  const fixture = resolve(process.cwd(), 'dist/modules/agents/security/fixtures/policy-authority-ipc.fixture.js');
  const client = new PolicyAuthorityProcessClientV1({
    executablePath: process.execPath,
    workingDirectory: process.cwd(),
    args: [fixture, 'wrong-health-version'],
    environment: { NODE_ENV: 'test' },
    startupTimeoutMs: 2_000,
    requestTimeoutMs: 2_000,
  });

  try {
    await assert.rejects(() => client.health(), /health 响应字段不完整/);
    assert.equal((client as unknown as { child?: unknown }).child, undefined);
  } finally {
    await client.close();
  }
});

test('Policy Authority IPC 握手缺少健康身份字段时失败关闭', async () => {
  const fixture = resolve(process.cwd(), 'dist/modules/agents/security/fixtures/policy-authority-ipc.fixture.js');
  const client = new PolicyAuthorityProcessClientV1({
    executablePath: process.execPath,
    workingDirectory: process.cwd(),
    args: [fixture, 'incomplete-hello'],
    environment: { NODE_ENV: 'test' },
    startupTimeoutMs: 2_000,
    requestTimeoutMs: 2_000,
  });

  try {
    await assert.rejects(() => client.health(), /health 响应字段不完整/);
    assert.equal((client as unknown as { child?: unknown }).child, undefined);
  } finally {
    await client.close();
  }
});

test('Policy Authority IPC 握手 authorityId 必须匹配生产配置', async () => {
  const fixture = resolve(process.cwd(), 'dist/modules/agents/security/fixtures/policy-authority-ipc.fixture.js');
  const client = new PolicyAuthorityProcessClientV1({
    executablePath: process.execPath,
    workingDirectory: process.cwd(),
    args: [fixture],
    environment: { NODE_ENV: 'production', GCAC_POLICY_AUTHORITY_ID: 'authority-expected' },
    startupTimeoutMs: 2_000,
    requestTimeoutMs: 2_000,
  });

  try {
    await assert.rejects(() => client.health(), /身份不匹配/);
    assert.equal((client as unknown as { child?: unknown }).child, undefined);
  } finally {
    await client.close();
  }
});

test('Policy Authority IPC 请求超时后回收子进程并失败关闭', async () => {
  const fixture = resolve(process.cwd(), 'dist/modules/agents/security/fixtures/policy-authority-ipc.fixture.js');
  const client = new PolicyAuthorityProcessClientV1({
    executablePath: process.execPath,
    workingDirectory: process.cwd(),
    args: [fixture, 'timeout'],
    environment: { NODE_ENV: 'test' },
    startupTimeoutMs: 2_000,
    requestTimeoutMs: 50,
  });

  try {
    await assert.rejects(() => client.health(), /超时/);
    assert.equal((client as unknown as { child?: unknown }).child, undefined);
  } finally {
    await client.close();
  }
});

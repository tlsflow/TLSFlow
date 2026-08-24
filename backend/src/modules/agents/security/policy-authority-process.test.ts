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

test('Policy Authority 宿主 IPC 配置只传递签名密钥文件路径，不携带私钥 JSON', () => {
  const environment = {
    NODE_ENV: 'production',
    GCAC_POLICY_AUTHORITY_EXECUTABLE_PATH: process.execPath,
    GCAC_POLICY_AUTHORITY_WORKING_DIRECTORY: process.cwd(),
    GCAC_POLICY_AUTHORITY_ARGS_JSON: '[]',
    GCAC_POLICY_AUTHORITY_ROOT_KEY_ID: 'root-key-1',
    GCAC_POLICY_AUTHORITY_ID: 'authority-1',
    GCAC_POLICY_AUTHORITY_ROOT_PUBLIC_KEY_PEM: 'public-key',
    GCAC_POLICY_AUTHORITY_ROOT_FINGERPRINT_SHA256: 'a'.repeat(64),
    GCAC_POLICY_AUTHORITY_BOOTSTRAP_JSON: '{}',
    GCAC_POLICY_AUTHORITY_KEYSET_JSON: '{}',
    GCAC_POLICY_AUTHORITY_SIGNING_KEYS_FILE: process.execPath,
    GCAC_POLICY_AUTHORITY_POLICY_BUNDLE_JSON: '{}',
    GCAC_POLICY_AUTHORITY_STATE_FILE: resolve(process.cwd(), 'data/runtime/policy-authority-state.json'),
  };
  const config = resolveProductionPolicyAuthorityProcessConfig(environment);
  assert.equal(config.environment.GCAC_POLICY_AUTHORITY_SIGNING_KEYS_FILE, environment.GCAC_POLICY_AUTHORITY_SIGNING_KEYS_FILE);
  assert.equal('GCAC_POLICY_AUTHORITY_SIGNING_KEYS_JSON' in config.environment, false);
  assert.throws(
    () => resolveProductionPolicyAuthorityProcessConfig({ ...environment, GCAC_POLICY_AUTHORITY_SIGNING_KEYS_JSON: '{"key":"private"}' }),
    /禁止携带.*私钥/,
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

test('Policy Authority IPC provisioning 响应材料不完整时失败关闭', async () => {
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
    await assert.rejects(() => client.provisionAgentPlan({} as never), /provisioning 响应不完整/);
  } finally {
    await client.close();
  }
});

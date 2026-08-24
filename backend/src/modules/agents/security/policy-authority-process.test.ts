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

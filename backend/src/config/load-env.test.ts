import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { loadEnvFile, resolveEnvFilePath } from './load-env.js';

const sandboxes: string[] = [];

describe('loadEnvFile', () => {
  afterEach(() => {
    while (sandboxes.length > 0) {
      cleanupSandbox(sandboxes.pop()!);
    }
  });

  it('从仓库根目录启动时回退读取 backend/.env', () => {
    const sandbox = createSandbox();
    const backendRoot = join(sandbox, 'backend');
    mkdirSync(backendRoot, { recursive: true });
    writeFileSync(join(backendRoot, '.env'), 'GCAC_SECRET_KEK=backend-kek\n', 'utf8');

    const env: NodeJS.ProcessEnv = {};
    loadEnvFile(sandbox, env, backendRoot);

    assert.equal(resolveEnvFilePath(sandbox, backendRoot), join(backendRoot, '.env'));
    assert.equal(env.GCAC_SECRET_KEK, 'backend-kek');
  });

  it('当前目录存在 .env 时保持当前目录优先级', () => {
    const sandbox = createSandbox();
    const backendRoot = join(sandbox, 'backend');
    mkdirSync(backendRoot, { recursive: true });
    writeFileSync(join(sandbox, '.env'), 'GCAC_SECRET_KEK=root-kek\n', 'utf8');
    writeFileSync(join(backendRoot, '.env'), 'GCAC_SECRET_KEK=backend-kek\n', 'utf8');

    const env: NodeJS.ProcessEnv = {};
    loadEnvFile(sandbox, env, backendRoot);

    assert.equal(resolveEnvFilePath(sandbox, backendRoot), join(sandbox, '.env'));
    assert.equal(env.GCAC_SECRET_KEK, 'root-kek');
  });

  it('不会覆盖进程里已经存在的环境变量', () => {
    const sandbox = createSandbox();
    const backendRoot = join(sandbox, 'backend');
    mkdirSync(backendRoot, { recursive: true });
    writeFileSync(join(backendRoot, '.env'), 'GCAC_TOKEN_SECRET=file-secret\n', 'utf8');

    const env: NodeJS.ProcessEnv = { GCAC_TOKEN_SECRET: 'runtime-secret' };
    loadEnvFile(sandbox, env, backendRoot);

    assert.equal(env.GCAC_TOKEN_SECRET, 'runtime-secret');
  });
});

function createSandbox(): string {
  const sandbox = mkdtempSync(join(tmpdir(), 'gcac-load-env-'));
  sandboxes.push(sandbox);
  return sandbox;
}

function cleanupSandbox(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

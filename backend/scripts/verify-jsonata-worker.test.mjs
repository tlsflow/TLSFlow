import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertJsonataWorkerArtifact, jsonataWorkerRelativePath } from './verify-jsonata-worker.mjs';

test('JSONata Worker 编译产物校验拒绝缺失文件并接受构建产物', () => {
  const root = mkdtempSync(join(tmpdir(), 'gcac-jsonata-worker-'));
  try {
    assert.throws(() => assertJsonataWorkerArtifact(root), /JSONata Worker 编译产物缺失/);
    const artifact = join(root, jsonataWorkerRelativePath);
    mkdirSync(join(root, 'dist/modules/workflow-templates/domain'), { recursive: true });
    writeFileSync(artifact, 'compiled worker', 'utf8');
    assert.equal(assertJsonataWorkerArtifact(root), artifact);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { copyRuntimeResources, runtimeResourceMappings } from './copy-runtime-resources.mjs';

test('构建资源装配会复制生产资源及非 TypeScript 插件运行时', () => {
  const backendRoot = mkdtempSync(join(tmpdir(), 'gcac-runtime-resources-'));
  try {
    for (const [sourceRelativePath] of runtimeResourceMappings) {
      const sourcePath = resolve(backendRoot, sourceRelativePath);
      mkdirSync(sourcePath, { recursive: true });
      writeFileSync(join(sourcePath, 'sentinel.txt'), sourceRelativePath, 'utf8');
    }

    const destinations = copyRuntimeResources(backendRoot);

    assert.equal(destinations.length, runtimeResourceMappings.length);
    for (const [, destinationRelativePath] of runtimeResourceMappings) {
      const destinationPath = resolve(backendRoot, destinationRelativePath);
      assert.equal(existsSync(join(destinationPath, 'sentinel.txt')), true);
      assert.equal(readFileSync(join(destinationPath, 'sentinel.txt'), 'utf8').length > 0, true);
    }
  } finally {
    rmSync(backendRoot, { recursive: true, force: true });
  }
});

test('资源装配支持独立输出目录，不触碰共享 dist', () => {
  const backendRoot = mkdtempSync(join(tmpdir(), 'gcac-runtime-resources-isolated-'));
  const outputRoot = join(backendRoot, 'isolated-dist');
  try {
    for (const [sourceRelativePath] of runtimeResourceMappings) {
      const sourcePath = resolve(backendRoot, sourceRelativePath);
      mkdirSync(sourcePath, { recursive: true });
      writeFileSync(join(sourcePath, 'sentinel.txt'), sourceRelativePath, 'utf8');
    }

    copyRuntimeResources(backendRoot, outputRoot);

    assert.equal(existsSync(resolve(backendRoot, 'dist')), false);
    for (const [, destinationRelativePath] of runtimeResourceMappings) {
      const relativeDestination = destinationRelativePath.replace(/^dist[\\/]/, '');
      assert.equal(existsSync(join(outputRoot, relativeDestination, 'sentinel.txt')), true);
    }
  } finally {
    rmSync(backendRoot, { recursive: true, force: true });
  }
});

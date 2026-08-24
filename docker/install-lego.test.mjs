import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveLegoAsset } from './install-lego.mjs';

const manifest = JSON.parse(readFileSync(new URL('./versions.json', import.meta.url), 'utf8'));

test('lego 清单固定发布矩阵的 Linux 资产与 SHA-256', () => {
  assert.deepEqual(resolveLegoAsset(manifest, 'amd64'), {
    version: '5.3.1',
    file: 'lego_v5.3.1_linux_amd64.tar.gz',
    sha256: 'b3c71b122ee1947eacfe0b809b955647f6377239fe4bfc49f73b1a091ae1252a',
  });
  assert.deepEqual(resolveLegoAsset(manifest, 'arm64'), {
    version: '5.3.1',
    file: 'lego_v5.3.1_linux_arm64.tar.gz',
    sha256: '58db563a2b97c2259516fa9910b4a9e1634a0737723d0381a65af1bf93a4b433',
  });
});

test('lego 清单拒绝发布矩阵外的目标架构', () => {
  assert.throws(() => resolveLegoAsset(manifest, '386'), /不支持的 lego Docker 目标架构/);
});

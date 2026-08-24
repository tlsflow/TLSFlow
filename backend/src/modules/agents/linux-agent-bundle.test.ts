import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
  buildLinuxAgentBundleTarGz,
  getLinuxAgentBundleFiles,
  getLinuxAgentBundleManifest,
} from './application/linux-agent-bundle.js';

function listTarEntries(buffer: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const rawName = header.subarray(0, 100);
    const name = rawName.subarray(0, rawName.indexOf(0) >= 0 ? rawName.indexOf(0) : rawName.length).toString('utf8');
    const sizeText = header.subarray(124, 136).toString('utf8').replace(/\0.*$/u, '').trim();
    const size = Number.parseInt(sizeText || '0', 8);
    names.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

describe('Linux Agent bundle', () => {
  it('bundle 文件清单必须包含 nginx helper', () => {
    const files = getLinuxAgentBundleFiles();
    const paths = files.map((item) => item.path);
    assert.equal(paths.includes('linux/gcac-nginx-helper.sh'), true);

    const manifest = getLinuxAgentBundleManifest();
    const manifestPaths = manifest.items.map((item) => item.path);
    assert.equal(manifestPaths.includes('linux/gcac-nginx-helper.sh'), true);
  });

  it('bundle tar.gz 必须实际包含 nginx helper 文件', () => {
    const archive = buildLinuxAgentBundleTarGz();
    const tar = gunzipSync(archive);
    const entries = listTarEntries(tar);
    assert.equal(entries.includes('linux/gcac-nginx-helper.sh'), true);
  });
});

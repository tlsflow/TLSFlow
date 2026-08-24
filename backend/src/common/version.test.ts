import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { GCAC_VERSION, assertPluginGcacCompatibility, compareSemVer, normalizeMinimumGcacVersion } from './version.js';

describe('GCAC 版本', () => {
  it('读取根版本文件', () => {
    const expected = readFileSync(new URL('../../../version', import.meta.url), 'utf8').trim();
    assert.equal(GCAC_VERSION, expected);
  });

  it('按照 SemVer 规则比较版本', () => {
    assert.equal(compareSemVer('1.2.3', '1.2.3'), 0);
    assert.equal(compareSemVer('1.2.4', '1.2.3'), 1);
    assert.equal(compareSemVer('1.2.3-beta.2', '1.2.3-beta.10'), -1);
    assert.equal(compareSemVer('1.2.3', '1.2.3-rc.1'), 1);
  });

  it('兼容缺少最低版本字段的历史插件', () => {
    assert.equal(normalizeMinimumGcacVersion(undefined), '0.0.0');
    assert.doesNotThrow(() => assertPluginGcacCompatibility('legacy-plugin', undefined));
  });

  it('拒绝要求更高 GCAC 版本的插件', () => {
    assert.throws(
      () => assertPluginGcacCompatibility('future-plugin', '999.0.0'),
      /当前版本不兼容/,
    );
  });
});

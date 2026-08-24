import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { GCAC_VERSION, assertPluginGcacCompatibility, compareSemVer, evaluatePluginGcacCompatibility, isSemVerRange, normalizeMinimumGcacVersion, satisfiesSemVerRange } from './version.js';

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

  it('为外部市场提供可复用的宿主版本比较结果', () => {
    assert.deepEqual(evaluatePluginGcacCompatibility(undefined), {
      compatible: true,
      currentGcacVersion: GCAC_VERSION,
      minGcacVersion: '0.0.0',
    });
    const result = evaluatePluginGcacCompatibility('999.0.0');
    assert.equal(result.compatible, false);
    assert.equal(result.currentGcacVersion, GCAC_VERSION);
    assert.equal(result.minGcacVersion, '999.0.0');
  });

  it('按比较子句评估能力级目标产品版本范围', () => {
    assert.equal(isSemVerRange('>=2.11.0 <3.0.0'), true);
    assert.equal(satisfiesSemVerRange('2.11.0', '>=2.11.0 <3.0.0'), true);
    assert.equal(satisfiesSemVerRange('3.0.0', '>=2.11.0 <3.0.0'), false);
    assert.equal(isSemVerRange('2.11'), false);
  });
});

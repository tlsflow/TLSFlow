import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { scanSuspectedMojibake } from './check-utf8-mojibake.mjs';

function withFixture(files, run) {
  const root = mkdtempSync(join(tmpdir(), 'gcac-utf8-mojibake-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = join(root, name);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('编码门禁能识别多类疑似乱码，而非绑定具体业务字符串', () => {
  withFixture({
    'bad.ts': "const summary = '鍒涘缓新的资源';\nconst damaged = '用户\uE234信息';\n",
    'bad.go': 'package fixture\nvar message = "PFX ????????????"\nvar binding = "?? IIS Binding ??"\nvar detail = "閻庣數鍘 闁告帗绋"\n',
  }, (root) => {
    const findings = scanSuspectedMojibake(root, ['bad.ts', 'bad.go']);
    const rules = new Set(findings.map((item) => item.rule));
    assert.ok(rules.has('CJK_MOJIBAKE'));
    assert.ok(rules.has('PRIVATE_USE_CHARACTER'));
    assert.ok(rules.has('QUESTION_MARK_PLACEHOLDER'));
    assert.ok(rules.has('DOUBLE_MOJIBAKE'));
    assert.equal(findings.filter((item) => item.rule === 'QUESTION_MARK_PLACEHOLDER').length, 2);
  });
});

test('编码门禁不误报正常 UTF-8 中文和代码问号操作符', () => {
  withFixture({
    'good.ts': "const summary = '创建用户并查询身份源';\nconst value = input ?? fallback;\nconst nested = first ?? second ?? 'default';\nconst question = '证书是否有效？';\n",
    'good.go': 'package fixture\nvar message = "PFX 检查未返回证书内容"\n',
  }, (root) => {
    assert.deepEqual(scanSuspectedMojibake(root, ['good.ts', 'good.go']), []);
  });
});

test('默认目标覆盖前后端、全部现役 Agent 和治理脚本', async () => {
  const { defaultScanTargets } = await import('./check-utf8-mojibake.mjs');
  assert.deepEqual(defaultScanTargets, [
    'backend/src',
    'web/src',
    'agents/windows-go-full-agent',
    'agents/linux-go-full-agent',
    'agents/windows-compat-full-agent',
    'scripts',
  ]);
});

test('编码门禁拒绝不是有效 UTF-8 的文本文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'gcac-invalid-utf8-'));
  try {
    writeFileSync(join(root, 'invalid.ts'), Buffer.from([0xc3, 0x28]));
    const findings = scanSuspectedMojibake(root, ['invalid.ts']);
    assert.equal(findings[0]?.rule, 'INVALID_UTF8');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

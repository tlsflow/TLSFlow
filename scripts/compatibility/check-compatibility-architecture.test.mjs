import assert from 'node:assert/strict';
import test from 'node:test';

import { compareWithBaseline, scanSourceText } from './check-compatibility-architecture.mjs';

test('已登记分派不应被重复报告', () => {
  const finding = {
    rule: 'platform-selector-expression',
    path: 'backend/src/modules/plugins/application/deployment-capability.resolver.ts',
    line: 10,
    excerpt: "if (input.osType === 'WINDOWS') return windowsCommand",
    fingerprint: 'known-fingerprint',
  };
  const violations = compareWithBaseline([finding], {
    version: 1,
    entries: [{ rule: finding.rule, path: finding.path, fingerprint: finding.fingerprint }],
  });
  assert.deepEqual(violations, []);
});

test('新增平台分派必须失败', () => {
  const finding = {
    rule: 'distribution-conditional',
    path: 'agents/linux-go-full-agent/internal/handler.go',
    line: 20,
    excerpt: 'if distro == "ubuntu" {',
    fingerprint: 'new-fingerprint',
  };
  const violations = compareWithBaseline([finding], { version: 1, entries: [] });
  assert.deepEqual(violations, [finding]);
});

test('同一已知分派的新增副本必须失败', () => {
  const finding = {
    rule: 'platform-selector-expression',
    path: 'backend/src/modules/plugins/application/deployment-capability.resolver.ts',
    line: 10,
    excerpt: "if (input.osType === 'WINDOWS') return windowsCommand",
    fingerprint: 'known-fingerprint',
  };
  const violations = compareWithBaseline([finding, { ...finding, line: 30 }], {
    version: 1,
    entries: [{ rule: finding.rule, path: finding.path, fingerprint: finding.fingerprint, count: 1 }],
  });
  assert.deepEqual(violations, [{ ...finding, line: 30 }]);
});

test('Resolver 中按 Agent 产品线分派必须被识别', () => {
  const findings = scanSourceText(
    'backend/src/modules/plugins/application/deployment-capability.resolver.ts',
    "if (request.productLine === 'windows-modern') return windowsAdapter;",
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.rule, 'platform-selector-expression');
});

test('C# Compatibility Agent 中按产品线分派必须被识别', () => {
  const findings = scanSourceText(
    'agents/windows-compat-full-agent/src/AgentRuntime.cs',
    'if (request.productLine == "windows-compatibility") return compatibilityHandler;',
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.rule, 'platform-selector-expression');
});

test('合法的 Registry 注册和 Capability 约束不得被误报', () => {
  const findings = scanSourceText(
    'backend/src/modules/plugins/canonical-plugin-id/canonical-plugin-id.registry.ts',
    [
      "registry.register(parseAdapterManifest(manifest));",
      "const result = matcher.matchRequirement(manifest.requirements, declarations);",
      "return result.status === 'matched';",
    ].join('\n'),
  );
  assert.deepEqual(findings, []);
});

test('产品版本判空不得被误报为版本分派', () => {
  const findings = scanSourceText(
    'agents/windows-compat-full-agent/src/CapabilityCollector.cs',
    'if (!TextUtility.IsBlank(tomcatVersion)) detail["version"] = tomcatVersion;',
  );
  assert.deepEqual(findings, []);
});

test('产品版本比较仍必须被识别', () => {
  const findings = scanSourceText(
    'agents/windows-compat-full-agent/src/CapabilityCollector.cs',
    'if (tomcatVersion >= "8.5") return TomcatCompatibilityMode.Modern;',
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.rule, 'product-version-conditional');
});

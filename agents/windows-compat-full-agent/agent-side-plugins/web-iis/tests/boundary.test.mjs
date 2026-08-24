import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testsDirectory, '../../../../..');
const sideSource = readFileSync(join(testsDirectory, '..', 'main.go'), 'utf8');
const manifest = JSON.parse(readFileSync(join(testsDirectory, '..', 'manifest.json'), 'utf8'));
const runnerSource = readFileSync(join(root, 'backend', 'src', 'modules', 'plugins', 'builtin-plugins', 'web-iis', 'runtime', 'index.js'), 'utf8');

test('IIS 专用逻辑只存在于独立 Go Agent-side Plugin 进程', () => {
  assert.match(sideSource, /windows-runtime-discovery\.exe/);
  assert.equal(manifest.runtime.kind, 'GO_EXECUTABLE');
  assert.doesNotMatch(JSON.stringify(manifest), /DOTNET|C#|csharp|System\.Web/u);
  assert.doesNotMatch(runnerSource, /Microsoft\.Web\.Administration/);
  assert.doesNotMatch(runnerSource, /node:child_process|process\.stdin|process\.stdout/);
  for (const directory of [
    join(root, 'agents', 'windows-compat-full-agent'),
  ]) {
    for (const path of codeFiles(directory)) {
      if (path.includes('windows-runtime-discovery') || path.endsWith('windows_runtime_iis.go')) continue;
      const source = readFileSync(path, 'utf8');
      assert.doesNotMatch(source, /Microsoft\.Web\.Administration|ServerManager/);
    }
  }
});

function codeFiles(directory) {
  if (!statSync(directory).isDirectory()) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...codeFiles(path));
    else if (/\.(go|csproj|xml)$/.test(entry.name)) files.push(path);
  }
  return files;
}

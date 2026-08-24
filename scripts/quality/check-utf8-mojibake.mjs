import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');

export const defaultScanTargets = [
  'backend/src',
  'web/src',
  'agents/windows-go-full-agent',
  'agents/linux-go-full-agent',
  'agents/windows-compat-full-agent',
  'scripts',
];

const textExtensions = new Set([
  '.cjs', '.cs', '.go', '.js', '.json', '.md', '.mjs', '.ps1', '.sh', '.sql', '.ts', '.tsx', '.vue', '.xml', '.yaml', '.yml',
]);
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'release', 'vendor']);
const ignoredFiles = new Set(['check-utf8-mojibake.mjs', 'check-utf8-mojibake.test.mjs']);

// 这些片段来自常见的“UTF-8 字节被按 GBK 解码”结果，不绑定任何业务文案。
const cjkMojibakeFragments = /鐧诲|澶栭|韬|鑾峰|鍙|閫€鍑|褰撳|鏉冮|鍒涘|鏌ヨ|瀹(?:€|℃)|淇|鐢ㄦ|鍒楄|鍒嗛|瑙掕|绛栫|娴嬭|鍚屾|缁勮|鏄犲|缂哄|璇佷|涓嶅/;
const doubleMojibakeMarkers = /[閻闁濠濞鐎鈧绲顕]/g;
const latinMojibake = /(?:[ÃÂ][\u0080-\u00bf]|â(?:€|€™|€œ|€œ|€“|€”|€¦)|ðŸ)/;
const questionMarkRun = /\?{4,}/;
const quotedString = /(["'])(?:\\.|(?!\1)[^\\\r\n])*\1/g;

export function scanSuspectedMojibake(root = repositoryRoot, targets = defaultScanTargets) {
  const findings = [];
  for (const target of targets) {
    const absoluteTarget = resolve(root, target);
    for (const file of collectTextFiles(absoluteTarget)) {
      findings.push(...scanFile(root, file));
    }
  }
  return findings;
}

function collectTextFiles(target) {
  const stats = statSync(target, { throwIfNoEntry: false });
  if (!stats) return [];
  if (stats.isFile()) return textExtensions.has(extname(target).toLowerCase()) ? [target] : [];
  if (!stats.isDirectory()) return [];

  const files = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    if (entry.isFile() && ignoredFiles.has(entry.name)) continue;
    files.push(...collectTextFiles(resolve(target, entry.name)));
  }
  return files;
}

function scanFile(root, file) {
  const bytes = readFileSync(file);
  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return [finding(root, file, 1, 1, 'INVALID_UTF8', '文件不是有效的 UTF-8 文本', '')];
  }

  const findings = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const checks = [
      ['REPLACEMENT_CHARACTER', /\uFFFD/, '包含 Unicode 替换字符'],
      ['PRIVATE_USE_CHARACTER', /[\uE000-\uF8FF]/, '包含转码时常见的 Unicode 私用区字符'],
      ['LATIN_MOJIBAKE', latinMojibake, '包含 UTF-8/Latin-1 疑似转码片段'],
      ['CJK_MOJIBAKE', cjkMojibakeFragments, '包含 UTF-8/GBK 疑似转码片段'],
    ];
    for (const [rule, pattern, message] of checks) {
      const match = pattern.exec(line);
      if (match) findings.push(finding(root, file, index + 1, match.index + 1, rule, message, line));
    }

    const questionMarkMatch = findQuestionMarkPlaceholder(line, extname(file).toLowerCase() === '.go');
    if (questionMarkMatch) {
      findings.push(finding(root, file, index + 1, questionMarkMatch.index + 1, 'QUESTION_MARK_PLACEHOLDER', '包含成组问号占位文本', line));
    }

    const markers = [...line.matchAll(doubleMojibakeMarkers)];
    if (markers.length >= 2) {
      findings.push(finding(root, file, index + 1, markers[0].index + 1, 'DOUBLE_MOJIBAKE', '包含疑似二次转码字符组合', line));
    }
  }
  return findings;
}

function findQuestionMarkPlaceholder(line, checkSeparatedGroups) {
  const run = questionMarkRun.exec(line);
  if (run) return run;
  if (!checkSeparatedGroups) return undefined;
  for (const literal of line.matchAll(quotedString)) {
    const groups = [...literal[0].matchAll(/\?{2,}/g)];
    if (groups.length >= 2) {
      return { index: (literal.index ?? 0) + (groups[0].index ?? 0), 0: groups[0][0] };
    }
  }
  return undefined;
}

function finding(root, file, line, column, rule, message, excerpt) {
  return {
    path: relative(root, file).replaceAll('\\', '/'),
    line,
    column,
    rule,
    message,
    excerpt: excerpt.trim().slice(0, 180),
  };
}

function run() {
  const targets = process.argv.slice(2);
  const findings = scanSuspectedMojibake(repositoryRoot, targets.length > 0 ? targets : defaultScanTargets);
  if (findings.length === 0) {
    console.log(`UTF-8 疑似乱码门禁通过：扫描 ${targets.length || defaultScanTargets.length} 个目标。`);
    return;
  }

  console.error('UTF-8 疑似乱码门禁失败：');
  for (const item of findings) {
    console.error(`- ${item.path}:${item.line}:${item.column} ${item.rule} ${item.message} ${item.excerpt}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();

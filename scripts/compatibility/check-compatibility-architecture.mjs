import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const baselinePath = join(scriptDirectory, 'compatibility-architecture-baseline.json');

const scanRoots = [
  'backend/src',
  'agents/linux-go-full-agent',
  'agents/windows-go-full-agent',
  'agents/windows-compat-full-agent',
  'web/src',
];

const sourceExtensions = new Set(['.cs', '.go', '.js', '.mjs', '.ps1', '.sh', '.ts', '.tsx', '.vue']);
const ignoredPathPatterns = [
  /(?:^|\/)dist(?:\/|$)/,
  /(?:^|\/)node_modules(?:\/|$)/,
  /(?:^|\/)vendor(?:\/|$)/,
  /\.test\.[^.]+$/,
  /\.spec\.[^.]+$/,
  /_test\.go$/,
  /(?:^|\/)i18n(?:\/|$)/,
];

const platformSelectorPattern = /\b(?:osType|os_type|osName|os_name|operatingSystem|runtime\.GOOS|process\.platform|platform|productLine|agentProduct\.productLine|linuxDistribution|distro|distribution|ID_LIKE)\b/i;
const conditionalExpressionPattern = /\b(?:if|else\s+if|switch|case)\b|===|!==|==|!=/i;
const platformValuePattern = /['"`](?:WINDOWS|LINUX|APPLIANCE|NETWORK_DEVICE|WINDOWS_OPENSSH|windows_powershell_service|windows_go_service|windows_compatibility_service|linux_go_systemd|linux_go_sysv|linux_go_openrc|linux_go_runit|windows-modern|windows-compatibility|linux-modern|linux-compatibility|windows|linux|darwin|freebsd)['"`]/i;
const distributionNamePattern = /\b(?:ubuntu|debian|centos|rhel|redhat|fedora|alpine|suse)\b/i;
const productVersionPattern = /\b(?:nginx|apache|httpd|tomcat|iis)[A-Za-z0-9_]*Version\b|\bversion[A-Za-z0-9_]*(?:nginx|apache|httpd|tomcat|iis)\b/i;
const productVersionComparisonPattern = /\b(?:nginx|apache|httpd|tomcat|iis)[A-Za-z0-9_]*Version\b\s*(?:===|!==|==|!=|>=|<=|>|<)|(?:===|!==|==|!=|>=|<=|>|<)\s*\b(?:nginx|apache|httpd|tomcat|iis)[A-Za-z0-9_]*Version\b|\b(?:nginx|apache|httpd|tomcat|iis)[A-Za-z0-9_]*Version\b\s*\.\s*(?:startsWith|endsWith|includes)\s*\(/i;
const productVersionPresenceGuardPattern = /\b(?:TextUtility\.IsBlank|string\.IsNullOrWhiteSpace|String\.IsNullOrWhiteSpace|string\.IsNullOrEmpty|String\.IsNullOrEmpty)\s*\(\s*[A-Za-z0-9_]*Version\b/i;
const productActionPattern = /\b(?:actionType|action\.type|task\.type|payload\["type"\])\b.*\b(?:nginx|apache|tomcat|iis)\b/i;

function normalizePath(path) {
  return path.replaceAll('\\', '/');
}

function normalizeLine(line) {
  return line.trim().replace(/\s+/g, ' ');
}

function fingerprint(rule, path, line) {
  return createHash('sha256')
    .update(`${rule}\n${path}\n${normalizeLine(line)}`)
    .digest('hex')
    .slice(0, 16);
}

function shouldIgnore(path) {
  return ignoredPathPatterns.some((pattern) => pattern.test(path));
}

function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    const repositoryPath = normalizePath(relative(repositoryRoot, absolutePath));
    if (shouldIgnore(repositoryPath)) continue;
    if (entry.isDirectory()) {
      output.push(...collectFiles(absolutePath));
      continue;
    }
    if (sourceExtensions.has(extname(entry.name))) output.push(absolutePath);
  }
  return output;
}

function detectLineFindings(path, line, lineNumber) {
  const findings = [];
  const normalized = normalizeLine(line);
  if (!normalized || normalized.startsWith('//') || normalized.startsWith('#')) return findings;

  if (platformSelectorPattern.test(line) && platformValuePattern.test(line) && conditionalExpressionPattern.test(line)) {
    findings.push(createFinding('platform-selector-expression', path, line, lineNumber));
  }
  if (distributionNamePattern.test(line) && conditionalExpressionPattern.test(line)) {
    findings.push(createFinding('distribution-conditional', path, line, lineNumber));
  }
  if (productVersionPattern.test(line) && conditionalExpressionPattern.test(line) && productVersionComparisonPattern.test(line) && !productVersionPresenceGuardPattern.test(line)) {
    findings.push(createFinding('product-version-conditional', path, line, lineNumber));
  }
  if (productActionPattern.test(line) && conditionalExpressionPattern.test(line)) {
    findings.push(createFinding('agent-product-action-dispatch', path, line, lineNumber));
  }
  return findings;
}

export function scanSourceText(path, source) {
  const normalizedPath = normalizePath(path);
  return source.split(/\r?\n/)
    .flatMap((line, index) => detectLineFindings(normalizedPath, line, index + 1));
}

function createFinding(rule, path, line, lineNumber) {
  return {
    rule,
    path,
    line: lineNumber,
    excerpt: normalizeLine(line),
    fingerprint: fingerprint(rule, path, line),
  };
}

export function scanCompatibilityArchitecture() {
  const findings = [];
  for (const scanRoot of scanRoots) {
    const absoluteRoot = join(repositoryRoot, scanRoot);
    for (const absolutePath of collectFiles(absoluteRoot)) {
      const path = normalizePath(relative(repositoryRoot, absolutePath));
      findings.push(...scanSourceText(path, readFileSync(absolutePath, 'utf8')));
    }
  }
  return findings.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.rule.localeCompare(right.rule));
}

function readBaseline() {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  if (baseline.version !== 1 || !Array.isArray(baseline.entries)) {
    throw new Error('兼容性架构基线格式无效');
  }
  return baseline;
}

function findingKey(finding) {
  return `${finding.rule}:${finding.path}:${finding.fingerprint}`;
}

function printFindings(findings) {
  for (const finding of findings) {
    process.stdout.write(`${finding.rule}\t${finding.path}:${finding.line}\t${finding.fingerprint}\t${finding.excerpt}\n`);
  }
}

export function compareWithBaseline(findings, baseline) {
  const allowedCounts = new Map(
    baseline.entries.map((entry) => [`${entry.rule}:${entry.path}:${entry.fingerprint}`, entry.count ?? 1]),
  );
  const seenCounts = new Map();
  return findings.filter((finding) => {
    const key = findingKey(finding);
    const nextCount = (seenCounts.get(key) ?? 0) + 1;
    seenCounts.set(key, nextCount);
    return nextCount > (allowedCounts.get(key) ?? 0);
  });
}

function printBaselineJson(findings) {
  const grouped = new Map();
  for (const finding of findings) {
    const key = findingKey(finding);
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    grouped.set(key, {
      rule: finding.rule,
      path: finding.path,
      fingerprint: finding.fingerprint,
      count: 1,
    });
  }
  process.stdout.write(`${JSON.stringify({ version: 1, entries: [...grouped.values()] }, null, 2)}\n`);
}

function main() {
  const findings = scanCompatibilityArchitecture();
  if (process.argv.includes('--list')) {
    printFindings(findings);
    return;
  }
  if (process.argv.includes('--baseline-json')) {
    printBaselineJson(findings);
    return;
  }

  const baseline = readBaseline();
  const violations = compareWithBaseline(findings, baseline);
  if (violations.length === 0) {
    process.stdout.write(`兼容性架构守卫通过：扫描 ${findings.length} 个已登记分派点，未发现新增 OS、发行版、产品版本或产品动作硬编码分派。\n`);
    return;
  }

  process.stderr.write('检测到未登记的兼容性硬编码分派。请改为 Fact、Capability、Registry、Adapter 或 Compatibility Profile；不得直接扩充基线绕过评审。\n');
  printFindings(violations);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

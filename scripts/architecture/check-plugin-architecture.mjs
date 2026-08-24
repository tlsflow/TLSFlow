import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const backendRequire = createRequire(join(repositoryRoot, 'backend/package.json'));
const ts = backendRequire('typescript');
const debtPath = join(scriptDirectory, 'plugin-architecture-debt.json');
const scanRoots = ['backend/src', 'web/src', 'agents/windows-go-full-agent', 'agents/linux-go-full-agent', 'agents/windows-compat-full-agent'];
const sourceExtensions = new Set(['.cs', '.go', '.js', '.mjs', '.ts', '.tsx', '.vue']);
const ignoredPatterns = [
  /(?:^|\/)dist(?:\/|$)/,
  /(?:^|\/)node_modules(?:\/|$)/,
  /(?:^|\/)database\/migrations(?:\/|$)/,
  /(?:^|\/)generated(?:\/|$)/,
  /(?:^|\/)i18n(?:\/|$)/,
  /(?:^|\/)builtin-plugins(?:\/|$)/,
  /(?:^|\/)builtin-workflows(?:\/|$)/,
  /(?:^|\/)fixtures(?:\/|$)/,
  /(?:^|\/)tests(?:\/|$)/,
  /\.test\.[^.]+$/,
  /\.spec\.[^.]+$/,
  /_test\.go$/,
];
const productTokens = new Set(['iis', 'nginx', 'apache', 'httpd', 'tomcat', 'citrix', 'netscaler', 'sangfor', 'synology', 'fortinet', 'paloalto']);
const productImplementationPattern = /(?:IIS|Nginx|Apache|Httpd|Tomcat|Citrix|Netscaler|Sangfor|Synology|Fortinet|PaloAlto).*(?:Driver|Executor|Tester|Projector|Provider|Adapter)$/i;
const goProductActionPattern = /["'`](?:windows|linux)\.(?:iis|nginx|apache|httpd|tomcat|citrix|netscaler|sangfor|synology|fortinet|paloalto)\.deploy_certificate["'`]/i;
const goProductActionHandlerPattern = /\b(?:windows|linux)?(?:IIS|Nginx|Apache|Httpd|Tomcat|Citrix|Netscaler|Sangfor|Synology|Fortinet|PaloAlto)\w*ActionHandler\s*\(/i;
const goProductRegistryPattern = /(?:AdapterID\s*:\s*(?:\w+\.)?Product(?:IIS|Nginx|Apache|Httpd|Tomcat|Citrix|Netscaler|Sangfor|Synology|Fortinet|PaloAlto)|ResolveProduct\s*\()/i;
const goProductCapabilityCatalogPattern = /\bCapability(?:IIS|Nginx|Apache|Httpd|Tomcat|Citrix|Netscaler|Sangfor|Synology|Fortinet|PaloAlto)\w*\b/;
const csharpProductHandlerPattern = /\b(?:Iis|Nginx|Apache|Httpd|Tomcat|Citrix|Netscaler|Sangfor|Synology|Fortinet|PaloAlto)\w*(?:DeploymentHandler|Provider|Executor)\s*(?:\(|\{)/i;
const ownerDriverKinds = new Set(['AGENT_NATIVE', 'AGENT_PLUGIN', 'DEVICE_PLUGIN']);
const legacyApiPattern = /^\/api\/v1\/(?:providers(?:\/discovery-runs)?|provider-discovery-results|provider-discovery-result|plugins\/(?:packages|permissions\/approve|enable|disable|execute|executions|step-draft|permission-summary|capabilities))$/;

function normalizePath(path) { return path.replaceAll('\\', '/'); }
function shouldIgnore(path) { return ignoredPatterns.some((pattern) => pattern.test(path)); }
function textOf(node, sourceFile) { return node.getText(sourceFile); }
function stringValue(node) { return ts.isStringLiteralLike(node) ? node.text : undefined; }
function propertyName(node) { return node.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) ? node.name.text : undefined; }
function containsProduct(value) {
  const normalized = String(value).toLowerCase().replaceAll(/[^a-z0-9]+/g, ' ');
  return normalized.split(' ').some((token) => productTokens.has(token));
}
function isImplementationConstructor(node) {
  if (!ts.isNewExpression(node)) return false;
  const name = textOf(node.expression, node.getSourceFile());
  return productImplementationPattern.test(name);
}
function isSelectionNode(node) {
  return ts.isIfStatement(node) || ts.isSwitchStatement(node) || ts.isConditionalExpression(node) || ts.isCaseClause(node);
}
function functionAnchor(node) {
  let current = node;
  while (current) {
    if (ts.isMethodDeclaration(current) || ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
      return current.name && ts.isIdentifier(current.name) ? current.name.text : '<anonymous>';
    }
    if (ts.isClassDeclaration(current) && current.name) return current.name.text;
    current = current.parent;
  }
  return '<module>';
}
function fingerprint(rule, path, anchor, excerpt) {
  return createHash('sha256').update(`${rule}\n${path}\n${anchor}\n${excerpt.replace(/\s+/g, ' ').trim()}`).digest('hex').slice(0, 16);
}
function makeFinding(rule, path, sourceFile, node, message) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const excerpt = textOf(node, sourceFile).split(/\r?\n/, 1)[0].trim().slice(0, 240);
  const anchor = functionAnchor(node);
  return {
    rule,
    path,
    line: position.line + 1,
    column: position.character + 1,
    nodeKind: ts.SyntaxKind[node.kind],
    anchor,
    excerpt,
    message,
    fingerprint: fingerprint(rule, path, anchor, excerpt),
  };
}
function extractVueScript(source) {
  const output = source.split(/\r?\n/).map(() => '');
  for (const match of source.matchAll(/<script(?:\s+setup)?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const content = match[1] ?? '';
    const start = (match.index ?? 0) + match[0].indexOf(content);
    const before = source.slice(0, start).split(/\r?\n/).length - 1;
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => { output[before + index] = line; });
  }
  return output.join('\n');
}
function collectStringLiterals(node) {
  const values = [];
  const visit = (child) => {
    const value = stringValue(child);
    if (value !== undefined) values.push(value);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return values;
}
function containsOwnerSource(node, sourceFile) {
  return Boolean(node) && /\b(?:agentId|deviceAsset|owner|executionLocation|executionLocations)\b/.test(textOf(node, sourceFile));
}
function containsDriverSink(node, sourceFile) {
  if (!node) return false;
  const text = textOf(node, sourceFile);
  return /\bdriverKind\b/.test(text) || [...ownerDriverKinds].some((kind) => text.includes(`'${kind}'`) || text.includes(`"${kind}"`));
}
function selectionCondition(node) {
  if (ts.isIfStatement(node) || ts.isConditionalExpression(node)) return node.expression;
  if (ts.isSwitchStatement(node)) return node.expression;
  return node;
}
function selectionBranches(node) {
  if (ts.isIfStatement(node)) return [node.thenStatement, node.elseStatement].filter(Boolean);
  if (ts.isConditionalExpression(node)) return [node.whenTrue, node.whenFalse];
  if (ts.isSwitchStatement(node)) return [node.caseBlock];
  return [node];
}
function isFrameworkCollectionName(node, sourceFile) {
  return /frameworkTypes?|FrameworkType/.test(textOf(node, sourceFile));
}
function hasFixedFrameworkProducts(node) {
  return collectStringLiterals(node).filter(containsProduct).length >= 2;
}
function frameworkCollectionOwner(node) {
  let current = node.parent;
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current))) current = current.parent;
  return current;
}
function isVendorDispatchTable(node, sourceFile) {
  if (!ts.isObjectLiteralExpression(node)) return false;
  const ownerText = declarationContextText(node, sourceFile);
  if (!/(?:provider|framework|product|adapter|driver|executor|projector|implementation|runtime|template|preset)/i.test(ownerText)) return false;
  const keys = node.properties.map((property) => propertyName(property)).filter(Boolean);
  return keys.filter(containsProduct).length >= 2;
}
function declarationContextText(node, sourceFile) {
  let current = node;
  for (let depth = 0; current && depth < 6; depth += 1, current = current.parent) {
    if (ts.isVariableDeclaration(current) || ts.isPropertyDeclaration(current) || ts.isTypeAliasDeclaration(current)) {
      return textOf(current, sourceFile);
    }
  }
  return textOf(node.parent ?? node, sourceFile);
}
function declarationContextName(node, sourceFile) {
  let current = node;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parent) {
    if (ts.isVariableDeclaration(current) || ts.isPropertyDeclaration(current) || ts.isTypeAliasDeclaration(current)) {
      return textOf(current.name, sourceFile);
    }
  }
  return '';
}
function isProductCatalogArray(node, sourceFile) {
  if (!ts.isArrayLiteralExpression(node) || !hasFixedFrameworkProducts(node)) return false;
  return /(?:provider|framework|product|runtime|template|preset|operation|permission|scope)/i.test(declarationContextName(node, sourceFile));
}
function isProductOperationContract(node, sourceFile) {
  const values = collectStringLiterals(node);
  if (!values.some((value) => containsProduct(value) && /(?:binding|deploy|certificate|install|update|restore|capture)/i.test(value))) return false;
  if (ts.isUnionTypeNode(node)) return /operation/i.test(declarationContextName(node, sourceFile));
  return ts.isArrayLiteralExpression(node) && /(?:operationTypes?|permissions?|scopes?)/i.test(declarationContextName(node, sourceFile));
}
function isProductCapabilityCatalogCall(node, sourceFile) {
  if (!ts.isCallExpression(node) || textOf(node.expression, sourceFile) !== 'definition') return false;
  const key = stringValue(node.arguments[0]);
  return Boolean(key && containsProduct(key) && /builtInCapabilityDefinitions/.test(declarationContextText(node, sourceFile)));
}
function isProductActionAliasTable(node, sourceFile) {
  if (!ts.isNewExpression(node) || textOf(node.expression, sourceFile) !== 'Map') return false;
  const owner = node.parent;
  if (!/(?:alias|action)/i.test(textOf(owner ?? node, sourceFile))) return false;
  return collectStringLiterals(node).some((value) => containsProduct(value) && /deploy|certificate|install|update/i.test(value));
}
function declaredName(node, sourceFile) {
  const owner = frameworkCollectionOwner(node);
  if (ts.isVariableDeclaration(owner) || ts.isTypeAliasDeclaration(owner) || ts.isPropertyDeclaration(owner) || ts.isParameter(owner)) {
    return textOf(owner.name, sourceFile);
  }
  return undefined;
}
function memberReceiverName(node, sourceFile) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  const receiver = textOf(node.expression.expression, sourceFile);
  return receiver.split('.').at(-1);
}
function isFrameworkAllowlist(node, sourceFile, membershipCollections) {
  if (ts.isArrayLiteralExpression(node) || ts.isUnionTypeNode(node)) {
    if (!hasFixedFrameworkProducts(node)) return false;
    const owner = frameworkCollectionOwner(node);
    if (ts.isNewExpression(owner)) return false;
    const name = declaredName(node, sourceFile);
    if (ts.isUnionTypeNode(node)) return Boolean(name && isFrameworkCollectionName(owner ?? node, sourceFile) && !collectStringLiterals(node).includes('string'));
    return Boolean(name && membershipCollections.has(name));
  }
  if (ts.isNewExpression(node)) {
    const constructor = textOf(node.expression, sourceFile);
    const name = declaredName(node, sourceFile);
    return /^(?:Set|Map)$/.test(constructor) && hasFixedFrameworkProducts(node) && Boolean(name && membershipCollections.has(name));
  }
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const method = node.expression.name.text;
  if (!['includes', 'has', 'get'].includes(method)) return false;
  return isFrameworkCollectionName(node.expression.expression, sourceFile);
}
function findGuardedSelection(node, sourceFile, pattern) {
  let current = node.parent;
  while (current && !ts.isSourceFile(current)) {
    const condition = isSelectionNode(current) ? selectionCondition(current) : undefined;
    if (condition && pattern.test(textOf(condition, sourceFile))) return current;
    if (ts.isFunctionLike(current)) return undefined;
    current = current.parent;
  }
  return undefined;
}

export function scanPluginArchitectureSource(path, source) {
  const normalizedPath = normalizePath(path);
  if (normalizedPath.endsWith('.go') || normalizedPath.endsWith('.cs')) return scanGoPluginArchitectureSource(normalizedPath, source);
  const script = normalizedPath.endsWith('.vue') ? extractVueScript(source) : source;
  const kind = normalizedPath.endsWith('.tsx') ? ts.ScriptKind.TSX : normalizedPath.endsWith('.js') || normalizedPath.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(normalizedPath, script, ts.ScriptTarget.Latest, true, kind);
  const findings = [];
  const membershipCollections = new Set();
  const collectMembership = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const argument = node.arguments[0];
      if (['includes', 'has', 'get'].includes(method) && argument && /frameworkTypes?|FrameworkType/.test(textOf(argument, sourceFile))) {
        const receiver = memberReceiverName(node, sourceFile);
        if (receiver) membershipCollections.add(receiver);
      }
    }
    ts.forEachChild(node, collectMembership);
  };
  collectMembership(sourceFile);
  const add = (rule, node, message) => findings.push(makeFinding(rule, normalizedPath, sourceFile, node, message));
  const visit = (node) => {
    if (isImplementationConstructor(node)) add('HOST_VENDOR_DISPATCH', node, '宿主不得构造厂商专用实现');
    if (isVendorDispatchTable(node, sourceFile)) add('HOST_VENDOR_DISPATCH', node, '宿主不得用厂商映射表选择实现');
    if (isProductCatalogArray(node, sourceFile)) add('HOST_VENDOR_DISPATCH', node, '宿主不得维护封闭的产品或运行时目录');
    if (isProductOperationContract(node, sourceFile)) add('HOST_PRODUCT_OPERATION_CONTRACT', node, '插件 Operation 与权限范围必须使用开放标识并由 Agent 能力校验');
    if (isProductCapabilityCatalogCall(node, sourceFile)) add('HOST_PRODUCT_CAPABILITY_CATALOG', node, '产品能力定义必须由插件贡献，宿主只保留通用能力');
    if (isSelectionNode(node)) {
      const values = collectStringLiterals(node);
      const text = textOf(node, sourceFile);
      if (values.some(containsProduct) && /(?:providerType|deviceFamily|frameworkType|pluginId|productId|actionType|\.kind|\.type)/.test(text)) {
        add('HOST_VENDOR_DISPATCH', node, '宿主不得按厂商或产品身份选择实现');
      }
      const condition = selectionCondition(node);
      const branches = selectionBranches(node);
      if (containsOwnerSource(condition, sourceFile) && branches.some((branch) => containsDriverSink(branch, sourceFile))) {
        add('OWNER_DRIVER_SELECTION', node, '目标所有者和执行位置不得决定 DriverKind');
      }
    }
    if (ts.isPropertyAssignment(node) && ['aliases', 'legacyActionType'].includes(propertyName(node) ?? '')) {
      const values = collectStringLiterals(node.initializer);
      if (values.some((value) => containsProduct(value) && /deploy|certificate|install|update/i.test(value))) {
        add('HOST_PRODUCT_ACTION_ALIAS', node, '厂商历史 Action 别名必须由插件包声明');
      }
    }
    if (isProductActionAliasTable(node, sourceFile)) add('HOST_PRODUCT_ACTION_ALIAS', node, '厂商历史 Action 别名必须由插件包声明');
    if (isFrameworkAllowlist(node, sourceFile, membershipCollections)) add('FRAMEWORK_DEPLOYMENT_ALLOWLIST', node, 'Framework 部署准入不得使用固定列表');
    if (ts.isSpreadAssignment(node) && /(?:inputSnapshot|snapshot)/.test(textOf(node.expression, sourceFile))) {
      const guard = findGuardedSelection(node, sourceFile, /actionType\s*!==\s*['"]agent\.atomic_plan\.execute['"]/);
      if (guard) {
        add('RAW_AGENT_ACTION_FORWARD', node, '未知 Agent Action 不得原样转发 Snapshot');
      }
    }
    if (ts.isNewExpression(node) && /Legacy.*Executor(?:Adapter)?$/.test(textOf(node.expression, sourceFile))) {
      const parentText = node.parent ? textOf(node.parent, sourceFile) : '';
      if (/\.register\s*\(|\[/.test(parentText)) add('LEGACY_EXECUTOR_REGISTRATION', node, 'Legacy Executor 不得加入默认生产注册表');
    }
    const literal = stringValue(node);
    if (literal && legacyApiPattern.test(literal) && /^(?:web|scripts)\//.test(normalizedPath)) {
      add('LEGACY_API_NEW_DEPENDENCY', node, '旧 Provider 或 Plugin API 不得新增消费者');
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings.sort((left, right) => left.line - right.line || left.column - right.column || left.rule.localeCompare(right.rule));
}

function scanGoPluginArchitectureSource(path, source) {
  const findings = [];
  const checks = [
    ['HOST_PRODUCT_ACTION_ALIAS', goProductActionPattern, '历史产品 Action 必须在控制面转换为签名 Atomic Plan'],
    ['HOST_VENDOR_DISPATCH', goProductActionHandlerPattern, 'Agent 不得注册产品专用 Action Handler'],
    ['HOST_VENDOR_DISPATCH', goProductRegistryPattern, 'Agent 不得按产品适配器选择执行实现'],
    ['HOST_PRODUCT_CAPABILITY_CATALOG', goProductCapabilityCatalogPattern, 'Agent 宿主不得声明插件拥有的产品 Capability'],
    ['HOST_VENDOR_DISPATCH', csharpProductHandlerPattern, 'Compatibility Agent 不得保留产品直连 Handler'],
  ];
  for (const [rule, pattern, message] of checks) {
    const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
    for (const match of source.matchAll(globalPattern)) {
      const offset = match.index ?? 0;
      const before = source.slice(0, offset);
      const line = before.split(/\r?\n/).length;
      const lineStart = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r')) + 1;
      const excerpt = source.slice(lineStart, source.indexOf('\n', offset) < 0 ? source.length : source.indexOf('\n', offset)).trim().slice(0, 240);
      findings.push({
        rule,
        path,
        line,
        column: offset - lineStart + 1,
        nodeKind: 'GoSourceLine',
        anchor: '<go>',
        excerpt,
        message,
        fingerprint: fingerprint(rule, path, '<go>', excerpt),
      });
    }
  }
  return findings;
}

function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    const repositoryPath = normalizePath(relative(repositoryRoot, absolutePath));
    if (shouldIgnore(repositoryPath)) return [];
    if (entry.isDirectory()) return collectFiles(absolutePath);
    return sourceExtensions.has(extname(entry.name)) ? [absolutePath] : [];
  });
}
export function scanPluginArchitecture(root = repositoryRoot, roots = scanRoots) {
  return roots.flatMap((configuredRoot) => collectFiles(resolve(root, configuredRoot)).flatMap((absolutePath) => {
    const path = normalizePath(relative(root, absolutePath));
    return scanPluginArchitectureSource(path, readFileSync(absolutePath, 'utf8'));
  })).sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.column - right.column || left.rule.localeCompare(right.rule));
}
function debtKey(item) { return `${item.rule}:${normalizePath(item.path)}:${item.anchor}:${item.fingerprint}`; }
export function compareWithDebt(findings, debt, requireZero = false) {
  if (debt.version !== 1 || !Array.isArray(debt.entries)) throw new Error('插件架构债务清单格式无效');
  if (requireZero && debt.entries.length > 0) throw new Error('零债务检查失败：临时架构债务清单仍有条目');
  const allowed = new Set(debt.entries.map((entry) => {
    for (const field of ['rule', 'path', 'anchor', 'fingerprint', 'reason', 'ownerTask', 'removeWhen']) {
      if (!entry[field]) throw new Error(`插件架构债务条目缺少 ${field}：${JSON.stringify(entry)}`);
    }
    return debtKey(entry);
  }));
  return findings.filter((finding) => !allowed.has(debtKey(finding)));
}
function printFindings(findings, stream = process.stdout) {
  for (const finding of findings) stream.write(`${finding.rule} ${finding.path}:${finding.line}:${finding.column} ${finding.message} [${finding.anchor}] ${finding.excerpt}\n`);
}
const findingPresets = {
  'vendor-neutrality': [
    'HOST_VENDOR_DISPATCH',
    'HOST_PRODUCT_ACTION_ALIAS',
    'HOST_PRODUCT_CAPABILITY_CATALOG',
    'HOST_PRODUCT_OPERATION_CONTRACT',
  ],
};
function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function optionValues(name) {
  return process.argv.flatMap((argument, index) => process.argv[index - 1] === name ? [argument] : []);
}
export function filterFindings(findings, {
  preset,
  rules = [],
} = {}) {
  const configuredRules = new Set(rules);
  if (preset) {
    const presetRules = findingPresets[preset];
    if (!presetRules) throw new Error(`未知的规则预设：${preset}`);
    presetRules.forEach((rule) => configuredRules.add(rule));
  }
  if (configuredRules.size === 0) return findings;
  return findings.filter((finding) => configuredRules.has(finding.rule));
}
function main() {
  const configuredRoot = optionValue('--root');
  const configuredScanRoots = process.argv.flatMap((argument, index) => process.argv[index - 1] === '--scan-root' ? [argument] : []);
  const rawFindings = scanPluginArchitecture(configuredRoot ? resolve(configuredRoot) : repositoryRoot, configuredScanRoots.length > 0 ? configuredScanRoots : scanRoots);
  let findings;
  try {
    findings = filterFindings(rawFindings, {
      preset: optionValue('--preset'),
      rules: optionValues('--rule'),
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes('--json')) { process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`); return; }
  if (process.argv.includes('--list')) { printFindings(findings); return; }
  if (process.argv.includes('--raw')) {
    if (findings.length === 0) {
      process.stdout.write(`统一插件架构原始扫描通过：未发现 ${optionValue('--preset') ?? '指定规则'} 违规。\n`);
      return;
    }
    process.stderr.write('统一插件架构原始扫描失败：发现未豁免的规则违规。\n');
    printFindings(findings, process.stderr);
    process.exitCode = 1;
    return;
  }
  const configuredDebtPath = optionValue('--debt');
  const debt = JSON.parse(readFileSync(configuredDebtPath ? resolve(configuredDebtPath) : debtPath, 'utf8'));
  let violations;
  try { violations = compareWithDebt(findings, debt, process.argv.includes('--require-zero')); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; return; }
  if (violations.length === 0) {
    process.stdout.write(`统一插件架构门禁通过：检测到 ${findings.length} 个受治理历史债务点，未发现新增旁路。\n`);
    return;
  }
  process.stderr.write('统一插件架构门禁失败：发现未登记的宿主厂商特例、执行旁路或旧 API 新依赖。\n');
  printFindings(violations, process.stderr);
  process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();

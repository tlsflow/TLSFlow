import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanPluginArchitecture } from './check-plugin-architecture.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const scanRoots = [
  'backend/src/modules/assets',
  'backend/src/modules/deployment-plans',
  'backend/src/modules/devices',
  'backend/src/modules/executions',
  'backend/src/modules/deployment-inputs',
  'web/src/views/assets',
  'web/src/design-system/components',
];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.vue']);
const ignored = [/(?:^|\/)database\/migrations(?:\/|$)/, /(?:^|\/)generated(?:\/|$)/, /\.test\.[^.]+$/, /\.spec\.[^.]+$/];
const forbidden = [
  ['LEGACY_INPUT_SOURCE', /\b(?:asset_ssl|execution_context)\b/g],
  ['LEGACY_DSL_SOURCE', /(?:kind\s*:\s*['"]dsl['"]|source\s*:\s*['"]dsl['"])/g],
  ['LEGACY_BINDING_FIELD', /\.(?:variableBindings|parameterBindings|credentialBindings|secretBindings|connectionBindings|certificateArtifactBindings)\b/g],
  ['INPUT_NAME_GUESS', /['"](?:deviceHost|certificatePath)['"]/g],
  ['SECOND_INPUT_RESOLVER', /new\s+UnifiedDeploymentInputResolver\s*\(/g],
];

function normalizePath(value) { return value.replaceAll('\\', '/'); }
function shouldIgnore(path) { return ignored.some((pattern) => pattern.test(path)); }

export function checkDeploymentInputArchitecture(root = repositoryRoot, roots = scanRoots) {
  const findings = [];
  for (const scanRoot of roots) {
    const absoluteRoot = resolve(root, scanRoot);
    if (!existsSync(absoluteRoot)) continue;
    for (const file of walk(absoluteRoot)) {
      const path = normalizePath(relative(root, file));
      if (shouldIgnore(path)) continue;
      const source = readFileSync(file, 'utf8');
      for (const [rule, pattern] of forbidden) {
        if (rule === 'INPUT_NAME_GUESS' && path === 'backend/src/modules/deployment-inputs/schema/deployment-asset-context.schema.ts') continue;
        if (rule === 'SECOND_INPUT_RESOLVER' && path === 'backend/src/modules/deployment-inputs/application/production-deployment-input-resolver.service.ts') continue;
        for (const match of source.matchAll(pattern)) findings.push(formatFinding(rule, path, source, match.index ?? 0));
      }
    }
  }
  const vendorFindings = scanPluginArchitecture(root, roots)
    .filter((finding) => finding.rule === 'HOST_VENDOR_DISPATCH' || finding.rule === 'FRAMEWORK_DEPLOYMENT_ALLOWLIST' || finding.rule === 'HOST_PRODUCT_ACTION_ALIAS')
    .map((finding) => `${finding.rule} ${finding.path}:${finding.line}:${finding.column} ${finding.excerpt}`);
  return [...findings, ...vendorFindings].sort();
}

function walk(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(path));
    else if (sourceExtensions.has(extname(entry.name))) output.push(path);
  }
  return output;
}

function formatFinding(rule, path, source, index) {
  const before = source.slice(0, index);
  const line = before.split(/\r?\n/).length;
  const column = index - Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
  return `${rule} ${path}:${line}:${column}`;
}

function run() {
  const findings = checkDeploymentInputArchitecture();
  if (findings.length > 0) {
    console.error('部署输入架构守卫失败：');
    findings.forEach((finding) => console.error(`- ${finding}`));
    process.exit(1);
  }
  console.log('部署输入架构守卫通过。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const builtinPluginRoot = 'backend/src/modules/plugins/builtin-plugins';

export function checkBuiltinPluginVersions(root = repositoryRoot, options = {}) {
  const baseRef = options.baseRef ?? resolveBaseRef(root, options.environment ?? process.env);
  const { committedPaths, workingTreePaths } = collectChangedPaths(root, baseRef);
  const committedViolations = findBuiltinPluginVersionViolations({
    changedPaths: committedPaths,
    readCurrentManifest: (manifestPath) => readJsonFile(resolve(root, manifestPath)),
    readBaseManifest: (manifestPath) => readJsonFromGit(root, baseRef, manifestPath),
    readCurrentResource: (resourcePath) => readJsonFile(resolve(root, resourcePath)),
    readBaseResource: (resourcePath) => readJsonFromGit(root, baseRef, resourcePath),
  });
  const workingTreeViolations = findBuiltinPluginVersionViolations({
    changedPaths: workingTreePaths,
    readCurrentManifest: (manifestPath) => readJsonFile(resolve(root, manifestPath)),
    readBaseManifest: (manifestPath) => readJsonFromGit(root, 'HEAD', manifestPath),
    readCurrentResource: (resourcePath) => readJsonFile(resolve(root, resourcePath)),
    readBaseResource: (resourcePath) => readJsonFromGit(root, 'HEAD', resourcePath),
  });
  return uniqueViolations([...committedViolations, ...workingTreeViolations]);
}

export function findBuiltinPluginVersionViolations({
  changedPaths,
  readCurrentManifest,
  readBaseManifest,
  readCurrentResource = () => undefined,
  readBaseResource = () => undefined,
}) {
  const normalizedChangedPaths = new Set(changedPaths.map((path) => path.replaceAll('\\', '/')));
  const pluginDirectories = [...new Set(changedPaths.map(pluginDirectoryFromPath).filter(Boolean))].sort();
  const violations = [];

  for (const pluginDirectory of pluginDirectories) {
    const manifestPath = `${builtinPluginRoot}/${pluginDirectory}/manifest.json`;
    const currentManifest = readCurrentManifest(manifestPath);
    const baseManifest = readBaseManifest(manifestPath);
    if (!currentManifest || !baseManifest) continue;
    const manifestChanged = normalizedChangedPaths.has(manifestPath);
    const pluginId = currentManifest.pluginId ?? baseManifest.pluginId ?? pluginDirectory;
    const pluginVersionIncremented = isSemanticVersionIncrement(currentManifest.version, baseManifest.version);
    if (!pluginVersionIncremented) {
      violations.push({
        kind: 'plugin',
        pluginId,
        pluginDirectory,
        previousVersion: baseManifest.version ?? '(未声明)',
        nextVersion: currentManifest.version ?? '(未声明)',
        manifestPath,
      });
    }

    const workflowPaths = new Set([
      ...Object.values(currentManifest.resources?.workflows ?? {}),
      ...Object.values(baseManifest.resources?.workflows ?? {}),
    ]);
    for (const workflowPath of workflowPaths) {
      const resourcePath = `${builtinPluginRoot}/${pluginDirectory}/${workflowPath}`;
      const resourceChanged = normalizedChangedPaths.has(resourcePath);
      if (!manifestChanged && !resourceChanged) continue;
      const currentWorkflow = readCurrentResource(resourcePath);
      const baseWorkflow = readBaseResource(resourcePath);
      if (!currentWorkflow || !baseWorkflow) continue;
      if (currentWorkflow.metadata?.version !== currentManifest.version) {
        violations.push({
          kind: 'workflow',
          pluginId,
          pluginDirectory,
          workflowName: currentWorkflow.metadata?.name ?? baseWorkflow.metadata?.name ?? workflowPath,
          previousVersion: baseWorkflow.metadata?.version ?? '(未声明)',
          nextVersion: currentWorkflow.metadata?.version ?? '(未声明)',
          expectedPluginVersion: currentManifest.version ?? '(未声明)',
          resourcePath,
          reason: 'PLUGIN_VERSION_MISMATCH',
        });
        continue;
      }
      if (!resourceChanged || !pluginVersionIncremented) continue;
    }
  }

  return violations;
}

function collectChangedPaths(root, baseRef) {
  const committedPaths = baseRef === 'HEAD'
    ? []
    : gitLines(root, ['diff', '--name-only', '--diff-filter=ACMRT', `${baseRef}...HEAD`, '--', builtinPluginRoot]);
  const workingTree = gitLines(root, ['diff', '--name-only', '--diff-filter=ACMRT', 'HEAD', '--', builtinPluginRoot]);
  const untracked = gitLines(root, ['ls-files', '--others', '--exclude-standard', '--', builtinPluginRoot]);
  return {
    committedPaths: [...new Set(committedPaths)].sort(),
    workingTreePaths: [...new Set([...workingTree, ...untracked])].sort(),
  };
}

function uniqueViolations(violations) {
  return [...new Map(violations.map((violation) => [
    `${violation.kind}:${violation.pluginDirectory}:${violation.resourcePath ?? violation.manifestPath}`,
    violation,
  ])).values()];
}

function isSemanticVersionIncrement(nextVersion, previousVersion) {
  if (typeof nextVersion !== 'string' || typeof previousVersion !== 'string') return false;
  return compareSemanticVersions(nextVersion, previousVersion) > 0;
}

function compareSemanticVersions(left, right) {
  const [leftCoreText, leftPreRelease = ''] = left.split('+', 1)[0].split('-', 2);
  const [rightCoreText, rightPreRelease = ''] = right.split('+', 1)[0].split('-', 2);
  const leftCore = leftCoreText.split('.').map(Number);
  const rightCore = rightCoreText.split('.').map(Number);
  if (leftCore.some(Number.isNaN) || rightCore.some(Number.isNaN)) return Number.NaN;
  for (let index = 0; index < 3; index += 1) {
    if ((leftCore[index] ?? 0) !== (rightCore[index] ?? 0)) return (leftCore[index] ?? 0) - (rightCore[index] ?? 0);
  }
  if (!leftPreRelease && !rightPreRelease) return 0;
  if (!leftPreRelease) return 1;
  if (!rightPreRelease) return -1;
  const leftParts = leftPreRelease.split('.');
  const rightParts = rightPreRelease.split('.');
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber;
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function resolveBaseRef(root, environment) {
  const configured = environment.GCAC_GIT_DIFF_BASE
    ?? environment.CI_MERGE_REQUEST_DIFF_BASE_SHA
    ?? readGithubBaseSha(environment.GITHUB_EVENT_PATH)
    ?? validCommit(environment.GITHUB_EVENT_BEFORE);
  if (configured) {
    if (gitRefExists(root, configured)) return configured;
    throw new Error(`Git 差异基线 ${configured} 不存在，请在 CI 中拉取完整比较历史`);
  }

  if (gitRefExists(root, 'origin/main')) {
    const mergeBase = gitText(root, ['merge-base', 'HEAD', 'origin/main']);
    if (mergeBase && mergeBase !== gitText(root, ['rev-parse', 'HEAD'])) return mergeBase;
  }

  if (gitRefExists(root, 'HEAD^')) return 'HEAD^';
  if (environment.CI) throw new Error('CI 缺少可用的 Git 差异基线，请设置 GCAC_GIT_DIFF_BASE 并拉取对应提交');
  return 'HEAD';
}

function readGithubBaseSha(eventPath) {
  if (!eventPath || !existsSync(eventPath)) return undefined;
  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    return validCommit(event.pull_request?.base?.sha ?? event.before);
  } catch {
    return undefined;
  }
}

function validCommit(value) {
  return typeof value === 'string' && value.length > 0 && !/^0+$/.test(value) ? value : undefined;
}

function pluginDirectoryFromPath(path) {
  const normalized = path.replaceAll('\\', '/');
  const prefix = `${builtinPluginRoot}/`;
  if (!normalized.startsWith(prefix)) return undefined;
  const relativePath = normalized.slice(prefix.length);
  const [pluginDirectory, nestedPath] = relativePath.split('/', 2);
  return pluginDirectory && nestedPath ? pluginDirectory : undefined;
}

function readJsonFile(path) {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonFromGit(root, ref, path) {
  try {
    return JSON.parse(gitText(root, ['show', `${ref}:${path}`]));
  } catch {
    return undefined;
  }
}

function gitRefExists(root, ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function gitLines(root, arguments_) {
  const output = gitText(root, arguments_);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function gitText(root, arguments_) {
  return execFileSync('git', arguments_, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function run() {
  const violations = checkBuiltinPluginVersions();
  if (violations.length === 0) {
    console.log('内置插件版本不可变检查通过。');
    return;
  }

  console.error('内置插件或其 Workflow 内容已变化，但插件版本未正确递进：');
  for (const violation of violations) {
    if (violation.kind === 'workflow') {
      if (violation.reason === 'PLUGIN_VERSION_MISMATCH') {
        console.error(`- Workflow ${violation.workflowName}：metadata.version 必须镜像插件版本 ${violation.expectedPluginVersion}，文件 ${violation.resourcePath}`);
        continue;
      }
    }
    if (violation.kind === 'plugin') {
      console.error(`- 插件 ${violation.pluginId} 或其内置 Workflow 内容已变化：Manifest.version 必须从 ${violation.previousVersion} 递进，文件 ${violation.manifestPath}`);
    }
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();

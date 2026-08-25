import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const outputRoot = resolve(process.env.GCAC_AGENT_BUNDLE_OUTPUT ?? join(repositoryRoot, 'build', 'agent-release-bundle'));
const releaseVersion = (await readFile(join(repositoryRoot, 'version'), 'utf8')).trim();
const fullAgentGo = process.env.GCAC_FULL_GO?.trim() || 'go';
const compatibilityGo = process.env.GCAC_COMPAT_GO?.trim() || '';
const runningInDockerBuilder = process.env.GCAC_AGENT_BUNDLE_IN_DOCKER === 'true';
const linuxSource = join(repositoryRoot, 'agents', 'linux-go-full-agent');
const windowsGoSource = join(repositoryRoot, 'agents', 'windows-go-full-agent');
const windowsCompatibilitySource = join(repositoryRoot, 'agents', 'windows-compat-full-agent');
const compatibilityDist = join(windowsCompatibilitySource, 'dist');
const compatibilityArtifacts = [
  'GCAC.WindowsCompatibilityAgent.exe',
  'gcac-agent-updater.exe',
  'plugins/windows-runtime-discovery.exe',
  'web-iis/web-iis-agent-side-plugin.exe',
];

if (!runningInDockerBuilder && (!canRunGo(fullAgentGo, 23) || !(await hasCompatibilityArtifacts()))) {
  run(process.execPath, [join(repositoryRoot, 'docker', 'build-tools', 'build-agent-release-bundle-docker.mjs')], repositoryRoot);
  process.exit(0);
}

if (!outputRoot.startsWith(`${repositoryRoot}${process.platform === 'win32' ? '\\' : '/'}`)) {
  throw new Error(`拒绝写入仓库外部目录：${outputRoot}`);
}
assertFullAgentGo(fullAgentGo);
if (compatibilityGo) assertCompatibilityGo(compatibilityGo);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    const detail = result.error.code === 'ENOENT'
      ? `未找到可执行文件 ${command}`
      : result.error.message;
    throw new Error(`无法执行构建命令：${command} ${args.join(' ')}（${detail}）`);
  }
  if (result.signal) {
    throw new Error(`构建命令被信号终止：${command} ${args.join(' ')}（${result.signal}）`);
  }
  if (result.status !== 0) throw new Error(`构建失败：${command} ${args.join(' ')}`);
}

function assertFullAgentGo(command) {
  const result = spawnSync(command, ['version'], {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) {
    const detail = result.error.code === 'ENOENT'
      ? `未找到可执行文件 ${command}`
      : result.error.message;
    throw new Error(`无法执行 Full Agent 的 Go 工具链：${command}（${detail}）`);
  }
  if (result.status !== 0) {
    throw new Error(`无法读取 Full Agent 的 Go 工具链版本：${command} version`);
  }
  const version = `${result.stdout ?? ''} ${result.stderr ?? ''}`.trim();
  const match = version.match(/\bgo(\d+)\.(\d+)(?:\.\d+)?\b/);
  const minor = match ? Number(match[2]) : 0;
  if (!match || Number(match[1]) !== 1 || minor < 23) {
    throw new Error(`Full Agent 构建需要 Go 1.23.x 或更高版本，当前为 ${version || '未知版本'}。请安装独立工具链后设置 GCAC_FULL_GO=/path/to/go，再重新执行。`);
  }
}

function assertCompatibilityGo(command) {
  const version = readGoVersion(command);
  const match = version.match(/\bgo(\d+)\.(\d+)(?:\.\d+)?\b/);
  if (!match || Number(match[1]) !== 1 || Number(match[2]) !== 20) {
    throw new Error(`Compatibility Agent 构建必须使用 Go 1.20.x，当前为 ${version || '未知版本'}。`);
  }
}

function readGoVersion(command) {
  const result = spawnSync(command, ['version'], {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error || result.status !== 0) return '';
  return `${result.stdout ?? ''} ${result.stderr ?? ''}`.trim();
}

function canRunGo(command, minimumMinor) {
  const version = readGoVersion(command);
  const match = version.match(/\bgo(\d+)\.(\d+)(?:\.\d+)?\b/);
  return Boolean(match && Number(match[1]) === 1 && Number(match[2]) >= minimumMinor);
}

async function hasCompatibilityArtifacts() {
  for (const artifact of compatibilityArtifacts) {
    try {
      await stat(join(compatibilityDist, artifact));
    } catch {
      return false;
    }
  }
  return true;
}

async function copyFile(source, target, mode) {
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target);
  if (mode) {
    const fileStat = await stat(target);
    await writeFile(target, await readFile(target), { mode: mode | (fileStat.mode & 0o777) });
  }
}

async function copyFiles(sourceRoot, targetRoot, files) {
  for (const file of files) {
    await copyFile(join(sourceRoot, file), join(targetRoot, file));
  }
}

const bundleItems = [];
async function recordFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await recordFiles(filePath);
      continue;
    }
    const content = await readFile(filePath);
    bundleItems.push({
      path: relative(outputRoot, filePath).replaceAll('\\', '/'),
      size: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    });
  }
}

if (compatibilityGo) {
  await buildCompatibilityArtifacts();
}

for (const [goArch, bundleArch] of [['amd64', 'amd64'], ['arm64', 'arm64']]) {
  const linuxTarget = join(outputRoot, 'linux', bundleArch);
  await mkdir(linuxTarget, { recursive: true });
  run(fullAgentGo, ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', join(linuxTarget, 'gcac-linux-agent'), '.'], linuxSource, {
    GOOS: 'linux',
    GOARCH: goArch,
    CGO_ENABLED: '0',
  });
  await copyFiles(linuxSource, linuxTarget, [
    'build.sh',
    'service-control.sh',
    'config/agent.config.template.json',
    'linux/gcac-linux-agent.service',
    'linux/upgrade.sh',
    'linux/rollback.sh',
    'release/verify-signature.sh',
    'linux/install-systemd.sh',
    'linux/uninstall-systemd.sh',
    'README.md',
  ]);

  const windowsTarget = join(outputRoot, 'windows', bundleArch, 'full-agent');
  await mkdir(windowsTarget, { recursive: true });
  run(fullAgentGo, ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', join(windowsTarget, 'gcac-agent.exe'), '.'], windowsGoSource, {
    GOOS: 'windows',
    GOARCH: goArch,
    CGO_ENABLED: '0',
  });
  run(fullAgentGo, ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', join(windowsTarget, 'gcac-agent-updater.exe'), './cmd/gcac-agent-updater'], windowsGoSource, {
    GOOS: 'windows',
    GOARCH: goArch,
    CGO_ENABLED: '0',
  });
  await mkdir(join(windowsTarget, 'plugins'), { recursive: true });
  run(fullAgentGo, ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', join(windowsTarget, 'plugins', 'windows-runtime-discovery.exe'), './agent-side-plugins/windows-runtime-discovery'], windowsGoSource, {
    GOOS: 'windows',
    GOARCH: goArch,
    CGO_ENABLED: '0',
  });
  await copyFiles(windowsGoSource, windowsTarget, [
    'config/agent.config.template.json',
    'install-service.ps1',
    'uninstall-service.ps1',
    'service-control.ps1',
    'release/verify-signature.ps1',
    'README.md',
  ]);
}

for (const artifact of compatibilityArtifacts) {
  const source = join(compatibilityDist, artifact);
  try {
    await stat(source);
  } catch {
    const buildHint = process.platform === 'win32'
      ? '在 Windows 上使用 Go 1.20.x 执行 agents/windows-compat-full-agent/build.ps1'
      : '在 Linux/macOS 上准备 Go 1.20.x 后执行 PATH="$GO120_ROOT/bin:$PATH" ./agents/windows-compat-full-agent/build.sh（该结果仅是交叉编译检查）';
    throw new Error(`Compatibility Go 产物缺失：${source}。${buildHint}。`);
  }
}

async function buildCompatibilityArtifacts() {
  await rm(compatibilityDist, { recursive: true, force: true });
  await mkdir(join(compatibilityDist, 'plugins'), { recursive: true });
  await mkdir(join(compatibilityDist, 'web-iis'), { recursive: true });
  const buildEnvironment = { GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' };
  const testTargets = [
    ['.', `/tmp/GCAC.WindowsCompatibilityAgent.tests.${process.pid}.exe`],
    ['./agent-side-plugins/windows-runtime-discovery', `/tmp/windows-runtime-discovery.tests.${process.pid}.exe`],
    ['./agent-side-plugins/web-iis', `/tmp/web-iis-agent-side-plugin.tests.${process.pid}.exe`],
  ];
  for (const [packagePath, testPath] of testTargets) {
    run(compatibilityGo, ['test', '-c', '-o', testPath, packagePath], windowsCompatibilitySource, buildEnvironment);
    const testHash = createHash('sha256').update(await readFile(testPath)).digest('hex');
    console.log(`Compatibility 测试程序通过：${testPath}，SHA256=${testHash}`);
    await rm(testPath, { force: true });
  }
  run(compatibilityGo, ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', join(compatibilityDist, compatibilityArtifacts[0]), '.'], windowsCompatibilitySource, buildEnvironment);
  run(compatibilityGo, ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', join(compatibilityDist, compatibilityArtifacts[1]), './cmd/gcac-agent-updater'], windowsCompatibilitySource, buildEnvironment);
  run(compatibilityGo, ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', join(compatibilityDist, compatibilityArtifacts[2]), './agent-side-plugins/windows-runtime-discovery'], windowsCompatibilitySource, buildEnvironment);
  run(compatibilityGo, ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', join(compatibilityDist, compatibilityArtifacts[3]), './agent-side-plugins/web-iis'], windowsCompatibilitySource, buildEnvironment);
}
const compatibilityTarget = join(outputRoot, 'windows', 'amd64', 'compatibility');
await mkdir(compatibilityTarget, { recursive: true });
for (const artifact of compatibilityArtifacts) {
  await copyFile(join(compatibilityDist, artifact), join(compatibilityTarget, artifact));
}
await copyFiles(windowsCompatibilitySource, compatibilityTarget, [
  'install-service.ps1',
  'uninstall-service.ps1',
  'upgrade-service.ps1',
  'config/agent.config.template.json',
  'release/verify-signature.ps1',
  'README.md',
]);

await recordFiles(outputRoot);
bundleItems.sort((left, right) => left.path.localeCompare(right.path));
await writeFile(join(outputRoot, 'manifest.json'), JSON.stringify({
  schemaVersion: 'gcac.agent-release-bundle/v1',
  version: releaseVersion,
  generatedAt: new Date().toISOString(),
  architectures: ['linux/amd64', 'linux/arm64', 'windows/amd64', 'windows/arm64'],
  compatibility: {
    runtime: 'go',
    toolchain: 'go1.20',
    productLine: 'windows-compat-full-agent',
    architectures: ['windows/amd64'],
    path: 'windows/amd64/compatibility',
  },
  items: bundleItems,
}, null, 2) + '\n', 'utf8');

console.log(`Agent Release Bundle 已生成：${outputRoot}`);

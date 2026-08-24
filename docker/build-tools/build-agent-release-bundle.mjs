import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const outputRoot = resolve(process.env.GCAC_AGENT_BUNDLE_OUTPUT ?? join(repositoryRoot, 'build', 'agent-release-bundle'));
const releaseVersion = (await readFile(join(repositoryRoot, 'version'), 'utf8')).trim();

if (!outputRoot.startsWith(`${repositoryRoot}${process.platform === 'win32' ? '\\' : '/'}`)) {
  throw new Error(`拒绝写入仓库外部目录：${outputRoot}`);
}
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) throw new Error(`构建失败：${command} ${args.join(' ')}`);
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

const linuxSource = join(repositoryRoot, 'agents', 'linux-go-full-agent');
const windowsGoSource = join(repositoryRoot, 'agents', 'windows-go-full-agent');
const windowsCompatibilitySource = join(repositoryRoot, 'agents', 'windows-compat-full-agent');

for (const [goArch, bundleArch] of [['amd64', 'amd64'], ['arm64', 'arm64']]) {
  const linuxTarget = join(outputRoot, 'linux', bundleArch);
  await mkdir(linuxTarget, { recursive: true });
  run('go', ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', join(linuxTarget, 'gcac-linux-agent'), '.'], linuxSource, {
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
  run('go', ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', join(windowsTarget, 'gcac-agent.exe'), '.'], windowsGoSource, {
    GOOS: 'windows',
    GOARCH: goArch,
    CGO_ENABLED: '0',
  });
  run('go', ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', join(windowsTarget, 'gcac-agent-updater.exe'), './cmd/gcac-agent-updater'], windowsGoSource, {
    GOOS: 'windows',
    GOARCH: goArch,
    CGO_ENABLED: '0',
  });
  await mkdir(join(windowsTarget, 'plugins'), { recursive: true });
  run('go', ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', join(windowsTarget, 'plugins', 'windows-runtime-discovery.exe'), './agent-side-plugins/windows-runtime-discovery'], windowsGoSource, {
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

const compatibilityDist = join(windowsCompatibilitySource, 'dist');
const compatibilityArtifacts = [
  'GCAC.WindowsCompatibilityAgent.exe',
  'gcac-agent-updater.exe',
  'plugins/windows-runtime-discovery.exe',
  'web-iis/web-iis-agent-side-plugin.exe',
];
for (const artifact of compatibilityArtifacts) {
  const source = join(compatibilityDist, artifact);
  try {
    await stat(source);
  } catch {
    throw new Error(`Compatibility Go 产物缺失：${source}。请先使用 Go 1.20 执行 agents/windows-compat-full-agent/build.ps1。`);
  }
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

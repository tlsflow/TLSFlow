import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputRoot = resolve(process.env.GCAC_AGENT_BUNDLE_OUTPUT ?? join(repositoryRoot, 'build', 'agent-release-bundle'));
const releaseVersion = process.env.GCAC_RELEASE_VERSION?.trim() || (await readFile(join(repositoryRoot, 'version'), 'utf8')).trim();

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
    'linux/gcac-nginx-helper.sh',
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
  await copyFiles(windowsGoSource, windowsTarget, [
    'config/agent.config.template.json',
    'install-service.ps1',
    'uninstall-service.ps1',
    'service-control.ps1',
    'README.md',
  ]);
}

const compatibilityBinary = join(windowsCompatibilitySource, 'bin', 'Release', 'GCAC.WindowsCompatibilityAgent.exe');
const compatibilityConfig = `${compatibilityBinary}.config`;
for (const bundleArch of ['amd64', 'arm64']) {
  const target = join(outputRoot, 'windows', bundleArch, 'compatibility');
  await mkdir(join(target, 'bin', 'Release'), { recursive: true });
  await copyFile(compatibilityBinary, join(target, 'bin', 'Release', 'GCAC.WindowsCompatibilityAgent.exe'));
  await copyFile(compatibilityConfig, join(target, 'bin', 'Release', 'GCAC.WindowsCompatibilityAgent.exe.config'));
  await copyFiles(windowsCompatibilitySource, target, [
    'install-service.ps1',
    'uninstall-service.ps1',
    'upgrade-service.ps1',
    'config/agent.config.template.json',
  ]);
}

await recordFiles(outputRoot);
bundleItems.sort((left, right) => left.path.localeCompare(right.path));
await writeFile(join(outputRoot, 'manifest.json'), JSON.stringify({
  schemaVersion: 'gcac.agent-release-bundle/v1',
  version: releaseVersion,
  generatedAt: new Date().toISOString(),
  architectures: ['linux/amd64', 'linux/arm64', 'windows/amd64', 'windows/arm64'],
  items: bundleItems,
}, null, 2) + '\n', 'utf8');

console.log(`Agent Release Bundle 已生成：${outputRoot}`);

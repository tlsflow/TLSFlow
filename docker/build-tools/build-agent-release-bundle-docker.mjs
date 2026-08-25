import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const outputRoot = resolve(process.env.GCAC_AGENT_BUNDLE_OUTPUT ?? join(repositoryRoot, 'build', 'agent-release-bundle'));
const dockerfile = join(repositoryRoot, 'docker', 'build-tools', 'Dockerfile.agent-release-bundle');
const versions = JSON.parse(await readFile(join(repositoryRoot, 'docker', 'build-tools', 'versions.json'), 'utf8'));
const agentToolchains = versions.agentToolchains;
if (!agentToolchains?.full || !agentToolchains?.compatibility) {
  throw new Error('versions.json 缺少 Agent Go builder 镜像版本。');
}
if (!outputRoot.startsWith(`${repositoryRoot}${process.platform === 'win32' ? '\\' : '/'}`)) {
  throw new Error(`拒绝写入仓库外部目录：${outputRoot}`);
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const result = spawnSync('docker', [
  'buildx',
  'build',
  '--pull',
  '--progress',
  'plain',
  '--build-arg',
  `GO_FULL_IMAGE=${agentToolchains.full}`,
  '--build-arg',
  `GO_COMPAT_IMAGE=${agentToolchains.compatibility}`,
  '--file',
  dockerfile,
  '--output',
  `type=local,dest=${outputRoot}`,
  repositoryRoot,
], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  throw new Error(`无法执行 Docker Agent Bundle 构建：${result.error.message}`);
}
if (result.status !== 0) {
  throw new Error('Docker Agent Bundle 构建失败。请检查 Docker daemon、Buildx 和 Go 基础镜像下载。');
}

console.log(`Docker 已生成 Agent Release Bundle：${outputRoot}`);

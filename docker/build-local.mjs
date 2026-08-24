import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const versions = JSON.parse(await readFile(join(repositoryRoot, 'docker', 'versions.json'), 'utf8'));
const options = parseArguments(process.argv.slice(2));
const architecture = options.architecture ?? 'all';
const platform = options.platform ?? defaultPlatform();
const tag = options.tag ?? versions.releaseVersion;

if (!['small', 'standard', 'all'].includes(architecture)) {
  throw new Error('--architecture 只允许 small、standard 或 all');
}
assertLinuxPlatform(platform);

run(process.execPath, [join(repositoryRoot, 'docker', 'build-agent-release-bundle.mjs')], repositoryRoot);

const targets = architecture === 'small'
  ? [{ name: 'gcac-small', dockerfile: 'docker/Dockerfile.small' }]
  : architecture === 'standard'
    ? standardTargets()
    : [{ name: 'gcac-small', dockerfile: 'docker/Dockerfile.small' }, ...standardTargets()];

for (const target of targets) {
  console.log(`开始本地构建 ${target.name}:${tag} (${platform})`);
  run('docker', [
    'buildx',
    'build',
    '--load',
    '--platform',
    platform,
    '--tag',
    `${target.name}:${tag}`,
    '--file',
    join(repositoryRoot, target.dockerfile),
    repositoryRoot,
  ], repositoryRoot);
}

console.log(`本地 Docker 构建完成：${targets.map((target) => `${target.name}:${tag}`).join(', ')}`);

function standardTargets() {
  return [
    { name: 'gcac-db', dockerfile: 'docker/Dockerfile.db' },
    { name: 'gcac-backend', dockerfile: 'docker/Dockerfile.backend' },
    { name: 'gcac-web', dockerfile: 'docker/Dockerfile.web' },
    { name: 'gcac-browser-runtime', dockerfile: 'docker/Dockerfile.browser-runtime' },
  ];
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) throw new Error(`不支持的参数：${argument}`);
    const [key, inlineValue] = argument.slice(2).split('=', 2);
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：--${key}`);
    if (key === 'architecture') options.architecture = value;
    else if (key === 'platform') options.platform = value;
    else if (key === 'tag') options.tag = value;
    else throw new Error(`不支持的参数：--${key}`);
  }
  return options;
}

function defaultPlatform() {
  if (process.arch === 'arm64') return 'linux/arm64';
  return 'linux/amd64';
}

function assertLinuxPlatform(value) {
  if (!versions.deploymentArchitectures.includes(value)) {
    throw new Error(`平台不在发布矩阵中：${value}`);
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`命令执行失败：${command} ${args.join(' ')}`);
}

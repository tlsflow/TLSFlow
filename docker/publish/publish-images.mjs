import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const versions = JSON.parse(await readFile(join(repositoryRoot, 'docker', 'build-tools', 'versions.json'), 'utf8'));
const releaseVersion = (await readFile(join(repositoryRoot, 'version'), 'utf8')).trim();
const options = parseArguments(process.argv.slice(2));
const namespace = options.namespace ?? process.env.DOCKERHUB_NAMESPACE?.trim();
const tag = options.tag ?? releaseVersion;
const architecture = options.architecture ?? 'all';
const platforms = options.platforms ?? versions.deploymentArchitectures;
const productEdition = options.edition ?? process.env.VITE_PRODUCT_EDITION?.trim() ?? 'public';

if (!namespace) {
  throw new Error('必须通过 --namespace 或 DOCKERHUB_NAMESPACE 指定 Docker Hub 命名空间');
}
if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(namespace)) {
  throw new Error('Docker Hub 命名空间格式不合法');
}
if (!['small', 'standard', 'all'].includes(architecture)) {
  throw new Error('--architecture 只允许 small、standard 或 all');
}
assertProductEdition(productEdition);
for (const platform of platforms) {
  if (!versions.deploymentArchitectures.includes(platform)) {
    throw new Error(`平台不在发布矩阵中：${platform}`);
  }
}

assertDockerLoginIsExternal();
run(process.execPath, [join(repositoryRoot, 'docker', 'build-tools', 'build-agent-release-bundle-docker.mjs')], repositoryRoot);

const targets = architecture === 'small'
  ? [{ name: 'gcac-small', dockerfile: 'docker/build-tools/Dockerfile.small', usesProductEdition: true }]
  : architecture === 'standard'
    ? standardTargets()
    : [{ name: 'gcac-small', dockerfile: 'docker/build-tools/Dockerfile.small', usesProductEdition: true }, ...standardTargets()];

for (const target of targets) {
  const image = `${namespace}/${target.name}`;
  const tags = [`${image}:${tag}`];
  if (options.latest === true) tags.push(`${image}:latest`);
  console.log(`开始发布 ${tags.join(', ')} (${platforms.join(',')}，${productEdition} 品牌)`);
  const commandArguments = [
    'buildx',
    'build',
    '--platform',
    platforms.join(','),
    ...productEditionBuildArgument(target, productEdition),
    '--file',
    join(repositoryRoot, target.dockerfile),
    ...tags.flatMap((item) => ['--tag', item]),
    '--provenance=true',
    '--sbom=true',
    '--push',
    repositoryRoot,
  ];
  run('docker', commandArguments, repositoryRoot);
}

console.log(`Docker Hub 发布完成：${targets.map((target) => `${namespace}/${target.name}:${tag}`).join(', ')}`);

function standardTargets() {
  return [
    { name: 'gcac-db', dockerfile: 'docker/build-tools/Dockerfile.db' },
    { name: 'gcac-backend', dockerfile: 'docker/build-tools/Dockerfile.backend' },
    { name: 'gcac-web', dockerfile: 'docker/build-tools/Dockerfile.web', usesProductEdition: true },
    { name: 'gcac-browser-runtime', dockerfile: 'docker/build-tools/Dockerfile.browser-runtime' },
  ];
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) throw new Error(`不支持的参数：${argument}`);
    const [key, inlineValue] = argument.slice(2).split('=', 2);
    if (key === 'latest') {
      options.latest = true;
      continue;
    }
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：--${key}`);
    if (key === 'namespace') options.namespace = value;
    else if (key === 'tag') options.tag = value;
    else if (key === 'architecture') options.architecture = value;
    else if (key === 'platforms') options.platforms = value.split(',').map((item) => item.trim()).filter(Boolean);
    else if (key === 'edition') options.edition = value;
    else throw new Error(`不支持的参数：--${key}`);
  }
  return options;
}

function assertProductEdition(value) {
  if (value !== 'public' && value !== 'enterprise') {
    throw new Error('--edition 只允许 public 或 enterprise');
  }
}

function productEditionBuildArgument(target, productEdition) {
  return target.usesProductEdition ? ['--build-arg', `VITE_PRODUCT_EDITION=${productEdition}`] : [];
}

function assertDockerLoginIsExternal() {
  if (process.env.GCAC_DOCKER_LOGIN_CONFIRMED !== 'true') {
    throw new Error('发布脚本不会处理 Docker Hub 凭据；请由受控发布环境先完成 docker login，并设置 GCAC_DOCKER_LOGIN_CONFIRMED=true');
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

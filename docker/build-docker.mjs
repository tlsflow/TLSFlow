import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const dockerRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(dockerRoot, '..');
const releaseVersion = (await readFile(join(repositoryRoot, 'version'), 'utf8')).trim();
const buildScript = join(dockerRoot, 'build-tools', 'build-local.mjs');

const choices = [
  { label: '构建全部镜像', args: ['--architecture', 'all'] },
  { label: 'gcac-small（单机版）', args: ['--image', 'gcac-small'] },
  { label: 'gcac-db（标准版数据库）', args: ['--image', 'gcac-db'] },
  { label: 'gcac-backend（标准版后端）', args: ['--image', 'gcac-backend'] },
  { label: 'gcac-web（标准版前端）', args: ['--image', 'gcac-web'] },
  { label: 'gcac-browser-runtime（标准版浏览器运行时）', args: ['--image', 'gcac-browser-runtime'] },
];

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}
if (options.list) {
  printChoices();
  process.exit(0);
}

if (options.architecture && options.selection !== undefined) {
  throw new Error('--architecture/--all 与 --image/数字选择不能同时使用');
}
const selected = options.selection ?? await promptSelection();
const choice = options.architecture
  ? { label: `构建 ${options.architecture} 架构镜像`, args: ['--architecture', options.architecture] }
  : resolveChoice(selected);
const buildArguments = [...choice.args];
if (options.platform) buildArguments.push('--platform', options.platform);
if (options.edition) buildArguments.push('--edition', options.edition);

console.log(`GCAC ${releaseVersion} Docker 镜像构建：${choice.label}`);
run(process.execPath, [buildScript, ...buildArguments], repositoryRoot);

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (/^\d+$/.test(argument)) {
      if (options.selection !== undefined) throw new Error('只能选择一个构建菜单项');
      options.selection = argument;
      continue;
    }
    if (argument === '--all') {
      options.architecture = 'all';
      continue;
    }
    if (argument === '--list') {
      options.list = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (!argument.startsWith('--')) throw new Error(`不支持的参数：${argument}`);
    const [key, inlineValue] = argument.slice(2).split('=', 2);
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：--${key}`);
    if (key === 'architecture') {
      if (!['small', 'standard', 'all'].includes(value)) throw new Error('--architecture 只允许 small、standard 或 all');
      options.architecture = value;
    } else if (key === 'image') {
      const imageIndex = choices.findIndex((choice) => choice.args[0] === '--image' && choice.args[1] === normalizeImageName(value));
      if (imageIndex < 0) throw new Error(`未知镜像：${value}`);
      options.selection = String(imageIndex);
    } else if (key === 'platform') options.platform = value;
    else if (key === 'edition') options.edition = value;
    else throw new Error(`不支持的参数：--${key}`);
  }
  return options;
}

function normalizeImageName(value) {
  if (value === 'browserRuntime') return 'gcac-browser-runtime';
  return value.startsWith('gcac-') ? value : `gcac-${value}`;
}

function printHelp() {
  console.log('用法：node docker/build-docker.mjs [数字] [选项]');
  console.log('不传数字时显示交互式构建列表；默认镜像标签读取根目录 version 文件。');
  console.log('选项：--all、--architecture small|standard|all、--image <镜像>、--platform <平台>、--edition public|enterprise、--list、--help');
  printChoices();
}

function printChoices() {
  console.log(`GCAC ${releaseVersion} Docker 镜像构建列表：`);
  for (const [index, choice] of choices.entries()) console.log(`  ${index}. ${choice.label}`);
  console.log('  q. 退出');
}

async function promptSelection() {
  printChoices();
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await readline.question('请选择构建项（输入数字或 q）：')).trim().toLowerCase();
  } finally {
    readline.close();
  }
}

function resolveChoice(selection) {
  if (selection === 'q' || selection === 'quit' || selection === 'exit' || selection === '') {
    console.log('已退出 Docker 镜像构建。');
    process.exit(0);
  }
  if (!/^\d+$/.test(selection)) throw new Error(`无效选择：${selection}`);
  const choice = choices[Number(selection)];
  if (!choice) throw new Error(`无效选择：${selection}，请输入 0-${choices.length - 1} 或 q`);
  return choice;
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

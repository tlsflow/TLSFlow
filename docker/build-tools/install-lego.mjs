import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const manifestPath = process.argv[2];
const targetArch = process.env.TARGETARCH?.trim();

if (isMainModule()) {
  if (!manifestPath) throw new Error('缺少 lego 版本清单路径');

  const asset = resolveLegoAsset(JSON.parse(readFileSync(manifestPath, 'utf8')), targetArch);
  const archivePath = '/tmp/lego.tar.gz';
  const url = `https://github.com/go-acme/lego/releases/download/v${asset.version}/${asset.file}`;

  run('curl', ['-fsSLo', archivePath, url]);
  const actualSha256 = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
  if (actualSha256 !== asset.sha256) {
    throw new Error(`lego 下载文件 SHA-256 不匹配：期望 ${asset.sha256}，实际 ${actualSha256}`);
  }
  run('tar', ['-xzf', archivePath, '-C', '/usr/local/bin', 'lego']);
  run('chmod', ['0755', '/usr/local/bin/lego']);
  run('/usr/local/bin/lego', ['--version']);
}

/**
 * 仅允许发布矩阵中的 Linux 架构，防止把未登记的外部下载引入镜像。
 */
export function resolveLegoAsset(manifest, targetArch) {
  if (targetArch !== 'amd64' && targetArch !== 'arm64') {
    throw new Error(`不支持的 lego Docker 目标架构：${targetArch || '未设置'}`);
  }

  const version = manifest?.lego?.version;
  const asset = manifest?.lego?.assets?.[`linux/${targetArch}`];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('lego 版本清单缺少合法版本号');
  }
  if (!asset || typeof asset.file !== 'string' || typeof asset.sha256 !== 'string') {
    throw new Error(`lego 版本清单缺少 linux/${targetArch} 资产`);
  }

  const expectedFile = `lego_v${version}_linux_${targetArch}.tar.gz`;
  if (asset.file !== expectedFile) {
    throw new Error(`lego 资产文件名必须为 ${expectedFile}`);
  }
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw new Error(`lego linux/${targetArch} SHA-256 格式不合法`);
  }

  return { version, file: asset.file, sha256: asset.sha256 };
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`命令执行失败：${command} ${args.join(' ')}`);
}

function isMainModule() {
  return process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url;
}

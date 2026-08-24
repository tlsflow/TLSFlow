import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

const bundleRoot = resolve(process.argv[2] ?? '/opt/gcac/agent-release-bundle');
const manifestPath = join(bundleRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (!Array.isArray(manifest.items) || manifest.items.length === 0) {
  throw new Error('Agent Release Bundle manifest.items 不能为空');
}

if (manifest.compatibility?.runtime !== 'go'
  || manifest.compatibility?.toolchain !== 'go1.20'
  || manifest.compatibility?.productLine !== 'windows-compat-full-agent'
  || JSON.stringify(manifest.compatibility?.architectures) !== JSON.stringify(['windows/amd64'])) {
  throw new Error('Compatibility Agent manifest 必须固定为 Go 1.20 windows/amd64');
}

const compatibilityPaths = manifest.items
  .map((item) => item?.path)
  .filter((item) => typeof item === 'string' && item.includes('/compatibility/'));
if (compatibilityPaths.some((item) => /\.config$/iu.test(item) || /windows\/arm64\/compatibility/iu.test(item))) {
  throw new Error('Compatibility Release Bundle 不得包含 .config 或 arm64 产物');
}

for (const item of manifest.items) {
  if (!item || typeof item.path !== 'string' || !/^[^/].*/u.test(item.path)) {
    throw new Error('Agent Release Bundle manifest 包含非法路径');
  }
  const filePath = resolve(bundleRoot, item.path);
  const relativePath = relative(bundleRoot, filePath);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Agent Release Bundle 路径越界：${item.path}`);
  }
  const content = await readFile(filePath);
  const sha256 = createHash('sha256').update(content).digest('hex');
  if (sha256 !== item.sha256) {
    throw new Error(`Agent Release Bundle SHA256 不匹配：${item.path}`);
  }
  if (Number(item.size) !== content.length) {
    throw new Error(`Agent Release Bundle 大小不匹配：${item.path}`);
  }
}

console.log(`Agent Release Bundle 校验通过：${manifest.version ?? 'unknown'}，${manifest.items.length} 个文件`);

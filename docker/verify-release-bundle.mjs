import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

const bundleRoot = resolve(process.argv[2] ?? '/opt/gcac/agent-release-bundle');
const manifestPath = join(bundleRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (!Array.isArray(manifest.items) || manifest.items.length === 0) {
  throw new Error('Agent Release Bundle manifest.items 不能为空');
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

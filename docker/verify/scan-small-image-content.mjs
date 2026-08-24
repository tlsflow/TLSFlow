import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const roots = process.argv.slice(2).map((item) => resolve(item));
const forbiddenNames = /\b(?:chromium|google-chrome|xvfb|x11vnc|novnc|websockify|playwright(?:-core)?)\b/iu;
const excludedFiles = new Set(['scan-small-image-content.mjs']);
const findings = [];

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const filePath = join(directory, entry.name);
    if (forbiddenNames.test(entry.name)) findings.push(filePath);
    if (entry.isDirectory()) {
      await walk(filePath);
      continue;
    }
    if (excludedFiles.has(entry.name)) continue;
    if (!/(?:package|npm-shrinkwrap)\.json$/iu.test(entry.name)) continue;
    const content = await readFile(filePath, 'utf8').catch(() => '');
    try {
      const manifest = JSON.parse(content);
      const dependencyNames = [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.packages ?? {}),
      ];
      if (!/[\\/]node_modules[\\/]/u.test(filePath)) {
        dependencyNames.push(...Object.keys(manifest.devDependencies ?? {}));
      }
      if (dependencyNames.some((name) => forbiddenNames.test(name))) findings.push(filePath);
    } catch {
      // 非 JSON 文件不参与依赖名称扫描。
    }
  }
}

for (const root of roots) await walk(root);
if (findings.length > 0) {
  console.error('小型版镜像检测到浏览器运行时相关内容：');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log('小型版镜像内容扫描通过：未检测到 Chromium、Xvfb、VNC 或 Playwright 浏览器依赖');

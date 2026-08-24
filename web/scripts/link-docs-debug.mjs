import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(webRoot, "../docs/Documentation/.vitepress/dist");
const target = path.resolve(webRoot, "public/docs");

const sourceStat = await fs.stat(source).catch(() => null);
if (!sourceStat?.isDirectory()) {
  throw new Error(`文档构建目录不存在，请先运行 npm run docs:build：${source}`);
}

const targetStat = await fs.lstat(target).catch(() => null);
if (targetStat && !targetStat.isSymbolicLink()) {
  throw new Error(`拒绝覆盖非软链接路径，请手动处理后重试：${target}`);
}

if (targetStat) {
  await fs.unlink(target);
}

await fs.symlink(source, target, "dir");
console.log(`已链接文档：${target} -> ${source}`);

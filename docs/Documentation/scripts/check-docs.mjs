import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const documentationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(documentationRoot, "..", "..");
const versionManifestPath = path.join(documentationRoot, "versions.json");
const localeDirectories = new Map([
  ["", "zh-CN"],
  ["en", "en-US"],
  ["fr", "fr-FR"],
  ["ja", "ja-JP"],
  ["ko", "ko-KR"],
  ["pt", "pt-BR"],
  ["ru", "ru-RU"],
  ["zh-TW", "zh-TW"]
]);
const localeDirectoryNames = new Set([...localeDirectories.keys()].filter(Boolean));
const requiredMetadata = ["title", "description", "docStatus", "productVersion", "sourceLocale", "locale", "specRefs", "codeRefs", "testRefs", "lastVerified"];
const allowedStatuses = new Set(["implemented", "in_review", "todo"]);
const sensitivePatterns = [
  /-----BEGIN [^-]+ PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{24,}\b/,
  /\b(?:password|token|secret)\s*[:=]\s*(?!\/\/)["'`]?([A-Za-z0-9+/=_-]{16,})/i
];

const includeFixtures = process.argv.includes("--include-fixtures");
const errors = [];
let versionManifest = { current: "", versions: [] };

try {
  versionManifest = JSON.parse(fs.readFileSync(versionManifestPath, "utf8"));
} catch (error) {
  errors.push(`${versionManifestPath}: 无法读取版本清单：${error.message}`);
}

const versionIds = new Set(
  Array.isArray(versionManifest.versions)
    ? versionManifest.versions.map((version) => version?.id).filter(Boolean)
    : []
);

if (!versionManifest.current || !versionIds.has(versionManifest.current)) {
  errors.push(`${versionManifestPath}: current 必须指向 versions 中存在的版本`);
}

const manifestLocales = new Map(
  Array.isArray(versionManifest.locales)
    ? versionManifest.locales.map((locale) => [locale?.id, locale])
    : []
);
for (const locale of ["zh-CN", "en-US"]) {
  if (!manifestLocales.has(locale)) {
    errors.push(`${versionManifestPath}: locales 必须包含 ${locale}`);
  }
}

for (const version of versionManifest.versions ?? []) {
  if (!version?.id || !/^v\d+\.\d+\.\d+$/.test(version.id)) {
    errors.push(`${versionManifestPath}: 版本 id 必须使用 v<主>.<次>.<补丁> 格式`);
    continue;
  }
  if (version.path !== `/${version.id}/`) {
    errors.push(`${versionManifestPath}: ${version.id} 的 path 必须为 /${version.id}/`);
  }
  const versionIndex = path.join(documentationRoot, version.id, "index.md");
  if (!fs.existsSync(versionIndex)) {
    errors.push(`${versionManifestPath}: 缺少版本首页：${version.id}/index.md`);
  }
}

function walkMarkdown(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".vitepress") {
      continue;
    }
    if (entry.name === "fixtures" && !includeFixtures) {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkMarkdown(absolutePath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      result.push(absolutePath);
    }
  }
  return result;
}

function getFrontmatter(text, filePath) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    errors.push(`${filePath}: 缺少 Frontmatter`);
    return "";
  }
  return match[1];
}

function getMetadata(frontmatter, key) {
  const line = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (line) {
    return line[1].trim().replace(/^['"]|['"]$/g, "");
  }
  const block = frontmatter.match(new RegExp(`^${key}:\\s*\\r?\\n((?:\\s+-\\s+.*\\r?\\n?)+)`, "m"));
  return block ? block[1] : null;
}

function getListValues(frontmatter, key) {
  const block = frontmatter.match(new RegExp(`^${key}:\\s*\\r?\\n((?:\\s+-\\s+.*\\r?\\n?)+)`, "m"));
  if (!block) {
    return [];
  }
  return block[1]
    .split(/\r?\n/)
    .map((line) => line.match(/^\s+-\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^['"]|['"]$/g, ""));
}

function resolveProjectReference(reference) {
  const normalized = reference.replace(/^`|`$/g, "").replace(/\//g, path.sep);
  return path.resolve(projectRoot, normalized);
}

function resolveDocLink(sourceFile, target) {
  const cleanTarget = target.split("#")[0].split("?")[0];
  if (!cleanTarget || cleanTarget.startsWith("http://") || cleanTarget.startsWith("https://") || cleanTarget.startsWith("mailto:")) {
    return null;
  }
  if (cleanTarget.startsWith("/")) {
    const relative = cleanTarget.replace(/^\/+/, "");
    const candidates = [
      path.join(documentationRoot, `${relative}.md`),
      path.join(documentationRoot, relative, "index.md")
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
  }
  if (cleanTarget.startsWith("C:") || cleanTarget.startsWith("D:")) {
    return null;
  }
  return path.resolve(path.dirname(sourceFile), cleanTarget);
}

function getDocumentKey(filePath) {
  const relativePath = path.relative(documentationRoot, filePath).replace(/\\/g, "/");
  const segments = relativePath.split("/");
  const versionIndex = versionIds.has(segments[0]) ? 1 : 0;
  const localeIndex = localeDirectoryNames.has(segments[versionIndex]) ? versionIndex + 1 : versionIndex;
  const scope = versionIndex === 1 ? segments[0] : "root";
  return `${scope}:${segments.slice(localeIndex).join("/")}`;
}

function getDocumentLocale(filePath) {
  const relativePath = path.relative(documentationRoot, filePath).replace(/\\/g, "/");
  const segments = relativePath.split("/");
  const versionIndex = versionIds.has(segments[0]) ? 1 : 0;
  return localeDirectories.get(segments[versionIndex]) ?? "zh-CN";
}

function getDocumentVersion(filePath) {
  const relativePath = path.relative(documentationRoot, filePath).replace(/\\/g, "/");
  const firstSegment = relativePath.split("/")[0];
  return versionIds.has(firstSegment) ? firstSegment : null;
}

function checkFilename(filePath) {
  const filename = path.basename(filePath);
  if (!/^[\x20-\x7e]+$/.test(filename)) {
    errors.push(`${filePath}: 文件名必须只包含 ASCII 字符，中文标题请放在 Frontmatter 或正文中`);
  }
  if (/20\d{2}(?:-?\d{2}){2}/.test(filename)) {
    errors.push(`${filePath}: 文件名不得包含日期，日期请放在 Frontmatter 元数据中`);
  }
}

function checkMetadata(filePath, frontmatter) {
  for (const key of requiredMetadata) {
    if (!getMetadata(frontmatter, key)) {
      errors.push(`${filePath}: 缺少元数据 ${key}`);
    }
  }

  const status = getMetadata(frontmatter, "docStatus");
  if (status && !allowedStatuses.has(status)) {
    errors.push(`${filePath}: docStatus 无效：${status}`);
  }

  const locale = getMetadata(frontmatter, "locale");
  const expectedLocale = getDocumentLocale(filePath);
  if (expectedLocale && locale !== expectedLocale) {
    errors.push(`${filePath}: locale 应为 ${expectedLocale}，实际为 ${locale}`);
  }

  const lastVerified = getMetadata(frontmatter, "lastVerified");
  if (lastVerified && !/^\d{4}-\d{2}-\d{2}$/.test(lastVerified)) {
    errors.push(`${filePath}: lastVerified 必须是 YYYY-MM-DD`);
  }

  const documentVersion = getDocumentVersion(filePath);
  if (documentVersion) {
    const productVersion = getMetadata(frontmatter, "productVersion");
    if (productVersion !== documentVersion) {
      errors.push(`${filePath}: 版本目录 ${documentVersion} 的 productVersion 必须为 ${documentVersion}，实际为 ${productVersion}`);
    }
  }

  for (const key of ["specRefs", "codeRefs", "testRefs"]) {
    for (const reference of getListValues(frontmatter, key)) {
      const target = resolveProjectReference(reference);
      if (!fs.existsSync(target)) {
        errors.push(`${filePath}: ${key} 路径不存在：${reference}`);
      }
    }
  }
}

function checkRootPagePolicy(filePath, frontmatter) {
  const relativePath = path.relative(documentationRoot, filePath).replace(/\\/g, "/");
  const documentVersion = getDocumentVersion(filePath);
  const redirectTo = getMetadata(frontmatter, "redirectTo");

  if (documentVersion) {
    if (redirectTo) {
      errors.push(`${filePath}: 版本文档不得声明 redirectTo，正式内容必须直接位于版本目录`);
    }
    return;
  }

  if (relativePath === "index.md") {
    if (redirectTo) {
      errors.push(`${filePath}: 官方首页不得声明 redirectTo`);
    }
    if (getMetadata(frontmatter, "productVersion") !== "current") {
      errors.push(`${filePath}: 官方首页的 productVersion 必须为 current`);
    }
    return;
  }

  if (!redirectTo || !/^\/v\d+\.\d+\.\d+(?:\/|$)/.test(redirectTo)) {
    errors.push(`${filePath}: 非版本 Markdown 必须声明指向版本文档的 redirectTo`);
    return;
  }

  if (!redirectTo.startsWith(`/${versionManifest.current}/`)) {
    errors.push(`${filePath}: redirectTo 必须指向当前版本 ${versionManifest.current}`);
  }
  if (getMetadata(frontmatter, "layout") !== "false") {
    errors.push(`${filePath}: 根目录兼容页必须设置 layout: false`);
  }

  const resolvedTarget = resolveDocLink(filePath, redirectTo);
  if (!resolvedTarget || !fs.existsSync(resolvedTarget)) {
    errors.push(`${filePath}: redirectTo 目标不存在：${redirectTo}`);
  }
}

function checkLinks(filePath, text) {
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, "");
    const resolved = resolveDocLink(filePath, target);
    if (resolved && !fs.existsSync(resolved)) {
      errors.push(`${filePath}: 内部链接不存在：${target}`);
    }
  }
}

function checkEncoding(filePath) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(filePath));
  } catch {
    errors.push(`${filePath}: 不是有效 UTF-8`);
  }
}

function checkSensitiveContent(filePath, text) {
  for (const pattern of sensitivePatterns) {
    if (pattern.test(text)) {
      errors.push(`${filePath}: 可能包含敏感信息，命中 ${pattern}`);
    }
  }
}

function checkLocalizedImages(filePath, text) {
  const version = getDocumentVersion(filePath);
  if (!version) return;
  const locale = getDocumentLocale(filePath);
  for (const match of text.matchAll(/<LocalizedImage\b[^>]*\bname=["']([^"']+)["'][^>]*>/g)) {
    const name = match[1];
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      errors.push(`${filePath}: LocalizedImage name 只能包含 ASCII 文件名：${name}`);
      continue;
    }
    for (const imageLocale of [locale, "zh-CN", "en-US"]) {
      const imagePath = path.join(documentationRoot, "public", "assets", version, imageLocale, name);
      if (!fs.existsSync(imagePath)) {
        errors.push(`${filePath}: 缺少 ${imageLocale} 图片资源：public/assets/${version}/${imageLocale}/${name}`);
      }
    }
  }
}

const markdownFiles = walkMarkdown(documentationRoot);
if (!markdownFiles.length) {
  errors.push("没有找到 Markdown 文档");
}

for (const filePath of markdownFiles) {
  const text = fs.readFileSync(filePath, "utf8");
  checkFilename(filePath);
  const frontmatter = getFrontmatter(text, filePath);
  checkMetadata(filePath, frontmatter);
  checkRootPagePolicy(filePath, frontmatter);
  checkLinks(filePath, text);
  checkLocalizedImages(filePath, text);
  checkEncoding(filePath);
  checkSensitiveContent(filePath, text);
}

const documentsByKey = new Map();
for (const filePath of markdownFiles) {
  const documentKey = getDocumentKey(filePath);
  const locale = getDocumentLocale(filePath);
  if (!documentsByKey.has(documentKey)) {
    documentsByKey.set(documentKey, new Map());
  }
  const localizedDocuments = documentsByKey.get(documentKey);
  if (locale && localizedDocuments.has(locale)) {
    errors.push(`${filePath}: 文档路径与 ${localizedDocuments.get(locale)} 重复，语言目录必须使用唯一的同路径页面`);
  } else if (locale) {
    localizedDocuments.set(locale, filePath);
  }
}

for (const [documentKey, localizedDocuments] of documentsByKey) {
  for (const [locale, filePath] of localizedDocuments) {
    if (locale && locale !== "zh-CN" && !localizedDocuments.has("zh-CN")) {
      errors.push(`${filePath}: 翻译页面缺少同路径的 zh-CN 权威页面：${documentKey}`);
    }
  }
}

for (const [documentKey, localizedDocuments] of documentsByKey) {
  if (!documentKey.startsWith("v") || !localizedDocuments.has("zh-CN")) continue;
  const chinesePath = localizedDocuments.get("zh-CN");
  if (!localizedDocuments.has("en-US")) {
    errors.push(`${chinesePath}: 缺少同路径的 en-US 页面：${documentKey}`);
  }
}

if (errors.length) {
  console.error(errors.map((error) => `✖ ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`文档检查通过：${markdownFiles.length} 个 Markdown 文件`);
}

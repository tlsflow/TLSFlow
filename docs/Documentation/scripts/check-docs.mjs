import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const documentationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(documentationRoot, "..", "..");
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
  const firstSegment = relativePath.split("/")[0];
  return localeDirectoryNames.has(firstSegment)
    ? relativePath.slice(firstSegment.length + 1)
    : relativePath;
}

function getDocumentLocale(filePath) {
  const relativePath = path.relative(documentationRoot, filePath).replace(/\\/g, "/");
  const firstSegment = relativePath.split("/")[0];
  return localeDirectories.get(firstSegment) ?? "zh-CN";
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

  for (const key of ["specRefs", "codeRefs", "testRefs"]) {
    for (const reference of getListValues(frontmatter, key)) {
      const target = resolveProjectReference(reference);
      if (!fs.existsSync(target)) {
        errors.push(`${filePath}: ${key} 路径不存在：${reference}`);
      }
    }
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

const markdownFiles = walkMarkdown(documentationRoot);
if (!markdownFiles.length) {
  errors.push("没有找到 Markdown 文档");
}

for (const filePath of markdownFiles) {
  const text = fs.readFileSync(filePath, "utf8");
  checkFilename(filePath);
  const frontmatter = getFrontmatter(text, filePath);
  checkMetadata(filePath, frontmatter);
  checkLinks(filePath, text);
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
  if (locale && locale !== "zh-CN" && !localizedDocuments.has("zh-CN")) {
    errors.push(`${filePath}: 翻译页面缺少同路径的 zh-CN 权威页面：${documentKey}`);
  }
}

if (errors.length) {
  console.error(errors.map((error) => `✖ ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`文档检查通过：${markdownFiles.length} 个 Markdown 文件`);
}

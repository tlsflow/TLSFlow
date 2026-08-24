import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(webRoot, '..')
const sourceRoot = path.join(webRoot, 'src')
const reportPath = path.join(repoRoot, 'docs', '检查报告', '20260707-i18n未国际化文本扫描清单.md')

const scanExtensions = new Set(['.vue', '.ts', '.tsx', '.js', '.jsx'])
const ignoredPathParts = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}build${path.sep}`,
  `${path.sep}coverage${path.sep}`,
  `${path.sep}src${path.sep}i18n${path.sep}`,
  `${path.sep}src${path.sep}api${path.sep}generated${path.sep}`
]

const chinesePattern = /[\u3400-\u9fff]/
const chineseGlobalPattern = /[\u3400-\u9fff]/g
const stringPattern = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g
const htmlTextPattern = />\s*([^<>{}\n][^<>{}]*)\s*</g
const htmlAttrPattern = /\s(?:title|aria-label|placeholder|alt|label|description|empty-title|empty-description|confirm-text|cancel-text|submit-label)=["']([^"']*[\u3400-\u9fff][^"']*)["']/g

const allowCommentPrefixes = ['//', '*', '/*', '<!--']
const lowValueLinePatterns = [
  /^\s*import\s/,
  /^\s*export\s+type\s/,
  /^\s*type\s/,
  /^\s*interface\s/
]

function toPosixRelative(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/')
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const normalized = `${fullPath}${entry.isDirectory() ? path.sep : ''}`
    if (ignoredPathParts.some((part) => normalized.includes(part))) continue

    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath))
      continue
    }

    if (scanExtensions.has(path.extname(entry.name))) files.push(fullPath)
  }

  return files
}

function getLineNumber(content, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1
  }
  return line
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function isCommentOnly(line) {
  const trimmed = line.trim()
  return allowCommentPrefixes.some((prefix) => trimmed.startsWith(prefix))
}

function shouldSkipLine(line) {
  if (!chinesePattern.test(line)) return true
  if (isCommentOnly(line)) return true
  return lowValueLinePatterns.some((pattern) => pattern.test(line))
}

function isLikelyUserVisible(filePath, line, kind) {
  const rel = toPosixRelative(filePath)
  if (rel.includes('/views/') || rel.includes('/layouts/') || rel.includes('/design-system/')) return true
  if (rel.includes('/router/')) return true
  if (kind === 'template-text' || kind === 'template-attribute') return true
  if (/\b(title|label|description|placeholder|message|empty|button|columns?|actions?|tabs?)\b/i.test(line)) return true
  return false
}

function classify(filePath, line, kind) {
  if (isLikelyUserVisible(filePath, line, kind)) return '用户可见，建议替换'
  if (line.includes('throw new Error') || line.includes('Error(')) return '错误信息，确认是否用户可见'
  if (line.includes('changeSummary') || line.includes('audit')) return '审计/业务记录，确认是否需要保留原文'
  return '需要人工确认'
}

function pushFinding(findings, filePath, lineNumber, kind, text, line) {
  const normalizedText = normalizeText(text)
  if (!normalizedText || !chinesePattern.test(normalizedText)) return

  findings.push({
    file: toPosixRelative(filePath),
    line: lineNumber,
    kind,
    text: normalizedText,
    category: classify(filePath, line, kind)
  })
}

function scanLineStrings(findings, filePath, line, lineNumber) {
  if (shouldSkipLine(line)) return

  stringPattern.lastIndex = 0
  let match
  while ((match = stringPattern.exec(line)) !== null) {
    const text = match[2]
    if (!chinesePattern.test(text)) continue
    pushFinding(findings, filePath, lineNumber, 'script-string', text, line)
  }
}

function scanVueTemplate(content, findings, filePath) {
  htmlTextPattern.lastIndex = 0
  let textMatch
  while ((textMatch = htmlTextPattern.exec(content)) !== null) {
    const text = normalizeText(textMatch[1])
    if (!chinesePattern.test(text)) continue
    const lineNumber = getLineNumber(content, textMatch.index)
    const line = content.split(/\r?\n/)[lineNumber - 1] ?? ''
    if (isCommentOnly(line)) continue
    pushFinding(findings, filePath, lineNumber, 'template-text', text, line)
  }

  htmlAttrPattern.lastIndex = 0
  let attrMatch
  while ((attrMatch = htmlAttrPattern.exec(content)) !== null) {
    const lineNumber = getLineNumber(content, attrMatch.index)
    const line = content.split(/\r?\n/)[lineNumber - 1] ?? ''
    if (isCommentOnly(line)) continue
    pushFinding(findings, filePath, lineNumber, 'template-attribute', attrMatch[1], line)
  }
}

function dedupeFindings(findings) {
  const seen = new Set()
  return findings.filter((finding) => {
    const key = `${finding.file}:${finding.line}:${finding.kind}:${finding.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    acc[item[key]] = (acc[item[key]] ?? 0) + 1
    return acc
  }, {})
}

function renderReport(findings) {
  const categoryCounts = countBy(findings, 'category')
  const fileCounts = countBy(findings, 'file')
  const topFiles = Object.entries(fileCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)

  const lines = [
    '# i18n 未国际化文本扫描清单',
    '',
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '## 说明',
    '',
    '- 本清单由 `npm run i18n:scan` 生成。',
    '- 扫描范围：`web/src` 下的 `.vue`、`.ts`、`.tsx`、`.js`、`.jsx` 文件。',
    '- 已排除：`web/src/i18n`、`web/src/api/generated`、构建产物和依赖目录。',
    '- 这不是自动替换结果。候选项必须逐条确认，避免把注释、协议字段、审计记录和后端错误原文误改成 UI 文案。',
    '',
    '## 汇总',
    '',
    `- 候选总数：${findings.length}`,
    ...Object.entries(categoryCounts).map(([category, count]) => `- ${category}：${count}`),
    '',
    '## 候选最多的文件',
    '',
    '| 文件 | 数量 |',
    '| --- | ---: |',
    ...topFiles.map(([file, count]) => `| \`${file}\` | ${count} |`),
    '',
    '## 明细',
    '',
    '| 状态 | 分类 | 文件 | 行 | 类型 | 文本 |',
    '| --- | --- | --- | ---: | --- | --- |',
    ...findings.map((finding) => {
      const text = finding.text.replace(/\|/g, '\\|')
      return `| TODO | ${finding.category} | \`${finding.file}\` | ${finding.line} | ${finding.kind} | ${text} |`
    }),
    ''
  ]

  return lines.join('\n')
}

async function main() {
  const files = await collectFiles(sourceRoot)
  const findings = []

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8')
    if (!chinesePattern.test(content)) continue

    if (path.extname(filePath) === '.vue') {
      scanVueTemplate(content, findings, filePath)
    }

    const lines = content.split(/\r?\n/)
    lines.forEach((line, index) => scanLineStrings(findings, filePath, line, index + 1))
  }

  const deduped = dedupeFindings(findings)
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.text.localeCompare(b.text))

  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, renderReport(deduped), 'utf8')

  console.log(`i18n literal scan completed: ${deduped.length} candidates`)
  console.log(`report: ${toPosixRelative(reportPath)}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

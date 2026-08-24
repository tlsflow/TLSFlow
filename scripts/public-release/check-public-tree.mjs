import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultConfigPath = path.join(scriptDirectory, 'public-release.config.json')

function toPosixPath(value) {
  return value.split(path.sep).join('/')
}

function normalizeRelativePath(value) {
  const normalized = toPosixPath(path.normalize(value))
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || path.isAbsolute(value)) {
    throw new Error(`非法相对路径：${value}`)
  }
  return normalized.replace(/^\.\/+/, '')
}

export function loadReleaseConfig(configPath = defaultConfigPath) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (config.version !== 1 || !Array.isArray(config.publicPaths) || !Array.isArray(config.generatedFiles)) {
    throw new Error(`公开发布配置格式无效：${configPath}`)
  }
  return config
}

function compilePatterns(patterns = []) {
  return patterns.map((pattern) => new RegExp(pattern))
}

function matchesPublicPath(relativePath, config) {
  const isSourcePath = config.publicPaths.some((entry) => {
    const normalizedEntry = normalizeRelativePath(entry)
    return relativePath === normalizedEntry || relativePath.startsWith(`${normalizedEntry}/`)
  })
  const isGeneratedPath = config.generatedFiles.some((entry) => normalizeRelativePath(entry.target) === relativePath)
  return isSourcePath || isGeneratedPath
}

function listFiles(rootDirectory) {
  const files = []
  const visit = (currentDirectory) => {
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.name === '.git') {
        continue
      }
      const absolutePath = path.join(currentDirectory, entry.name)
      const relativePath = normalizeRelativePath(path.relative(rootDirectory, absolutePath))
      if (entry.isDirectory()) {
        visit(absolutePath)
      } else {
        files.push({ absolutePath, relativePath, isSymbolicLink: entry.isSymbolicLink() })
      }
    }
  }
  visit(rootDirectory)
  return files
}

function readTextIfSafe(absolutePath) {
  const buffer = fs.readFileSync(absolutePath)
  if (buffer.includes(0) || buffer.length > 4 * 1024 * 1024) {
    return null
  }
  return buffer.toString('utf8')
}

export function inspectPublicTree({ rootDirectory, config, checkRequiredPublicFiles = true }) {
  const forbiddenPathPatterns = compilePatterns(config.forbiddenPathPatterns)
  const sensitiveFilePatterns = compilePatterns(config.sensitiveFilePatterns)
  const sensitiveContentPatterns = compilePatterns(config.sensitiveContentPatterns)
  const violations = []
  const files = listFiles(rootDirectory)
  const hashes = {}

  if (checkRequiredPublicFiles) {
    const requiredPublicFiles = (config.requiredPublicFiles ?? []).map(normalizeRelativePath)
    for (const requiredPath of requiredPublicFiles) {
      if (!files.some((file) => file.relativePath === requiredPath)) {
        violations.push({ type: 'required-path', path: requiredPath })
      }
    }
  }

  for (const file of files) {
    const pathIsAllowed = matchesPublicPath(file.relativePath, config)
    const forbiddenPath = forbiddenPathPatterns.some((pattern) => pattern.test(file.relativePath))
    const sensitiveFile = sensitiveFilePatterns.some((pattern) => pattern.test(file.relativePath))

    if (!pathIsAllowed || forbiddenPath || sensitiveFile || file.isSymbolicLink) {
      violations.push({
        type: file.isSymbolicLink
          ? 'symbolic-link'
          : forbiddenPath || sensitiveFile
            ? 'sensitive-path'
            : 'unknown-path',
        path: file.relativePath,
      })
    }

    const text = readTextIfSafe(file.absolutePath)
    if (text !== null && sensitiveContentPatterns.some((pattern) => pattern.test(text))) {
      violations.push({
        type: 'sensitive-content',
        path: file.relativePath,
      })
    }

    hashes[file.relativePath] = crypto.createHash('sha256').update(fs.readFileSync(file.absolutePath)).digest('hex')
  }

  const migrationFiles = files
    .map((file) => file.relativePath)
    .filter((relativePath) => /^backend\/src\/database\/migrations\/[^/]+\.sql$/.test(relativePath))
    .sort()

  return {
    ok: violations.length === 0,
    fileCount: files.length,
    hashes,
    migrationFiles,
    violations,
  }
}

export function assertPublicTree({ rootDirectory, config, checkRequiredPublicFiles = true }) {
  const result = inspectPublicTree({ rootDirectory, config, checkRequiredPublicFiles })
  if (!result.ok) {
    const summary = result.violations.map((item) => `${item.type}: ${item.path}`).join('\n')
    throw new Error(`公开目录检查失败：\n${summary}`)
  }
  return result
}

function parseArguments(argv) {
  const options = { rootDirectory: process.cwd(), configPath: defaultConfigPath }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--root') {
      options.rootDirectory = path.resolve(argv[++index])
    } else if (argument === '--config') {
      options.configPath = path.resolve(argv[++index])
    } else if (argument === '--manifest') {
      options.manifestPath = path.resolve(argv[++index])
    } else {
      throw new Error(`不支持的参数：${argument}`)
    }
  }
  return options
}

if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '')) {
  try {
    const options = parseArguments(process.argv.slice(2))
    const config = loadReleaseConfig(options.configPath)
    const result = assertPublicTree({ rootDirectory: options.rootDirectory, config })
    const manifest = {
      generatedAt: new Date().toISOString(),
      fileCount: result.fileCount,
      migrationFiles: result.migrationFiles,
      hashes: result.hashes,
      scanStatus: 'passed',
    }
    if (options.manifestPath) {
      fs.writeFileSync(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    }
    process.stdout.write(`公开目录检查通过：${result.fileCount} 个文件；活动迁移 ${result.migrationFiles.length} 个\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}

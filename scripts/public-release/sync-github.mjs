import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { assertPublicTree, loadReleaseConfig } from './check-public-tree.mjs'

function runGit(argumentsList, cwd, options = {}) {
  return execFileSync('git', argumentsList, {
    cwd,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  }).trim()
}

function validateRefName(refName, label) {
  if (!/^[A-Za-z0-9._/-]+$/.test(refName) || refName.includes('..') || refName.includes('//') || refName.startsWith('/') || refName.endsWith('/')) {
    throw new Error(`${label}非法：${refName}`)
  }
}

function main() {
  if (process.env.PUBLIC_RELEASE_APPROVED !== 'true') {
    throw new Error('缺少人工确认：必须设置 PUBLIC_RELEASE_APPROVED=true')
  }

  const repositoryRoot = runGit(['rev-parse', '--show-toplevel'])
  const configPath = path.join(repositoryRoot, 'scripts/public-release/public-release.config.json')
  const config = loadReleaseConfig(configPath)
  const status = runGit(['status', '--porcelain', '--untracked-files=all'], repositoryRoot)
  if (status) {
    throw new Error('Gitee 公开仓库工作树不干净，已停止 GitHub 同步')
  }

  const scanResult = assertPublicTree({ rootDirectory: repositoryRoot, config })
  const githubRepositoryUrl = process.env.GITHUB_REPOSITORY_URL
  if (!githubRepositoryUrl) {
    throw new Error('缺少 GITHUB_REPOSITORY_URL')
  }

  const targetBranch = process.env.PUBLIC_RELEASE_TARGET_BRANCH || 'main'
  validateRefName(targetBranch, 'GitHub 目标分支')
  const tagName = process.env.PUBLIC_RELEASE_TAG
  if (tagName) {
    validateRefName(tagName, 'GitHub 目标标签')
    const tagCommit = runGit(['rev-list', '-n', '1', tagName], repositoryRoot)
    const currentCommit = runGit(['rev-parse', 'HEAD'], repositoryRoot)
    if (tagCommit !== currentCommit) {
      throw new Error(`标签 ${tagName} 没有指向当前公开提交`)
    }
  }

  const hasGithubRemote = runGit(['remote'], repositoryRoot).split(/\r?\n/).includes('github')
  if (hasGithubRemote) {
    runGit(['remote', 'set-url', 'github', githubRepositoryUrl], repositoryRoot)
  } else {
    runGit(['remote', 'add', 'github', githubRepositoryUrl], repositoryRoot)
  }
  runGit(['push', '--porcelain', 'github', `HEAD:refs/heads/${targetBranch}`], repositoryRoot)
  if (tagName) {
    runGit(['push', '--porcelain', 'github', `refs/tags/${tagName}`], repositoryRoot)
  }
  process.stdout.write(`${JSON.stringify({
    targetBranch,
    tagName: tagName || null,
    githubCommit: runGit(['rev-parse', 'HEAD'], repositoryRoot),
    fileCount: scanResult.fileCount,
    migrationFiles: scanResult.migrationFiles,
    scanStatus: 'passed',
  }, null, 2)}\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}

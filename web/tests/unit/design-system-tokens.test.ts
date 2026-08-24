import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const tokenFile = resolve(process.cwd(), 'src/design-system/tokens/index.css')
const css = readFileSync(tokenFile, 'utf8')

function readCssBlock(startAt: number): string {
  const openingBrace = css.indexOf('{', startAt)
  expect(openingBrace).toBeGreaterThan(startAt)

  let depth = 0
  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(openingBrace + 1, index)
    }
  }

  throw new Error('主题令牌 CSS 块未闭合')
}

function readThemeBlocks(): { light: string; dark: string } {
  const lightStart = css.indexOf(':root,')
  const darkStart = css.indexOf(':root[data-theme="dark"]')
  expect(lightStart).toBeGreaterThanOrEqual(0)
  expect(darkStart).toBeGreaterThan(lightStart)
  return { light: readCssBlock(lightStart), dark: readCssBlock(darkStart) }
}

function expectToken(block: string, token: string): void {
  expect(block).toMatch(new RegExp(`(^|\\n)\\s*${token.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*:`))
}

const themeColorTokens = [
  '--gc-color-bg',
  '--gc-color-bg-strong',
  '--gc-color-bg-glow',
  '--gc-color-bg-gradient-start',
  '--gc-color-bg-gradient-end',
  '--gc-color-surface-solid',
  '--gc-color-surface-overlay',
  '--gc-color-text',
  '--gc-color-text-secondary',
  '--gc-color-text-muted',
  '--gc-color-text-soft',
  '--gc-color-text-strong',
  '--gc-color-border',
  '--gc-color-border-subtle',
  '--gc-color-border-strong',
  '--gc-color-primary',
  '--gc-color-primary-hover',
  '--gc-color-primary-strong',
  '--gc-color-primary-bg',
  '--gc-color-primary-border',
  '--gc-color-focus',
  '--gc-color-focus-ring',
  '--gc-color-backdrop',
  '--gc-color-disabled',
  '--gc-color-disabled-bg'
]

const commonLayoutTokens = [
  '--gc-space-7',
  '--gc-space-9',
  '--gc-space-12',
  '--gc-space-tight',
  '--gc-space-compact',
  '--gc-space-control',
  '--gc-space-panel',
  '--gc-space-section',
  '--gc-space-viewport',
  '--gc-space-nav-gap',
  '--gc-space-modal-x',
  '--gc-space-modal-y',
  '--gc-border-width-default',
  '--gc-border-width-thick',
  '--gc-control-height-sm',
  '--gc-control-height-md',
  '--gc-control-height-lg',
  '--gc-control-height-comfortable',
  '--gc-size-shell-sidebar',
  '--gc-size-modal-default',
  '--gc-size-icon-button',
  '--gc-size-icon-sm',
  '--gc-size-icon-md',
  '--gc-size-icon-lg',
  '--gc-size-modal-confirm',
  '--gc-size-modal-lg',
  '--gc-size-modal-xl',
  '--gc-size-modal-xxl',
  '--gc-size-progress',
  '--gc-font-family-mono',
  '--gc-font-size-overline',
  '--gc-font-size-caption',
  '--gc-font-size-label',
  '--gc-font-size-body',
  '--gc-font-size-heading-xs',
  '--gc-font-size-heading-sm',
  '--gc-font-size-heading-md',
  '--gc-radius-control',
  '--gc-radius-card',
  '--gc-radius-modal',
  '--gc-radius-panel',
  '--gc-radius-pill',
  '--gc-shadow-card',
  '--gc-shadow-modal',
  '--gc-shadow-button-primary'
]

describe('设计系统主题令牌合同', () => {
  it('由 html[data-theme] 提供完整的亮色和暗色语义令牌', () => {
    const { light, dark } = readThemeBlocks()

    expect(css).toContain(':root[data-theme="light"]')
    expect(css).toContain(':root[data-theme="dark"]')
    for (const token of themeColorTokens) {
      expectToken(light, token)
      expectToken(dark, token)
    }
  })

  it('为 success、warning、danger、info 保持四件套结构', () => {
    const { light, dark } = readThemeBlocks()
    for (const tone of ['success', 'warning', 'danger', 'info']) {
      for (const suffix of ['', '-bg', '-soft', '-border']) {
        expectToken(light, `--gc-color-${tone}${suffix}`)
        expectToken(dark, `--gc-color-${tone}${suffix}`)
      }
    }
  })

  it('提供 Cloud Security Pro 的通用尺寸和层级令牌', () => {
    const { light } = readThemeBlocks()
    for (const token of commonLayoutTokens) expectToken(light, token)

    expect(light).toMatch(/--gc-size-shell-sidebar\s*:\s*260px/)
    expect(light).toMatch(/--gc-size-modal-default\s*:\s*672px/)
    expect(light).toMatch(/--gc-size-modal-lg\s*:\s*720px/)
    expect(light).toMatch(/--gc-size-modal-xl\s*:\s*860px/)
    expect(light).toMatch(/--gc-radius-control\s*:\s*8px/)
    expect(light).toMatch(/--gc-radius-card\s*:\s*12px/)
    expect(light).toMatch(/--gc-radius-modal\s*:\s*16px/)
    expect(css).not.toContain('--gc-color-legacy-')
  })

  it('全局背景只消费主题变量，不通过独立暗色 body 规则切换', () => {
    expect(css).toMatch(/body\s*\{[\s\S]*background:\s*var\(--gc-color-bg\)/)
    expect(css).not.toMatch(/:root\[data-theme="dark"\]\s+body\s*\{/)
  })
})

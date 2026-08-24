import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const layout = readFileSync(resolve(process.cwd(), 'src/design-system/patterns/layout.css'), 'utf8')
const buttonComponent = readFileSync(resolve(process.cwd(), 'src/design-system/components/GcButton.vue'), 'utf8')
const dataTableComponent = readFileSync(resolve(process.cwd(), 'src/design-system/components/GcDataTable.vue'), 'utf8')
const emptyStateComponent = readFileSync(resolve(process.cwd(), 'src/design-system/components/GcEmptyState.vue'), 'utf8')
const dashboardView = readFileSync(resolve(process.cwd(), 'src/views/dashboard/DashboardView.vue'), 'utf8')
const tokens = readFileSync(resolve(process.cwd(), 'src/design-system/tokens/index.css'), 'utf8')

function cssBlocks(selector: string): string[] {
  return [...layout.matchAll(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, 'g'))].map((match) => match[1])
}

describe('按钮和卡片样式收口合同', () => {
  it('由全局入口统一承载原生、链接和图标按钮的外观', () => {
    expect(layout).toContain('.gc-button,\n.gc-icon-button {')
    expect(layout).toContain('text-decoration: none;')
    expect(layout).toContain('.gc-button--secondary:hover:not(:disabled)')
    expect(layout).toContain('.gc-button:focus-visible,\n.gc-icon-button:focus-visible')
    expect(layout).toContain('.gc-icon-button:disabled,\n.gc-button:disabled')
    expect(buttonComponent).not.toContain('<style')
  })

  it('为主要、危险、幽灵和忙碌状态保留语义化交互规则', () => {
    for (const selector of [
      '\\.gc-button--primary',
      '\\.gc-button--danger',
      '\\.gc-button--ghost',
      '\\.gc-button--loading \\.gc-button__content',
    ]) {
      expect(cssBlocks(selector)).toHaveLength(1)
    }
  })

  it('全局卡片基线只使用卡片圆角令牌', () => {
    const cardBlocks = cssBlocks('\\.gc-card')

    expect(cardBlocks).toHaveLength(1)
    expect(cardBlocks[0]).toContain('border-radius: var(--gc-radius-card);')
    expect(cardBlocks[0]).not.toContain('--gc-radius-lg')
  })

  it('表格和空状态卡片最终都遵循共享卡片圆角', () => {
    expect(dataTableComponent).toContain('class="gc-card gc-data-table"')
    expect(dataTableComponent).toContain('border-radius: var(--gc-radius-card);')
    expect(emptyStateComponent).toContain('class="gc-card gc-empty-state"')

    const emptyStateBlocks = cssBlocks('section\\.gc-card\\.gc-empty-state')
    expect(emptyStateBlocks).toHaveLength(1)
    expect(emptyStateBlocks[0]).toContain('border-radius: var(--gc-radius-card);')
  })

  it('默认卡片和通用表格使用无滤镜的轻玻璃表面', () => {
    const cardBlocks = cssBlocks('\\.gc-card')

    expect(cardBlocks[0]).toContain('background: var(--gc-color-surface-glass);')
    expect(cardBlocks[0]).toContain('border: var(--gc-border-width-default) solid var(--gc-color-border-soft);')
    expect(cardBlocks[0]).not.toContain('backdrop-filter')
    expect(dataTableComponent).toContain('background: var(--gc-color-surface-glass);')
    expect(dataTableComponent).not.toContain('backdrop-filter')
  })

  it('轻玻璃表面保留可见的工作区透出层次', () => {
    expect(tokens).toContain('--gc-color-surface-glass: rgb(255 255 255 / 68%);')
    expect(tokens).toContain('--gc-color-surface-workspace-glass: rgb(255 255 255 / 58%);')
    expect(tokens).toContain('--gc-gradient-workspace: linear-gradient(118deg, var(--gc-color-workspace-primary) 0%, var(--gc-color-workspace-soft) 42%, var(--gc-color-workspace-accent) 100%);')
  })

  it('仅工作台壳层与仪表盘概览面板保留模糊', () => {
    for (const selector of ['\\.gc-workbench__sidebar', '\\.gc-workbench__topbar']) {
      expect(cssBlocks(selector).some((block) => block.includes('backdrop-filter: blur('))).toBe(true)
    }

    expect(dashboardView).toContain('backdrop-filter: blur(var(--gc-space-4));')
  })

  it('收起侧栏时将品牌标记居中到窄侧栏', () => {
    const collapsedBrandBlocks = cssBlocks('\\.gc-workbench--nav-collapsed \\.gc-workbench__brand')

    expect(collapsedBrandBlocks).toHaveLength(1)
    expect(collapsedBrandBlocks[0]).toContain('align-self: stretch;')
    expect(collapsedBrandBlocks[0]).toContain('box-sizing: border-box;')
    expect(collapsedBrandBlocks[0]).toContain('display: grid;')
    expect(collapsedBrandBlocks[0]).toContain('gap: 0;')
    expect(collapsedBrandBlocks[0]).toContain('grid-template-columns: 1fr;')
    expect(collapsedBrandBlocks[0]).toContain('justify-items: center;')
    expect(collapsedBrandBlocks[0]).toContain('justify-content: center;')
    expect(collapsedBrandBlocks[0]).toContain('width: 100%;')

    const collapsedBrandTextBlocks = cssBlocks('\\.gc-workbench--nav-collapsed \\.gc-workbench__brand-text')
    expect(collapsedBrandTextBlocks).toHaveLength(1)
    expect(collapsedBrandTextBlocks[0]).toContain('position: absolute;')
  })
})

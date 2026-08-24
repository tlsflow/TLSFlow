import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const layout = readFileSync(resolve(process.cwd(), 'src/design-system/patterns/layout.css'), 'utf8')
const buttonComponent = readFileSync(resolve(process.cwd(), 'src/design-system/components/GcButton.vue'), 'utf8')
const dataTableComponent = readFileSync(resolve(process.cwd(), 'src/design-system/components/GcDataTable.vue'), 'utf8')
const emptyStateComponent = readFileSync(resolve(process.cwd(), 'src/design-system/components/GcEmptyState.vue'), 'utf8')

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
})

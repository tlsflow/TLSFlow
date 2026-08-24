import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const tokens = readFileSync(resolve(process.cwd(), 'src/design-system/tokens/index.css'), 'utf8')
const layout = readFileSync(resolve(process.cwd(), 'src/design-system/patterns/layout.css'), 'utf8')
const automationEditor = readFileSync(resolve(process.cwd(), 'src/views/automations/AutomationEditor.vue'), 'utf8')

describe('表单控件样式契约', () => {
  it('单行控件统一使用 42.5px 全局高度令牌', () => {
    expect(tokens).toContain('--gc-control-height-md: 42.5px;')
    expect(layout).toContain('height: var(--gc-control-height-md);')
  })

  it('自动化表单不允许网格拉伸单行控件', () => {
    expect(automationEditor).toContain('align-content: start;')
    expect(automationEditor).toContain("input:not([type='checkbox']), .automation-editor select:not([multiple])")
    expect(automationEditor).toContain('height: var(--gc-control-height-md);')
  })
})

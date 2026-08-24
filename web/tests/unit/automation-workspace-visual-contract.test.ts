import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'src', relativePath), 'utf8')
}

const sources = {
  automationsView: readSource('views/automations/AutomationsView.vue'),
  automationEditor: readSource('views/automations/AutomationEditor.vue'),
  automationPreview: readSource('views/automations/AutomationPreviewPanel.vue'),
  taskDrawer: readSource('views/tasks/TaskDrawer.vue'),
}

describe('自动化工作台视觉合同', () => {
  it('复用共享组件，不在业务页面重建工作台壳层', () => {
    expect(sources.automationsView).toContain('GcButton')
    expect(sources.automationsView).toContain('GcCard')
    expect(sources.automationsView).toContain('GcEmptyState')
    expect(sources.automationsView).toContain("confirmText: t('automations.actions.delete')")
    expect(sources.automationEditor).toContain('GcProgressBar')
    expect(sources.automationEditor).toContain('GcSelectionCard')
    expect(sources.automationPreview).toContain('GcCard')
    expect(sources.automationPreview).toContain('GcEmptyState')
    expect(sources.taskDrawer).toContain('GcButton')
    expect(sources.taskDrawer).toContain('GcProgressBar')
    expect(sources.taskDrawer).toContain('GcEmptyState')
    expect(sources.taskDrawer).toContain('task-drawer__item-force gc-button--danger')
    expect(sources.taskDrawer).toContain('variant="icon"')
    expect(sources.taskDrawer).toContain('<rect x="6" y="6" width="12" height="12" rx="2" />')
    expect(sources.taskDrawer).toContain('@click.stop="requestForceEndTask(task)"')
    expect(sources.taskDrawer).toContain('transform: translateY(-50%)')
    expect(sources.taskDrawer).toContain('v-model:open="forceCancelConfirmOpen"')
    expect(sources.taskDrawer).toContain('if (!task || forceCancelLoading.value) return')
    expect(sources.taskDrawer).not.toContain(':disabled="!canForceCancel(forceCancelTarget)"')
    expect(sources.taskDrawer).not.toContain('window.confirm')
    expect(Object.values(sources).join('\n')).not.toContain('ShellLayout')
  })

  it('只使用语义化视觉值，并保持用户可见时间本地化', () => {
    Object.values(sources).forEach((source) => {
      expect(source).not.toContain('--gc-color-legacy-')
      expect(source).not.toMatch(/(?:#[0-9a-f]{3,8}|rgb\(|hsl\()/i)
      expect(source).not.toMatch(/\d+px/)
      expect(source).not.toContain('toISOString')
      expect(source).not.toContain('toUTCString')
    })

    expect(sources.automationsView).toContain('formatMaybeLocalTime')
    expect(sources.automationPreview).toContain('formatBrowserLocalTime')
    expect(sources.taskDrawer).toContain('formatBrowserLocalTime')
  })
})

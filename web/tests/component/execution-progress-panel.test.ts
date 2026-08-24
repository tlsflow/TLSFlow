import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import GcExecutionProgressPanel from '@/design-system/components/GcExecutionProgressPanel.vue'

describe('GcExecutionProgressPanel', () => {
  it('以普通用户可理解的五阶段展示证书更新流程', () => {
    const wrapper = mount(GcExecutionProgressPanel, {
      global: { plugins: [i18n] },
      props: {
        mode: 'execution',
        runId: 'run-1',
        requestId: 'request-1',
        steps: [
          { id: '1', name: 'DISCOVER target-1', stepType: 'DISCOVER', status: 'SUCCESS', startedAt: '2026/07/29 10:00:00', finishedAt: '2026/07/29 10:00:01' },
          { id: '2', name: 'BACKUP target-1', stepType: 'BACKUP', status: 'SUCCESS', startedAt: '2026/07/29 10:00:02', finishedAt: '2026/07/29 10:00:03' },
          { id: '3', name: 'CUSTOM plugin-version-1', stepType: 'INSTALL', status: 'RUNNING', startedAt: '2026/07/29 10:00:04' },
          { id: '4', name: 'RELOAD target-1', stepType: 'RELOAD', status: 'PENDING' },
          { id: '5', name: 'VERIFY target-1', stepType: 'VERIFY', status: 'PENDING' },
        ],
        lines: [],
      },
    })

    const text = wrapper.text()
    expect(text).toContain('证书准备')
    expect(text).toContain('备份')
    expect(text).toContain('更新')
    expect(text).toContain('重载')
    expect(text).toContain('验证')
    expect(text).toContain('将新证书安全应用到目标服务')
    expect(text).toContain('查看详细记录')
    expect(text).not.toContain('CUSTOM plugin-version-1')
    expect(text).not.toContain('RUNNING')
  })
})

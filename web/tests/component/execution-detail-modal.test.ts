import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import GcExecutionDetailModal from '@/design-system/components/GcExecutionDetailModal.vue'
import { i18n } from '@/i18n'

describe('GcExecutionDetailModal', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    document.documentElement.classList.remove('gc-modal-open')
  })

  it('统一展示执行概览、步骤和日志标签页', async () => {
    const wrapper = mount(GcExecutionDetailModal, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: {
        open: true,
        row: {
          id: 'run_1',
          name: 'xd.jacksonz.cn 证书部署',
          planName: 'xd.jacksonz.cn 证书部署',
          status: 'SUCCESS',
          risk: 'HIGH',
          runTypeLabel: '正式执行',
          sourceLabel: '部署计划',
          assetNames: ['xd.jacksonz.cn'],
          raw: {
            id: 'run_1',
            type: 'apply',
            status: 'SUCCESS',
            startedAt: '2026-08-18T01:16:29.000Z',
            finishedAt: '2026-08-18T01:16:43.000Z',
          },
        },
        summary: {
          state: 'passed',
          label: '执行完成',
          detail: '全部步骤已完成。',
          passed: 1,
          warning: 0,
          failed: 0,
          unknown: 0,
        },
        steps: [{
          id: 'step-1',
          name: '证书准备',
          status: 'SUCCESS',
          detail: '检查证书材料和目标状态。',
          startedAt: '2026-08-18T01:16:29.000Z',
          finishedAt: '2026-08-18T01:16:29.000Z',
          unknownResult: false,
        }],
        lines: [{
          id: 'line-1',
          time: '2026/08/18 09:16:29',
          level: 'info',
          step: '证书准备',
          message: '执行完成',
        }],
      },
    })

    expect(document.body.textContent).toContain('执行详情 run_1')
    expect(document.body.textContent).toContain('xd.jacksonz.cn 证书部署')
    expect(document.body.textContent).toContain('执行 ID')
    expect(document.body.textContent).toContain('执行完成')

    const tabButtons = document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    expect(tabButtons).toHaveLength(3)
    tabButtons[1]?.click()
    await nextTick()
    expect(document.body.textContent).toContain('证书准备')
    tabButtons[2]?.click()
    await nextTick()
    expect(document.body.textContent).toContain('执行完成')

    wrapper.unmount()
  })
})

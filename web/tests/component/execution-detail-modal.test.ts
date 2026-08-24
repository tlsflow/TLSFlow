import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import GcExecutionDetailModal from '@/design-system/components/GcExecutionDetailModal.vue'
import { i18n } from '@/i18n'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

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

  it('运行记录没有时间字段时，从步骤时间聚合概览并按本地时间显示', async () => {
    const startedAt = '2026-08-18T01:16:29.000Z'
    const finishedAt = '2026-08-18T01:16:43.000Z'
    const wrapper = mount(GcExecutionDetailModal, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: {
        open: true,
        row: {
          id: 'run_without_times',
          name: '证书部署',
          status: 'SUCCESS',
          risk: 'HIGH',
          raw: { id: 'run_without_times', status: 'SUCCESS' },
        },
        steps: [
          { id: 'step-1', name: '准备', status: 'SUCCESS', startedAt: startedAt, finishedAt: '2026-08-18T01:16:31.000Z', unknownResult: false },
          { id: 'step-2', name: '验证', status: 'SUCCESS', startedAt: '2026-08-18T01:16:38.000Z', finishedAt, unknownResult: false },
        ],
      },
    })

    expect(document.body.textContent).toContain(formatBrowserLocalTime(startedAt))
    expect(document.body.textContent).toContain(formatBrowserLocalTime(finishedAt))

    wrapper.unmount()
  })

  it('优先展示执行详情解析出的目标名称', () => {
    const wrapper = mount(GcExecutionDetailModal, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: {
        open: true,
        targetLabel: 'cloud.jacksonz.cn',
        row: {
          id: 'run_target_label',
          name: '证书部署',
          status: 'SUCCESS',
          risk: 'HIGH',
          raw: { id: 'run_target_label', status: 'SUCCESS' },
        },
      },
    })

    expect(document.body.textContent).toContain('cloud.jacksonz.cn')

    wrapper.unmount()
  })
})

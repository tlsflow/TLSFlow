import { describe, expect, it, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import GcDryRunResultModal from '@/design-system/components/GcDryRunResultModal.vue'

describe('GcDryRunResultModal', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('以任务列表展示 dry-run 进度，并按间隔逐步揭示任务', async () => {
    vi.useFakeTimers()

    const wrapper = mount(GcDryRunResultModal, {
      attachTo: document.body,
      props: {
        open: true,
        polling: true,
        runId: 'run_1',
        requestId: 'req_1',
        summary: {
          state: 'running',
          label: 'Dry-run 回传中',
          detail: '已收到部分结论，仍有步骤尚未完成。',
          passed: 2,
          warning: 0,
          failed: 0,
          unknown: 0,
        },
        steps: [
          {
            id: 'step-1',
            name: 'DISCOVER target-1',
            status: 'SUCCESS',
            detail: '识别部署目标与 IIS 站点上下文。',
            startedAt: '2026/07/01 11:00:00',
            finishedAt: '2026/07/01 11:00:02',
          },
          {
            id: 'step-2',
            name: 'VERIFY target-1',
            status: 'RUNNING',
            detail: '校验证书材料、目标绑定和域名匹配。',
            startedAt: '2026/07/01 11:00:03',
          },
        ],
        lines: [
          { id: 'line-1', time: '2026/07/01 11:00:01', level: 'info', step: 'DISCOVER target-1', message: 'IIS 站点存在: 已命中 IIS 站点 TEST' },
          { id: 'line-2', time: '2026/07/01 11:00:02', level: 'info', step: 'DISCOVER target-1', message: 'PFX loadable: PFX can be parsed locally' },
          { id: 'line-3', time: '2026/07/01 11:00:03', level: 'info', step: 'VERIFY target-1', message: 'Certificate domain match: Certificate domains match the expected target domains' },
        ],
        checks: [
          { key: 'site_exists', label: 'IIS 站点存在', status: 'passed', detail: '已命中 IIS 站点 TEST' },
        ],
      },
    })

    const bodyText = () => document.body.textContent ?? ''

    expect(bodyText()).toContain('任务进度')
    expect(bodyText()).toContain('环境识别')
    expect(bodyText()).not.toContain('结果校验')
    expect(bodyText()).toContain('检查结论')
    expect(bodyText()).not.toContain('执行日志')
    expect(bodyText()).toContain('50%')
    expect(bodyText()).toContain('1/2')

    await vi.advanceTimersByTimeAsync(2050)

    expect(bodyText()).toContain('结果校验')
    expect(bodyText()).toContain('最新事件')
    expect(bodyText()).toContain('展开事件')
    expect(bodyText()).toContain('查看完整日志')
    expect(bodyText()).toContain('1/2')

    wrapper.unmount()
  })

  it('证书更新执行模式在右侧展示逐条完成日志，不显示检查结论', async () => {
    vi.useFakeTimers()

    const wrapper = mount(GcDryRunResultModal, {
      attachTo: document.body,
      props: {
        open: true,
        mode: 'execution',
        summary: null,
        steps: [
          {
            id: 'step-1',
            name: 'BACKUP target-1',
            status: 'SUCCESS',
            detail: '备份当前证书绑定。',
            startedAt: '2026/07/01 16:47:59',
            finishedAt: '2026/07/01 16:47:59',
          },
          {
            id: 'step-2',
            name: 'RELOAD target-1',
            status: 'SUCCESS',
            detail: '刷新站点绑定。',
            startedAt: '2026/07/01 16:48:00',
            finishedAt: '2026/07/01 16:48:01',
          },
        ],
        lines: [
          { id: 'line-1', time: '2026/07/01 16:47:59', level: 'info', step: 'BACKUP target-1', message: 'backup completed: 已完成当前证书绑定备份' },
          { id: 'line-2', time: '2026/07/01 16:48:01', level: 'info', step: 'RELOAD target-1', message: 'binding refreshed: 已完成 IIS 绑定刷新' },
        ],
      },
    })

    const bodyText = () => document.body.textContent ?? ''

    expect(bodyText()).toContain('执行日志')
    expect(bodyText()).not.toContain('检查结论')
    expect(bodyText()).not.toContain('最新事件')
    expect(bodyText()).toContain('已完成当前证书绑定备份')
    expect(bodyText()).toContain('50%')
    expect(bodyText()).toContain('1/2')

    await vi.advanceTimersByTimeAsync(2050)

    expect(bodyText()).toContain('已完成 IIS 绑定刷新')
    expect(bodyText()).toContain('2/2')

    wrapper.unmount()
  })
})

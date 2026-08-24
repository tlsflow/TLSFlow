import { describe, expect, it, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import GcDryRunResultModal from '@/design-system/components/GcDryRunResultModal.vue'
import { i18n } from '@/i18n'

describe('GcDryRunResultModal', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('dry-run 与正式执行一致地实时展示任务日志和预检结论', async () => {
    const wrapper = mount(GcDryRunResultModal, {
      attachTo: document.body,
      global: { plugins: [i18n] },
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
    expect(bodyText()).toContain('证书准备')
    expect(bodyText()).toContain('验证')
    expect(bodyText()).toContain('检查结论')
    expect(bodyText()).toContain('执行动态')
    expect(bodyText()).toContain('已命中 IIS 站点 TEST')
    expect(bodyText()).not.toContain('Certificate domains match the expected target domains')
    expect(bodyText()).toContain('50%')
    expect(bodyText()).toContain('1/2')
    expect(bodyText()).toContain('查看详细记录')

    wrapper.unmount()
  })

  it('证书更新执行模式立即展示实时任务日志，不使用定时假揭示', async () => {
    const wrapper = mount(GcDryRunResultModal, {
      attachTo: document.body,
      global: { plugins: [i18n] },
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

    expect(bodyText()).toContain('执行动态')
    expect(bodyText()).not.toContain('检查结论')
    expect(bodyText()).not.toContain('最新事件')
    expect(bodyText()).toContain('保存当前状态，确保需要时可以安全恢复')
    expect(bodyText()).toContain('让服务加载新证书，并等待运行状态稳定')
    expect(bodyText()).toContain('100%')
    expect(bodyText()).toContain('2/2')

    wrapper.unmount()
  })

  it('执行日志默认跟随最新任务，用户上翻后暂停自动滚动', async () => {
    const initialSteps = [
      {
        id: 'step-1',
        name: 'BACKUP target-1',
        status: 'SUCCESS',
        detail: '备份完成。',
        startedAt: '2026/07/21 11:08:12',
        finishedAt: '2026/07/21 11:08:13',
      },
      {
        id: 'step-2',
        name: 'INSTALL target-1',
        status: 'RUNNING',
        detail: '正在安装证书。',
        startedAt: '2026/07/21 11:08:13',
      },
    ]
    const wrapper = mount(GcDryRunResultModal, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: {
        open: true,
        mode: 'execution',
        summary: null,
        steps: initialSteps,
        lines: [],
      },
    })
    const feedElement = document.querySelector('.gc-dry-run-modern__feed-list') as HTMLUListElement | null
    expect(feedElement).not.toBeNull()
    if (!feedElement) throw new Error('执行日志列表未渲染')
    let scrollHeight = 400
    Object.defineProperty(feedElement, 'scrollHeight', { configurable: true, get: () => scrollHeight })
    Object.defineProperty(feedElement, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(feedElement, 'scrollTop', { configurable: true, writable: true, value: 200 })

    scrollHeight = 600
    await wrapper.setProps({
      steps: [
        { ...initialSteps[0] },
        { ...initialSteps[1], status: 'SUCCESS', finishedAt: '2026/07/21 11:08:14' },
        {
          id: 'step-3',
          name: 'VERIFY target-1',
          status: 'RUNNING',
          detail: '正在验证证书。',
          startedAt: '2026/07/21 11:08:14',
        },
      ],
    })
    await nextTick()
    expect(feedElement.scrollTop).toBe(600)
    expect(document.body.textContent).toContain('检查服务是否已正确使用新证书。')

    feedElement.scrollTop = 100
    feedElement.dispatchEvent(new Event('scroll'))
    await nextTick()
    scrollHeight = 800
    await wrapper.setProps({
      steps: [
        { ...initialSteps[0] },
        { ...initialSteps[1], status: 'SUCCESS', finishedAt: '2026/07/21 11:08:14' },
        {
          id: 'step-3',
          name: 'VERIFY target-1',
          status: 'SUCCESS',
          detail: '证书验证完成。',
          startedAt: '2026/07/21 11:08:14',
          finishedAt: '2026/07/21 11:08:15',
        },
        {
          id: 'step-4',
          name: 'CLEANUP target-1',
          status: 'RUNNING',
          detail: '正在清理临时文件。',
          startedAt: '2026/07/21 11:08:15',
        },
      ],
    })
    await nextTick()
    expect(feedElement.scrollTop).toBe(100)

    wrapper.unmount()
  })
})

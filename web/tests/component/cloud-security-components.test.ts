import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GcButton from '@/design-system/components/GcButton.vue'
import GcCard from '@/design-system/components/GcCard.vue'
import GcDonutChart from '@/design-system/components/GcDonutChart.vue'
import GcProgressBar from '@/design-system/components/GcProgressBar.vue'
import GcSelectionCard from '@/design-system/components/GcSelectionCard.vue'
import GcTrendChart from '@/design-system/components/GcTrendChart.vue'

describe('Cloud Security Pro 共享组件', () => {
  it('GcButton 提供四种变体并在忙碌时禁止提交', () => {
    const wrapper = mount(GcButton, {
      props: { variant: 'primary', type: 'submit', loading: true },
      slots: { default: '提交' },
    })

    const button = wrapper.get('button')
    expect(button.classes()).toContain('gc-button--primary')
    expect(button.attributes('type')).toBe('submit')
    expect(button.attributes('aria-busy')).toBe('true')
    expect((button.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('GcCard 按 Header、Body、Footer 插槽建立稳定结构', () => {
    const wrapper = mount(GcCard, {
      slots: {
        header: '<h2>标题</h2>',
        body: '<p>正文</p>',
        footer: '<button>操作</button>',
      },
    })

    expect(wrapper.find('.gc-pro-card__header').text()).toBe('标题')
    expect(wrapper.find('.gc-pro-card__body').text()).toBe('正文')
    expect(wrapper.find('.gc-pro-card__footer').text()).toBe('操作')
  })

  it('GcProgressBar 归一化边界值并映射 StatusTone', () => {
    const wrapper = mount(GcProgressBar, {
      props: { value: 120, max: 100, tone: 'success', ariaLabel: '证书有效期进度' },
      slots: { default: '已完成' },
    })

    const progress = wrapper.get('[role="progressbar"]')
    expect(progress.classes()).toContain('gc-progress--success')
    expect(progress.attributes('aria-valuenow')).toBe('100')
    expect(progress.get('.gc-progress__fill').attributes('style')).toContain('width: 100%')
    expect(progress.text()).toBe('已完成')
  })

  it('GcProgressBar 按需显示完整进度轨道边界', () => {
    const wrapper = mount(GcProgressBar, {
      props: { value: 100, outlined: true, ariaLabel: '证书有效期进度' },
    })

    expect(wrapper.get('[role="progressbar"]').classes()).toContain('gc-progress--outlined')
  })

  it('GcProgressBar 可将标签放入加高的进度轨道内部', () => {
    const wrapper = mount(GcProgressBar, {
      props: { value: 100, captionInside: true, ariaLabel: '任务进度' },
      slots: { default: '100%' },
    })

    const progress = wrapper.get('[role="progressbar"]')
    expect(progress.classes()).toContain('gc-progress--caption-inside')
    expect(progress.get('.gc-progress__track .gc-progress__caption').text()).toBe('100%')
    expect(progress.findAll('.gc-progress__caption')).toHaveLength(1)
  })

  it('GcSelectionCard 通过受控事件切换选择状态', async () => {
    const wrapper = mount(GcSelectionCard, {
      props: { title: '证书部署', description: '选择部署目标' },
    })

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
    expect(wrapper.emitted('select')).toEqual([[true]])
    expect(wrapper.get('button').attributes('aria-pressed')).toBe('false')

    await wrapper.setProps({ modelValue: true })
    expect(wrapper.get('button').classes()).toContain('gc-selection-card--selected')
    expect(wrapper.get('button').attributes('aria-pressed')).toBe('true')
  })

  it('GcTrendChart 忽略非法数据并应用 StatusTone', () => {
    const wrapper = mount(GcTrendChart, {
      props: {
        data: [{ value: 12 }, { value: 24 }, { value: Number.NaN }, { value: 36 }],
        ariaLabel: '证书趋势',
        emptyLabel: '暂无趋势数据',
        tone: 'warning',
      },
    })

    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('证书趋势')
    expect(wrapper.classes()).toContain('gc-trend-chart--warning')
    expect(wrapper.findAll('.gc-trend-chart__point')).toHaveLength(3)
    expect(wrapper.findAll('.gc-trend-chart__point').every((point) => point.element.tagName === 'SPAN')).toBe(true)
    expect(wrapper.findAll('.gc-trend-chart__point').every((point) => point.attributes('aria-hidden') === 'true')).toBe(true)
    expect(wrapper.findAll('.gc-trend-chart__line')).toHaveLength(1)
    expect(wrapper.findAll('.gc-trend-chart__area')).toHaveLength(1)
    expect(wrapper.html()).not.toContain('NaN')
  })

  it('GcTrendChart 提供平滑曲线与键盘可访问的数值提示', async () => {
    const wrapper = mount(GcTrendChart, {
      props: {
        data: [{ value: 12 }, { value: 24 }, { value: 18 }],
        ariaLabel: '证书趋势',
        emptyLabel: '暂无趋势数据',
      },
    })

    expect(wrapper.find('.gc-trend-chart__line').attributes('d')).toContain('C ')
    await wrapper.get('[role="img"]').trigger('focus')
    expect(wrapper.find('.gc-trend-chart__tooltip').text()).toBe('12')
    await wrapper.get('[role="img"]').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.find('.gc-trend-chart__tooltip').text()).toBe('24')
    await wrapper.findAll('.gc-trend-chart__point')[2].trigger('pointerenter')
    expect(wrapper.find('.gc-trend-chart__tooltip').text()).toBe('18')
    expect(wrapper.findAll('.gc-trend-chart__point')[2].classes()).toContain('gc-trend-chart__point--active')
  })

  it('GcTrendChart 在无有效数据时显示调用方提供的空态文案', () => {
    const wrapper = mount(GcTrendChart, {
      props: {
        data: [{ value: Number.POSITIVE_INFINITY }],
        ariaLabel: '证书趋势',
        emptyLabel: '暂无趋势数据',
      },
    })

    expect(wrapper.find('.gc-trend-chart__empty').text()).toBe('暂无趋势数据')
  })

  it('GcDonutChart 归一化有效分段并映射各分段 StatusTone', () => {
    const wrapper = mount(GcDonutChart, {
      props: {
        segments: [
          { value: 7, tone: 'success' },
          { value: 3, tone: 'danger' },
          { value: Number.NaN, tone: 'info' },
          { value: -1, tone: 'warning' },
        ],
        ariaLabel: '证书状态分布',
        emptyLabel: '暂无状态数据',
      },
      slots: { center: '<strong>10</strong>' },
    })

    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('证书状态分布')
    expect(wrapper.findAll('.gc-donut-chart__segment')).toHaveLength(2)
    expect(wrapper.find('.gc-donut-chart__segment--success').exists()).toBe(true)
    expect(wrapper.find('.gc-donut-chart__segment--danger').exists()).toBe(true)
    expect(wrapper.find('.gc-donut-chart__center').text()).toBe('10')
    expect(wrapper.html()).not.toContain('NaN')
  })

  it('GcDonutChart 在无有效分段时显示调用方提供的空态文案', () => {
    const wrapper = mount(GcDonutChart, {
      props: {
        segments: [{ value: 0, tone: 'muted' }],
        ariaLabel: '证书状态分布',
        emptyLabel: '暂无状态数据',
      },
    })

    expect(wrapper.find('.gc-donut-chart__empty').text()).toBe('暂无状态数据')
  })
})

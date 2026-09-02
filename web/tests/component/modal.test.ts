import { describe, expect, it, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import GcModal from '@/design-system/components/GcModal.vue'

describe('GcModal', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
    document.documentElement.classList.remove('gc-modal-open')
  })

  it('点击背景遮罩不会关闭模态框', async () => {
    const wrapper = mount(GcModal, {
      attachTo: document.body,
      props: {
        open: true,
        title: '测试模态框',
      },
      slots: {
        default: '<p>模态框内容</p>',
      },
    })

    const mask = document.body.querySelector<HTMLElement>('.gc-modal__mask')
    expect(mask).not.toBeNull()

    await mask?.click()

    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(document.body.textContent).toContain('模态框内容')

    wrapper.unmount()
  })

  it('使用 CertVault 基准结构渲染遮罩、内容容器和 footer', () => {
    const wrapper = mount(GcModal, {
      attachTo: document.body,
      props: {
        open: true,
        title: '测试模态框',
      },
      slots: {
        default: '<p>模态框内容</p>',
        actions: '<button type="button">保存</button>',
      },
    })

    const mask = document.body.querySelector<HTMLElement>('.gc-modal__mask')
    const modal = document.body.querySelector<HTMLElement>('.gc-modal')
    const header = document.body.querySelector<HTMLElement>('.gc-modal__header')
    const body = document.body.querySelector<HTMLElement>('.gc-modal__body')
    const footer = document.body.querySelector<HTMLElement>('.gc-modal__actions')

    expect(mask).not.toBeNull()
    expect(modal).not.toBeNull()
    expect(header).not.toBeNull()
    expect(body).not.toBeNull()
    expect(footer).not.toBeNull()
    expect(footer?.parentElement).toBe(modal)
    expect(footer?.parentElement).not.toBe(body?.parentElement)

    wrapper.unmount()
  })

  it('将调用方指定的对话框 class 挂到 Teleport 中的实际容器', () => {
    const wrapper = mount(GcModal, {
      attachTo: document.body,
      props: {
        open: true,
        title: '测试模态框',
        dialogClass: 'device-detail-dialog',
      },
    })

    expect(document.body.querySelector('.gc-modal.device-detail-dialog')).not.toBeNull()

    wrapper.unmount()
  })

  it('无标题或无操作区时由正文补齐模态框外缘留白状态', () => {
    const wrapper = mount(GcModal, {
      attachTo: document.body,
      props: { open: true },
      slots: { default: '<p>模态框内容</p>' },
    })

    const modal = document.body.querySelector<HTMLElement>('.gc-modal')
    expect(modal?.classList.contains('gc-modal--without-header')).toBe(true)
    expect(modal?.classList.contains('gc-modal--without-actions')).toBe(true)

    wrapper.unmount()
  })

  it('显式传入 closeOnBackdrop 也不能通过遮罩关闭', async () => {
    const wrapper = mount(GcModal, {
      attachTo: document.body,
      props: {
        open: true,
        title: '测试模态框',
        closeOnBackdrop: true,
      },
      slots: {
        default: '<p>模态框内容</p>',
      },
    })

    const mask = document.body.querySelector<HTMLElement>('.gc-modal__mask')
    expect(mask).not.toBeNull()

    await mask?.click()

    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(document.body.textContent).toContain('模态框内容')

    wrapper.unmount()
  })

  it('打开时锁定背景滚动并在关闭后恢复', async () => {
    const wrapper = mount(GcModal, {
      attachTo: document.body,
      props: {
        open: true,
        title: '测试模态框',
        edgeToEdge: true,
      },
    })

    expect(document.body.style.overflow).toBe('hidden')
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(document.documentElement.classList.contains('gc-modal-open')).toBe(true)
    expect(document.body.querySelector('.gc-modal__mask--edge-to-edge')).not.toBeNull()

    await wrapper.setProps({ open: false })

    expect(document.body.style.overflow).toBe('')
    expect(document.documentElement.style.overflow).toBe('')
    expect(document.documentElement.classList.contains('gc-modal-open')).toBe(false)
    wrapper.unmount()
  })

  it('打开时捕获焦点，Tab 在模态框内循环，Escape 关闭并恢复触发焦点', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()

    const wrapper = mount(GcModal, {
      attachTo: document.body,
      props: { open: false, title: '测试模态框' },
      slots: { actions: '<button type="button">保存</button>' },
    })

    await wrapper.setProps({ open: true })
    await nextTick()

    const closeButton = document.body.querySelector<HTMLButtonElement>('.gc-modal__close')
    const actionButton = document.body.querySelector<HTMLButtonElement>('.gc-modal__actions button')
    expect(document.activeElement).toBe(closeButton)

    actionButton?.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    await nextTick()
    expect(document.activeElement).toBe(closeButton)

    closeButton?.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }))
    await nextTick()
    expect(document.activeElement).toBe(actionButton)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.emitted('update:open')).toEqual([[false]])

    await wrapper.setProps({ open: false })
    await nextTick()
    wrapper.unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('提交中禁用内容控件和关闭按钮，并显示传入错误', async () => {
    const wrapper = mount(GcModal, {
      attachTo: document.body,
      props: { open: true, title: '编辑', busy: true, error: '保存失败' },
      slots: {
        default: '<input name="name" />',
        actions: '<button type="submit">保存</button>',
      },
    })
    await nextTick()

    expect(document.body.querySelector<HTMLInputElement>('input')?.disabled).toBe(true)
    expect(document.body.querySelector<HTMLButtonElement>('.gc-modal__actions button')?.disabled).toBe(true)
    expect(document.body.querySelector<HTMLButtonElement>('.gc-modal__close')?.disabled).toBe(true)
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('保存失败')

    wrapper.unmount()
  })

  it('忙碌时忽略 Escape，避免提交过程被意外关闭', () => {
    const wrapper = mount(GcModal, {
      attachTo: document.body,
      props: { open: true, title: '编辑', busy: true },
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(wrapper.emitted('update:open')).toBeUndefined()
    wrapper.unmount()
  })

  it('允许调用方在忙碌时关闭窗口，但仍禁用内容控件', async () => {
    const wrapper = mount(GcModal, {
      attachTo: document.body,
      props: { open: true, title: '部署', busy: true, closeableWhileBusy: true },
      slots: { default: '<input name="name" />' },
    })
    await nextTick()

    const closeButton = document.body.querySelector<HTMLButtonElement>('.gc-modal__close')
    expect(closeButton?.disabled).toBe(false)
    expect(document.body.querySelector<HTMLInputElement>('input')?.disabled).toBe(true)

    closeButton?.click()
    await nextTick()
    expect(wrapper.emitted('update:open')).toEqual([[false]])
    wrapper.unmount()
  })
})

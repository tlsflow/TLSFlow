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
})

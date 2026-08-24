import { describe, expect, it, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
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
})

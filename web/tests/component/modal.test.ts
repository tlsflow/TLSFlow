import { describe, expect, it, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import GcModal from '@/design-system/components/GcModal.vue'

describe('GcModal', () => {
  afterEach(() => {
    document.body.innerHTML = ''
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
})

import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SecurityAdminPage from '@/views/settings/SecurityAdminPage.vue'

describe('SecurityAdminPage', () => {
  it('在页面操作区保留刷新加载行为', async () => {
    const load = vi.fn().mockResolvedValue({
      data: {
        items: [{ id: 'mapping-1' }],
        page: 1,
        pageSize: 20,
        total: 1,
      },
      requestId: 'test-request',
      timestamp: '2026-08-11T00:00:00.000Z',
    })
    const wrapper = mount(SecurityAdminPage, {
      props: {
        config: {
          resourceName: '映射',
          columns: [{ key: 'id', title: 'ID' }],
          load,
        },
      },
    })
    await flushPromises()

    expect(wrapper.find('section.gc-page.security-admin').exists()).toBe(true)
    const toolbar = wrapper.get('.gc-page-toolbar')
    expect(toolbar.text()).toContain('刷新')
    expect(wrapper.text()).toContain('mapping-1')

    ;(toolbar.get('button').element as HTMLButtonElement).click()
    await flushPromises()
    expect(load).toHaveBeenCalledTimes(2)

    wrapper.unmount()
  })
})

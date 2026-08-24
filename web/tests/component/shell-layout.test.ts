import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { i18n } from '@/i18n'
import ShellLayout from '@/layouts/ShellLayout.vue'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: ShellLayout,
        children: [
          { path: '/dashboard', name: 'dashboard', component: { template: '<div />' }, meta: { title: '仪表盘', titleKey: 'nav.dashboard', module: 'dashboard', requiresAuth: true, heroTitle: true } },
          { path: '/certificates', name: 'certificates', component: { template: '<div />' }, meta: { title: '证书', titleKey: 'nav.certificates', module: 'certificate', requiresAuth: true, heroTitle: true } },
          { path: '/workflows', name: 'workflows', component: { template: '<div />' }, meta: { title: '工作流', titleKey: 'nav.workflowTemplates', module: 'workflow-template', requiresAuth: true, heroTitle: true } },
        ],
      },
    ],
  })
}

describe('ShellLayout', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAuthStore().setSession({
      user: {
        id: 'user-1',
        username: 'admin',
        displayName: '系统管理员',
        tenantId: 'tenant-1',
        tenantName: '默认租户',
        roles: ['admin'],
      },
    })
    usePermissionStore().setPermissions([
      'certificate.asset.read',
      'service_asset.read',
      'deployment.plan.read',
      'workflow.read',
      'automation.read',
      'execution.run.read',
      'plugin.read',
      'monitor.target.read',
      'audit.read',
      'settings.read',
      'credential.read',
      'notification.channel.read',
      'security.user.read',
      'security.role.read',
      'security.identity_source.read',
      'binding.read',
      'ca.operations.read',
      'cloud_account_asset.read',
      'host.read',
      'gateway.read',
    ])
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('使用侧栏、上下文栏和内容区组成统一工作台', async () => {
    const router = createTestRouter()
    await router.push('/dashboard')
    await router.isReady()

    const wrapper = mount(ShellLayout, {
      global: {
        plugins: [router, i18n],
        stubs: { RouterLink: false, RouterView: { template: '<div data-test="page-content" />' } },
      },
    })

    expect(wrapper.find('.gc-workbench__sidebar').exists()).toBe(true)
    expect(wrapper.find('.gc-workbench__topbar').exists()).toBe(true)
    expect(wrapper.find('.gc-workbench__content').exists()).toBe(true)
    expect(wrapper.find('.gc-workbench__nav-item--active').text()).toContain('总览')
    expect(wrapper.find('.gc-workbench__context-title').text()).toContain('总览')
    expect(wrapper.find('[data-test="page-content"]').exists()).toBe(true)
  })

  it('保留 activePaths 对子路由的定位能力', async () => {
    const router = createTestRouter()
    await router.push('/workflows')
    await router.isReady()

    const wrapper = mount(ShellLayout, {
      global: {
        plugins: [router, i18n],
        stubs: { RouterLink: false, RouterView: { template: '<div />' } },
      },
    })

    const activeItem = wrapper.find('.gc-workbench__nav-item--active')
    expect(activeItem.exists()).toBe(true)
    expect(activeItem.text()).toContain('部署')
    expect(wrapper.find('.gc-workbench__submenu-item--active').text()).toContain('工作流')
  })

  it('移动端导航支持打开、遮罩关闭和 Escape 恢复焦点', async () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = (() => ({
      media: '(max-width: 60rem)',
      onchange: null,
      matches: true,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia

    try {
      const router = createTestRouter()
      await router.push('/dashboard')
      await router.isReady()
      const wrapper = mount(ShellLayout, {
        attachTo: document.body,
        global: {
          plugins: [router, i18n],
          stubs: { RouterLink: false, RouterView: { template: '<div />' } },
        },
      })

      const toggle = wrapper.find('.gc-workbench__mobile-toggle')
      const toggleElement = toggle.element as HTMLButtonElement
      toggleElement.focus()
      await toggle.trigger('click')
      expect(wrapper.find('.gc-workbench__scrim').exists()).toBe(true)
      expect(wrapper.find('.gc-workbench__sidebar').attributes('aria-hidden')).toBe('false')

      await wrapper.find('.gc-workbench__scrim').trigger('click')
      expect(wrapper.find('.gc-workbench__scrim').exists()).toBe(false)

      await toggle.trigger('click')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.gc-workbench__scrim').exists()).toBe(false)
      expect(document.activeElement).toBe(toggle.element as HTMLElement)
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })
})

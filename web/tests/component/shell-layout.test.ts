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
      'task.read',
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
    document.documentElement.classList.remove('gc-modal-open')
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
    expect(wrapper.find('.gc-workbench__nav-item--active').text()).toContain('仪表盘')
    expect(wrapper.find('.gc-workbench__context-title').text()).toContain('仪表盘')
    expect(wrapper.find('#gc-shell-hero-leading').exists()).toBe(false)
    expect(wrapper.find('#gc-shell-hero-actions').exists()).toBe(false)
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

    const contextChildren = Array.from(wrapper.get('.gc-workbench__context').element.children)
    expect(contextChildren[0]?.classList.contains('gc-workbench__context-heading')).toBe(true)
    expect(contextChildren[1]?.tagName).toBe('NAV')
  })

  it('将全局任务入口紧邻右侧用户菜单', async () => {
    const router = createTestRouter()
    await router.push('/dashboard')
    await router.isReady()

    const wrapper = mount(ShellLayout, {
      global: {
        plugins: [router, i18n],
        stubs: { RouterLink: false, RouterView: { template: '<div />' } },
      },
    })

    const accountActions = wrapper.get('.gc-workbench__account-actions')
    const accountChildren = Array.from(accountActions.element.children)
    expect(accountChildren[0]?.classList.contains('gc-shell__task-entry')).toBe(true)
    expect(accountChildren[1]?.classList.contains('gc-shell__user')).toBe(true)
  })

  it('将设置固定在侧栏底部，并将视图切换放入用户菜单', async () => {
    const router = createTestRouter()
    await router.push('/dashboard')
    await router.isReady()

    const wrapper = mount(ShellLayout, {
      global: {
        plugins: [router, i18n],
        stubs: { RouterLink: false, RouterView: { template: '<div />' } },
      },
    })

    expect(wrapper.find('.gc-workbench__sidebar-footer .gc-workbench__settings-item').exists()).toBe(true)
    expect(wrapper.find('.gc-workbench__sidebar-meta .gc-workbench__sidebar-toggle').exists()).toBe(true)
    expect(wrapper.find('.gc-workbench__version').text()).toContain('版本 0.1.0')
    expect(wrapper.find('.gc-workbench__sidebar-footer .gc-workbench__view-mode').exists()).toBe(false)

    await wrapper.get('.gc-shell__user-button').trigger('click')
    expect(wrapper.find('.gc-shell__user-menu .gc-shell__view-mode').exists()).toBe(true)
  })

  it('支持桌面侧栏收起展开，并在模态打开时临时收起后恢复', async () => {
    const router = createTestRouter()
    await router.push('/dashboard')
    await router.isReady()

    const wrapper = mount(ShellLayout, {
      global: {
        plugins: [router, i18n],
        stubs: { RouterLink: false, RouterView: { template: '<div />' } },
      },
    })

    const toggle = wrapper.get('.gc-workbench__sidebar-toggle')
    await toggle.trigger('click')
    expect(wrapper.classes()).toContain('gc-workbench--nav-collapsed')
    expect(wrapper.get('.gc-workbench__nav-item').attributes('title')).toBeTruthy()
    expect(wrapper.find('.gc-workbench--nav-collapsed .gc-workbench__nav-active-mark').exists()).toBe(false)

    await toggle.trigger('click')
    expect(wrapper.classes()).not.toContain('gc-workbench--nav-collapsed')

    document.documentElement.classList.add('gc-modal-open')
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(wrapper.classes()).toContain('gc-workbench--nav-collapsed')

    document.documentElement.classList.remove('gc-modal-open')
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(wrapper.classes()).not.toContain('gc-workbench--nav-collapsed')
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

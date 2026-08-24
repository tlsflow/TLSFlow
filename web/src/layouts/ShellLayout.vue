<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, RouterLink, RouterView } from 'vue-router'
import { useRouter } from 'vue-router'
import { changeCurrentUserPassword } from '@/api/modules/security.api'
import { listTasks, type TaskStatus } from '@/api/modules/tasks.api'
import { GcModal } from '@/design-system/components'
import { productBrand } from '@/brand/product-brand'
import { localeLabels, supportedLocales, type SupportedLocale } from '@/i18n'
import { useAppStore } from '@/stores/app.store'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'
import type { MenuItem } from '@/types/router'
import { gcacVersion } from '@/version'
import TaskDrawer from '@/views/tasks/TaskDrawer.vue'
import { isQuickTask, subscribeGlobalTaskRefresh, subscribeTaskActivity, subscribeTaskRealtime, type TaskRealtimeMessage } from '@/views/tasks/task-events'

type ToastTone = 'success' | 'warning' | 'danger' | 'info'

interface ToastNotice {
  readonly id: number
  readonly message: string
  readonly tone: ToastTone
}

interface ToastEventDetail {
  readonly message?: string
  readonly tone?: ToastTone
  readonly durationMs?: number
}

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const authStore = useAuthStore()
const permissionStore = usePermissionStore()
const { t } = useI18n()

const USER_MODE_MENU_ITEMS: readonly MenuItem[] = [
  {
    titleKey: 'viewMode.steps.certificates',
    path: '/certificates',
    module: 'certificate',
    permission: 'certificate.asset.read',
    icon: 'certificate',
  },
  {
    titleKey: 'viewMode.steps.applications',
    path: '/assets',
    module: 'asset',
    permission: 'service_asset.read',
    icon: 'stack',
  },
  {
    titleKey: 'viewMode.steps.deployments',
    path: '/deployment-plans',
    module: 'certificate-deployment',
    permission: 'deployment.plan.read',
    icon: 'rocket',
  },
]

const isUserViewMode = computed(() => appStore.viewMode === 'user')
const userModeMenuItems = computed(() => USER_MODE_MENU_ITEMS.filter((item) => (
  !item.permission || permissionStore.hasPermission(item.permission)
)))
const settingsMenuItem = computed(() => permissionStore.visibleMenuItems.find((item) => item.module === 'settings') ?? null)
const navItems = computed(() => {
  if (isUserViewMode.value) return userModeMenuItems.value
  return permissionStore.visibleMenuItems.filter((item) => item.module !== 'settings')
})
const activeTopItem = computed(() => navItems.value.find((item) => isMenuItemActive(item)) ?? (settingsMenuItem.value && isMenuItemActive(settingsMenuItem.value) ? settingsMenuItem.value : null))
const activeChildren = computed(() => isUserViewMode.value ? [] : (activeTopItem.value?.children ?? []))
const brandTarget = computed(() => isUserViewMode.value ? '/certificates' : '/dashboard')
const lockContentScroll = computed(() => route.path === '/certificates')
const currentPageTitle = computed(() => {
  if (!route.meta.heroTitle) return ''
  const titleKey = route.meta.titleKey
  if (typeof titleKey === 'string' && titleKey) return t(titleKey)
  const title = route.meta.title
  if (typeof title === 'string' && title) return title
  return ''
})
const showTaskEntry = computed(() => permissionStore.hasPermission('task.read'))
const TASK_ENTRY_REFRESH_INTERVAL_MS = 15_000
const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = ['QUEUED', 'RUNNING', 'RETRY_WAITING', 'CANCELLING']
const taskDrawerOpen = ref(false)
const activeTaskCount = ref(0)
const taskEntryConnected = ref(false)
const mobileNavOpen = ref(false)
const isMobileViewport = ref(false)
const sidebarCollapsed = ref(false)
const mobileNavCloseButton = ref<HTMLButtonElement | null>(null)
const mobileNavToggleButton = ref<HTMLButtonElement | null>(null)
const userMenuOpen = ref(false)
const languageMenuOpen = ref(false)
const userMenuRoot = ref<HTMLElement | null>(null)
const taskEntryRoot = ref<HTMLElement | null>(null)
const toastNotices = ref<ToastNotice[]>([])
const passwordDialogOpen = ref(false)
const passwordSubmitting = ref(false)
const passwordError = ref('')
const passwordSuccess = ref('')
const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})
const currentUserName = computed(() => authStore.user?.displayName ?? t('common.userFallback'))
const currentTenantName = computed(() => authStore.user?.tenantName ?? t('common.tenantFallback'))
const currentUserInitial = computed(() => currentUserName.value.slice(0, 1).toUpperCase())
const currentThemeLabel = computed(() => appStore.theme === 'dark' ? t('preferences.themeDark') : t('preferences.themeLight'))
const currentLocaleLabel = computed(() => localeLabels[appStore.locale])
let disposeTaskActivity: (() => void) | undefined
let disposeTaskRefresh: (() => void) | undefined
let disposeTaskRealtime: (() => void) | undefined
let taskEntryRefreshTimer: number | undefined
let taskEntryRefreshPending = false
let toastSequence = 0
let mobileNavPreviousFocus: HTMLElement | null = null
let mobileViewportQuery: MediaQueryList | undefined
let overlayStateObserver: MutationObserver | undefined
let sidebarCollapsedBeforeModal = false
const toastTimers = new Map<number, number>()
const executionTaskSuccessToastIds = new Set<string>()
const DEPLOYMENT_EXECUTION_TASK_TYPES = new Set([
  'CERTIFICATE_DRY_RUN',
  'CERTIFICATE_DEPLOY',
  'CERTIFICATE_ROLLBACK',
])

function isMenuItemActive(item: MenuItem): boolean {
  if (route.path === item.path) return true
  if (item.activePaths?.includes(route.path)) return true
  return item.children?.some((child) => isMenuItemActive(child)) ?? false
}

function menuTitle(item: MenuItem): string {
  return item.titleKey ? t(item.titleKey) : (item.title ?? item.path)
}

function isUserModePath(path: string): boolean {
  return USER_MODE_MENU_ITEMS.some((item) => item.path === path)
}

function firstUserModePath(): string {
  return userModeMenuItems.value[0]?.path ?? '/certificates'
}

function switchViewMode(mode: 'user' | 'professional'): void {
  if (appStore.viewMode === mode) return
  appStore.setViewMode(mode)
  if (mode === 'user' && !isUserModePath(route.path)) {
    void router.push(firstUserModePath())
  }
}

function selectViewMode(mode: 'user' | 'professional'): void {
  switchViewMode(mode)
  closeMobileNav(false)
  closeUserMenu()
}

function toggleSidebar(): void {
  if (isMobileViewport.value) {
    toggleMobileNav()
    return
  }
  sidebarCollapsed.value = !sidebarCollapsed.value
}

function syncModalNavigation(): void {
  const modalOpen = document.documentElement.classList.contains('gc-modal-open')
    || Boolean(document.body.querySelector('.gc-modal__mask, .gc-confirm__mask, .gc-drawer__layer'))
  if (modalOpen) {
    if (!sidebarCollapsed.value) {
      sidebarCollapsedBeforeModal = true
      sidebarCollapsed.value = true
    }
    closeMobileNav(false)
    return
  }
  if (sidebarCollapsedBeforeModal) {
    sidebarCollapsed.value = false
    sidebarCollapsedBeforeModal = false
  }
}

function updateMobileViewport(): void {
  isMobileViewport.value = Boolean(mobileViewportQuery?.matches)
  if (!isMobileViewport.value) closeMobileNav()
}

function openMobileNav(): void {
  if (mobileNavOpen.value) return
  mobileNavPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  mobileNavOpen.value = true
}

function closeMobileNav(restoreFocus = true): void {
  if (!mobileNavOpen.value) return
  mobileNavOpen.value = false
  if (!restoreFocus) {
    mobileNavPreviousFocus = null
    return
  }
  const focusTarget = mobileNavPreviousFocus?.isConnected
    ? mobileNavPreviousFocus
    : mobileNavToggleButton.value
  mobileNavPreviousFocus = null
  void nextTick(() => focusTarget?.focus())
}

function toggleMobileNav(): void {
  if (mobileNavOpen.value) {
    closeMobileNav()
    return
  }
  openMobileNav()
}

function handleShellKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && mobileNavOpen.value) {
    event.preventDefault()
    closeMobileNav()
  }
}

watch(mobileNavOpen, (opened) => {
  if (!opened) return
  void nextTick(() => mobileNavCloseButton.value?.focus())
})

watch(() => route.path, () => closeMobileNav(false))

function iconPath(icon?: string): string {
  const paths: Record<string, string> = {
    dashboard: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h3A1.5 1.5 0 0 1 10 5.5v3A1.5 1.5 0 0 1 8.5 10h-3A1.5 1.5 0 0 1 4 8.5v-3Zm10 0A1.5 1.5 0 0 1 15.5 4h3A1.5 1.5 0 0 1 20 5.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 14 8.5v-3ZM4 15.5A1.5 1.5 0 0 1 5.5 14h3a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3Zm10 0a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-3Z',
    certificate: 'M12 3.5 18.5 7v5c0 4-2.4 7.5-6.5 9-4.1-1.5-6.5-5-6.5-9V7L12 3.5Zm-2.5 8 1.7 1.7 3.8-3.8',
    stack: 'M4 7.5 12 4l8 3.5-8 3.5-8-3.5Zm0 4.5 8 3.5 8-3.5M4 16.5 12 20l8-3.5',
    rocket: 'M14.5 4.5c2.5-.3 4.7.2 5.5 1s1.3 3 .9 5.5l-5.1 5.1-4.2-4.2 2.9-2.9ZM11.6 7.4 8.3 5.8 5.1 8.9l3.2 1.1m4.4 4.4-1.1 3.2-3.2 3.2-1.1-4.4 2.9-2.9m-2.2 2.2-2.4-.1',
    plug: 'M9 3v5m6-5v5m-8 0h10v3a5 5 0 0 1-5 5v5m-4-10H5a2 2 0 1 0 0 4h2m10-4h2a2 2 0 1 1 0 4h-2',
    activity: 'M3 12h4l2.5-6 4.5 12 2.5-6H21',
    sliders: 'M4 6h16M4 12h16M4 18h16M8 4v4m8 4v4m-5 4v4',
    shield: 'M12 3.5 19 6v5.2c0 4.5-2.9 8.2-7 9.3-4.1-1.1-7-4.8-7-9.3V6l7-2.5Z',
    server: 'M5 5h14v5H5V5Zm0 9h14v5H5v-5Zm3-6.5h.01M8 16.5h.01',
    bolt: 'm13 2-8 12h6l-1 8 9-13h-6l0-7Z',
    workflow: 'M5 7a2 2 0 1 1 4 0 2 2 0 0 1-4 0Zm10 10a2 2 0 1 1 4 0 2 2 0 0 1-4 0ZM7 9v3a3 3 0 0 0 3 3h5m-5-8h5a3 3 0 0 1 3 3v5',
    plugin: 'M12 2.5 3.5 7.25v9.5L12 21.5l8.5-4.75v-9.5L12 2.5Zm0 2.2 4.75 2.65L12 10 7.25 7.35 12 4.7Zm-6.5 4.3 5.5 3.05v6.5l-5.5-3.08V9Zm13 0v6.47L13 18.55v-6.5L18.5 9Z',
    pulse: 'M3 12h4l2-6 4 12 2-6h6',
    settings: 'M12 8.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Zm7.4 3.25c0-.36-.03-.72-.08-1.06l2.02-1.5-2-3.46-2.4 1a8.05 8.05 0 0 0-1.84-1.06L14.8 3h-5.6l-.3 2.92c-.66.26-1.28.62-1.84 1.06l-2.4-1-2 3.46 2.02 1.5a7.4 7.4 0 0 0 0 2.12l-2.02 1.5 2 3.46 2.4-1c.56.44 1.18.8 1.84 1.06l.3 2.92h5.6l.3-2.92c.66-.26 1.28-.62 1.84-1.06l2.4 1 2-3.46-2.02-1.5c.05-.34.08-.7.08-1.06Z'
  }
  return paths[icon ?? ''] ?? paths.dashboard
}

async function logout() {
  closeUserMenu()
  await authStore.logout()
  await router.push({ name: 'login' })
}

function toggleUserMenu() {
  taskDrawerOpen.value = false
  userMenuOpen.value = !userMenuOpen.value
  if (!userMenuOpen.value) languageMenuOpen.value = false
}

function toggleTaskDrawer() {
  closeUserMenu()
  taskDrawerOpen.value = !taskDrawerOpen.value
  if (taskDrawerOpen.value) void refreshTaskEntryCount()
}

function closeUserMenu() {
  userMenuOpen.value = false
  languageMenuOpen.value = false
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!event.target) return
  const target = event.target as Node
  if (userMenuRoot.value?.contains(target)) {
    taskDrawerOpen.value = false
    return
  }
  closeUserMenu()
  if (taskEntryRoot.value?.contains(target)) return
  taskDrawerOpen.value = false
}

function resetPasswordForm() {
  passwordForm.currentPassword = ''
  passwordForm.newPassword = ''
  passwordForm.confirmPassword = ''
  passwordError.value = ''
  passwordSuccess.value = ''
  passwordSubmitting.value = false
}

function openPasswordDialog() {
  closeUserMenu()
  resetPasswordForm()
  passwordDialogOpen.value = true
}

function toggleThemePreference() {
  languageMenuOpen.value = false
  void appStore.setTheme(appStore.theme === 'dark' ? 'light' : 'dark')
}

function selectLocalePreference(locale: SupportedLocale) {
  void appStore.setLocale(locale)
  languageMenuOpen.value = false
}

async function submitPasswordChange() {
  passwordError.value = ''
  passwordSuccess.value = ''
  if (passwordForm.newPassword.length < 8) {
    passwordError.value = t('password.tooShort')
    return
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    passwordError.value = t('password.mismatch')
    return
  }

  passwordSubmitting.value = true
  try {
    await changeCurrentUserPassword({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword
    })
    passwordSuccess.value = t('password.success')
    passwordDialogOpen.value = false
    resetPasswordForm()
  } catch (cause) {
    passwordError.value = cause instanceof Error ? cause.message : t('password.failed')
  } finally {
    passwordSubmitting.value = false
  }
}

watch(passwordDialogOpen, (opened) => {
  if (!opened) resetPasswordForm()
})

watch(
  [() => appStore.viewMode, () => route.path, userModeMenuItems],
  ([mode, path]) => {
    if (mode !== 'user' || isUserModePath(String(path))) return
    void router.replace(firstUserModePath())
  },
  { immediate: true },
)

watch(showTaskEntry, (visible) => {
  if (visible) {
    startTaskEntryRefresh()
    void refreshTaskEntryCount()
    return
  }
  stopTaskEntryRefresh()
  activeTaskCount.value = 0
}, { immediate: true })

onMounted(() => {
  if (typeof window.matchMedia === 'function') {
    mobileViewportQuery = window.matchMedia('(max-width: 60rem)')
    mobileViewportQuery.addEventListener('change', updateMobileViewport)
  }
  updateMobileViewport()
  overlayStateObserver = new MutationObserver(syncModalNavigation)
  overlayStateObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  overlayStateObserver.observe(document.body, { childList: true })
  syncModalNavigation()
  window.addEventListener('keydown', handleShellKeydown)
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  window.addEventListener('gcac:toast', handleToastEvent as EventListener)
  disposeTaskActivity = subscribeTaskActivity((state) => {
    taskEntryConnected.value = state.connected
    if (state.activeCount > 0) {
      activeTaskCount.value = state.activeCount
      return
    }
    void refreshTaskEntryCount()
  })
  disposeTaskRealtime = subscribeTaskRealtime(handleTaskRealtime)
  disposeTaskRefresh = subscribeGlobalTaskRefresh(() => {
    void refreshTaskEntryCount()
  })
  void refreshTaskEntryCount()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleShellKeydown)
  mobileViewportQuery?.removeEventListener('change', updateMobileViewport)
  mobileViewportQuery = undefined
  overlayStateObserver?.disconnect()
  overlayStateObserver = undefined
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  window.removeEventListener('gcac:toast', handleToastEvent as EventListener)
  disposeTaskActivity?.()
  disposeTaskRealtime?.()
  disposeTaskRefresh?.()
  stopTaskEntryRefresh()
  disposeTaskActivity = undefined
  disposeTaskRealtime = undefined
  disposeTaskRefresh = undefined
  executionTaskSuccessToastIds.clear()
  toastTimers.forEach((timer) => window.clearTimeout(timer))
  toastTimers.clear()
})

function handleToastEvent(event: Event): void {
  const detail = (event as CustomEvent<ToastEventDetail | undefined>).detail
  const message = typeof detail?.message === 'string' ? detail.message.trim() : ''
  if (!message) return
  const id = toastSequence + 1
  toastSequence = id
  toastNotices.value = [
    ...toastNotices.value.filter((item) => item.message !== message),
    { id, message, tone: normalizeToastTone(detail?.tone) },
  ].slice(-4)
  const durationMs = typeof detail?.durationMs === 'number' && Number.isFinite(detail.durationMs)
    ? Math.max(1_500, detail.durationMs)
    : 4_000
  const timer = window.setTimeout(() => removeToastNotice(id), durationMs)
  toastTimers.set(id, timer)
}

function handleTaskRealtime(message: TaskRealtimeMessage): void {
  if (message.type !== 'task.changed') return
  const task = message.task
  if (task.status !== 'SUCCEEDED' || !DEPLOYMENT_EXECUTION_TASK_TYPES.has(task.taskType)) return
  if (executionTaskSuccessToastIds.has(task.id)) return
  executionTaskSuccessToastIds.add(task.id)
  window.dispatchEvent(new CustomEvent('gcac:toast', {
    detail: {
      message: t('deploymentPlans.feedback.executionTaskSucceeded'),
      tone: 'success',
    },
  }))
}

function normalizeToastTone(tone: ToastEventDetail['tone']): ToastTone {
  return tone === 'success' || tone === 'warning' || tone === 'danger' || tone === 'info' ? tone : 'info'
}

function removeToastNotice(id: number): void {
  const timer = toastTimers.get(id)
  if (timer !== undefined) window.clearTimeout(timer)
  toastTimers.delete(id)
  toastNotices.value = toastNotices.value.filter((item) => item.id !== id)
}

function startTaskEntryRefresh(): void {
  if (typeof window === 'undefined' || taskEntryRefreshTimer !== undefined) return
  taskEntryRefreshTimer = window.setInterval(() => {
    void refreshTaskEntryCount()
  }, TASK_ENTRY_REFRESH_INTERVAL_MS)
}

function stopTaskEntryRefresh(): void {
  if (taskEntryRefreshTimer === undefined) return
  window.clearInterval(taskEntryRefreshTimer)
  taskEntryRefreshTimer = undefined
}

async function refreshTaskEntryCount(): Promise<void> {
  if (!showTaskEntry.value || taskEntryRefreshPending) return
  taskEntryRefreshPending = true
  try {
    const counts = await Promise.all(ACTIVE_TASK_STATUSES.map(async (status) => {
      const [executionResult, automationResult] = await Promise.all([
        listTasks({
          page: 1,
          pageSize: 100,
          filters: { status, category: 'EXECUTION' },
          includeAll: true,
        }),
        listTasks({
          page: 1,
          pageSize: 100,
          filters: { status, taskType: 'AUTOMATION_RUN' },
          includeAll: true,
        }),
      ])
      return new Set([
        ...(executionResult.data?.items ?? []),
        ...(automationResult.data?.items ?? []),
      ].filter(isQuickTask).map((task) => task.id)).size
    }))
    activeTaskCount.value = counts.reduce((sum, count) => sum + count, 0)
  } catch {
    // 中文说明：角标只是提示信息，失败时保留已有计数，避免影响主导航。
  } finally {
    taskEntryRefreshPending = false
  }
}
</script>

<template>
  <div
    class="gc-shell gc-workbench"
    :class="{
      'gc-workbench--nav-open': mobileNavOpen,
      'gc-workbench--nav-collapsed': sidebarCollapsed && !isMobileViewport,
    }"
  >
    <aside
      id="gc-workbench-navigation"
      class="gc-workbench__sidebar"
      :inert="isMobileViewport && !mobileNavOpen"
      :aria-hidden="isMobileViewport && !mobileNavOpen"
    >
      <div class="gc-workbench__sidebar-header">
        <RouterLink class="gc-workbench__brand" :to="brandTarget" :aria-label="t('shell.backDashboard')" @click="closeMobileNav(false)">
          <span class="gc-workbench__brand-mark" aria-hidden="true">
            <img :src="productBrand.markAssetUrl" alt="">
          </span>
          <span class="gc-workbench__brand-text">{{ t('app.brand') }}</span>
        </RouterLink>
        <button
          ref="mobileNavCloseButton"
          class="gc-workbench__icon-button gc-workbench__sidebar-close"
          type="button"
          :aria-label="t('shell.currentGroupNavigation')"
          @click="closeMobileNav()"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <nav class="gc-workbench__nav" :aria-label="t('nav.dashboard')">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          class="gc-workbench__nav-item"
          :class="{ 'gc-workbench__nav-item--active': isMenuItemActive(item) }"
          :to="item.path"
          :aria-label="sidebarCollapsed ? menuTitle(item) : undefined"
          :title="sidebarCollapsed ? menuTitle(item) : undefined"
          @click="closeMobileNav(false)"
        >
          <svg class="gc-workbench__nav-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path :d="iconPath(item.icon)" />
          </svg>
          <span class="gc-workbench__nav-label">{{ menuTitle(item) }}</span>
          <span v-if="isMenuItemActive(item) && !sidebarCollapsed" class="gc-workbench__nav-active-mark" aria-hidden="true" />
        </RouterLink>
      </nav>

      <div class="gc-workbench__sidebar-footer">
        <RouterLink
          v-if="settingsMenuItem"
          class="gc-workbench__nav-item gc-workbench__settings-item"
          :class="{ 'gc-workbench__nav-item--active': isMenuItemActive(settingsMenuItem) }"
          :to="settingsMenuItem.path"
          :aria-label="sidebarCollapsed ? menuTitle(settingsMenuItem) : undefined"
          :title="sidebarCollapsed ? menuTitle(settingsMenuItem) : undefined"
          @click="closeMobileNav(false)"
        >
          <svg class="gc-workbench__nav-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path :d="iconPath(settingsMenuItem.icon)" />
          </svg>
          <span class="gc-workbench__nav-label">{{ menuTitle(settingsMenuItem) }}</span>
          <span v-if="isMenuItemActive(settingsMenuItem) && !sidebarCollapsed" class="gc-workbench__nav-active-mark" aria-hidden="true" />
        </RouterLink>
        <div class="gc-workbench__sidebar-meta">
          <span class="gc-workbench__version">{{ t('app.versionLabel', { version: gcacVersion }) }}</span>
          <button
            class="gc-workbench__icon-button gc-workbench__sidebar-toggle"
            type="button"
            :aria-label="sidebarCollapsed ? t('shell.sidebarExpand') : t('shell.sidebarCollapse')"
            :aria-expanded="!sidebarCollapsed"
            aria-controls="gc-workbench-navigation"
            @click="toggleSidebar"
          >
            <span aria-hidden="true">{{ sidebarCollapsed ? '›' : '‹' }}</span>
          </button>
        </div>
      </div>
    </aside>

    <button
      v-if="mobileNavOpen"
      class="gc-workbench__scrim"
      type="button"
      :aria-label="t('shell.currentGroupNavigation')"
      @click="closeMobileNav()"
    />

    <div class="gc-workbench__main">
      <header class="gc-workbench__topbar">
        <button
          ref="mobileNavToggleButton"
          class="gc-workbench__icon-button gc-workbench__mobile-toggle"
          type="button"
          :aria-label="t('shell.currentGroupNavigation')"
          :aria-expanded="mobileNavOpen"
          aria-controls="gc-workbench-navigation"
          @click="toggleMobileNav"
        >
          <span aria-hidden="true">☰</span>
        </button>

        <div class="gc-workbench__context">
          <div class="gc-workbench__context-heading">
            <h1 class="gc-workbench__context-title">{{ currentPageTitle || (activeTopItem ? menuTitle(activeTopItem) : t('nav.dashboard')) }}</h1>
          </div>
          <nav v-if="activeChildren.length" class="gc-workbench__submenu" :aria-label="t('shell.currentGroupNavigation')">
            <RouterLink
              v-for="child in activeChildren"
            :key="child.path"
            class="gc-workbench__submenu-item"
            :class="{ 'gc-workbench__submenu-item--active': isMenuItemActive(child) }"
            :to="child.path"
            @click="closeMobileNav(false)"
          >
              {{ menuTitle(child) }}
            </RouterLink>
          </nav>
        </div>

        <div class="gc-workbench__account-actions">
          <div v-if="showTaskEntry" ref="taskEntryRoot" class="gc-shell__task-entry">
            <button
              class="gc-shell__task-button"
              :class="{ 'gc-shell__task-button--active': activeTaskCount > 0, 'gc-shell__task-button--connected': taskEntryConnected }"
              type="button"
              :aria-label="t('tasks.aria.openDrawer')"
              :aria-expanded="taskDrawerOpen"
              @click="toggleTaskDrawer"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 4.5h10A2.5 2.5 0 0 1 19.5 7v10a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 17V7A2.5 2.5 0 0 1 7 4.5Z" />
                <path d="m8 12 2.2 2.2L16 8.5" />
              </svg>
              <span v-if="activeTaskCount > 0" class="gc-shell__task-badge">{{ activeTaskCount > 99 ? '99+' : activeTaskCount }}</span>
            </button>
            <TaskDrawer :open="taskDrawerOpen" @close="taskDrawerOpen = false" />
          </div>

          <div ref="userMenuRoot" class="gc-shell__user" :aria-label="t('userMenu.currentUser')">
            <button
              class="gc-shell__user-button"
              type="button"
              aria-haspopup="menu"
              :aria-expanded="userMenuOpen"
              @click="toggleUserMenu"
            >
              <span class="gc-shell__user-avatar" aria-hidden="true">{{ currentUserInitial }}</span>
              <span class="gc-shell__user-meta">
                <span class="gc-shell__user-name">{{ currentUserName }}</span>
              </span>
              <span class="gc-shell__user-chevron" aria-hidden="true">⌄</span>
            </button>

            <div v-if="userMenuOpen" class="gc-shell__user-menu" role="menu">
              <div class="gc-shell__user-menu-header">
                <span class="gc-shell__user-avatar gc-shell__user-avatar--menu" aria-hidden="true">{{ currentUserInitial }}</span>
                <span>
                  <strong>{{ currentUserName }}</strong>
                  <small>{{ currentTenantName }}</small>
                </span>
              </div>

              <div class="gc-shell__user-menu-list" role="none">
                <button class="gc-shell__user-menu-action" type="button" role="menuitem" @click="openPasswordDialog">
                  <span class="gc-shell__user-menu-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M14 10a4 4 0 1 0-3.2 3.9L13 16h2v2h3v-3.2l-3.7-3.7" /><path d="M7.5 10.5h.01" /></svg>
                  </span>
                  <span>{{ t('userMenu.changePassword') }}</span>
                </button>

                <div class="gc-shell__view-mode" role="group" :aria-label="t('viewMode.switchLabel')">
                  <span
                    class="gc-shell__view-mode-thumb"
                    :class="{ 'gc-shell__view-mode-thumb--right': !isUserViewMode }"
                    aria-hidden="true"
                  />
                  <button
                    class="gc-shell__view-mode-button"
                    :class="{ 'gc-shell__view-mode-button--active': isUserViewMode }"
                    type="button"
                    :aria-pressed="isUserViewMode"
                    @click="selectViewMode('user')"
                  >
                    {{ t('viewMode.user') }}
                  </button>
                  <button
                    class="gc-shell__view-mode-button"
                    :class="{ 'gc-shell__view-mode-button--active': !isUserViewMode }"
                    type="button"
                    :aria-pressed="!isUserViewMode"
                    @click="selectViewMode('professional')"
                  >
                    {{ t('viewMode.professional') }}
                  </button>
                </div>

            <button
              class="gc-shell__user-menu-action"
              type="button"
              role="menuitem"
              :aria-label="t('preferences.themeToggle')"
              @click="toggleThemePreference"
            >
              <span class="gc-shell__user-menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              </span>
              <span>{{ t('preferences.theme') }}</span>
              <span class="gc-shell__user-menu-value">{{ currentThemeLabel }}</span>
            </button>

            <div class="gc-shell__user-menu-branch" role="none">
              <button
                class="gc-shell__user-menu-action"
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                :aria-expanded="languageMenuOpen"
                :aria-label="t('preferences.languageSelect')"
                @click="languageMenuOpen = !languageMenuOpen"
              >
                <span class="gc-shell__user-menu-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M4 5h10M9 3v2M10 5c-.7 3.4-2.6 6.2-5 8" /><path d="M6 9c1.1 1.8 2.7 3.2 5 4" /><path d="m13 21 4-9 4 9M14.3 18h5.4" /></svg>
                </span>
                <span>{{ t('preferences.language') }}</span>
                <span class="gc-shell__user-menu-value">{{ currentLocaleLabel }}</span>
              </button>

              <div v-if="languageMenuOpen" class="gc-shell__locale-menu" role="menu" :aria-label="t('preferences.languageSelect')">
                <button
                  v-for="locale in supportedLocales"
                  :key="locale"
                  class="gc-shell__locale-menu-item"
                  :class="{ 'gc-shell__locale-menu-item--active': locale === appStore.locale }"
                  type="button"
                  role="menuitemradio"
                  :aria-checked="locale === appStore.locale"
                  @click="selectLocalePreference(locale)"
                >
                  <span>{{ localeLabels[locale] }}</span>
                  <span v-if="locale === appStore.locale" aria-hidden="true">✓</span>
                </button>
              </div>
            </div>

            <button class="gc-shell__user-menu-action gc-shell__user-menu-action--danger" type="button" role="menuitem" @click="logout">
              <span class="gc-shell__user-menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M10 17 15 12l-5-5" /><path d="M15 12H3" /><path d="M21 5v14" /></svg>
              </span>
              <span>{{ t('userMenu.logout') }}</span>
            </button>

            <div class="gc-shell__user-menu-version">
              {{ t('app.versionLabel', { version: gcacVersion }) }}
            </div>
              </div>
            </div>
          </div>
        </div>
      </header>

    <main class="gc-shell__content gc-workbench__content" :class="{ 'gc-shell__content--locked': lockContentScroll, 'gc-workbench__content--locked': lockContentScroll }">
      <RouterView />
    </main>
    </div>

    <GcModal v-model:open="passwordDialogOpen" size="sm" :title="t('password.title')" :description="t('password.description')">
      <form class="gc-password-form" @submit.prevent="submitPasswordChange">
        <label class="gc-form-field">
          <span>{{ t('password.current') }}</span>
          <input v-model="passwordForm.currentPassword" type="password" autocomplete="current-password" required>
        </label>
        <label class="gc-form-field">
          <span>{{ t('password.new') }}</span>
          <input v-model="passwordForm.newPassword" type="password" autocomplete="new-password" minlength="8" required>
        </label>
        <label class="gc-form-field">
          <span>{{ t('password.confirm') }}</span>
          <input v-model="passwordForm.confirmPassword" type="password" autocomplete="new-password" minlength="8" required>
        </label>
        <p v-if="passwordError" class="gc-form-error">{{ passwordError }}</p>
        <p v-else-if="passwordSuccess" class="gc-form-success">{{ passwordSuccess }}</p>
        <div class="gc-form-actions">
          <button class="gc-button" type="button" :disabled="passwordSubmitting" @click="passwordDialogOpen = false">
            {{ t('password.cancel') }}
          </button>
          <button class="gc-button gc-button--primary" type="submit" :disabled="passwordSubmitting">
            {{ passwordSubmitting ? t('password.submitting') : t('password.submit') }}
          </button>
        </div>
      </form>
    </GcModal>

    <Teleport to="body">
      <TransitionGroup name="gc-shell-toast" tag="div" class="gc-shell__toasts">
        <div
          v-for="notice in toastNotices"
          :key="notice.id"
          class="gc-shell__toast"
          :class="`gc-shell__toast--${notice.tone}`"
          role="status"
        >
          <span class="gc-shell__toast-dot" aria-hidden="true" />
          <span class="gc-shell__toast-message">{{ notice.message }}</span>
          <button class="gc-shell__toast-close" type="button" :aria-label="t('designSystem.toast.close')" @click="removeToastNotice(notice.id)">
            {{ t('designSystem.toast.close') }}
          </button>
        </div>
      </TransitionGroup>
    </Teleport>

  </div>
</template>

<style scoped>
.gc-workbench__content--locked {
  height: calc(100vh - var(--gc-control-height-md) - var(--gc-space-4));
  overflow: hidden;
}

@media (max-width: 60rem) {
  .gc-workbench__sidebar:not([aria-hidden="true"]) {
    transform: translateX(0);
  }
}
</style>

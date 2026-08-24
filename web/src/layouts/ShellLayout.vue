<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, RouterLink, RouterView } from 'vue-router'
import { useRouter } from 'vue-router'
import { changeCurrentUserPassword } from '@/api/modules/security.api'
import { GcModal } from '@/design-system/components'
import { localeLabels, supportedLocales, type SupportedLocale } from '@/i18n'
import { useAppStore } from '@/stores/app.store'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'
import type { MenuItem } from '@/types/router'
import { gcacVersion } from '@/version'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const authStore = useAuthStore()
const permissionStore = usePermissionStore()
const { t } = useI18n()

const breadcrumbs = computed(() => {
  const keys = route.meta.breadcrumbKeys
  if (Array.isArray(keys) && keys.length > 0) return keys.map((key) => t(key))

  const value = route.meta.breadcrumb
  if (Array.isArray(value) && value.length > 0) return value

  const titleKey = route.meta.titleKey
  return [typeof titleKey === 'string' ? t(titleKey) : String(route.meta.title ?? t('app.defaultBreadcrumb'))]
})

const navItems = computed(() => permissionStore.visibleMenuItems)
const activeTopItem = computed(() => navItems.value.find((item) => isMenuItemActive(item)) ?? null)
const activeChildren = computed(() => activeTopItem.value?.children ?? [])
const lockContentScroll = computed(() => route.path === '/certificates')
const showDashboardRefresh = computed(() => route.name === 'dashboard.overview')
const userMenuOpen = ref(false)
const languageMenuOpen = ref(false)
const userMenuRoot = ref<HTMLElement | null>(null)
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

function isMenuItemActive(item: MenuItem): boolean {
  if (route.path === item.path) return true
  if (item.activePaths?.includes(route.path)) return true
  return item.children?.some((child) => isMenuItemActive(child)) ?? false
}

function menuTitle(item: MenuItem): string {
  return item.titleKey ? t(item.titleKey) : (item.title ?? item.path)
}

function iconPath(icon?: string): string {
  const paths: Record<string, string> = {
    dashboard: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h3A1.5 1.5 0 0 1 10 5.5v3A1.5 1.5 0 0 1 8.5 10h-3A1.5 1.5 0 0 1 4 8.5v-3Zm10 0A1.5 1.5 0 0 1 15.5 4h3A1.5 1.5 0 0 1 20 5.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 14 8.5v-3ZM4 15.5A1.5 1.5 0 0 1 5.5 14h3a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3Zm10 0a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-3Z',
    shield: 'M12 3.5 19 6v5.2c0 4.5-2.9 8.2-7 9.3-4.1-1.1-7-4.8-7-9.3V6l7-2.5Z',
    server: 'M5 5h14v5H5V5Zm0 9h14v5H5v-5Zm3-6.5h.01M8 16.5h.01',
    bolt: 'm13 2-8 12h6l-1 8 9-13h-6l0-7Z',
    workflow: 'M5 7a2 2 0 1 1 4 0 2 2 0 0 1-4 0Zm10 10a2 2 0 1 1 4 0 2 2 0 0 1-4 0ZM7 9v3a3 3 0 0 0 3 3h5m-5-8h5a3 3 0 0 1 3 3v5',
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

function refreshDashboard() {
  window.dispatchEvent(new CustomEvent('dashboard:refresh'))
}

function toggleUserMenu() {
  userMenuOpen.value = !userMenuOpen.value
  if (!userMenuOpen.value) languageMenuOpen.value = false
}

function closeUserMenu() {
  userMenuOpen.value = false
  languageMenuOpen.value = false
}

function handleDocumentPointerDown(event: PointerEvent) {
  const root = userMenuRoot.value
  if (!root || !event.target || root.contains(event.target as Node)) return
  closeUserMenu()
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

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
})
</script>

<template>
  <div class="gc-shell">
    <header class="gc-shell__topbar">
      <RouterLink class="gc-shell__brand" to="/dashboard" :aria-label="t('shell.backDashboard')">
        <span class="gc-shell__brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3.5 19 6v5.2c0 4.5-2.9 8.2-7 9.3-4.1-1.1-7-4.8-7-9.3V6l7-2.5Z" /></svg>
        </span>
        <span class="gc-shell__brand-text">{{ t('app.brand') }}</span>
      </RouterLink>

      <nav class="gc-shell__menu" :aria-label="t('nav.dashboard')">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          class="gc-shell__menu-item"
          :class="{ 'gc-shell__menu-item--active': isMenuItemActive(item) }"
          :to="item.path"
        >
          <svg class="gc-shell__menu-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path :d="iconPath(item.icon)" />
          </svg>
          <span>{{ menuTitle(item) }}</span>
        </RouterLink>
      </nav>

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
    </header>

    <main class="gc-shell__content" :class="{ 'gc-shell__content--locked': lockContentScroll }">
      <section class="gc-shell__hero" :aria-label="t('shell.currentLocation')">
        <div>
          <p class="gc-shell__eyebrow">{{ t('app.platform') }}</p>
          <div class="gc-shell__breadcrumbs" :aria-label="t('shell.breadcrumb')">
            <span v-for="(item, index) in breadcrumbs" :key="`${item}-${index}`">
              <span v-if="index > 0" class="gc-shell__breadcrumb-separator">/</span>
              {{ item }}
            </span>
          </div>
        </div>
        <div class="gc-shell__hero-actions">
          <nav v-if="activeChildren.length" class="gc-shell__submenu" :aria-label="t('shell.currentGroupNavigation')">
            <RouterLink
              v-for="child in activeChildren"
              :key="child.path"
              class="gc-shell__submenu-item"
              :class="{ 'gc-shell__submenu-item--active': isMenuItemActive(child) }"
              :to="child.path"
            >
              {{ menuTitle(child) }}
            </RouterLink>
          </nav>
          <button
            v-if="showDashboardRefresh"
            class="gc-button gc-button--primary"
            type="button"
            @click="refreshDashboard"
          >
            <span aria-hidden="true">↻</span>
            {{ t('common.refresh') }}
          </button>
        </div>
      </section>

      <RouterView />
    </main>

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
  </div>
</template>

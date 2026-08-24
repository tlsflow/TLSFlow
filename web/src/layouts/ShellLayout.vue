<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, RouterLink, RouterView } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'
import type { MenuItem } from '@/types/router'

const route = useRoute()
const authStore = useAuthStore()
const permissionStore = usePermissionStore()

const breadcrumbs = computed(() => {
  const value = route.meta.breadcrumb
  return Array.isArray(value) ? value : [String(route.meta.title ?? '控制台')]
})

const navItems = computed(() => permissionStore.visibleMenuItems)
const activeTopItem = computed(() => navItems.value.find((item) => isMenuItemActive(item)) ?? null)
const activeChildren = computed(() => activeTopItem.value?.children ?? [])

function isMenuItemActive(item: MenuItem): boolean {
  if (route.path === item.path) return true
  return item.children?.some((child) => route.path === child.path) ?? false
}

function iconPath(icon?: string): string {
  const paths: Record<string, string> = {
    dashboard: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h3A1.5 1.5 0 0 1 10 5.5v3A1.5 1.5 0 0 1 8.5 10h-3A1.5 1.5 0 0 1 4 8.5v-3Zm10 0A1.5 1.5 0 0 1 15.5 4h3A1.5 1.5 0 0 1 20 5.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 14 8.5v-3ZM4 15.5A1.5 1.5 0 0 1 5.5 14h3a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3Zm10 0a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-3Z',
    shield: 'M12 3.5 19 6v5.2c0 4.5-2.9 8.2-7 9.3-4.1-1.1-7-4.8-7-9.3V6l7-2.5Z',
    server: 'M5 5h14v5H5V5Zm0 9h14v5H5v-5Zm3-6.5h.01M8 16.5h.01',
    bolt: 'm13 2-8 12h6l-1 8 9-13h-6l0-7Z',
    pulse: 'M3 12h4l2-6 4 12 2-6h6',
    settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8 3.5a7.8 7.8 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L15.5 3h-4l-.3 2.6a8 8 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.3 2.6h4l.3-2.6a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z'
  }
  return paths[icon ?? ''] ?? paths.dashboard
}
</script>

<template>
  <div class="gc-shell">
    <header class="gc-shell__topbar">
      <RouterLink class="gc-shell__brand" to="/dashboard" aria-label="返回仪表盘">
        <span class="gc-shell__brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3.5 19 6v5.2c0 4.5-2.9 8.2-7 9.3-4.1-1.1-7-4.8-7-9.3V6l7-2.5Z" /></svg>
        </span>
        <span class="gc-shell__brand-text">GCAC 控制台</span>
      </RouterLink>

      <nav class="gc-shell__menu" aria-label="主导航">
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
          <span>{{ item.title }}</span>
        </RouterLink>
      </nav>

      <div class="gc-shell__user" aria-label="当前用户">
        <span class="gc-shell__user-avatar" aria-hidden="true">{{ (authStore.user?.displayName ?? 'U').slice(0, 1) }}</span>
        <span class="gc-shell__user-name">{{ authStore.user?.displayName ?? '未登录用户' }}</span>
        <span class="gc-shell__tenant">{{ authStore.user?.tenantName ?? '默认租户' }}</span>
      </div>
    </header>

    <main class="gc-shell__content">
      <section class="gc-shell__hero" aria-label="当前位置">
        <div>
          <p class="gc-shell__eyebrow">企业 SSL 证书生命周期管理平台</p>
          <div class="gc-shell__breadcrumbs" aria-label="面包屑">
            <span v-for="(item, index) in breadcrumbs" :key="`${item}-${index}`">
              <span v-if="index > 0" class="gc-shell__breadcrumb-separator">/</span>
              {{ item }}
            </span>
          </div>
        </div>
        <nav v-if="activeChildren.length" class="gc-shell__submenu" aria-label="当前分组导航">
          <RouterLink
            v-for="child in activeChildren"
            :key="child.path"
            class="gc-shell__submenu-item"
            active-class="gc-shell__submenu-item--active"
            :to="child.path"
          >
            {{ child.title }}
          </RouterLink>
        </nav>
      </section>

      <RouterView />
    </main>
  </div>
</template>

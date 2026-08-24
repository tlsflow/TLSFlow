<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, RouterLink, RouterView } from 'vue-router'
import { useAppStore } from '@/stores/app.store'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'

const route = useRoute()
const appStore = useAppStore()
const authStore = useAuthStore()
const permissionStore = usePermissionStore()

const breadcrumbs = computed(() => {
  const value = route.meta.breadcrumb
  return Array.isArray(value) ? value : [String(route.meta.title ?? '控制台')]
})
</script>

<template>
  <div class="gc-shell" :class="{ 'gc-shell--collapsed': appStore.sidebarCollapsed }">
    <aside class="gc-shell__sidebar">
      <div class="gc-shell__brand">
        <span class="gc-shell__brand-mark">GC</span>
        <span class="gc-shell__brand-text">证书控制台</span>
      </div>
      <nav class="gc-shell__menu" aria-label="主导航">
        <RouterLink
          v-for="item in permissionStore.visibleMenuItems"
          :key="item.path"
          class="gc-shell__menu-item"
          active-class="gc-shell__menu-item--active"
          :to="item.path"
        >
          {{ item.title }}
        </RouterLink>
      </nav>
    </aside>

    <div class="gc-shell__main">
      <header class="gc-shell__topbar">
        <button class="gc-icon-button" type="button" @click="appStore.toggleSidebar">
          {{ appStore.sidebarCollapsed ? '展开' : '收起' }}
        </button>
        <div class="gc-shell__breadcrumbs" aria-label="面包屑">
          <span v-for="(item, index) in breadcrumbs" :key="`${item}-${index}`">
            <span v-if="index > 0" class="gc-shell__breadcrumb-separator">/</span>
            {{ item }}
          </span>
        </div>
        <div class="gc-shell__user">
          <span>{{ authStore.user?.displayName ?? '未登录用户' }}</span>
          <span class="gc-shell__tenant">{{ authStore.user?.tenantName ?? '默认租户' }}</span>
        </div>
      </header>

      <main class="gc-shell__content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

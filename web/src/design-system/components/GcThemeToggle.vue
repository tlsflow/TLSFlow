<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app.store'

const appStore = useAppStore()
const { t } = useI18n()

const isDark = computed(() => appStore.theme === 'dark')

function toggleTheme() {
  void appStore.setTheme(isDark.value ? 'light' : 'dark')
}
</script>

<template>
  <button class="gc-theme-toggle" type="button" :aria-label="t('preferences.themeToggle')" @click="toggleTheme">
    <span class="gc-theme-toggle__icon" aria-hidden="true">{{ isDark ? '☾' : '☼' }}</span>
    <span>{{ isDark ? t('preferences.themeDark') : t('preferences.themeLight') }}</span>
  </button>
</template>

<style scoped>
.gc-theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  color: var(--gc-color-text);
  background: var(--gc-color-surface-soft);
  cursor: pointer;
  font-size: var(--gc-font-size-sm);
  font-weight: 750;
}

.gc-theme-toggle:hover { border-color: var(--gc-color-border-strong); background: var(--gc-color-primary-soft); }
.gc-theme-toggle:focus-visible { outline: 3px solid var(--gc-color-primary-weak); outline-offset: 2px; }
.gc-theme-toggle__icon { width: 18px; text-align: center; }
</style>

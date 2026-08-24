<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app.store'

const appStore = useAppStore()
const { t } = useI18n()

const isDark = computed(() => appStore.theme === 'dark')
const nextThemeLabel = computed(() => (isDark.value ? t('preferences.themeLight') : t('preferences.themeDark')))

function toggleTheme() {
  void appStore.setTheme(isDark.value ? 'light' : 'dark')
}
</script>

<template>
  <button
    class="gc-theme-toggle"
    type="button"
    :class="{ 'gc-theme-toggle--dark': isDark }"
    :aria-label="t('preferences.themeToggle')"
    :title="nextThemeLabel"
    @click="toggleTheme"
  >
    <span class="gc-theme-toggle__glow" aria-hidden="true"></span>
    <span class="gc-theme-toggle__icon" aria-hidden="true">
      <!-- 当前为夜间：显示月亮图标，点击切到日间 -->
      <svg v-if="isDark" class="gc-theme-toggle__svg" viewBox="0 0 24 24" fill="none">
        <path
          d="M20.2 14.1A8.2 8.2 0 0 1 9.9 3.8a8.5 8.5 0 1 0 10.3 10.3Z"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M15.2 7.4c.2.7.7 1.2 1.4 1.4-.7.2-1.2.7-1.4 1.4-.2-.7-.7-1.2-1.4-1.4.7-.2 1.2-.7 1.4-1.4Z"
          fill="currentColor"
        />
      </svg>
      <!-- 当前为日间：显示太阳图标，点击切到夜间 -->
      <svg v-else class="gc-theme-toggle__svg" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.6" />
        <path
          d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>
    </span>
  </button>
</template>

<style scoped>
.gc-theme-toggle {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: var(--gc-space-10);
  height: var(--gc-space-10);
  padding: 0;
  overflow: hidden;
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  color: var(--gc-color-text);
  background:
    linear-gradient(160deg, var(--gc-color-surface-overlay), var(--gc-color-surface-soft));
  box-shadow:
    var(--gc-shadow-sm),
    inset 0 var(--gc-border-width-default) 0 var(--gc-color-surface-solid);
  cursor: pointer;
  transition:
    border-color .2s ease,
    box-shadow .2s ease,
    transform .2s ease,
    color .2s ease,
    background .2s ease;
}

.gc-theme-toggle__glow {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 30% 25%, var(--gc-color-primary-weak), transparent 55%),
    radial-gradient(circle at 75% 80%, var(--gc-color-info-soft), transparent 60%);
  opacity: .55;
  pointer-events: none;
  transition: opacity .2s ease;
}

.gc-theme-toggle__icon {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: var(--gc-size-icon-md);
  height: var(--gc-size-icon-md);
}

.gc-theme-toggle__svg {
  width: var(--gc-size-icon-md);
  height: var(--gc-size-icon-md);
}

.gc-theme-toggle:hover {
  border-color: var(--gc-color-primary-border-strong);
  color: var(--gc-color-primary);
  background:
    linear-gradient(160deg, var(--gc-color-surface-overlay), var(--gc-color-primary-soft));
  box-shadow:
    var(--gc-shadow-hover),
    0 0 0 var(--gc-size-focus-ring) var(--gc-color-primary-weak),
    inset 0 var(--gc-border-width-default) 0 var(--gc-color-surface-solid);
  transform: translateY(calc(var(--gc-border-width-default) * -1));
}

.gc-theme-toggle:hover .gc-theme-toggle__glow {
  opacity: .9;
}

.gc-theme-toggle:active {
  transform: translateY(0);
}

.gc-theme-toggle:focus-visible {
  outline: var(--gc-size-focus-ring) solid var(--gc-color-primary-weak);
  outline-offset: var(--gc-border-width-thick);
}

.gc-theme-toggle--dark {
  color: var(--gc-color-info);
}

.gc-theme-toggle--dark:hover {
  color: var(--gc-color-primary-hover);
}

@media (prefers-reduced-motion: reduce) {
  .gc-theme-toggle {
    transition: none;
  }
}
</style>

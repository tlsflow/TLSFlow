<script setup lang="ts">
import { computed, ref, watch } from 'vue'

type PluginLogoSize = 'market' | 'detail' | 'onboarding'

const props = withDefaults(defineProps<{
  logoUrl?: string
  fallbackText: string
  alt: string
  size?: PluginLogoSize
}>(), {
  size: 'market',
})

const failed = ref(false)

const resolvedLogoUrl = computed(() => {
  const value = props.logoUrl?.trim()
  if (!value || failed.value || typeof window === 'undefined') return undefined
  try {
    const url = new URL(value, window.location.origin)
    // 插件 Logo 只允许加载当前 GCAC 的静态资源，避免插件元数据把浏览器引向外部站点。
    if (url.origin !== window.location.origin) return undefined
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return undefined
  }
})

watch(() => props.logoUrl, () => {
  failed.value = false
})

function markFailed(): void {
  failed.value = true
}
</script>

<template>
  <span class="plugin-logo" :class="[`plugin-logo--${size}`, { 'plugin-logo--fallback': !resolvedLogoUrl }]">
    <img v-if="resolvedLogoUrl" :src="resolvedLogoUrl" :alt="alt" @error="markFailed">
    <span v-else aria-hidden="true">{{ fallbackText }}</span>
  </span>
</template>

<style scoped>
.plugin-logo {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-solid);
  box-shadow: var(--gc-shadow-sm);
}

.plugin-logo--market {
  inline-size: var(--gc-size-plugin-logo-market-inline);
  block-size: var(--gc-size-plugin-logo-market-block);
}

.plugin-logo--detail {
  inline-size: var(--gc-size-plugin-logo-detail);
  block-size: var(--gc-size-plugin-logo-detail);
}

.plugin-logo--onboarding {
  inline-size: var(--gc-size-plugin-logo-onboarding);
  block-size: var(--gc-size-plugin-logo-onboarding);
  border-radius: var(--gc-radius-control);
  box-shadow: none;
}

.plugin-logo img {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  padding: var(--gc-space-compact);
  object-fit: contain;
}

.plugin-logo--fallback {
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
  font-size: var(--gc-font-size-xl);
  font-weight: var(--gc-font-weight-semibold);
}
</style>

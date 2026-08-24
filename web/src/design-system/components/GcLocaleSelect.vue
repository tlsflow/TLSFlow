<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { localeLabels, supportedLocales, type SupportedLocale } from '@/i18n'
import { useAppStore } from '@/stores/app.store'

const appStore = useAppStore()
const { t } = useI18n()

const locale = computed({
  get: () => appStore.locale,
  set: (value: SupportedLocale) => {
    void appStore.setLocale(value)
  }
})
</script>

<template>
  <label class="gc-locale-select">
    <span class="gc-locale-select__label">{{ t('preferences.language') }}</span>
    <select v-model="locale" :aria-label="t('preferences.languageSelect')">
      <option v-for="item in supportedLocales" :key="item" :value="item">
        {{ localeLabels[item] }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.gc-locale-select {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 750;
}

.gc-locale-select select {
  min-height: 36px;
  max-width: 180px;
  padding: 0 30px 0 10px;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  color: var(--gc-color-text);
  background: var(--gc-color-surface-soft);
}

.gc-locale-select select:focus-visible { outline: 3px solid var(--gc-color-primary-weak); outline-offset: 2px; }

@media (max-width: 760px) {
  .gc-locale-select__label { display: none; }
  .gc-locale-select select { max-width: 132px; }
}
</style>

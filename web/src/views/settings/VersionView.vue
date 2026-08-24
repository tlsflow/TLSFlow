<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { gcacVersion } from '@/version'

const { t } = useI18n()
</script>

<template>
  <section class="gc-page version-page">
    <section class="gc-card version-page__card" :aria-label="t('settings.version.currentVersion')">
      <h2>{{ t('settings.version.title') }}</h2>
      <span class="version-page__label">{{ t('settings.version.currentVersion') }}</span>
      <strong class="version-page__value">{{ gcacVersion }}</strong>
      <dl class="version-page__details">
        <div>
          <dt>{{ t('settings.version.product') }}</dt>
          <dd>{{ t('app.brand') }}</dd>
        </div>
      </dl>
    </section>
  </section>
</template>

<style scoped>
.version-page {
  display: grid;
  gap: var(--gc-space-5);
}

.version-page__card {
  display: grid;
  gap: var(--gc-space-3);
  padding: var(--gc-space-8);
  border: var(--gc-border-width-default) solid var(--gc-color-info-border);
  background: var(--gc-color-info-soft);
}

.version-page__label {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 700;
}

.version-page__value {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-2xl);
  line-height: 1;
}

.version-page__details {
  margin: var(--gc-space-3) 0 0;
  padding-top: var(--gc-space-4);
  border-top: var(--gc-border-width-default) solid var(--gc-color-info-border);
}

.version-page__details div {
  display: grid;
  gap: var(--gc-space-1);
}

.version-page__details dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.version-page__details dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-md);
  font-weight: 700;
}
</style>

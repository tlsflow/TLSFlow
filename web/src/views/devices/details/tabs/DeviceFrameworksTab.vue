<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { GcEmptyState, GcStatusTag } from '@/design-system/components'
import type { DeviceFrameworkView } from '../device-detail.model'

defineProps<{ frameworks: readonly DeviceFrameworkView[] }>()
const { t } = useI18n()
</script>

<template>
  <section v-if="frameworks.length" class="agent-detail-modal__section" :aria-label="t('devices.unifiedDetail.aria.frameworks')">
    <div class="agent-detail-modal__framework-grid" role="list">
      <article v-for="framework in frameworks" :key="framework.id" class="agent-detail-modal__framework-card" role="listitem">
        <header>
          <span>{{ framework.type || t('devices.unifiedDetail.values.empty') }}</span>
          <h3>{{ framework.name }}</h3>
        </header>
        <dl>
          <div>
            <dt>{{ t('devices.unifiedDetail.fields.frameworkVersion') }}</dt>
            <dd>{{ framework.version || t('devices.unifiedDetail.values.empty') }}</dd>
          </div>
          <div>
            <dt>{{ t('devices.unifiedDetail.fields.frameworkStatus') }}</dt>
            <dd><GcStatusTag :status="framework.status || 'UNKNOWN'" /></dd>
          </div>
        </dl>
      </article>
    </div>
  </section>
  <GcEmptyState v-else :title="t('devices.unifiedDetail.empty.frameworks')" />
</template>

<style scoped>
.agent-detail-modal__section { padding: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-glass); box-shadow: var(--gc-shadow-sm); }
.agent-detail-modal__framework-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-2); }
.agent-detail-modal__framework-card { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface-glass); }
.agent-detail-modal__framework-card header { display: grid; gap: var(--gc-space-1); }
.agent-detail-modal__framework-card header span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 800; text-transform: uppercase; }
.agent-detail-modal__framework-card h3 { margin: 0; color: var(--gc-color-text); font-size: var(--gc-font-size-sm); }
.agent-detail-modal__framework-card dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-2); margin: 0; }
.agent-detail-modal__framework-card dl div { display: grid; gap: var(--gc-space-1); }
.agent-detail-modal__framework-card dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 800; }
.agent-detail-modal__framework-card dd { margin: 0; color: var(--gc-color-text); font-size: var(--gc-font-size-xs); font-weight: 800; overflow-wrap: anywhere; }
@media (max-width: 64rem) { .agent-detail-modal__framework-grid { grid-template-columns: 1fr; } }
@media (max-width: 47.5rem) { .agent-detail-modal__framework-card dl { grid-template-columns: 1fr; } }
</style>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { GcEmptyState, GcStatusTag } from '@/design-system/components'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import type { DeviceLogView } from '../device-detail.model'

defineProps<{ logs: readonly DeviceLogView[] }>()
const { t } = useI18n()
</script>

<template>
  <section v-if="logs.length" class="agent-detail-modal__section" :aria-label="t('devices.unifiedDetail.aria.logs')">
    <div class="agent-detail-modal__log-list" role="list">
      <article v-for="log in logs" :key="log.id" class="agent-detail-modal__log-item" role="listitem">
        <header class="agent-detail-modal__log-head">
          <div class="agent-detail-modal__log-main">
            <strong>{{ log.eventType }}</strong>
            <p>{{ log.summary || t('devices.unifiedDetail.values.empty') }}</p>
          </div>
          <div class="agent-detail-modal__log-meta">
            <GcStatusTag v-if="log.result" :status="log.result" />
            <time>{{ formatBrowserLocalTime(log.occurredAt) }}</time>
          </div>
        </header>
      </article>
    </div>
  </section>
  <GcEmptyState v-else :title="t('devices.unifiedDetail.empty.logs')" />
</template>

<style scoped>
.agent-detail-modal__section { padding: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-glass); box-shadow: var(--gc-shadow-sm); }
.agent-detail-modal__log-list { display: grid; grid-column: 1 / -1; gap: var(--gc-space-1); }
.agent-detail-modal__log-item { display: grid; gap: var(--gc-space-1); padding: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface-glass); }
.agent-detail-modal__log-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--gc-space-3); }
.agent-detail-modal__log-main { display: grid; min-width: 0; gap: var(--gc-space-1); }
.agent-detail-modal__log-main strong,
.agent-detail-modal__log-main p { margin: 0; }
.agent-detail-modal__log-main strong { color: var(--gc-color-text); font-size: var(--gc-font-size-sm); font-weight: 900; overflow-wrap: anywhere; }
.agent-detail-modal__log-main p { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); line-height: 1.3; overflow-wrap: anywhere; }
.agent-detail-modal__log-meta { display: grid; justify-items: end; min-width: calc(var(--gc-space-10) * 4); gap: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); text-align: right; white-space: nowrap; }
@media (max-width: 68.75rem) { .agent-detail-modal__log-head { flex-direction: column; } .agent-detail-modal__log-meta { justify-items: start; min-width: 0; text-align: left; } }
</style>

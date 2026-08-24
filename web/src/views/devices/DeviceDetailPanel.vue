<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcStatusTag } from '@/design-system/components'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

const props = defineProps<{ detail: Record<string, unknown> }>()
const { t } = useI18n()
const publicSummary = computed(() => (props.detail.publicSummary ?? {}) as Record<string, unknown>)
const extensionSummary = computed(() => (props.detail.extensionSummary ?? {}) as Record<string, unknown>)
const allowedActions = computed(() => Array.isArray(props.detail.allowedActions) ? props.detail.allowedActions.map(String) : [])
const isAgent = computed(() => props.detail.extensionType === 'AGENT')

function actionLabel(action: string): string {
  return t(`devices.detail.actions.${action}`)
}
</script>

<template>
  <div class="device-detail">
    <header class="device-detail__hero">
      <div>
        <h3>{{ detail.displayName }}</h3>
        <p>{{ detail.productFamily }} · {{ detail.managementMethod }}</p>
      </div>
      <GcStatusTag :status="String(detail.health ?? 'UNKNOWN')" />
    </header>

    <section class="device-detail__grid">
      <article>
        <h4>{{ t('devices.detail.sections.overview') }}</h4>
        <dl>
          <div><dt>{{ t('devices.columns.managementAddress') }}</dt><dd>{{ detail.managementAddress || '—' }}</dd></div>
          <div><dt>{{ t('devices.columns.version') }}</dt><dd>{{ detail.softwareVersion || '—' }}</dd></div>
          <div><dt>{{ t('devices.columns.applications') }}</dt><dd>{{ detail.applicationAssetCount ?? 0 }}</dd></div>
          <div><dt>{{ t('devices.columns.lastContact') }}</dt><dd>{{ formatBrowserLocalTime(String(detail.lastContactAt ?? publicSummary.updatedAt ?? '')) }}</dd></div>
        </dl>
      </article>
      <article>
        <h4>{{ t('devices.detail.sections.runtime') }}</h4>
        <dl>
          <div><dt>{{ t('devices.detail.fields.hostname') }}</dt><dd>{{ publicSummary.hostname || '—' }}</dd></div>
          <div><dt>{{ t('devices.detail.fields.osType') }}</dt><dd>{{ publicSummary.osType || '—' }}</dd></div>
          <div><dt>{{ t('devices.detail.fields.managementMode') }}</dt><dd>{{ publicSummary.managementMode || '—' }}</dd></div>
          <div><dt>{{ t('devices.detail.fields.statusReason') }}</dt><dd>{{ detail.statusReason || '—' }}</dd></div>
        </dl>
      </article>
    </section>

    <section class="device-detail__extension">
      <h4>{{ isAgent ? t('devices.detail.sections.agent') : t('devices.detail.sections.networkAppliance') }}</h4>
      <pre>{{ JSON.stringify(extensionSummary, null, 2) }}</pre>
    </section>

    <section class="device-detail__actions">
      <h4>{{ t('devices.detail.sections.actions') }}</h4>
      <div>
        <button v-for="action in allowedActions" :key="action" class="gc-button" type="button" disabled>
          {{ actionLabel(action) }}
        </button>
      </div>
      <p v-if="allowedActions.includes('DISABLE_DEVICE')">{{ t('devices.detail.disableImpact') }}</p>
    </section>
  </div>
</template>

<style scoped>
.device-detail { display: grid; gap: var(--gc-space-5); }
.device-detail__hero { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-4); }
.device-detail__hero h3, .device-detail__hero p, .device-detail h4 { margin: 0; }
.device-detail__hero p { color: var(--gc-color-text-muted); }
.device-detail__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.device-detail article, .device-detail__extension, .device-detail__actions { padding: var(--gc-space-4); background: var(--gc-color-surface-soft); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-md); }
.device-detail dl { display: grid; gap: var(--gc-space-3); margin: var(--gc-space-3) 0 0; }
.device-detail dl div { display: flex; justify-content: space-between; gap: var(--gc-space-3); }
.device-detail dt { color: var(--gc-color-text-muted); }
.device-detail dd { margin: 0; text-align: right; }
.device-detail pre { overflow: auto; margin: var(--gc-space-3) 0 0; color: var(--gc-color-text); white-space: pre-wrap; }
.device-detail__actions div { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); margin-top: var(--gc-space-3); }
.device-detail__actions p { color: var(--gc-color-danger); }
</style>

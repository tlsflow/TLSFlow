<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcModal, GcStatusTag } from '@/design-system/components'

const props = defineProps<{
  open: boolean
  detail: Record<string, unknown> | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()

const extension = computed(() => {
  const value = props.detail?.extensionSummary
  return isRecord(value) ? value : {}
})

const resources = computed(() => {
  const capabilityProfile = isRecord(extension.value.capabilityProfile) ? extension.value.capabilityProfile : {}
  const value = capabilityProfile.resources ?? capabilityProfile.discovery ?? capabilityProfile
  return isRecord(value) ? value : {}
})

const virtualServers = computed(() => readList(resources.value.virtualServers ?? resources.value.virtualServer))
const certificates = computed(() => readList(resources.value.certificates ?? resources.value.certificateResources))
const bindings = computed(() => readList(resources.value.certificateBindings ?? resources.value.bindings))

const title = computed(() => text(props.detail?.displayName ?? props.detail?.name, t('devices.detail.title')))
const status = computed(() => text(props.detail?.health ?? props.detail?.sourceStatus, 'UNKNOWN'))

function text(value: unknown, fallback = '—'): string {
  if (value === undefined || value === null || value === '') return fallback
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function readList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function field(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && value !== '') return text(value)
  }
  return '—'
}

function close() {
  emit('update:open', false)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
</script>

<template>
  <GcModal
    :open="props.open"
    :title="title"
    :description="t('devices.detail.citrixDescription')"
    size="xl"
    @update:open="close"
  >
    <div class="citrix-detail">
      <header class="citrix-detail__hero">
        <div>
          <p class="citrix-detail__eyebrow">{{ t('devices.platforms.citrixAdc') }}</p>
          <h3>{{ title }}</h3>
          <p>{{ field(props.detail ?? {}, 'managementAddress', 'address') }} · {{ field(props.detail ?? {}, 'productFamily') }}</p>
        </div>
        <GcStatusTag :status="status" />
      </header>

      <section class="citrix-detail__grid">
        <article>
          <h4>{{ t('devices.detail.citrix.connection') }}</h4>
          <dl>
            <div><dt>{{ t('devices.detail.fields.managementAddress') }}</dt><dd>{{ field(props.detail ?? {}, 'managementAddress', 'address') }}</dd></div>
            <div><dt>{{ t('devices.detail.fields.managementPort') }}</dt><dd>{{ field(extension, 'managementPort', 'port') }}</dd></div>
            <div><dt>{{ t('devices.detail.fields.authMode') }}</dt><dd>{{ field(extension, 'authMode', 'authenticationMode') }}</dd></div>
            <div><dt>{{ t('devices.detail.fields.tlsVerify') }}</dt><dd>{{ props.detail?.tlsVerify === false || extension.tlsVerify === false ? t('devices.detail.values.no') : t('devices.detail.values.yes') }}</dd></div>
          </dl>
        </article>
        <article>
          <h4>{{ t('devices.detail.citrix.software') }}</h4>
          <dl>
            <div><dt>{{ t('devices.detail.fields.deviceFamily') }}</dt><dd>{{ field(extension, 'deviceFamily') }}</dd></div>
            <div><dt>{{ t('devices.detail.fields.softwareVersion') }}</dt><dd>{{ field(props.detail ?? {}, 'softwareVersion', 'version') }}</dd></div>
            <div><dt>{{ t('devices.detail.fields.softwareBuild') }}</dt><dd>{{ field(extension, 'softwareBuild', 'build') }}</dd></div>
            <div><dt>{{ t('devices.detail.fields.supportTier') }}</dt><dd>{{ field(extension, 'supportTier') }}</dd></div>
          </dl>
        </article>
      </section>

      <section class="citrix-detail__resources">
        <article>
          <h4>{{ t('devices.detail.citrix.virtualServers') }} <span>{{ virtualServers.length }}</span></h4>
          <ul v-if="virtualServers.length">
            <li v-for="server in virtualServers" :key="field(server, 'id', 'name')">
              <strong>{{ field(server, 'name', 'vserverName') }}</strong>
              <span>{{ field(server, 'type', 'serviceType') }} · {{ field(server, 'address', 'ipv46') }}:{{ field(server, 'port') }}</span>
            </li>
          </ul>
          <p v-else class="citrix-detail__empty">{{ t('devices.detail.citrix.noResources') }}</p>
        </article>
        <article>
          <h4>{{ t('devices.detail.citrix.certificates') }} <span>{{ certificates.length }}</span></h4>
          <ul v-if="certificates.length">
            <li v-for="certificate in certificates" :key="field(certificate, 'id', 'name')">
              <strong>{{ field(certificate, 'name', 'certkeyName', 'subject') }}</strong>
              <span>{{ field(certificate, 'notAfter', 'expiryDate') }}</span>
            </li>
          </ul>
          <p v-else class="citrix-detail__empty">{{ t('devices.detail.citrix.noResources') }}</p>
        </article>
        <article>
          <h4>{{ t('devices.detail.citrix.bindings') }} <span>{{ bindings.length }}</span></h4>
          <ul v-if="bindings.length">
            <li v-for="binding in bindings" :key="field(binding, 'id', 'vserverName', 'certkeyName')">
              <strong>{{ field(binding, 'vserverName', 'virtualServerName') }}</strong>
              <span>{{ field(binding, 'certkeyName', 'certificateName', 'certKey') }}</span>
            </li>
          </ul>
          <p v-else class="citrix-detail__empty">{{ t('devices.detail.citrix.noResources') }}</p>
        </article>
      </section>
    </div>
  </GcModal>
</template>

<style scoped>
.citrix-detail { display: grid; gap: var(--gc-space-5); }
.citrix-detail__hero { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--gc-space-4); }
.citrix-detail__hero h3, .citrix-detail__hero p, .citrix-detail h4 { margin: 0; }
.citrix-detail__hero p:not(.citrix-detail__eyebrow) { color: var(--gc-color-text-muted); }
.citrix-detail__eyebrow { color: var(--gc-color-primary); font-size: var(--gc-font-size-sm); }
.citrix-detail__grid, .citrix-detail__resources { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.citrix-detail__resources { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.citrix-detail article { padding: var(--gc-space-4); background: var(--gc-color-surface-soft); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-md); }
.citrix-detail dl { display: grid; gap: var(--gc-space-3); margin: var(--gc-space-3) 0 0; }
.citrix-detail dl div { display: flex; justify-content: space-between; gap: var(--gc-space-3); }
.citrix-detail dt, .citrix-detail__empty { color: var(--gc-color-text-muted); }
.citrix-detail dd { margin: 0; text-align: right; }
.citrix-detail h4 { display: flex; justify-content: space-between; gap: var(--gc-space-3); }
.citrix-detail ul { display: grid; gap: var(--gc-space-3); margin: var(--gc-space-4) 0 0; padding: 0; list-style: none; }
.citrix-detail li { display: grid; gap: var(--gc-space-1); }
.citrix-detail li span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
@media (max-width: 900px) { .citrix-detail__grid, .citrix-detail__resources { grid-template-columns: 1fr; } }
</style>

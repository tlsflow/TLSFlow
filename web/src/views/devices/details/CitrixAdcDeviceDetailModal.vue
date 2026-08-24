<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcModal, GcStatusTag } from '@/design-system/components'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'

type DetailTab = 'overview' | 'certificates' | 'lb-servers' | 'vpn-servers' | 'logs'

const props = defineProps<{
  open: boolean
  detail: Record<string, unknown> | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const activeTab = ref<DetailTab>('overview')
const expandedLogIds = ref<string[]>([])

const extension = computed(() => asRecord(props.detail?.extensionSummary))
const virtualServers = computed(() => readList(extension.value.virtualServers))
const certificates = computed(() => readList(extension.value.certificateResources))
const bindings = computed(() => readList(extension.value.certificateBindings))
const deviceLogs = computed(() => readList(extension.value.deviceLogs))
const lbServers = computed(() => virtualServers.value.filter((item) => field(item, 'type').toUpperCase() === 'LB'))
const vpnServers = computed(() => virtualServers.value.filter((item) => field(item, 'type').toUpperCase() === 'VPN'))
const activeServers = computed(() => activeTab.value === 'vpn-servers' ? vpnServers.value : lbServers.value)
const activeServerLabel = computed(() => activeTab.value === 'vpn-servers'
  ? t('devices.detail.citrix.tabs.vpnServers')
  : t('devices.detail.citrix.tabs.lbServers'))
const activeServerSectionTitle = computed(() => activeTab.value === 'vpn-servers'
  ? t('devices.detail.citrix.sections.vpnServersTitle')
  : t('devices.detail.citrix.sections.lbServersTitle'))
const activeServerSectionDescription = computed(() => activeTab.value === 'vpn-servers'
  ? t('devices.detail.citrix.sections.vpnServersDescription')
  : t('devices.detail.citrix.sections.lbServersDescription'))
const activeServerEmptyText = computed(() => activeTab.value === 'vpn-servers'
  ? t('devices.detail.citrix.empty.vpnServers')
  : t('devices.detail.citrix.empty.lbServers'))

const tabs = computed(() => [
  { key: 'overview' as const, label: t('devices.detail.citrix.tabs.basic') },
  { key: 'certificates' as const, label: t('devices.detail.citrix.tabs.certificates') },
  { key: 'lb-servers' as const, label: t('devices.detail.citrix.tabs.lbServers') },
  { key: 'vpn-servers' as const, label: t('devices.detail.citrix.tabs.vpnServers') },
  { key: 'logs' as const, label: t('devices.detail.citrix.tabs.logs') },
])

const title = computed(() => text(props.detail?.displayName ?? props.detail?.name, t('devices.detail.title')))
const status = computed(() => text(props.detail?.health ?? props.detail?.sourceStatus, 'UNKNOWN'))

watch(() => props.open, (open) => {
  if (!open) return
  activeTab.value = 'overview'
  expandedLogIds.value = []
})

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

function localTimeField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && value !== '') return formatMaybeLocalTime(value)
  }
  return '—'
}

function serverBindings(server: Record<string, unknown>): Record<string, unknown>[] {
  const name = field(server, 'name', 'virtualServerName')
  const type = field(server, 'type', 'virtualServerType')
  return bindings.value.filter((binding) => {
    const bindingName = field(binding, 'virtualServerName', 'vserverName')
    const bindingType = field(binding, 'virtualServerType', 'type')
    return bindingName === name && (bindingType === '—' || bindingType === type)
  })
}

function certificateBindings(certificate: Record<string, unknown>): Record<string, unknown>[] {
  const name = field(certificate, 'certkeyName', 'name')
  return bindings.value.filter((binding) => field(binding, 'certkeyName', 'certificateName') === name)
}

function serverEndpoint(server: Record<string, unknown>): string {
  const address = field(server, 'address', 'ipv46')
  const port = field(server, 'port')
  return port === '—' ? address : `${address}:${port}`
}

function bindingMode(binding: Record<string, unknown>): string {
  return binding.sniCertificate === true
    ? t('devices.detail.citrix.values.sni')
    : t('devices.detail.citrix.values.defaultBinding')
}

function logId(log: Record<string, unknown>, index: number): string {
  return field(log, 'id') === '—' ? `device-log-${index}` : field(log, 'id')
}

function isLogExpanded(id: string): boolean {
  return expandedLogIds.value.includes(id)
}

function toggleLog(id: string): void {
  expandedLogIds.value = isLogExpanded(id)
    ? expandedLogIds.value.filter((item) => item !== id)
    : [...expandedLogIds.value, id]
}

function logDetail(log: Record<string, unknown>): string {
  const detail = log.detail
  if (detail === undefined || detail === null || detail === '') return '—'
  return typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)
}

function close(): void {
  emit('update:open', false)
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
</script>

<template>
  <GcModal
    :open="props.open"
    :title="t('devices.detail.title')"
    :description="t('devices.detail.citrixDescription')"
    size="xl"
    width="66vw"
    @update:open="close"
  >
    <section class="adc-detail">
      <div class="adc-detail__hero">
        <div class="adc-detail__hero-copy">
          <p class="adc-detail__eyebrow">{{ t('devices.platforms.citrixAdc') }}</p>
          <h2>{{ title }}</h2>
          <span>{{ field(extension, 'deviceAssetId') }} · {{ field(props.detail ?? {}, 'productFamily') }}</span>
        </div>
        <div class="adc-detail__hero-side">
          <GcStatusTag :status="status" />
          <div class="adc-detail__spotlight">
            <small>{{ t('devices.detail.fields.managementAddress') }}</small>
            <strong>{{ field(props.detail ?? {}, 'managementAddress', 'address') }}</strong>
          </div>
        </div>
      </div>

      <nav class="adc-detail__tabs" :aria-label="t('devices.detail.citrix.tabsAriaLabel')">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="adc-detail__tab"
          :data-active="activeTab === tab.key"
          type="button"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>

      <div v-if="activeTab === 'overview'" class="adc-detail__sections">
        <article class="adc-detail__section">
          <header class="adc-detail__section-head">
            <h3>{{ t('devices.detail.citrix.sections.connectionTitle') }}</h3>
            <p>{{ t('devices.detail.citrix.sections.connectionDescription') }}</p>
          </header>
          <dl class="adc-detail__grid">
            <div><dt>{{ t('devices.detail.fields.managementAddress') }}</dt><dd>{{ field(props.detail ?? {}, 'managementAddress', 'address') }}</dd></div>
            <div><dt>{{ t('devices.detail.fields.managementPort') }}</dt><dd>{{ field(extension, 'managementPort', 'port') }}</dd></div>
            <div><dt>{{ t('devices.detail.fields.authMode') }}</dt><dd>{{ field(extension, 'authMode', 'authenticationMode') }}</dd></div>
            <div><dt>{{ t('devices.detail.fields.tlsVerify') }}</dt><dd>{{ props.detail?.tlsVerify === false || extension.tlsVerify === false ? t('devices.detail.values.no') : t('devices.detail.values.yes') }}</dd></div>
            <div><dt>{{ t('devices.detail.citrix.fields.lastContact') }}</dt><dd>{{ formatMaybeLocalTime(props.detail?.lastContactAt) }}</dd></div>
            <div><dt>{{ t('devices.detail.fields.statusReason') }}</dt><dd>{{ field(props.detail ?? {}, 'statusReason') }}</dd></div>
          </dl>
        </article>

        <article class="adc-detail__section">
          <header class="adc-detail__section-head">
            <h3>{{ t('devices.detail.citrix.sections.softwareTitle') }}</h3>
            <p>{{ t('devices.detail.citrix.sections.softwareDescription') }}</p>
          </header>
          <dl class="adc-detail__grid">
            <div><dt>{{ t('devices.detail.fields.deviceFamily') }}</dt><dd>{{ field(extension, 'deviceFamily') }}</dd></div>
            <div><dt>{{ t('devices.detail.fields.softwareVersion') }}</dt><dd>{{ field(props.detail ?? {}, 'softwareVersion', 'version') }}</dd></div>
            <div><dt>{{ t('devices.detail.fields.softwareBuild') }}</dt><dd>{{ field(extension, 'softwareBuild', 'build') }}</dd></div>
            <div><dt>{{ t('devices.detail.fields.supportTier') }}</dt><dd>{{ field(extension, 'supportTier') }}</dd></div>
            <div><dt>{{ t('devices.detail.citrix.fields.certificateCount') }}</dt><dd>{{ certificates.length }}</dd></div>
            <div><dt>{{ t('devices.detail.citrix.fields.virtualServerCount') }}</dt><dd>{{ virtualServers.length }}</dd></div>
          </dl>
        </article>
      </div>

      <article v-else-if="activeTab === 'certificates'" class="adc-detail__section">
        <header class="adc-detail__section-head">
          <h3>{{ t('devices.detail.citrix.sections.certificatesTitle') }}</h3>
          <p>{{ t('devices.detail.citrix.sections.certificatesDescription') }}</p>
        </header>
        <div v-if="certificates.length" class="adc-detail__cards">
          <article v-for="certificate in certificates" :key="field(certificate, 'id', 'certkeyName')" class="adc-detail__resource-card">
            <header>
              <div>
                <small>{{ t('devices.detail.citrix.fields.certificateName') }}</small>
                <strong>{{ field(certificate, 'certkeyName', 'name') }}</strong>
              </div>
              <GcStatusTag :status="field(certificate, 'remoteStatus')" />
            </header>
            <dl class="adc-detail__resource-meta">
              <div class="adc-detail__resource-meta-wide"><dt>{{ t('devices.detail.citrix.fields.subject') }}</dt><dd>{{ field(certificate, 'subject') }}</dd></div>
              <div class="adc-detail__resource-meta-wide"><dt>{{ t('devices.detail.citrix.fields.issuer') }}</dt><dd>{{ field(certificate, 'issuer') }}</dd></div>
              <div><dt>{{ t('devices.detail.citrix.fields.validFrom') }}</dt><dd>{{ localTimeField(certificate, 'notBefore') }}</dd></div>
              <div><dt>{{ t('devices.detail.citrix.fields.expiresAt') }}</dt><dd>{{ localTimeField(certificate, 'notAfter', 'expiryDate') }}</dd></div>
            </dl>
            <footer>
              <span>{{ t('devices.detail.citrix.fields.boundVirtualServers') }}</span>
              <div v-if="certificateBindings(certificate).length" class="adc-detail__chips">
                <span v-for="binding in certificateBindings(certificate)" :key="field(binding, 'id')">
                  {{ field(binding, 'virtualServerName') }} · {{ bindingMode(binding) }}
                </span>
              </div>
              <strong v-else>—</strong>
            </footer>
          </article>
        </div>
        <p v-else class="adc-detail__empty">{{ t('devices.detail.citrix.empty.certificates') }}</p>
      </article>

      <article v-else-if="activeTab === 'lb-servers' || activeTab === 'vpn-servers'" class="adc-detail__section">
        <header class="adc-detail__section-head">
          <h3>{{ activeServerSectionTitle }}</h3>
          <p>{{ activeServerSectionDescription }}</p>
        </header>
        <div v-if="activeServers.length" class="adc-detail__server-list">
          <article v-for="server in activeServers" :key="field(server, 'id', 'name')" class="adc-detail__server-card">
            <header class="adc-detail__server-head">
              <div class="adc-detail__server-title">
                <small>{{ activeServerLabel }}</small>
                <strong>{{ field(server, 'name') }}</strong>
                <span>{{ serverEndpoint(server) }} · {{ field(server, 'protocol') }}</span>
              </div>
              <GcStatusTag :status="field(server, 'runtimeState')" />
            </header>
            <div class="adc-detail__server-meta">
              <span>{{ t('devices.detail.citrix.fields.sniNames') }}：{{ field(server, 'sniNames') }}</span>
              <span>{{ t('devices.detail.citrix.fields.certificateBindings') }}：{{ serverBindings(server).length }}</span>
            </div>
            <div v-if="serverBindings(server).length" class="adc-detail__site-bindings">
              <article v-for="binding in serverBindings(server)" :key="field(binding, 'id')" class="adc-detail__binding-card">
                <header>
                  <div>
                    <strong>{{ field(binding, 'certkeyName') }}</strong>
                    <small>{{ field(binding, 'certificateSubject') }}</small>
                  </div>
                  <div class="adc-detail__binding-status">
                    <GcStatusTag :status="field(binding, 'certificateStatus')" />
                    <span>{{ bindingMode(binding) }}</span>
                  </div>
                </header>
                <dl class="adc-detail__certificate-meta">
                  <div><dt>{{ t('devices.detail.citrix.fields.issuer') }}</dt><dd>{{ field(binding, 'certificateIssuer') }}</dd></div>
                  <div><dt>{{ t('devices.detail.citrix.fields.validFrom') }}</dt><dd>{{ localTimeField(binding, 'certificateNotBefore') }}</dd></div>
                  <div><dt>{{ t('devices.detail.citrix.fields.expiresAt') }}</dt><dd>{{ localTimeField(binding, 'certificateNotAfter') }}</dd></div>
                </dl>
              </article>
            </div>
            <p v-else class="adc-detail__binding-empty">{{ t('devices.detail.citrix.empty.bindings') }}</p>
          </article>
        </div>
        <p v-else class="adc-detail__empty">{{ activeServerEmptyText }}</p>
      </article>

      <article v-else class="adc-detail__section">
        <header class="adc-detail__section-head">
          <h3>{{ t('devices.detail.citrix.sections.logsTitle') }}</h3>
          <p>{{ t('devices.detail.citrix.sections.logsDescription') }}</p>
        </header>
        <div v-if="deviceLogs.length" class="adc-detail__log-list" role="list" :aria-label="t('devices.detail.citrix.logsAriaLabel')">
          <article v-for="(log, index) in deviceLogs" :key="logId(log, index)" class="adc-detail__log-item" role="listitem">
            <button class="adc-detail__log-toggle" type="button" @click="toggleLog(logId(log, index))">
              <span class="adc-detail__log-main">
                <strong>{{ field(log, 'eventType', 'action') }}</strong>
                <small>{{ field(log, 'action') }} · {{ field(log, 'actorId') }}</small>
              </span>
              <span class="adc-detail__log-meta">
                <GcStatusTag :status="field(log, 'result')" />
                <time>{{ localTimeField(log, 'createdAt') }}</time>
                <small>{{ isLogExpanded(logId(log, index)) ? t('devices.detail.citrix.collapseLog') : t('devices.detail.citrix.expandLog') }}</small>
              </span>
            </button>
            <pre v-if="isLogExpanded(logId(log, index))" class="adc-detail__log-detail"><code>{{ logDetail(log) }}</code></pre>
          </article>
        </div>
        <p v-else class="adc-detail__empty">{{ t('devices.detail.citrix.empty.logs') }}</p>
      </article>
    </section>
  </GcModal>
</template>

<style scoped>
.adc-detail { display: grid; gap: var(--gc-space-4); }
.adc-detail__hero { display: flex; justify-content: space-between; gap: var(--gc-space-5); padding: var(--gc-space-5); border: var(--gc-space-hairline) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-lg); background: var(--gc-gradient-surface); }
.adc-detail__hero-copy { display: grid; align-content: center; gap: var(--gc-space-1); min-width: 0; }
.adc-detail__hero-copy h2, .adc-detail__hero-copy p { margin: 0; }
.adc-detail__hero-copy h2 { font-size: var(--gc-font-size-xl); letter-spacing: -0.03em; }
.adc-detail__hero-copy span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); overflow-wrap: anywhere; }
.adc-detail__eyebrow { color: var(--gc-color-primary); font-size: var(--gc-font-size-xs); font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
.adc-detail__hero-side { display: grid; align-content: space-between; justify-items: end; gap: var(--gc-space-2); min-width: calc(var(--gc-space-10) * 4.5); }
.adc-detail__spotlight { display: grid; gap: var(--gc-space-1); min-width: calc(var(--gc-space-10) * 4.5); padding: var(--gc-space-3); border-radius: var(--gc-radius-md); background: var(--gc-color-text); color: var(--gc-color-surface-solid); }
.adc-detail__spotlight small { color: var(--gc-color-text-inverse-muted); font-size: var(--gc-font-size-xs); font-weight: 800; }
.adc-detail__spotlight strong { overflow-wrap: anywhere; }
.adc-detail__tabs { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.adc-detail__tab { padding: var(--gc-space-2) var(--gc-space-4); border: var(--gc-space-hairline) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-xl); background: var(--gc-color-surface-solid); color: var(--gc-color-text-muted); font: inherit; font-size: var(--gc-font-size-xs); font-weight: 800; cursor: pointer; }
.adc-detail__tab[data-active='true'] { border-color: var(--gc-color-focus); background: var(--gc-gradient-surface-soft); color: var(--gc-color-text); box-shadow: var(--gc-shadow-focus); }
.adc-detail__sections, .adc-detail__cards, .adc-detail__server-list, .adc-detail__log-list { display: grid; gap: var(--gc-space-3); }
.adc-detail__section { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-4); border: var(--gc-space-hairline) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-lg); background: var(--gc-gradient-surface); }
.adc-detail__section-head { display: grid; gap: var(--gc-space-1); }
.adc-detail__section-head h3, .adc-detail__section-head p { margin: 0; }
.adc-detail__section-head h3 { font-size: var(--gc-font-size-md); }
.adc-detail__section-head p, .adc-detail__empty { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.adc-detail__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); margin: 0; }
.adc-detail__grid > div { display: grid; gap: var(--gc-space-1); padding: var(--gc-space-3); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-soft); }
.adc-detail dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.adc-detail dd { margin: 0; color: var(--gc-color-text); font-size: var(--gc-font-size-sm); font-weight: 700; overflow-wrap: anywhere; }
.adc-detail__cards { grid-template-columns: repeat(auto-fit, minmax(calc(var(--gc-space-10) * 6), 1fr)); }
.adc-detail__resource-card, .adc-detail__log-item { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-md); background: var(--gc-gradient-surface-soft); }
.adc-detail__resource-card > header { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--gc-space-3); }
.adc-detail__resource-card header > div { display: grid; gap: var(--gc-space-1); min-width: 0; }
.adc-detail__resource-card header small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.adc-detail__resource-card header strong { overflow-wrap: anywhere; }
.adc-detail__resource-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-2) var(--gc-space-3); margin: 0; padding-top: var(--gc-space-2); border-top: var(--gc-space-hairline) solid var(--gc-color-border-muted); }
.adc-detail__resource-meta > div { display: grid; gap: var(--gc-space-1); min-width: 0; }
.adc-detail__resource-meta-wide { grid-column: 1 / -1; }
.adc-detail__resource-meta dd { font-size: var(--gc-font-size-xs); font-weight: 700; }
.adc-detail__resource-card footer { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.adc-detail__chips { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.adc-detail__chips span { padding: var(--gc-space-1) var(--gc-space-2); border: var(--gc-space-hairline) solid var(--gc-color-primary-border); border-radius: var(--gc-radius-xl); background: var(--gc-color-primary-soft); color: var(--gc-color-primary-strong); font-size: var(--gc-font-size-xs); font-weight: 700; overflow-wrap: anywhere; }
.adc-detail__server-list { grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; margin: 0; }
.adc-detail__server-card { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-md); background: var(--gc-gradient-surface-soft); }
.adc-detail__server-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--gc-space-3); }
.adc-detail__server-title { display: grid; gap: var(--gc-space-1); min-width: 0; }
.adc-detail__server-title small, .adc-detail__server-title span, .adc-detail__server-meta { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.adc-detail__server-title strong { font-size: var(--gc-font-size-md); overflow-wrap: anywhere; }
.adc-detail__server-title span { overflow-wrap: anywhere; }
.adc-detail__server-meta { display: flex; flex-wrap: wrap; gap: var(--gc-space-2) var(--gc-space-4); font-weight: 700; }
.adc-detail__site-bindings { display: grid; gap: var(--gc-space-2); }
.adc-detail__binding-card { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-code-bg); border-radius: var(--gc-radius-md); background: var(--gc-color-code-bg); color: var(--gc-color-text-inverse); }
.adc-detail__binding-card > header { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--gc-space-2); }
.adc-detail__binding-card header > div:first-child { display: grid; gap: var(--gc-space-1); min-width: 0; }
.adc-detail__binding-card header small { color: var(--gc-color-text-inverse-muted); font-size: var(--gc-font-size-xs); overflow-wrap: anywhere; }
.adc-detail__binding-card header strong { color: var(--gc-color-text-inverse); overflow-wrap: anywhere; }
.adc-detail__binding-status { display: grid; gap: var(--gc-space-1); justify-items: end; color: var(--gc-color-text-inverse-muted); font-size: var(--gc-font-size-xs); font-weight: 800; }
.adc-detail__certificate-meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-2); margin: 0; }
.adc-detail__certificate-meta > div { display: grid; gap: var(--gc-space-1); min-width: 0; }
.adc-detail__certificate-meta dt { color: var(--gc-color-text-inverse-muted); }
.adc-detail__certificate-meta dd { color: var(--gc-color-text-inverse); font-size: var(--gc-font-size-xs); }
.adc-detail__binding-empty { margin: 0; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.adc-detail__log-toggle { display: flex; justify-content: space-between; gap: var(--gc-space-4); width: 100%; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.adc-detail__log-main, .adc-detail__log-meta { display: grid; gap: var(--gc-space-1); }
.adc-detail__log-main { min-width: 0; }
.adc-detail__log-main strong { overflow-wrap: anywhere; }
.adc-detail__log-main small, .adc-detail__log-meta time, .adc-detail__log-meta small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.adc-detail__log-meta { justify-items: end; min-width: calc(var(--gc-space-10) * 4); text-align: right; }
.adc-detail__log-detail { margin: 0; padding: var(--gc-space-3); overflow: auto; border-radius: var(--gc-radius-md); background: var(--gc-color-code-bg); color: var(--gc-color-muted-bg); font-size: var(--gc-font-size-xs); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.adc-detail__log-detail code { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace; }
.adc-detail__empty { margin: 0; padding: var(--gc-space-6); text-align: center; }
@media (max-width: 68.75rem) { .adc-detail__server-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 56.25rem) { .adc-detail__hero { flex-direction: column; } .adc-detail__hero-side { justify-items: stretch; } .adc-detail__spotlight { min-width: 0; } .adc-detail__cards, .adc-detail__grid, .adc-detail__certificate-meta, .adc-detail__resource-meta { grid-template-columns: 1fr; } .adc-detail__resource-meta-wide { grid-column: auto; } .adc-detail__log-toggle { flex-direction: column; } .adc-detail__log-meta { justify-items: start; min-width: 0; text-align: left; } }
@media (max-width: 47.5rem) { .adc-detail__server-list { grid-template-columns: 1fr; } }
</style>

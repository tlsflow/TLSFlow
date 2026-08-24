<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { listCertificateVersions } from '@/api/modules/certificates.api'
import { executeManagedDeviceCapability, getManagedDevice, refreshManagedDeviceDiscovery } from '@/api/modules/devices.api'
import type { ApiRecord } from '@/api/modules/common'
import { GcDevicePresentation, GcModal, GcStatusTag, type DevicePresentationSchema } from '@/design-system/components'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import CertificateDetailPanel from '@/views/certificates/CertificateDetailPanel.vue'
import { DeviceDetailAdapterRegistry } from './device-detail.adapter'
import { deviceDetailTabRegistry } from './device-detail.providers'
import type { DeviceBoundCertificateView, DeviceCertificateSelection } from './device-detail.model'

const { t, locale } = useI18n()
const opened = ref(false)
const loading = ref(false)
const rediscovering = ref(false)
const error = ref('')
const discoveryFeedback = ref<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null)
const detail = ref<ApiRecord | null>(null)
const openedDeviceId = ref('')
const activeTab = ref('overview')
const certificateModalOpen = ref(false)
const certificateAssetDetailOpen = ref(false)
const selectedCertificate = ref<DeviceCertificateSelection | null>(null)
const selectedCertificateAssetRoute = ref<{ assetId: string; versionId: string } | null>(null)
const certificateAssetError = ref('')
const certificateContextUsages = ref<ApiRecord[]>([])
let certificateLookupRequest = 0
const adapterRegistry = new DeviceDetailAdapterRegistry()
const context = computed(() => detail.value ? adapterRegistry.buildContext(detail.value) : null)
const tabs = computed(() => context.value ? deviceDetailTabRegistry.resolve(context.value) : [])
const activeDescriptor = computed(() => tabs.value.find(tab => tab.key === activeTab.value) ?? tabs.value[0])
const pluginUi = computed(() => asRecord(detail.value?.pluginUi))
const pluginPresentation = computed(() => {
  const value = pluginUi.value.presentation
  return value && typeof value === 'object' ? value as DevicePresentationSchema : null
})
const pluginMessages = computed(() => asRecord(pluginUi.value.messages) as Record<string, string>)
const pluginTabRows = computed(() => ({
  frameworks: arrayRecords(detail.value?.frameworks),
  sites: arrayRecords(detail.value?.sites),
  certificates: arrayRecords(detail.value?.certificates),
  logs: arrayRecords(detail.value?.logs),
}))
const title = computed(() => String(detail.value?.displayName ?? t('devices.detail.title')))
const status = computed(() => String(detail.value?.health ?? 'UNKNOWN'))
const deviceType = computed(() => String(detail.value?.productFamily ?? detail.value?.category ?? t('devices.unifiedDetail.values.empty')))
const heroSubtitle = computed(() => String(detail.value?.category ?? detail.value?.managementMode ?? ''))
const deviceAssetId = computed(() => {
  const extension = asRecord(detail.value?.extension)
  const extensionSummary = asRecord(detail.value?.extensionSummary)
  return String(extension.deviceAssetId ?? extensionSummary.deviceAssetId ?? '')
})
const canRefreshDiscovery = computed(() => Boolean(
  openedDeviceId.value
  && deviceAssetId.value
  && context.value?.permissions.has('REFRESH_DISCOVERY'),
))
const selectedCertificateTitle = computed(() => {
  const certificate = selectedCertificate.value?.certificate
  return certificate?.name || certificate?.subject || t('devices.unifiedDetail.values.unknownCertificate')
})
const selectedCertificateSource = computed(() => {
  const selection = selectedCertificate.value
  if (!selection?.site) return t('devices.unifiedDetail.certificateDetail.deviceResource')
  const endpoint = selection.site.endpoint
  const endpointLabel = [endpoint?.protocol, endpoint?.hostName || endpoint?.address, endpoint?.port].filter(Boolean).join(' · ')
  return endpointLabel ? `${selection.site.name} · ${endpointLabel}` : selection.site.name
})

watch(tabs, (next) => {
  if (!next.some(tab => tab.key === activeTab.value)) activeTab.value = 'overview'
})

async function open(deviceId: string) {
  openedDeviceId.value = deviceId
  opened.value = true
  activeTab.value = 'overview'
  loading.value = true
  error.value = ''
  discoveryFeedback.value = null
  detail.value = null
  try {
    const response = await getManagedDevice(deviceId, locale.value)
    detail.value = response.data ?? null
    if (!detail.value) error.value = t('devices.errors.detailLoadFailed')
  } catch {
    error.value = t('devices.errors.detailLoadFailed')
  } finally {
    loading.value = false
  }
}

async function refreshDiscovery() {
  if (!canRefreshDiscovery.value || rediscovering.value || !openedDeviceId.value) return
  rediscovering.value = true
  discoveryFeedback.value = null
  try {
    const response = await refreshManagedDeviceDiscovery(openedDeviceId.value)
    const result = response.data ?? {}
    const refreshed = await getManagedDevice(openedDeviceId.value, locale.value)
    if (refreshed.data) detail.value = refreshed.data
    const succeeded = result.status === 'success'
    if (!succeeded) {
      discoveryFeedback.value = {
        tone: 'danger',
        message: t('devices.unifiedDetail.discovery.failed', {
          errorCode: String(result.status ?? t('devices.health.unknown')),
        }),
      }
    } else {
      discoveryFeedback.value = { tone: 'success', message: t('devices.unifiedDetail.discovery.success') }
    }
  } catch {
    discoveryFeedback.value = { tone: 'danger', message: t('devices.unifiedDetail.discovery.requestFailed') }
  } finally {
    rediscovering.value = false
  }
}

async function executePluginAction(capabilityKey: string) {
  if (!openedDeviceId.value || rediscovering.value) return
  rediscovering.value = true
  discoveryFeedback.value = null
  try {
    await executeManagedDeviceCapability(openedDeviceId.value, capabilityKey)
    const refreshed = await getManagedDevice(openedDeviceId.value, locale.value)
    if (refreshed.data) detail.value = refreshed.data
    discoveryFeedback.value = { tone: 'success', message: t('devices.onboarding.completed') }
  } catch (cause) {
    discoveryFeedback.value = { tone: 'danger', message: cause instanceof Error ? cause.message : t('devices.unifiedDetail.discovery.requestFailed') }
  } finally {
    rediscovering.value = false
  }
}

function normalizeFingerprint(value?: string): string {
  return String(value ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase()
}

function directCertificateRoute(certificate: DeviceBoundCertificateView) {
  if (!certificate.certificateAssetId || !certificate.certificateVersionId) return null
  return { assetId: certificate.certificateAssetId, versionId: certificate.certificateVersionId }
}

async function resolveCertificateAssetRoute(certificate: DeviceBoundCertificateView) {
  const directRoute = directCertificateRoute(certificate)
  if (directRoute) return directRoute
  const fingerprint = normalizeFingerprint(certificate.fingerprintSha256)
  if (!fingerprint) return null
  const response = await listCertificateVersions({ page: 1, pageSize: 20, keyword: fingerprint })
  const items = Array.isArray(response.data?.items) ? response.data.items : []
  const matched = items.find((item) => normalizeFingerprint(String(item.fingerprintSha256 ?? '')) === fingerprint)
  const assetId = String(matched?.certificateAssetId ?? '')
  const versionId = String(matched?.id ?? '')
  return assetId && versionId ? { assetId, versionId } : null
}

function buildCertificateContextUsages(selection: DeviceCertificateSelection): ApiRecord[] {
  const { site, binding, certificate } = selection
  if (!site) return []
  return [{
    id: `device-detail:${site.id}:${binding?.id ?? certificate.certificateVersionId ?? certificate.name ?? 'certificate'}`,
    resourceId: site.id,
    resourceName: site.name,
    targetName: site.name,
    domainName: binding?.hostName || site.endpoint?.hostName || certificate.subject || site.name,
    bindingType: binding?.bindingType || site.kind,
    resourceType: site.kind,
    status: binding?.status || site.status || 'ACTIVE',
    metadata: {
      source: 'device_detail',
      siteAssetId: site.siteAssetId,
      managedTargetId: site.managedTargetId,
      protocol: site.endpoint?.protocol,
      address: site.endpoint?.address,
      port: site.endpoint?.port,
    },
  }]
}

async function openCertificateDetail(selection: DeviceCertificateSelection) {
  const requestId = ++certificateLookupRequest
  certificateModalOpen.value = false
  certificateAssetDetailOpen.value = false
  selectedCertificate.value = selection
  selectedCertificateAssetRoute.value = null
  certificateContextUsages.value = buildCertificateContextUsages(selection)
  certificateAssetError.value = ''
  try {
    const route = await resolveCertificateAssetRoute(selection.certificate)
    if (requestId !== certificateLookupRequest) return
    if (route) {
      selectedCertificateAssetRoute.value = route
      certificateAssetDetailOpen.value = true
      return
    }
    certificateModalOpen.value = true
  } catch {
    if (requestId !== certificateLookupRequest) return
    certificateAssetError.value = t('devices.unifiedDetail.certificateDetail.queryFailed')
    certificateModalOpen.value = true
  }
}

function closeCertificateModal() {
  certificateLookupRequest += 1
  certificateModalOpen.value = false
  selectedCertificate.value = null
  selectedCertificateAssetRoute.value = null
  certificateContextUsages.value = []
  certificateAssetError.value = ''
}

function closeCertificateAssetDetail() {
  certificateLookupRequest += 1
  certificateAssetDetailOpen.value = false
  selectedCertificate.value = null
  selectedCertificateAssetRoute.value = null
  certificateContextUsages.value = []
  certificateAssetError.value = ''
}

function asRecord(value: unknown): ApiRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ApiRecord : {}
}

function arrayRecords(value: unknown): ApiRecord[] {
  return Array.isArray(value) ? value.filter((item): item is ApiRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []
}

defineExpose({ open })
</script>

<template>
  <GcModal
    v-model:open="opened"
    :title="t('devices.detail.title')"
    :description="t('devices.unifiedDetail.modalDescription')"
    size="lg"
    width="82vw"
  >
    <section class="agent-detail-modal">
      <p v-if="error" class="agent-detail-modal__error">{{ error }}</p>
      <div v-if="detail" class="agent-detail-modal__hero">
        <div class="agent-detail-modal__hero-copy">
          <p class="agent-detail-modal__eyebrow">{{ t('devices.unifiedDetail.nodeEyebrow') }}</p>
          <h2>{{ title }}</h2>
          <span>{{ heroSubtitle }}</span>
        </div>
        <div class="agent-detail-modal__hero-side">
          <GcStatusTag :status="status" />
          <div class="agent-detail-modal__spotlight">
            <small>{{ t('devices.unifiedDetail.deviceType') }}</small>
            <strong>{{ deviceType }}</strong>
          </div>
        </div>
      </div>

      <p
        v-if="discoveryFeedback"
        class="agent-detail-modal__feedback"
        :data-tone="discoveryFeedback.tone"
      >
        {{ discoveryFeedback.message }}
      </p>

      <p v-if="loading" class="agent-detail-modal__loading">{{ t('common.loading') }}</p>

      <GcDevicePresentation
        v-if="detail && pluginPresentation && !loading"
        v-model:active-tab="activeTab"
        :schema="pluginPresentation"
        :data="detail"
        :tab-rows="pluginTabRows"
        :plugin-messages="pluginMessages"
        @action="executePluginAction"
      />

      <template v-else-if="detail && context && !loading">
        <nav class="agent-detail-modal__tabs" :aria-label="t('devices.unifiedDetail.aria.tabs')">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="agent-detail-modal__tab"
            type="button"
            :data-active="activeTab === tab.key"
            @click="activeTab = tab.key"
          >
            {{ t(tab.labelKey) }}
          </button>
        </nav>
        <component
          v-if="activeDescriptor"
          :is="activeDescriptor.component"
          v-bind="activeDescriptor.buildProps?.(context)"
          @certificate-click="openCertificateDetail"
        />
      </template>
    </section>
  </GcModal>

  <GcModal
    v-model:open="certificateModalOpen"
    :title="t('devices.unifiedDetail.certificateDetail.title')"
    :description="t('devices.unifiedDetail.certificateDetail.description')"
    size="lg"
    width="58vw"
  >
    <section v-if="selectedCertificate" class="agent-certificate-modal">
      <header class="agent-certificate-modal__hero">
        <div>
          <p>{{ t('devices.unifiedDetail.certificateDetail.eyebrow') }}</p>
          <h3>{{ selectedCertificateTitle }}</h3>
          <span>{{ selectedCertificateSource }}</span>
        </div>
        <GcStatusTag v-if="selectedCertificate.certificate.status" :status="selectedCertificate.certificate.status" />
      </header>
      <dl class="agent-certificate-modal__grid">
        <div><dt>{{ t('devices.unifiedDetail.fields.subject') }}</dt><dd>{{ selectedCertificate.certificate.subject || t('devices.unifiedDetail.values.empty') }}</dd></div>
        <div><dt>{{ t('devices.unifiedDetail.fields.issuer') }}</dt><dd>{{ selectedCertificate.certificate.issuer || t('devices.unifiedDetail.values.empty') }}</dd></div>
        <div><dt>{{ t('devices.unifiedDetail.fields.notBefore') }}</dt><dd>{{ selectedCertificate.certificate.notBefore ? formatBrowserLocalTime(selectedCertificate.certificate.notBefore) : t('devices.unifiedDetail.values.empty') }}</dd></div>
        <div><dt>{{ t('devices.unifiedDetail.fields.notAfter') }}</dt><dd>{{ selectedCertificate.certificate.notAfter ? formatBrowserLocalTime(selectedCertificate.certificate.notAfter) : t('devices.unifiedDetail.values.empty') }}</dd></div>
        <div v-if="selectedCertificate.certificate.fingerprintSha256" class="agent-certificate-modal__fingerprint">
          <dt>{{ t('devices.unifiedDetail.certificateDetail.fingerprint') }}</dt>
          <dd>{{ selectedCertificate.certificate.fingerprintSha256 }}</dd>
        </div>
      </dl>
      <p v-if="certificateAssetError" class="agent-certificate-modal__state agent-certificate-modal__state--error">{{ certificateAssetError }}</p>
      <p v-else class="agent-certificate-modal__state">
        {{ t('devices.unifiedDetail.certificateDetail.notManaged') }}
      </p>
    </section>
    <template #actions>
      <button class="gc-button" type="button" @click="closeCertificateModal">
        {{ t('devices.unifiedDetail.certificateDetail.close') }}
      </button>
    </template>
  </GcModal>

  <GcModal
    v-model:open="certificateAssetDetailOpen"
    :title="t('devices.unifiedDetail.certificateDetail.managedTitle')"
    :description="t('devices.unifiedDetail.certificateDetail.managedDescription')"
    size="xxl"
  >
    <CertificateDetailPanel
      v-if="selectedCertificateAssetRoute"
      :asset-id="selectedCertificateAssetRoute.assetId"
      :version-id="selectedCertificateAssetRoute.versionId"
      :context-usages="certificateContextUsages"
    />
    <template #actions>
      <button class="gc-button" type="button" @click="closeCertificateAssetDetail">
        {{ t('devices.unifiedDetail.certificateDetail.close') }}
      </button>
    </template>
  </GcModal>
</template>

<style scoped>
.agent-detail-modal { display: grid; gap: var(--gc-space-2); }
.agent-detail-modal__error,
.agent-detail-modal__loading { margin: 0; padding: var(--gc-space-4); color: var(--gc-color-text-muted); text-align: center; }
.agent-detail-modal__error { color: var(--gc-color-danger); }
.agent-detail-modal__hero { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-md); background: radial-gradient(circle at top right, var(--gc-color-primary-soft), transparent 26%), linear-gradient(140deg, var(--gc-color-surface-hover) 0%, var(--gc-color-surface-solid) 54%, var(--gc-color-surface-subtle) 100%); }
.agent-detail-modal__hero-copy { display: grid; min-width: 0; gap: var(--gc-space-1); }
.agent-detail-modal__eyebrow { margin: 0; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 800; text-transform: uppercase; }
.agent-detail-modal__hero-copy h2 { margin: 0; color: var(--gc-color-text); font-size: var(--gc-font-size-lg); line-height: 1.06; overflow-wrap: anywhere; }
.agent-detail-modal__hero-copy span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 700; overflow-wrap: anywhere; }
.agent-detail-modal__hero-side { display: flex; align-items: center; justify-content: flex-end; min-width: 0; gap: var(--gc-space-2); }
.agent-detail-modal__discover { flex: 0 0 auto; }
.agent-detail-modal__feedback { margin: 0; padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-info-soft); color: var(--gc-color-text); font-size: var(--gc-font-size-xs); font-weight: 700; }
.agent-detail-modal__feedback[data-tone='success'] { border-color: var(--gc-color-success-border); background: var(--gc-color-success-soft); color: var(--gc-color-success); }
.agent-detail-modal__feedback[data-tone='warning'] { border-color: var(--gc-color-warning-border); background: var(--gc-color-warning-soft); color: var(--gc-color-warning); }
.agent-detail-modal__feedback[data-tone='danger'] { border-color: var(--gc-color-danger-border); background: var(--gc-color-danger-soft); color: var(--gc-color-danger); }
.agent-detail-modal__spotlight { display: grid; min-width: calc(var(--gc-space-10) * 3); gap: var(--gc-space-1); padding: var(--gc-space-1) var(--gc-space-2); border-radius: var(--gc-radius-sm); background: var(--gc-color-text); color: var(--gc-color-surface-solid); }
.agent-detail-modal__spotlight small { color: var(--gc-color-text-inverse-muted); font-size: var(--gc-font-size-xs); font-weight: 800; text-transform: uppercase; }
.agent-detail-modal__spotlight strong { font-size: var(--gc-font-size-sm); line-height: 1.15; overflow-wrap: anywhere; }
.agent-detail-modal__tabs { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.agent-detail-modal__tab { border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-xl); padding: var(--gc-space-1) var(--gc-space-2); background: var(--gc-color-surface-solid); color: var(--gc-color-text-muted); font: inherit; font-size: var(--gc-font-size-xs); font-weight: 800; cursor: pointer; }
.agent-detail-modal__tab[data-active='true'] { border-color: var(--gc-color-focus); box-shadow: var(--gc-shadow-focus); background: linear-gradient(135deg, var(--gc-color-surface-selected), var(--gc-color-surface-solid)); color: var(--gc-color-text); }
.agent-certificate-modal { display: grid; gap: var(--gc-space-2); }
.agent-certificate-modal__hero { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--gc-space-3); padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-md); background: linear-gradient(140deg, var(--gc-color-surface-hover), var(--gc-color-surface-solid)); }
.agent-certificate-modal__hero p,
.agent-certificate-modal__hero h3,
.agent-certificate-modal__hero span { margin: 0; }
.agent-certificate-modal__hero p { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 800; text-transform: uppercase; }
.agent-certificate-modal__hero h3 { color: var(--gc-color-text); font-size: var(--gc-font-size-md); overflow-wrap: anywhere; }
.agent-certificate-modal__hero span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.agent-certificate-modal__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--gc-space-2); margin: 0; }
.agent-certificate-modal__grid div { min-width: 0; padding: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface-hover); }
.agent-certificate-modal__grid dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 800; }
.agent-certificate-modal__grid dd { margin: 0; color: var(--gc-color-text); font-size: var(--gc-font-size-xs); font-weight: 700; overflow-wrap: anywhere; }
.agent-certificate-modal__fingerprint { grid-column: 1 / -1; }
.agent-certificate-modal__state { margin: 0; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.agent-certificate-modal__state--error { color: var(--gc-color-danger); }
@media (max-width: 68.75rem) { .agent-detail-modal__hero { display: grid; grid-template-columns: 1fr; } .agent-detail-modal__hero-side { justify-content: flex-start; } .agent-certificate-modal__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 47.5rem) { .agent-detail-modal__hero { padding: var(--gc-space-2); } .agent-certificate-modal__grid { grid-template-columns: 1fr; } }
</style>

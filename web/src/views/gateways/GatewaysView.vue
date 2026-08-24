<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import {
  createAgentInstallMaterials,
} from '@/api/modules/assets.api'
import { listGateways, probeGateway } from '@/api/modules/gateways.api'
import { readNumber, readPath, readString, type ViewRow } from '@/composables/useBusinessPage'
import type { ApiRecord } from '@/api/modules/common'
import { GcModal, GcStatusTag } from '@/design-system/components'
import { formatBrowserLocalTime, formatMaybeLocalTimeByCandidates } from '@/utils/browser-local-time'

type GatewayPlatform = 'linux_go' | 'windows_go'

const gatewayPlatformProfiles: Record<GatewayPlatform, {
  labelKey: 'devices.platforms.linux' | 'devices.platforms.windows'
}> = {
  linux_go: {
    labelKey: 'devices.platforms.linux',
  },
  windows_go: {
    labelKey: 'devices.platforms.windows',
  },
}

interface InstallMaterialSession {
  platform: GatewayPlatform
  zone: string
  enrollmentToken: string
  expiresAt?: string
  materials: unknown[]
  task: unknown
}

const pageRef = ref<InstanceType<typeof BusinessResourcePage> | null>(null)
const selectedGateway = ref<ViewRow | null>(null)
const detailModalOpen = ref(false)
const installModalOpen = ref(false)
const installPending = ref(false)
const installError = ref('')
const selectedInstallPlatform = ref<GatewayPlatform>('linux_go')
const installZone = ref('default')
const installSession = ref<InstallMaterialSession | null>(null)
const { t } = useI18n()

const platformOptions = computed<Array<{ value: GatewayPlatform; label: string; description: string }>>(() => [
  { value: 'linux_go', label: t(gatewayPlatformProfiles.linux_go.labelKey), description: t('gateways.platforms.linuxSystemd.description') },
  { value: 'windows_go', label: t(gatewayPlatformProfiles.windows_go.labelKey), description: t('gateways.platforms.windowsService.description') },
])

const gatewayRaw = computed<ApiRecord | null>(() => selectedGateway.value?.raw ?? null)
const routeChannels = computed(() => normalizeList(gatewayRaw.value, ['routeChannels', 'channels', 'adapters', 'protocols', 'supportedProtocols']))
const capabilities = computed(() => normalizeList(gatewayRaw.value, ['capabilities', 'capabilityKeys']))
const gatewayStats = computed(() => ({
  currentLoad: readNumber(gatewayRaw.value ?? {}, ['currentLoad', 'load', 'activeTasks']) ?? 0,
  maxConcurrentTasks: readNumber(gatewayRaw.value ?? {}, ['maxConcurrentTasks']) ?? 0,
  successRate: formatSuccessRate(readPath(gatewayRaw.value ?? {}, 'successRate') ?? readPath(gatewayRaw.value ?? {}, 'statistics.successRate')),
  lastHeartbeatAt: formatMaybeLocalTimeByCandidates(readString(gatewayRaw.value ?? {}, ['lastHeartbeatAt', 'lastSeenAt', 'heartbeatAt', 'updatedAt']), ['lastHeartbeatAt'])
}))
const gatewayRegion = computed(() => firstDisplayValue(gatewayRaw.value, ['zoneName', 'zoneId', 'zoneIds', 'networkZone']) || t('gateways.values.defaultRegion'))
const gatewayStatus = computed(() => readString(gatewayRaw.value ?? {}, ['status', 'state', 'onlineStatus']) || String(selectedGateway.value?.status ?? ''))
const gatewayDisplayName = computed(() => {
  const name = String(selectedGateway.value?.name ?? '').trim()
  if (name && !isTechnicalId(name)) return name
  return t('gateways.values.regionGatewayName', { region: gatewayRegion.value })
})
const gatewayOverview = computed(() => {
  const currentLoad = gatewayStats.value.currentLoad
  const maxConcurrentTasks = gatewayStats.value.maxConcurrentTasks
  return [
    { label: t('gateways.detail.overview.connectionStatus'), value: formatGatewayStatus(gatewayStatus.value), tone: statusTone(gatewayStatus.value) },
    { label: t('gateways.detail.overview.serviceRegion'), value: gatewayRegion.value },
    { label: t('gateways.detail.overview.processing'), value: t('gateways.values.taskCount', { count: currentLoad }) },
    { label: t('gateways.detail.overview.availableCapacity'), value: formatCapacity(currentLoad, maxConcurrentTasks) },
    { label: t('gateways.detail.overview.successRate'), value: gatewayStats.value.successRate },
    { label: t('gateways.detail.overview.lastContact'), value: gatewayStats.value.lastHeartbeatAt || '-' },
  ]
})
const gatewayAbilities = computed(() => {
  const values = new Set([...routeChannels.value, ...capabilities.value].map((item) => item.trim().toLowerCase()))
  const abilities: Array<{ key: string; title: string; description: string }> = []
  if (hasAny(values, ['probe.tcp', 'probe.http', 'probe.agent', 'gateway.probe.tcp', 'gateway.probe.http', 'gateway.probe.agent'])) {
    abilities.push({ key: 'probe', title: t('gateways.detail.abilities.probe.title'), description: t('gateways.detail.abilities.probe.description') })
  }
  if (hasAny(values, ['forward.agent_task', 'gateway.forward.agent_task'])) {
    abilities.push({ key: 'agent-task', title: t('gateways.detail.abilities.agentTask.title'), description: t('gateways.detail.abilities.agentTask.description') })
  }
  if (hasAny(values, ['forward.direct_control', 'gateway.forward.direct_control'])) {
    abilities.push({ key: 'direct-control', title: t('gateways.detail.abilities.directControl.title'), description: t('gateways.detail.abilities.directControl.description') })
  }
  return abilities
})

function openGatewayInstallModal() {
  installModalOpen.value = true
  installError.value = ''
  installSession.value = null
}

async function requestGatewayInstallMaterials() {
  installPending.value = true
  installError.value = ''
  try {
    const result = await createAgentInstallMaterials({
      platform: selectedInstallPlatform.value,
      zone: installZone.value || 'default',
      role: 'gateway',
    })
    const data = result.data ?? {}
    const materials = Array.isArray(data.materials) ? data.materials : []
    if (!materials.length || !isRecord(materials[0]) || !isRecord(data.task)) {
      throw new Error(t('api.errors.requestFailed'))
    }
    installSession.value = {
      platform: selectedInstallPlatform.value,
      zone: readString(data, ['zone']) || installZone.value || 'default',
      enrollmentToken: readString(data, ['enrollmentToken']) || '',
      expiresAt: readString(data, ['expiresAt']),
      materials,
      task: data.task,
    }
  } catch (cause) {
    installError.value = cause instanceof Error ? cause.message : t('api.errors.requestFailed')
  } finally {
    installPending.value = false
  }
}

function handleGatewaySelection(row: ViewRow | null) {
  selectedGateway.value = row
}

async function openDetailModal(row: ViewRow) {
  selectedGateway.value = row
  detailModalOpen.value = true
}

async function runProbe(row: ViewRow) {
  await probeGateway(buildGatewayProbePayload(row))
}

function buildGatewayProbePayload(row: ViewRow | undefined) {
  const raw = row?.raw ?? {}
  const targets = normalizeList(raw, ['reachableTargets', 'targets', 'targetCidrs', 'targetZones'])
  const channels = normalizeList(raw, ['routeChannels', 'channels', 'adapters', 'protocols', 'supportedProtocols'])
  const protocol = channels.find((item) => item.startsWith('probe.')) ?? 'probe.tcp'
  return {
    gatewayId: row?.id ?? '',
    targetId: targets[0] ?? row?.id ?? '',
    protocol,
    port: defaultPort(protocol)
  }
}

function defaultPort(protocol: string): number {
  const normalized = protocol.toLowerCase()
  if (normalized.includes('http') || normalized.includes('curl') || normalized.includes('agent')) return 443
  return 22
}

function firstDisplayValue(record: ApiRecord | null, paths: readonly string[]): string {
  if (!record) return ''
  for (const path of paths) {
    const value = readPath(record, path)
    if (value !== undefined && value !== null && value !== '') return renderValue(value)
  }
  return ''
}

function normalizeList(record: ApiRecord | null, paths: readonly string[]): string[] {
  if (!record) return []
  for (const path of paths) {
    const value = readPath(record, path)
    if (Array.isArray(value)) return value.map(renderValue).filter((item) => item && item !== '-')
    if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function formatSuccessRate(value: unknown): string {
  if (typeof value === 'number') return value <= 1 ? `${Math.round(value * 100)}%` : `${Math.round(value)}%`
  if (typeof value === 'string' && value.trim()) return value
  return '-'
}

function formatCapacity(currentLoad: number, maxConcurrentTasks: number): string {
  if (!maxConcurrentTasks) return '-'
  const available = Math.max(0, maxConcurrentTasks - currentLoad)
  return t('gateways.values.availableCapacity', { count: available })
}

function formatGatewayStatus(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'online') return t('gateways.status.online')
  if (normalized === 'offline') return t('gateways.status.offline')
  if (normalized === 'disabled') return t('gateways.status.disabled')
  if (normalized === 'revoked') return t('gateways.status.revoked')
  if (normalized === 'upgrading') return t('gateways.status.upgrading')
  return value || '-'
}

function statusTone(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'online') return 'good'
  if (normalized === 'offline' || normalized === 'disabled' || normalized === 'revoked') return 'bad'
  return 'warn'
}

function hasAny(values: Set<string>, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => values.has(candidate))
}

function isTechnicalId(value: string): boolean {
  return /^(agt|gw|gateway|agent)_[a-z0-9_:-]+$/iu.test(value.trim())
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  if (Array.isArray(value)) return value.map(renderValue).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function isRecord(value: unknown): value is ApiRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function linkTarget(link: NonNullable<BusinessPageConfig['contextLinks']>[number]) {
  const row = selectedGateway.value
  if (!row) return null
  const value = link.candidates
    .map((candidate) => readPath(row.raw, candidate))
    .find((item) => item !== undefined && item !== null && item !== '')
  if (value === undefined || value === null || value === '') return null
  return { path: link.to, query: { [link.queryKey]: String(value) } }
}

function platformLabel(platform: GatewayPlatform): string {
  return t(gatewayPlatformProfiles[platform].labelKey)
}

const config = computed<BusinessPageConfig>(() => ({
  title: t('gateways.page.title'),
  description: t('gateways.page.description'),
  showHeader: false,
  showMetrics: false,
  showDetailPanel: false,
  showActionPanel: false,
  readPermission: 'gateway.read',
  primaryPermission: 'gateway.write',
  primaryActionLabel: t('gateways.actions.addGatewayAgent'),
  primaryAction: openGatewayInstallModal,
  moduleName: 'gateways',
  resourceName: t('gateways.resourceName'),
  defaultStatus: 'ONLINE',
  defaultRisk: 'MEDIUM',
  columns: [
    { key: 'name', title: t('gateways.columns.gateway'), candidates: ['name', 'gatewayName', 'id'] },
    { key: 'agentId', title: 'Agent', candidates: ['agentId'] },
    { key: 'zone', title: t('gateways.columns.region'), candidates: ['zoneName', 'zoneId', 'zoneIds', 'networkZone'] },
    { key: 'status', title: t('gateways.columns.status'), candidates: ['status', 'state', 'onlineStatus'] },
    { key: 'load', title: t('gateways.columns.load'), candidates: ['currentLoad', 'load', 'activeTasks'] },
    { key: 'updatedAt', title: t('gateways.columns.lastHeartbeat'), candidates: ['lastHeartbeatAt', 'lastSeenAt', 'heartbeatAt', 'updatedAt'] },
    { key: 'actions', title: t('gateways.columns.actions'), candidates: [] },
  ],
  metrics: [],
  detailFields: [],
  contextLinks: [
    { label: t('gateways.links.assets'), to: '/assets', queryKey: 'gatewayId', candidates: ['id', 'gatewayId'] },
    { label: t('gateways.links.executions'), to: '/executions', queryKey: 'gatewayId', candidates: ['id', 'gatewayId'] },
  ],
  emptyTitle: t('gateways.empty.title'),
  emptyDescription: t('gateways.empty.description'),
  load: () => listGateways({ page: 1, pageSize: 20, sort: 'updatedAt:desc' }),
  actions: [],
  rowActions: [
    {
      label: t('gateways.actions.detail'),
      permission: 'gateway.read',
      reloadAfterRun: false,
      run: openDetailModal,
    },
    {
      label: t('gateways.actions.probe'),
      permission: 'gateway.write',
      danger: true,
      confirmText: 'PROBE',
      riskText: t('gateways.actions.probeRisk'),
      run: runProbe,
    },
  ],
  onSelectionChange: handleGatewaySelection,
}))
</script>

<template>
  <section class="gc-page gateway-page">
    <BusinessResourcePage ref="pageRef" :config="config" />

    <GcModal v-model:open="installModalOpen" :title="t('gateways.modals.install.title')" size="lg" :close-on-backdrop="false">
      <section class="gateway-material-modal">
        <div class="gateway-command-modal__field">
          <p class="gateway-command-modal__label">{{ t('gateways.fields.platform') }}</p>
          <div class="gateway-command-modal__platforms">
            <button
              v-for="option in platformOptions"
              :key="option.value"
              class="gateway-command-modal__platform"
              :data-active="selectedInstallPlatform === option.value"
              type="button"
              @click="selectedInstallPlatform = option.value"
            >
              <strong>{{ option.label }}</strong>
              <span>{{ option.description }}</span>
            </button>
          </div>
        </div>

        <label class="gateway-command-modal__field">
          <span class="gateway-command-modal__label">{{ t('gateways.fields.region') }}</span>
          <input v-model.trim="installZone" type="text" placeholder="default">
        </label>

        <button class="gc-button gateway-command-modal__primary" type="button" :disabled="installPending" @click="requestGatewayInstallMaterials">
          {{ installPending ? t('gateways.actions.generating') : t('gateways.modals.install.title') }}
        </button>
        <p v-if="installError" class="gateway-command-modal__error">{{ installError }}</p>

        <div v-if="installSession" class="gateway-material-modal__result">
          <dl class="gateway-command-modal__meta">
            <div><dt>{{ t('gateways.fields.platform') }}</dt><dd>{{ platformLabel(installSession.platform) }}</dd></div>
            <div><dt>{{ t('gateways.fields.region') }}</dt><dd>{{ installSession.zone }}</dd></div>
            <div><dt>{{ t('gateways.fields.expiresAt') }}</dt><dd>{{ formatBrowserLocalTime(installSession.expiresAt) || '-' }}</dd></div>
          </dl>
          <pre class="gateway-material-modal__payload">{{ JSON.stringify({ enrollmentToken: installSession.enrollmentToken, materials: installSession.materials, task: installSession.task }, null, 2) }}</pre>
        </div>
      </section>

      <template #actions>
        <button class="gc-button" type="button" @click="installModalOpen = false">{{ t('gateways.actions.close') }}</button>
      </template>
    </GcModal>

    <GcModal v-model:open="detailModalOpen" :title="t('gateways.modals.detail.title')" size="xl">
      <section v-if="selectedGateway" class="gateway-detail-modal">
        <header class="gateway-detail-modal__hero">
          <div>
            <p>{{ t('gateways.detail.eyebrow') }}</p>
            <h2>{{ gatewayDisplayName }}</h2>
            <span>{{ t('gateways.detail.heroDescription', { region: gatewayRegion }) }}</span>
          </div>
          <div class="gateway-detail-modal__hero-side">
            <GcStatusTag :status="String(selectedGateway.status)" />
          </div>
        </header>

        <section class="gateway-detail-modal__sections">
          <article class="gateway-detail-modal__section">
            <div class="gateway-detail-modal__section-head">
              <h3>{{ t('gateways.detail.sections.overview') }}</h3>
            </div>
            <dl class="gateway-detail-modal__summary">
              <div
                v-for="item in gatewayOverview"
                :key="item.label"
                class="gateway-detail-modal__summary-item"
                :data-tone="item.tone || 'neutral'"
              >
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </div>
            </dl>
          </article>

          <article class="gateway-detail-modal__section">
            <div class="gateway-detail-modal__section-head">
              <h3>{{ t('gateways.detail.sections.services') }}</h3>
            </div>
            <ul v-if="gatewayAbilities.length" class="gateway-detail-modal__abilities">
              <li v-for="ability in gatewayAbilities" :key="ability.key">
                <strong>{{ ability.title }}</strong>
                <span>{{ ability.description }}</span>
              </li>
            </ul>
            <p v-else class="gateway-detail-modal__empty">-</p>
          </article>

          <nav class="gateway-detail-modal__links">
            <template v-for="link in config.contextLinks" :key="link.label">
              <RouterLink v-if="linkTarget(link)" class="gc-button" :to="linkTarget(link)!">{{ link.label }}</RouterLink>
            </template>
          </nav>
        </section>
      </section>
    </GcModal>
  </section>
</template>

<style scoped>
.gateway-page { display: grid; gap: var(--gc-space-5); }
.gateway-command-modal,
.gateway-detail-modal { display: grid; gap: var(--gc-space-4); }
.gateway-command-modal__field { display: grid; gap: var(--gc-space-2); }
.gateway-command-modal__label { margin: 0; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 850; }
.gateway-command-modal__platforms { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.gateway-command-modal__platform {
  display: grid;
  min-height: var(--gc-control-height-lg);
  gap: var(--gc-space-2);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  padding: var(--gc-space-3);
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-text);
  text-align: left;
  cursor: pointer;
}
.gateway-command-modal__platform:hover,
.gateway-command-modal__platform:focus-visible { border-color: var(--gc-color-primary-border-strong); background: var(--gc-color-surface-hover); outline: none; box-shadow: var(--gc-shadow-focus); }
.gateway-command-modal__platform[data-active='true'] { border-color: var(--gc-color-primary); background: var(--gc-color-primary-soft); }
.gateway-command-modal__platform strong,
.gateway-command-modal__platform span { display: block; }
.gateway-command-modal__platform span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); line-height: var(--gc-line-height-relaxed); }
.gateway-command-modal input,
.gateway-command-modal select,
.gateway-command-modal textarea {
  width: 100%;
  min-height: var(--gc-control-height-md);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  padding: var(--gc-space-2) var(--gc-space-3);
  background: var(--gc-color-surface-field);
  color: var(--gc-color-text);
  font: inherit;
}
.gateway-command-modal textarea { min-height: calc(var(--gc-space-12) * 2); resize: vertical; font-family: var(--gc-font-family-mono); }
.gateway-command-modal input:focus,
.gateway-command-modal select:focus,
.gateway-command-modal textarea:focus { border-color: var(--gc-color-focus); outline: none; box-shadow: var(--gc-shadow-focus); background: var(--gc-color-surface-field-focus); }
.gateway-command-modal__primary { justify-self: start; box-shadow: var(--gc-shadow-button-primary); }
.gateway-command-modal__error { margin: 0; border: var(--gc-border-width-default) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-md); padding: var(--gc-space-3); color: var(--gc-color-danger); background: var(--gc-color-danger-bg); font-weight: 800; }
.gateway-command-modal__result { display: grid; gap: var(--gc-space-3); }
.gateway-command-modal__meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); margin: 0; }
.gateway-command-modal__meta > div { border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-control); padding: var(--gc-space-3); background: var(--gc-color-surface-raised); }
.gateway-command-modal__meta dt { margin-bottom: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 850; }
.gateway-command-modal__meta dd { margin: 0; overflow-wrap: anywhere; color: var(--gc-color-text); font-weight: 800; }
.gateway-detail-modal__hero { display: flex; justify-content: space-between; gap: var(--gc-space-3); align-items: center; border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-md); padding: var(--gc-space-4); background: var(--gc-gradient-hero); }
.gateway-detail-modal__hero p,
.gateway-detail-modal__hero h2 { margin: 0; }
.gateway-detail-modal__hero p { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 850; }
.gateway-detail-modal__hero h2 { margin-top: var(--gc-space-1); color: var(--gc-color-text-strong); font-size: var(--gc-font-size-lg); line-height: var(--gc-line-height-tight); }
.gateway-detail-modal__hero span { display: block; margin-top: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 700; }
.gateway-detail-modal__hero-side,
.gateway-detail-modal__links { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.gateway-detail-modal__hero-side { justify-content: flex-end; }
.gateway-detail-modal__sections { display: grid; gap: var(--gc-space-3); }
.gateway-detail-modal__section { display: grid; gap: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); padding: var(--gc-space-4); background: var(--gc-gradient-surface); }
.gateway-detail-modal__section-head h3 { margin: 0; color: var(--gc-color-text-strong); font-size: var(--gc-font-size-md); }
.gateway-detail-modal__summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-2); margin: 0; }
.gateway-detail-modal__summary-item { min-height: calc(var(--gc-space-10) * 2); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-control); padding: var(--gc-space-2) var(--gc-space-3); background: var(--gc-color-surface-solid); }
.gateway-detail-modal__summary-item[data-tone='good'] { border-color: var(--gc-color-success-border); background: var(--gc-color-success-soft); }
.gateway-detail-modal__summary-item[data-tone='warn'] { border-color: var(--gc-color-warning-border); background: var(--gc-color-warning-soft); }
.gateway-detail-modal__summary-item[data-tone='bad'] { border-color: var(--gc-color-danger-border); background: var(--gc-color-danger-soft); }
.gateway-detail-modal__summary-item dt { margin-bottom: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 850; }
.gateway-detail-modal__summary-item dd { margin: 0; overflow-wrap: anywhere; color: var(--gc-color-text); font-size: var(--gc-font-size-md); font-weight: 850; }
.gateway-detail-modal__abilities { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.gateway-detail-modal__abilities li { min-height: calc(var(--gc-space-10) * 2); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-control); padding: var(--gc-space-2) var(--gc-space-3); background: var(--gc-color-surface-soft); color: var(--gc-color-text); }
.gateway-detail-modal__abilities strong,
.gateway-detail-modal__abilities span { display: block; }
.gateway-detail-modal__abilities strong { margin-bottom: var(--gc-space-1); font-size: var(--gc-font-size-sm); font-weight: 800; }
.gateway-detail-modal__abilities span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); line-height: var(--gc-line-height-relaxed); font-weight: 700; }
.gateway-detail-modal__empty { margin: 0; color: var(--gc-color-text-muted); font-weight: 750; }
@media (max-width: 56.25rem) {
  .gateway-command-modal__platforms,
  .gateway-command-modal__meta,
  .gateway-detail-modal__summary,
  .gateway-detail-modal__abilities { grid-template-columns: 1fr; }
  .gateway-detail-modal__hero { display: grid; }
}
</style>

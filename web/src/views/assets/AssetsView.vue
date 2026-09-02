<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { checkAgentUpgrade, dispatchAgentUpgrade, executeAssetAction, listAssets, type UnifiedAssetRef } from '@/api/modules/assets.api'
import { GcButton, GcModal, GcStatusTag } from '@/design-system/components'
import DeviceOnboardingWizard from '@/views/devices/DeviceOnboardingWizard.vue'
import UnifiedAssetDetailModal from './UnifiedAssetDetailModal.vue'
import UnifiedAssetEditModal from './UnifiedAssetEditModal.vue'
import { readString, type ViewRow } from '@/composables/useBusinessPage'

const PRODUCT_FAMILY_LABEL_KEYS: Readonly<Record<string, string>> = {
  'agent_host': 'devices.products.agentHost',
  'windows_compatibility': 'devices.products.windowsCompatibility',
  'device.chaitin-safeline-waf': 'devices.products.chaitinSafelineWaf',
  'device.f5.bigip': 'devices.products.f5BigIp',
  'device.synology-dsm': 'devices.products.synologyDsm',
  'device.nginx-proxy-manager': 'devices.products.nginxProxyManager',
  'citrix.netscaler-adc': 'devices.products.citrixAdc',
  'device.citrix.netscaler-adc': 'devices.products.citrixAdc',
  'cloud.aliyun': 'devices.products.aliyunCdn',
  'cloud.aliyun.cdn': 'devices.products.aliyunCdn',
}

const { t } = useI18n()
const route = useRoute?.() ?? { query: {} as Record<string, string | string[] | undefined> }
const filters = ref<Record<string, string>>({
  category: readQueryString('category'),
  managementMethod: readQueryString('managementMethod'),
  health: readQueryString('health'),
})
const onboardingOpen = ref(false)
const reloadKey = ref(0)
const assetDetailModal = ref<{ open: (assetRef: UnifiedAssetRef) => Promise<void> } | null>(null)
const assetEditModal = ref<{ open: (assetRef: UnifiedAssetRef) => void } | null>(null)
const upgradingAgentId = ref('')
const upgradeConfirmationOpen = ref(false)
const upgradeConfirmationBusy = ref(false)
const upgradeConfirmationError = ref('')
const upgradeConfirmation = ref<{
  agentId: string
  planId: string
  currentVersion: string
  targetVersion: string
  displayName: string
} | null>(null)

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readQueryString(key: string): string {
  const value = route.query[key]
  return typeof value === 'string' ? value : ''
}

async function loadUnifiedAssets(query: { page: number; pageSize: number }) {
  return listAssets({ page: query.page, pageSize: query.pageSize, sort: 'displayName:asc', filters: filters.value })
}

function includesAction(row: ViewRow, action: string): boolean {
  return Array.isArray(row.raw.availableActions) && (row.raw.availableActions as unknown[]).includes(action)
}

function assetRefOf(row: ViewRow): UnifiedAssetRef {
  const ref = asRecord(row.raw.assetRef)
  const rootType = ref.rootType
  const id = String(ref.id ?? row.id).trim()
  if ((rootType !== 'DEVICE' && rootType !== 'SERVICE_ASSET') || !id) {
    throw new Error(t('assets.inventory.errors.deleteTargetMissing'))
  }
  return { rootType, id }
}

async function openDetail(row: ViewRow) {
  await assetDetailModal.value?.open(assetRefOf(row))
}

function openEdit(row: ViewRow): void {
  assetEditModal.value?.open(assetRefOf(row))
}

onMounted(() => {
  const deviceId = typeof route.query.deviceId === 'string' ? route.query.deviceId : ''
  if (route.query.detailModal === '1' && deviceId) {
    void assetDetailModal.value?.open({ rootType: 'DEVICE', id: deviceId })
  }
})

async function deleteAsset(row: ViewRow) {
  await executeAssetAction(assetRefOf(row), 'DELETE')
}

async function upgradeAgent(row: ViewRow) {
  if (upgradingAgentId.value || upgradeConfirmationOpen.value) return
  const agentId = String(row.raw.agentId ?? '').trim()
  if (!agentId) throw new Error(t('devices.errors.upgradeTargetMissing'))
  upgradingAgentId.value = agentId
  try {
    const planResponse = await checkAgentUpgrade(agentId)
    const plan = asRecord(planResponse.data)
    if (String(plan.status ?? '').toLowerCase() === 'not_required') {
      throw new Error(t('devices.errors.upgradeNotRequired'))
    }
    const planId = String(plan.id ?? '').trim()
    if (!planId) throw new Error(t('devices.errors.upgradePlanMissing'))
    const currentVersion = String(plan.currentVersion ?? row.controlVersion ?? row.raw.controlVersion ?? t('devices.upgrade.values.unknownVersion'))
    const targetVersion = String(plan.targetVersion ?? '').trim()
    if (!targetVersion) throw new Error(t('devices.errors.upgradeTargetVersionMissing'))
    upgradeConfirmationError.value = ''
    upgradeConfirmation.value = {
      agentId,
      planId,
      currentVersion,
      targetVersion,
      displayName: String(row.raw.displayName ?? row.raw.name ?? row.id),
    }
    upgradeConfirmationOpen.value = true
  } finally {
    upgradingAgentId.value = ''
  }
}

async function confirmAgentUpgrade(): Promise<void> {
  const confirmation = upgradeConfirmation.value
  if (!confirmation || upgradeConfirmationBusy.value) return
  upgradeConfirmationBusy.value = true
  upgradeConfirmationError.value = ''
  try {
    await dispatchAgentUpgrade(confirmation.agentId, confirmation.planId)
    upgradeConfirmationOpen.value = false
    upgradeConfirmation.value = null
    reloadKey.value += 1
  } catch (error) {
    upgradeConfirmationError.value = error instanceof Error ? error.message : t('devices.errors.upgradeDispatchFailed')
  } finally {
    upgradeConfirmationBusy.value = false
  }
}

function closeUpgradeConfirmation(): void {
  if (upgradeConfirmationBusy.value) return
  upgradeConfirmationOpen.value = false
  upgradeConfirmation.value = null
  upgradeConfirmationError.value = ''
}

const config = computed<BusinessPageConfig>(() => ({
  title: t('assets.inventory.title'),
  description: t('assets.inventory.description'),
  readPermission: 'service_asset.read',
  readPermissions: ['host.read', 'service_asset.read', 'application.read'],
  primaryPermission: 'host.create',
  primaryActionLabel: t('assets.inventory.actions.add'),
  primaryAction: () => { onboardingOpen.value = true },
  moduleName: 'assets',
  resourceName: t('assets.inventory.title'),
  resourceListLabel: t('assets.inventory.list'),
  defaultStatus: 'UNKNOWN',
  defaultRisk: 'MEDIUM',
  showHeader: false,
  showMetrics: false,
  showDetailPanel: false,
  showActionPanel: false,
  tableFixed: true,
  clientSidePagination: false,
  showTotalInPagination: true,
  columns: [
    { key: 'name', title: t('assets.inventory.columns.name'), candidates: ['displayName', 'id'], width: '12%' },
    {
      key: 'category',
      title: t('assets.inventory.columns.category'),
      candidates: ['category'],
      format: (record) => {
        const category = String(record.category ?? '').toUpperCase()
        const categoryKeys: Readonly<Record<string, string>> = {
          SERVER: 'assets.inventory.categories.server',
          NETWORK_APPLIANCE: 'assets.inventory.categories.networkAppliance',
          SECURITY_APPLIANCE: 'assets.inventory.categories.securityAppliance',
          CLOUD: 'assets.inventory.categories.cloud',
          APPLIANCE: 'assets.inventory.categories.appliance',
        }
        const labelKey = categoryKeys[category]
        return labelKey ? t(labelKey) : readString(record, ['category'])
      },
      width: '8%',
    },
    {
      key: 'productFamily',
      title: t('assets.inventory.columns.productFamily'),
      candidates: ['productFamily'],
      format: (record) => {
        const productFamily = readString(record, ['productFamily'])
        const labelKey = PRODUCT_FAMILY_LABEL_KEYS[productFamily.trim().toLowerCase()]
        return labelKey ? t(labelKey) : productFamily
      },
      width: '11%',
    },
    {
      key: 'managementMethod',
      title: t('assets.inventory.columns.managementMethod'),
      candidates: ['managementMethod'],
      format: (record) => {
        const managementMethod = String(record.managementMethod ?? '').toUpperCase()
        if (managementMethod === 'AGENT') return t('assets.inventory.managementMethods.agent')
        if (managementMethod === 'PLUGIN') return t('assets.inventory.managementMethods.plugin')
        if (managementMethod === 'API' || managementMethod === 'REST_API') return t('assets.inventory.managementMethods.api')
        return readString(record, ['managementMethod'])
      },
      width: '10%',
    },
    { key: 'managementAddress', title: t('assets.inventory.columns.managementAddress'), candidates: ['managementAddress'], width: '12%' },
    { key: 'status', title: t('assets.inventory.columns.status'), candidates: ['livenessStatus', 'health', 'sourceStatus'], kind: 'status', width: '8%' },
    { key: 'deviceVersion', title: t('assets.inventory.columns.version'), candidates: ['softwareVersion'], width: '12%', truncate: true },
    { key: 'controlVersion', title: t('assets.inventory.columns.controlVersion'), candidates: ['controlVersion'], width: '10%' },
    { key: 'siteCount', title: t('assets.inventory.columns.sites'), candidates: ['siteCount', 'applicationAssetCount'], kind: 'count', width: '5%' },
    { key: 'actions', title: t('assets.inventory.columns.actions'), candidates: [], width: '12%' },
  ],
  metrics: [
    { title: t('assets.inventory.metrics.total'), description: t('assets.inventory.metrics.totalDescription'), status: 'HEALTHY', risk: 'MEDIUM', kind: 'total' },
    { title: t('assets.inventory.metrics.abnormal'), description: t('assets.inventory.metrics.abnormalDescription'), status: 'UNREACHABLE', risk: 'HIGH' },
  ],
  filters: [
    { key: 'category', label: t('assets.inventory.filters.category'), type: 'select', options: [
      { label: t('assets.inventory.categories.server'), value: 'SERVER' },
      { label: t('assets.inventory.categories.networkAppliance'), value: 'NETWORK_APPLIANCE' },
      { label: t('assets.inventory.categories.securityAppliance'), value: 'SECURITY_APPLIANCE' },
      { label: t('assets.inventory.categories.cloud'), value: 'CLOUD' },
    ] },
    { key: 'managementMethod', label: t('assets.inventory.filters.managementMethod'), type: 'select', options: [
      { label: t('assets.inventory.managementMethods.agent'), value: 'AGENT' },
      { label: t('assets.inventory.managementMethods.api'), value: 'API' },
      { label: t('assets.inventory.managementMethods.plugin'), value: 'PLUGIN' },
    ] },
    { key: 'health', label: t('assets.inventory.filters.health'), type: 'select', options: [
      { label: t('assets.inventory.health.healthy'), value: 'HEALTHY' },
      { label: t('assets.inventory.health.degraded'), value: 'DEGRADED' },
      { label: t('assets.inventory.health.unreachable'), value: 'UNREACHABLE' },
      { label: t('assets.inventory.health.disabled'), value: 'DISABLED' },
      { label: t('assets.inventory.health.unknown'), value: 'UNKNOWN' },
    ] },
  ],
  filterValues: filters.value,
  onFiltersChange: (next) => { filters.value = next },
  emptyTitle: t('assets.inventory.empty.title'),
  emptyDescription: t('assets.inventory.empty.description'),
  load: (query) => {
    void reloadKey.value
    return loadUnifiedAssets(query)
  },
  actions: [],
  rowActions: [{
    label: t('assets.inventory.actions.detail'), permission: 'host.read', permissions: ['host.read', 'service_asset.read', 'application.read'], reloadAfterRun: false,
    hidden: (row) => !row.raw.availableActions || !Array.isArray(row.raw.availableActions) || !(row.raw.availableActions as unknown[]).includes('VIEW'), run: openDetail,
  }, {
    label: t('assets.inventory.actions.operation'), permission: 'host.read', permissions: ['host.update', 'host.delete', 'service_asset.manage', 'application.update'], reloadAfterRun: false,
    hidden: (row) => !row.raw.availableActions || !Array.isArray(row.raw.availableActions) || !(row.raw.availableActions as unknown[]).some((item) => ['EDIT', 'DELETE'].includes(String(item))),
    menu: [{
       label: t('assets.inventory.actions.edit'), permission: 'host.update', permissions: ['host.update', 'service_asset.manage', 'application.update'], reloadAfterRun: false, hidden: (row) => !includesAction(row, 'EDIT'), run: async (row) => { openEdit(row) },
    }, {
       label: t('assets.inventory.actions.delete'), permission: 'host.delete', permissions: ['host.delete', 'service_asset.manage', 'application.update'], danger: true, confirmText: 'DELETE',
      riskText: t('assets.inventory.deleteImpact'), hidden: (row) => !includesAction(row, 'DELETE'), run: deleteAsset,
    }, {
      label: t('assets.inventory.actions.upgrade'), permission: 'host.update', reloadAfterRun: true,
      hidden: (row) => !includesAction(row, 'UPGRADE') || !String(row.raw.agentId ?? '').trim(),
      run: upgradeAgent,
    }],
  }],
}))
</script>

<template>
  <section class="gc-page devices-page">
    <BusinessResourcePage :key="reloadKey" :config="config">
      <template #cell-status="{ row }">
        <GcStatusTag :status="String(row.status)" />
      </template>
      <template #cell-deviceVersion="{ row }">
        <span>{{ row.deviceVersion }}</span>
      </template>
      <template #cell-controlVersion="{ row }">
        <span class="devices-page__control-version">
          <span>{{ row.controlVersion }}</span>
          <GcStatusTag
            v-if="row.raw.upgradeAvailable"
            status="available"
            :label="t('devices.actions.upgradeNew')"
            tone="success"
          />
        </span>
      </template>
    </BusinessResourcePage>
    <DeviceOnboardingWizard v-model:open="onboardingOpen" @completed="reloadKey += 1" />
    <UnifiedAssetEditModal ref="assetEditModal" @completed="reloadKey += 1" />
    <UnifiedAssetDetailModal ref="assetDetailModal" />
    <GcModal
      v-model:open="upgradeConfirmationOpen"
      size="sm"
      :title="t('devices.upgrade.confirmTitle')"
      :description="t('devices.upgrade.confirmDescription')"
      :busy="upgradeConfirmationBusy"
      :error="upgradeConfirmationError"
      @update:open="(open) => { if (!open) closeUpgradeConfirmation() }"
    >
      <div v-if="upgradeConfirmation" class="devices-page__upgrade-confirmation">
        <div class="devices-page__upgrade-target">
          <span class="devices-page__upgrade-label">{{ t('devices.upgrade.fields.target') }}</span>
          <strong>{{ upgradeConfirmation.displayName }}</strong>
        </div>
        <dl class="devices-page__upgrade-versions">
          <div>
            <dt>{{ t('devices.upgrade.fields.currentVersion') }}</dt>
            <dd>{{ upgradeConfirmation.currentVersion }}</dd>
          </div>
          <div>
            <dt>{{ t('devices.upgrade.fields.targetVersion') }}</dt>
            <dd class="devices-page__upgrade-target-version">{{ upgradeConfirmation.targetVersion }}</dd>
          </div>
        </dl>
        <p class="devices-page__upgrade-notice">{{ t('devices.upgrade.notice') }}</p>
      </div>
      <template #actions>
        <GcButton variant="secondary" :disabled="upgradeConfirmationBusy" @click="closeUpgradeConfirmation">
          {{ t('devices.actions.cancel') }}
        </GcButton>
        <GcButton variant="primary" :loading="upgradeConfirmationBusy" @click="confirmAgentUpgrade">
          {{ t('devices.upgrade.confirmAction') }}
        </GcButton>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.devices-page {
  display: grid;
  gap: var(--gc-space-3);
}

.devices-page :deep(.business-page__row-actions) {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  min-width: max-content;
  white-space: nowrap;
}

.devices-page :deep(.business-page__row-actions > *) {
  flex: 0 0 auto;
  min-width: max-content;
  white-space: nowrap;
  overflow-wrap: normal;
}

.devices-page__control-version {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-1);
  max-width: 100%;
  white-space: nowrap;
}

.devices-page__upgrade-confirmation {
  display: grid;
  gap: var(--gc-space-4);
}

.devices-page__upgrade-target {
  display: grid;
  gap: var(--gc-space-1);
  padding: var(--gc-space-3);
  background: var(--gc-color-surface-soft);
  border: var(--gc-space-hairline) solid var(--gc-color-border);
  border-radius: var(--gc-radius-card);
}

.devices-page__upgrade-label,
.devices-page__upgrade-versions dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-caption);
}

.devices-page__upgrade-versions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}

.devices-page__upgrade-versions div {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.devices-page__upgrade-versions dd {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-weight: var(--gc-font-weight-semibold);
  overflow-wrap: anywhere;
}

.devices-page__upgrade-target-version {
  color: var(--gc-color-success) !important;
}

.devices-page__upgrade-notice {
  margin: 0;
  color: var(--gc-color-text-muted);
  line-height: var(--gc-line-height-relaxed);
}

@media (max-width: 640px) {
  .devices-page__upgrade-versions {
    grid-template-columns: 1fr;
  }

}
</style>

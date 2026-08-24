<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { deleteManagedDeviceAsset, getManagedDevice, listManagedDevices } from '@/api/modules/devices.api'
import { checkAgentUpgrade, deleteAgent, dispatchAgentUpgrade } from '@/api/modules/assets.api'
import type { ApiRecord } from '@/api/modules/common'
import { GcButton, GcModal, GcStatusTag } from '@/design-system/components'
import DeviceOnboardingWizard from './DeviceOnboardingWizard.vue'
import ManagedDeviceDetailModal from './details/ManagedDeviceDetailModal.vue'
import type { ViewRow } from '@/composables/useBusinessPage'

const { t } = useI18n()
const route = useRoute?.() ?? { query: {} as Record<string, string | string[] | undefined> }
const filters = ref<Record<string, string>>({})
const onboardingOpen = ref(false)
const reloadKey = ref(0)
const deviceDetailModal = ref<{ open: (deviceId: string) => Promise<void> } | null>(null)
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

function readAgentDetailField(detail: Record<string, unknown>, fieldKey: string): unknown {
  const sections = Array.isArray(detail.informationSections) ? detail.informationSections : []
  for (const section of sections) {
    const fields = asRecord(section).fields
    if (!Array.isArray(fields)) continue
    const field = fields.find((candidate) => asRecord(candidate).key === fieldKey)
    if (field) return asRecord(field).value
  }
  return undefined
}

async function enrichAgentUpgradeState(record: ApiRecord): Promise<ApiRecord> {
  if (String(record.extensionType ?? '').toUpperCase() !== 'AGENT') return record
  const deviceId = String(record.id ?? '').trim()
  if (!deviceId) return record
  try {
    const response = await getManagedDevice(deviceId, undefined, [])
    const detail = asRecord(response.data)
    const extension = asRecord(detail.extension)
    const extensionSummary = asRecord(detail.extensionSummary)
    const agentId = String(extension.agentId ?? extensionSummary.agentId ?? '').trim()
    const agentRole = String(readAgentDetailField(detail, 'agentRole') ?? '').toLowerCase()
    const upgradeStatus = String(readAgentDetailField(detail, 'upgradeStatus') ?? '').toLowerCase()
    const targetVersion = readAgentDetailField(detail, 'targetVersion')
    return {
      ...record,
      agentId: agentId || undefined,
      // 产品线和平台由后端升级建议决定，前端只排除独立 Gateway 角色。
      agentUpgradeAvailable: agentRole !== 'gateway' && upgradeStatus === 'available',
      agentUpgradeTargetVersion: typeof targetVersion === 'string' ? targetVersion : undefined,
    }
  } catch {
    // 单个 Agent 详情读取失败不应阻塞整页设备列表，升级入口保持隐藏。
    return record
  }
}

async function loadDevices() {
  const response = await listManagedDevices({ page: 1, pageSize: 20, sort: 'displayName:asc', filters: filters.value })
  if (!response.data?.items?.length) return response
  const items = await Promise.all(response.data.items.map((item) => enrichAgentUpgradeState(item)))
  return { ...response, data: { ...response.data, items } }
}

async function openDetail(row: ViewRow) {
  await deviceDetailModal.value?.open(row.id)
}

onMounted(() => {
  const deviceId = typeof route.query.deviceId === 'string' ? route.query.deviceId : ''
  if (route.query.detailModal === '1' && deviceId) {
    void deviceDetailModal.value?.open(deviceId)
  }
})

async function deleteDevice(row: ViewRow) {
  const response = await getManagedDevice(row.id)
  const extension = (response.data?.extension ?? {}) as Record<string, unknown>
  const extensionSummary = (response.data?.extensionSummary ?? {}) as Record<string, unknown>
  if (extension.type === 'AGENT' || response.data?.extensionType === 'AGENT') {
    const agentId = String(extension.agentId ?? extensionSummary.agentId ?? '')
    if (!agentId) throw new Error(t('devices.errors.deleteTargetMissing'))
    await deleteAgent(agentId)
    return
  }
  const deviceAssetId = String(extension.deviceAssetId ?? extensionSummary.deviceAssetId ?? '')
  if (!deviceAssetId) throw new Error(t('devices.errors.deleteTargetMissing'))
  await deleteManagedDeviceAsset(deviceAssetId)
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
  title: t('devices.page.title'),
  description: t('devices.page.description'),
  readPermission: 'host.read',
  primaryPermission: 'host.create',
  primaryActionLabel: t('devices.actions.add'),
  primaryAction: () => { onboardingOpen.value = true },
  moduleName: 'devices',
  resourceName: t('devices.page.title'),
  defaultStatus: 'UNKNOWN',
  defaultRisk: 'MEDIUM',
  showHeader: false,
  showMetrics: false,
  showDetailPanel: false,
  showActionPanel: false,
  tableFixed: true,
  showTotalInPagination: true,
  columns: [
    { key: 'name', title: t('devices.columns.name'), candidates: ['displayName', 'id'], width: '13%' },
    { key: 'category', title: t('devices.columns.category'), candidates: ['category'], width: '8%' },
    { key: 'productFamily', title: t('devices.columns.productFamily'), candidates: ['productFamily'], width: '11%' },
    { key: 'managementMethod', title: t('devices.columns.managementMethod'), candidates: ['managementMethod'], width: '10%' },
    { key: 'managementAddress', title: t('devices.columns.managementAddress'), candidates: ['managementAddress'], width: '13%' },
    { key: 'status', title: t('devices.columns.liveness'), candidates: ['livenessStatus', 'health', 'sourceStatus'], kind: 'status', width: '8%' },
    { key: 'deviceVersion', title: t('devices.columns.deviceVersion'), candidates: ['softwareVersion'], width: '20ch', truncate: true },
    { key: 'controlVersion', title: t('devices.columns.controlVersion'), candidates: ['controlVersion'], width: '11%' },
    { key: 'applicationAssetCount', title: t('devices.columns.applications'), candidates: ['applicationAssetCount'], kind: 'count', width: '6%' },
    { key: 'actions', title: t('devices.columns.actions'), candidates: [], width: '15%' },
  ],
  metrics: [
    { title: t('devices.metrics.total'), description: t('devices.metrics.totalDescription'), status: 'HEALTHY', risk: 'MEDIUM', kind: 'total' },
    { title: t('devices.metrics.abnormal'), description: t('devices.metrics.abnormalDescription'), status: 'UNREACHABLE', risk: 'HIGH' },
  ],
  filters: [
    { key: 'category', label: t('devices.filters.category'), type: 'select', options: [
      { label: t('devices.categories.server'), value: 'SERVER' },
      { label: t('devices.categories.networkAppliance'), value: 'NETWORK_APPLIANCE' },
      { label: t('devices.categories.securityAppliance'), value: 'SECURITY_APPLIANCE' },
    ] },
    { key: 'managementMethod', label: t('devices.filters.managementMethod'), type: 'select', options: [
      { label: t('devices.managementMethods.agent'), value: 'AGENT' },
      { label: t('devices.managementMethods.api'), value: 'API' },
    ] },
    { key: 'health', label: t('devices.filters.health'), type: 'select', options: [
      { label: t('devices.health.healthy'), value: 'HEALTHY' },
      { label: t('devices.health.degraded'), value: 'DEGRADED' },
      { label: t('devices.health.unreachable'), value: 'UNREACHABLE' },
      { label: t('devices.health.disabled'), value: 'DISABLED' },
      { label: t('devices.health.unknown'), value: 'UNKNOWN' },
    ] },
  ],
  filterValues: filters.value,
  onFiltersChange: (next) => { filters.value = next },
  emptyTitle: t('devices.empty.title'),
  emptyDescription: t('devices.empty.description'),
  load: () => {
    void reloadKey.value
    return loadDevices()
  },
  actions: [],
  rowActions: [{
    label: t('devices.actions.detail'), permission: 'host.read', reloadAfterRun: false, run: openDetail,
  }, {
    label: t('devices.actions.delete'), permission: 'host.delete', danger: true, confirmText: 'DELETE',
    riskText: t('devices.detail.deleteImpact'), run: deleteDevice,
  }, {
    label: t('devices.actions.upgrade'), permission: 'host.update', reloadAfterRun: true,
    hidden: (row) => row.raw.agentUpgradeAvailable !== true || !String(row.raw.agentId ?? '').trim(),
    run: upgradeAgent,
  }],
}))
</script>

<template>
  <section class="gc-page devices-page">
    <BusinessResourcePage :key="reloadKey" :config="config">
      <template #cell-controlVersion="{ row }">
        <span class="devices-page__control-version">
          <span>{{ row.controlVersion }}</span>
          <GcStatusTag
            v-if="row.raw.agentUpgradeAvailable"
            status="available"
            :label="t('devices.actions.upgradeNew')"
            tone="success"
          />
        </span>
      </template>
    </BusinessResourcePage>
    <DeviceOnboardingWizard v-model:open="onboardingOpen" @completed="reloadKey += 1" />
    <ManagedDeviceDetailModal ref="deviceDetailModal" />
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
  flex-wrap: nowrap;
  white-space: nowrap;
}

.devices-page :deep(.business-page__row-actions > *) {
  flex: 0 0 auto;
  white-space: nowrap;
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

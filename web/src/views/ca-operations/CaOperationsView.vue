<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { caOperationsApi, type CaOperationObjectType, type CaOperationRecord, type CaOperationsTree, type CaOperationsTreeAuthority } from '@/api/modules/ca-operations.api'
import { GcDataTable, GcEmptyState, GcModal, GcPageToolbar, GcStatusTag, type StatusTone } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { translateDynamic } from '@/i18n/translate'
import { useAppStore } from '@/stores/app.store'
import InternalCaView from '@/views/internal-ca/InternalCaView.vue'
import { subscribeCaOperationsRealtime, type CaOperationsRealtimeMessage } from './ca-operations-realtime'

interface OperationRow extends Record<string, unknown> {
  recordKey: string
  subject: string
  identifier: string
  template: string
  source: string
  status: string
  observedAt: string
}

const objectTypes: CaOperationObjectType[] = ['request', 'issuance', 'revocation', 'template']
const { t, te } = useI18n()
const appStore = useAppStore()
const route = useRoute()
const router = useRouter()
const tree = ref<CaOperationsTree>({ trustDomains: [], unassignedAuthorities: [] })
const selectedCaId = ref('')
const selectedView = ref<CaOperationObjectType>('request')
const query = ref('')
const records = ref<CaOperationRecord[]>([])
const integrity = ref('complete')
const loadingTree = ref(false)
const loadingRecords = ref(false)
const defaultCaSaving = ref(false)
const errorKey = ref('')
const errorMessage = ref('')
const internalCaModalOpen = ref(false)
let recordsRequestInFlight = false
let treeRequestInFlight = false
let disposeCaRealtime: (() => void) | undefined

function caOperationsLabel(namespace: string, value: unknown): string {
  return translateDynamic(t, te, `caOperations.${namespace}`, value)
}

const authorities = computed(() => [
  ...tree.value.trustDomains.flatMap((domain) => domain.authorities),
  ...tree.value.unassignedAuthorities,
])
const selectedAuthority = computed(() => authorities.value.find((authority) => authority.id === selectedCaId.value))
const defaultCaId = computed(() => appStore.preferences.defaultCaId ?? '')
const selectedCaIsDefault = computed(() => Boolean(selectedCaId.value) && selectedCaId.value === defaultCaId.value)
const rows = computed<OperationRow[]>(() => records.value.map((record) => ({
  recordKey: record.recordKey,
  subject: displayText(record, ['subjectCommonName', 'commonName', 'name']),
  identifier: displayText(record, ['serialNumber', 'requestId', 'externalObjectId']),
  template: displayText(record, ['templateExternalId', 'templateName']),
  source: caOperationsLabel('sources', record.source),
  status: record.normalizedStatus,
  observedAt: formatBrowserLocalTime(record.observedAt, { includeSeconds: false }) || t('common.notAvailable'),
})))
const columns = computed<DataTableColumn<OperationRow>[]>(() => [
  { key: 'subject', title: t('caOperations.columns.subject') },
  { key: 'identifier', title: t('caOperations.columns.identifier') },
  { key: 'template', title: t('caOperations.columns.template') },
  { key: 'source', title: t('caOperations.columns.source') },
  { key: 'status', title: t('caOperations.columns.status') },
  { key: 'observedAt', title: t('caOperations.columns.observedAt') },
])
onMounted(() => {
  disposeCaRealtime = subscribeCaOperationsRealtime(handleCaRealtime)
  void loadTree()
})
onBeforeUnmount(() => {
  disposeCaRealtime?.()
})
watch([selectedCaId, selectedView], async ([caId]) => {
  if (!caId) return
  await updateRoute()
  await loadRecords()
})

async function loadTree(options: { silent?: boolean } = {}) {
  if (treeRequestInFlight) return
  treeRequestInFlight = true
  const showLoading = options.silent !== true
  if (showLoading) loadingTree.value = true
  errorKey.value = ''
  errorMessage.value = ''
  try {
    const currentCaId = selectedCaId.value
    tree.value = (await caOperationsApi.tree()).data ?? { trustDomains: [], unassignedAuthorities: [] }
    const routeCaId = typeof route.query.caId === 'string' ? route.query.caId : ''
    const routeView = typeof route.query.view === 'string' && objectTypes.includes(route.query.view as CaOperationObjectType)
      ? route.query.view as CaOperationObjectType
      : 'request'
    selectedView.value = routeView
    const preferredCaId = appStore.preferences.defaultCaId
    selectedCaId.value = options.silent === true && authorities.value.some((authority) => authority.id === currentCaId)
      ? currentCaId
      : authorities.value.some((authority) => authority.id === routeCaId)
        ? routeCaId
        : authorities.value.some((authority) => authority.id === preferredCaId)
          ? preferredCaId ?? ''
          : authorities.value[0]?.id ?? ''
  } catch (caught) {
    setApiError(caught, 'caOperations.messages.loadTreeFailed')
  } finally {
    treeRequestInFlight = false
    if (showLoading) loadingTree.value = false
  }
}

async function loadRecords(options: { silent?: boolean } = {}) {
  if (!selectedCaId.value) return
  if (recordsRequestInFlight) return
  recordsRequestInFlight = true
  const showLoading = options.silent !== true
  if (showLoading) loadingRecords.value = true
  errorKey.value = ''
  errorMessage.value = ''
  try {
    const result = (await caOperationsApi.records({
      caId: selectedCaId.value,
      view: selectedView.value,
      query: query.value.trim() || undefined,
      limit: 100,
    })).data
    records.value = result?.items ?? []
    integrity.value = result?.integrity ?? 'complete'
  } catch (caught) {
    setApiError(caught, 'caOperations.messages.loadRecordsFailed')
  } finally {
    recordsRequestInFlight = false
    if (showLoading) loadingRecords.value = false
  }
}

function handleCaRealtime(message: CaOperationsRealtimeMessage): void {
  void loadTree({ silent: true })
  if (message.type === 'snapshot' || message.caId === selectedCaId.value) {
    void loadRecords({ silent: true })
  }
}

async function refreshRecords() {
  if (!selectedCaId.value) return
  errorKey.value = ''
  errorMessage.value = ''
  try {
    await loadRecords()
  } catch (caught) {
    setApiError(caught, 'caOperations.messages.loadRecordsFailed')
  }
}

async function saveDefaultCa(): Promise<void> {
  if (!selectedCaId.value || selectedCaIsDefault.value || defaultCaSaving.value) return
  defaultCaSaving.value = true
  errorKey.value = ''
  errorMessage.value = ''
  try {
    const saved = await appStore.setDefaultCaId(selectedCaId.value)
    if (!saved) errorMessage.value = appStore.preferenceError || t('caOperations.messages.saveDefaultFailed')
  } catch (caught) {
    setApiError(caught, 'caOperations.messages.saveDefaultFailed')
  } finally {
    defaultCaSaving.value = false
  }
}

function setApiError(caught: unknown, fallbackKey: string): void {
  if (caught instanceof ApiClientError) {
    errorKey.value = ''
    errorMessage.value = caught.message
    return
  }
  errorKey.value = fallbackKey
  errorMessage.value = ''
}

async function updateRoute() {
  await router.replace({
    query: {
      ...route.query,
      caId: selectedCaId.value || undefined,
      view: selectedView.value,
    },
  })
}

function statusLabel(status: string): string {
  return caOperationsLabel('statuses', status)
}

function statusTone(status: string): StatusTone {
  if (['issued', 'complete', 'succeeded', 'realtime', 'normal'].includes(status)) return 'success'
  if (['pending', 'partial', 'stale', 'delayed', 'queued'].includes(status)) return 'warning'
  if (['rejected', 'revoked', 'failed', 'offline'].includes(status)) return 'danger'
  return 'muted'
}

function viewCount(authority: CaOperationsTreeAuthority | undefined, objectType: CaOperationObjectType): number {
  return authority?.views.find((view) => view.objectType === objectType)?.count ?? 0
}

function displayText(record: CaOperationRecord, candidates: string[]): string {
  for (const candidate of candidates) {
    const value = record.display[candidate]
    if (Array.isArray(value)) return value.join(', ')
    if (value !== undefined && value !== '') return String(value)
  }
  return t('common.notAvailable')
}
</script>

<template>
  <section class="gc-page ca-operations">
    <GcPageToolbar class="ca-operations__hero-actions">
      <template #actions>
        <select
          v-model="selectedCaId"
          class="ca-operations__authority-select"
          :disabled="loadingTree || authorities.length === 0"
          :aria-label="t('caOperations.aria.authoritySelect')"
        >
          <option v-if="authorities.length === 0" value="" disabled>{{ t('caOperations.messages.noAuthority') }}</option>
          <optgroup v-for="domain in tree.trustDomains" :key="domain.id" :label="domain.name">
            <option v-for="authority in domain.authorities" :key="authority.id" :value="authority.id">
              {{ authority.name }} · {{ authority.providerName }}
            </option>
          </optgroup>
          <optgroup v-if="tree.unassignedAuthorities.length" :label="t('caOperations.tree.unassigned')">
            <option v-for="authority in tree.unassignedAuthorities" :key="authority.id" :value="authority.id">
              {{ authority.name }} · {{ authority.providerName }}
            </option>
          </optgroup>
        </select>
        <button
          class="gc-button"
          type="button"
          :disabled="!selectedAuthority || selectedCaIsDefault || defaultCaSaving"
          @click="saveDefaultCa"
        >
          {{ selectedCaIsDefault ? t('caOperations.actions.defaultCaSelected') : defaultCaSaving ? t('caOperations.actions.settingDefaultCa') : t('caOperations.actions.setDefaultCa') }}
        </button>
      </template>
      <template #primary>
        <button class="gc-button" type="button" @click="internalCaModalOpen = true">
          {{ t('caOperations.actions.manageInternalCa') }}
        </button>
        <button class="gc-button gc-button--primary" type="button" :disabled="!selectedAuthority || loadingRecords" @click="refreshRecords">
          {{ t('common.refresh') }}
        </button>
      </template>
    </GcPageToolbar>

    <p v-if="errorKey || errorMessage" class="ca-operations__error" role="alert">{{ errorMessage || t(errorKey) }}</p>

    <div v-if="authorities.length" class="ca-operations__layout">
      <section class="ca-operations__content">
        <div class="gc-card ca-operations__summary">
          <div>
            <span>{{ t('caOperations.summary.currentAuthority') }}</span>
            <strong>{{ selectedAuthority?.name }}</strong>
            <small>{{ selectedAuthority?.providerName }} · {{ selectedAuthority?.providerType }}</small>
          </div>
          <div>
            <span>{{ t('caOperations.summary.integrity') }}</span>
            <GcStatusTag :status="integrity" :label="statusLabel(integrity)" :tone="statusTone(integrity)" />
          </div>
        </div>

        <nav class="ca-operations__views" :aria-label="t('caOperations.aria.objectViews')">
          <button
            v-for="objectType in objectTypes"
            :key="objectType"
            type="button"
            :class="{ 'ca-operations__view--active': selectedView === objectType }"
            @click="selectedView = objectType"
          >
            <span>{{ caOperationsLabel('views', objectType) }}</span>
            <small>{{ viewCount(selectedAuthority, objectType) }}</small>
          </button>
        </nav>

        <GcDataTable :columns="columns" :rows="rows" :loading="loadingRecords" row-key="recordKey" :empty-text="t('caOperations.messages.empty')" dense pagination>
          <template #toolbar>
            <form class="ca-operations__toolbar" @submit.prevent="loadRecords()">
              <input v-model="query" class="ca-operations__search" :placeholder="t('caOperations.filters.searchPlaceholder')" :aria-label="t('caOperations.aria.search')" />
              <button class="gc-button" type="submit">{{ t('caOperations.actions.search') }}</button>
            </form>
          </template>
          <template #cell-status="{ row }"><GcStatusTag :status="String(row.status)" :label="statusLabel(String(row.status))" :tone="statusTone(String(row.status))" /></template>
        </GcDataTable>
      </section>
    </div>

    <GcEmptyState v-else-if="!loadingTree" :title="t('caOperations.messages.noAuthority')" :description="t('caOperations.messages.noAuthorityDescription')" />

    <GcModal v-model:open="internalCaModalOpen" size="xxl" :title="t('caOperations.actions.manageInternalCa')" :description="t('internalCa.description')">
      <InternalCaView embedded />
    </GcModal>
  </section>
</template>

<style scoped>
.ca-operations {
  gap: var(--gc-space-5);
}

.ca-operations__authority-select {
  width: min(100%, var(--gc-size-sidebar));
  max-width: 100%;
  min-height: var(--gc-control-height-md);
  padding: 0 var(--gc-space-3);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-field);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  font: inherit;
  font-size: var(--gc-font-size-sm);
}

.ca-operations__authority-select:focus {
  outline: none;
  border-color: var(--gc-color-primary-border-strong);
  background: var(--gc-color-surface-field-focus);
  box-shadow: var(--gc-shadow-focus);
}

.ca-operations__error {
  margin: 0;
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  border-radius: var(--gc-radius-md);
  padding: var(--gc-space-3) var(--gc-space-4);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-soft);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.ca-operations__layout {
  display: block;
}

.ca-operations__content {
  min-width: 0;
  display: grid;
  gap: var(--gc-space-3);
  align-content: start;
}

.ca-operations__summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(var(--gc-size-card-min), 1fr));
  gap: var(--gc-space-3);
  padding: var(--gc-space-4);
  border-color: var(--gc-color-border-soft);
  background: var(--gc-color-surface-glass);
  box-shadow: var(--gc-shadow-sm);
}

.ca-operations__summary > div {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.ca-operations__summary span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 600;
}

.ca-operations__summary small {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.ca-operations__summary strong {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  font-weight: 650;
  overflow-wrap: anywhere;
}

.ca-operations__views {
  display: flex;
  gap: var(--gc-space-1);
  padding: var(--gc-space-1);
  overflow-x: auto;
  background: var(--gc-color-surface-muted);
  border: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  border-radius: var(--gc-radius-full);
}

.ca-operations__views button {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-2);
  min-width: max-content;
  min-height: var(--gc-control-height-sm);
  padding: 0 var(--gc-space-4);
  color: var(--gc-color-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--gc-radius-full);
  cursor: pointer;
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
  white-space: nowrap;
  transition: background-color 180ms ease, color 180ms ease, box-shadow 180ms ease;
}

.ca-operations__views button:hover,
.ca-operations__view--active {
  color: var(--gc-color-text);
  background: var(--gc-color-surface-solid);
  box-shadow: var(--gc-shadow-sm);
}

.ca-operations__views small {
  display: inline-grid;
  place-items: center;
  min-width: var(--gc-space-5);
  color: inherit;
}

.ca-operations__toolbar {
  display: flex;
  gap: var(--gc-space-2);
}

.ca-operations__search {
  flex: 1;
  min-width: 0;
  min-height: var(--gc-control-height-sm);
  padding: 0 var(--gc-space-3);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-glass);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  font: inherit;
  font-size: var(--gc-font-size-xs);
}

.ca-operations__search:focus {
  outline: none;
  border-color: var(--gc-color-primary-border-strong);
  background: var(--gc-color-surface-field-focus);
  box-shadow: var(--gc-shadow-focus);
}

.ca-operations :deep(.gc-data-table th),
.ca-operations :deep(.gc-data-table td) {
  padding: var(--gc-space-2) var(--gc-space-3);
}

.ca-operations :deep(.gc-data-table__toolbar) {
  padding: var(--gc-space-3) var(--gc-space-4);
}

@media (max-width: 56rem) {
  .ca-operations__summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 40rem) {
  .ca-operations__summary { grid-template-columns: 1fr; }
  .ca-operations__toolbar { flex-direction: column; }
}
</style>

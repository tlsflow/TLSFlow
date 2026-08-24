<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { caOperationsApi, type CaOperationObjectType, type CaOperationRecord, type CaOperationsTree, type CaOperationsTreeAuthority, type CaSyncRun } from '@/api/modules/ca-operations.api'
import { GcDataTable, GcEmptyState, GcPageHeader, GcPageToolbar, GcStatusTag, type StatusTone } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

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
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const tree = ref<CaOperationsTree>({ trustDomains: [], unassignedAuthorities: [] })
const selectedCaId = ref('')
const selectedView = ref<CaOperationObjectType>('request')
const query = ref('')
const records = ref<CaOperationRecord[]>([])
const syncRuns = ref<CaSyncRun[]>([])
const integrity = ref('complete')
const lastSuccessfulSyncAt = ref('')
const loadingTree = ref(false)
const loadingRecords = ref(false)
const syncing = ref(false)
const errorKey = ref('')
const currentTime = ref(Date.now())
let freshnessTimer: ReturnType<typeof setInterval> | undefined

const authorities = computed(() => [
  ...tree.value.trustDomains.flatMap((domain) => domain.authorities),
  ...tree.value.unassignedAuthorities,
])
const selectedAuthority = computed(() => authorities.value.find((authority) => authority.id === selectedCaId.value))
const rows = computed<OperationRow[]>(() => records.value.map((record) => ({
  recordKey: record.recordKey,
  subject: displayText(record, ['subjectCommonName', 'commonName', 'name']),
  identifier: displayText(record, ['serialNumber', 'requestId', 'externalObjectId']),
  template: displayText(record, ['templateExternalId', 'templateName']),
  source: t(`caOperations.sources.${record.source}`),
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
const latestSyncRun = computed(() => syncRuns.value.find((run) => run.objectType === selectedView.value))
const freshness = computed(() => {
  if (['queued', 'running'].includes(latestSyncRun.value?.status ?? '')) return 'syncing'
  if (latestSyncRun.value?.status === 'failed') return 'offline'
  if (!lastSuccessfulSyncAt.value) return 'unknown'
  const ageMs = currentTime.value - Date.parse(lastSuccessfulSyncAt.value)
  if (ageMs <= 30_000) return 'realtime'
  if (ageMs <= 120_000) return 'normal'
  if (ageMs <= 600_000) return 'delayed'
  return 'stale'
})

onMounted(() => {
  freshnessTimer = setInterval(() => {
    currentTime.value = Date.now()
  }, 10_000)
  void loadTree()
})
onBeforeUnmount(() => {
  if (freshnessTimer) clearInterval(freshnessTimer)
})
watch([selectedCaId, selectedView], async ([caId]) => {
  if (!caId) return
  await updateRoute()
  await Promise.all([loadRecords(), loadSyncRuns()])
})

async function loadTree() {
  loadingTree.value = true
  errorKey.value = ''
  try {
    tree.value = (await caOperationsApi.tree()).data ?? { trustDomains: [], unassignedAuthorities: [] }
    const routeCaId = typeof route.query.caId === 'string' ? route.query.caId : ''
    const routeView = typeof route.query.view === 'string' && objectTypes.includes(route.query.view as CaOperationObjectType)
      ? route.query.view as CaOperationObjectType
      : 'request'
    selectedView.value = routeView
    selectedCaId.value = authorities.value.some((authority) => authority.id === routeCaId)
      ? routeCaId
      : authorities.value[0]?.id ?? ''
  } catch {
    errorKey.value = 'caOperations.messages.loadTreeFailed'
  } finally {
    loadingTree.value = false
  }
}

async function loadRecords() {
  if (!selectedCaId.value) return
  loadingRecords.value = true
  errorKey.value = ''
  try {
    const result = (await caOperationsApi.records({
      caId: selectedCaId.value,
      view: selectedView.value,
      query: query.value.trim() || undefined,
      limit: 100,
    })).data
    records.value = result?.items ?? []
    integrity.value = result?.integrity ?? 'complete'
    lastSuccessfulSyncAt.value = result?.lastSuccessfulSyncAt ?? ''
  } catch {
    errorKey.value = 'caOperations.messages.loadRecordsFailed'
  } finally {
    loadingRecords.value = false
  }
}

async function loadSyncRuns() {
  if (!selectedCaId.value) return
  try {
    syncRuns.value = (await caOperationsApi.syncRuns(selectedCaId.value)).data ?? []
  } catch {
    syncRuns.value = []
  }
}

async function startSync() {
  const authority = selectedAuthority.value
  if (!authority || syncing.value) return
  syncing.value = true
  errorKey.value = ''
  try {
    await caOperationsApi.createSyncRuns({
      providerId: authority.providerId,
      caId: authority.id,
      objectTypes: [selectedView.value],
      mode: 'incremental',
    })
    await loadSyncRuns()
  } catch {
    errorKey.value = 'caOperations.messages.syncFailed'
  } finally {
    syncing.value = false
  }
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
  return t('caOperations.statuses.' + status)
}

function statusTone(status: string): StatusTone {
  if (['issued', 'complete', 'succeeded', 'realtime', 'normal'].includes(status)) return 'success'
  if (['pending', 'partial', 'stale', 'delayed', 'queued'].includes(status)) return 'warning'
  if (['rejected', 'revoked', 'failed', 'offline'].includes(status)) return 'danger'
  if (['syncing', 'running'].includes(status)) return 'info'
  return 'muted'
}

function selectAuthority(authority: CaOperationsTreeAuthority) {
  selectedCaId.value = authority.id
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
    <GcPageHeader :title="t('caOperations.title')" />

    <GcPageToolbar class="ca-operations__hero-actions">
      <template #actions>
        <button class="gc-button" type="button" :disabled="loadingTree" @click="loadTree">{{ t('common.refresh') }}</button>
      </template>
      <template #primary>
        <button class="gc-button gc-button--primary" type="button" :disabled="!selectedAuthority || syncing" @click="startSync">
          {{ syncing ? t('caOperations.actions.syncing') : t('caOperations.actions.sync') }}
        </button>
      </template>
    </GcPageToolbar>

    <p v-if="errorKey" class="ca-operations__error" role="alert">{{ t(errorKey) }}</p>
    <p v-if="loadingTree" class="ca-operations__loading" role="status">{{ t('common.loading') }}</p>

    <div v-if="authorities.length" class="ca-operations__layout">
      <aside class="gc-card ca-operations__tree" :aria-label="t('caOperations.aria.authorityTree')">
        <header>
          <strong>{{ t('caOperations.tree.title') }}</strong>
          <span>{{ t('caOperations.tree.count', { count: authorities.length }) }}</span>
        </header>
        <section v-for="domain in tree.trustDomains" :key="domain.id" class="ca-operations__tree-group">
          <h2>{{ domain.name }}</h2>
          <button
            v-for="authority in domain.authorities"
            :key="authority.id"
            class="ca-operations__authority"
            :class="{ 'ca-operations__authority--active': selectedCaId === authority.id }"
            type="button"
            @click="selectAuthority(authority)"
          >
            <span>{{ authority.name }}</span>
            <small>{{ authority.providerName }}</small>
          </button>
        </section>
        <section v-if="tree.unassignedAuthorities.length" class="ca-operations__tree-group">
          <h2>{{ t('caOperations.tree.unassigned') }}</h2>
          <button
            v-for="authority in tree.unassignedAuthorities"
            :key="authority.id"
            class="ca-operations__authority"
            :class="{ 'ca-operations__authority--active': selectedCaId === authority.id }"
            type="button"
            @click="selectAuthority(authority)"
          >
            <span>{{ authority.name }}</span>
            <small>{{ authority.providerName }}</small>
          </button>
        </section>
      </aside>

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
          <div>
            <span>{{ t('caOperations.summary.lastSuccessfulSync') }}</span>
            <strong>{{ lastSuccessfulSyncAt ? formatBrowserLocalTime(lastSuccessfulSyncAt, { includeSeconds: false }) : t('common.notAvailable') }}</strong>
            <GcStatusTag :status="freshness" :label="t(`caOperations.freshness.${freshness}`)" :tone="statusTone(freshness)" />
          </div>
          <div>
            <span>{{ t('caOperations.summary.latestRun') }}</span>
            <GcStatusTag v-if="latestSyncRun" :status="latestSyncRun.status" :label="statusLabel(latestSyncRun.status)" :tone="statusTone(latestSyncRun.status)" />
            <strong v-else>{{ t('common.notAvailable') }}</strong>
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
            <span>{{ t(`caOperations.views.${objectType}`) }}</span>
            <small>{{ viewCount(selectedAuthority, objectType) }}</small>
          </button>
        </nav>

        <GcDataTable :columns="columns" :rows="rows" :loading="loadingRecords" row-key="recordKey" :empty-text="t('caOperations.messages.empty')" dense>
          <template #toolbar>
            <form class="ca-operations__toolbar" @submit.prevent="loadRecords">
              <input v-model="query" class="ca-operations__search" :placeholder="t('caOperations.filters.searchPlaceholder')" :aria-label="t('caOperations.aria.search')" />
              <button class="gc-button" type="submit">{{ t('caOperations.actions.search') }}</button>
            </form>
          </template>
          <template #cell-status="{ row }"><GcStatusTag :status="String(row.status)" :label="statusLabel(String(row.status))" :tone="statusTone(String(row.status))" /></template>
        </GcDataTable>
      </section>
    </div>

    <GcEmptyState v-else-if="!loadingTree" :title="t('caOperations.messages.noAuthority')" :description="t('caOperations.messages.noAuthorityDescription')" />
  </section>
</template>

<style scoped>
.ca-operations {
  gap: var(--gc-space-5);
}

.ca-operations__error,
.ca-operations__loading {
  margin: 0;
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  border-radius: var(--gc-radius-md);
  padding: var(--gc-space-3) var(--gc-space-4);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-soft);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.ca-operations__loading {
  border-color: var(--gc-color-info-border);
  color: var(--gc-color-info);
  background: var(--gc-color-info-soft);
}

.ca-operations__layout {
  display: grid;
  grid-template-columns: minmax(var(--gc-size-card-min), var(--gc-size-sidebar)) minmax(0, 1fr);
  gap: var(--gc-space-5);
  align-items: start;
}

.ca-operations__tree {
  position: sticky;
  top: var(--gc-space-4);
  display: grid;
  gap: var(--gc-space-3);
  align-content: start;
  padding: var(--gc-space-4);
}

.ca-operations__tree header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--gc-space-3);
  padding: 0 0 var(--gc-space-3);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.ca-operations__tree header strong {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-md);
  font-weight: 650;
}

.ca-operations__tree header span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  line-height: var(--gc-line-height-relaxed);
}

.ca-operations__tree-group {
  display: grid;
  gap: var(--gc-space-2);
}

.ca-operations__tree-group h2 {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 600;
}

.ca-operations__authority {
  display: grid;
  gap: var(--gc-space-1);
  width: 100%;
  padding: var(--gc-space-3);
  text-align: left;
  color: var(--gc-color-text);
  background: var(--gc-color-surface-soft);
  border: var(--gc-border-width-default) solid transparent;
  border-radius: var(--gc-radius-control);
  cursor: pointer;
  transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
}

.ca-operations__authority:hover {
  border-color: var(--gc-color-border-soft);
  background: var(--gc-color-surface-muted);
  box-shadow: var(--gc-shadow-hover);
}

.ca-operations__authority--active {
  border-color: var(--gc-color-primary-border);
  box-shadow: var(--gc-shadow-focus);
  background: var(--gc-color-surface-selected);
}

.ca-operations__authority span {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  font-weight: 650;
  overflow-wrap: anywhere;
}

.ca-operations__authority small {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  overflow-wrap: anywhere;
}

.ca-operations__content {
  min-width: 0;
  display: grid;
  gap: var(--gc-space-3);
  align-content: start;
}

.ca-operations__summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(var(--gc-size-card-min), 1fr));
  gap: var(--gc-space-3);
  padding: var(--gc-space-4);
  border-color: var(--gc-color-border-muted);
  background: var(--gc-gradient-surface);
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
  .ca-operations__layout { grid-template-columns: 1fr; }
  .ca-operations__tree { position: static; }
  .ca-operations__summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 40rem) {
  .ca-operations__summary { grid-template-columns: 1fr; }
  .ca-operations__toolbar { flex-direction: column; }
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcEmptyState, GcModal, GcPagination, GcPermissionButton, GcStatusTag, type StatusTone } from '@/design-system/components'
import { exportAuditEvidence, listAudits } from '@/api/modules/audits.api'
import type { ApiRecord } from '@/api/modules/common'
import { ApiClientError } from '@/api/client'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { auditReadableTitle, auditResultLabel, auditSummary, auditTypeLabel, isSuppressedAudit, type AuditDisplayItem, type AuditPresentation } from '@/utils/audit-format'

interface AuditRow extends AuditDisplayItem {
  readonly id: string
  readonly createdAt: string
  readonly raw: ApiRecord
}

const rows = ref<AuditRow[]>([])
const total = ref(0)
const loading = ref(false)
const exporting = ref(false)
const error = ref('')
const exportError = ref('')
const currentPage = ref(1)
const pageSize = ref(50)
const keyword = ref('')
const keywordDraft = ref('')
const detailOpen = ref(false)
const detailRow = ref<AuditRow | null>(null)
const { t } = useI18n()

const failedCount = computed(() => rows.value.filter((row) => row.result === 'failure' || row.result === 'denied').length)
const userActionCount = computed(() => rows.value.filter((row) => row.actorType === 'user').length)
const successCount = computed(() => rows.value.filter((row) => row.result === 'success').length)

function auditResultTone(result: string): StatusTone {
  if (result === 'success') return 'success'
  if (result === 'denied') return 'warning'
  if (result === 'failure') return 'danger'
  return 'muted'
}

onMounted(() => {
  void loadAudits()
})

function applyKeywordFilter(): void {
  const nextKeyword = keywordDraft.value.trim()
  keyword.value = nextKeyword
  currentPage.value = 1
  void loadAudits()
}

function changePage(page: number): void {
  currentPage.value = page
  void loadAudits()
}

function changePageSize(size: number): void {
  pageSize.value = size
  currentPage.value = 1
  void loadAudits()
}

async function loadAudits() {
  loading.value = true
  error.value = ''
  try {
    const result = await listAudits({
      page: currentPage.value,
      pageSize: pageSize.value,
      sort: 'createdAt:desc',
      keyword: keyword.value || undefined,
    })
    const page = result.data ?? { items: [], page: currentPage.value, pageSize: pageSize.value, total: 0 }
    const visibleItems = page.items.filter((record) => !isSuppressedAudit({
      eventType: readString(record, ['eventType'], 'audit.event'),
      resourceType: readString(record, ['resourceType'], 'auditLog'),
      detail: readPath(record, 'detail'),
    }))
    rows.value = visibleItems.map(toAuditRow).sort(compareAuditRowsDesc)
    total.value = page.total ?? rows.value.length
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? t('audit.errors.withRequestId', { message: cause.message, requestId: cause.requestId }) : cause instanceof Error ? cause.message : t('audit.errors.loadFailed')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

async function exportEvidence() {
  exporting.value = true
  exportError.value = ''
  try {
    await exportAuditEvidence({ scope: 'current-filter', dryRun: true })
  } catch (cause) {
    exportError.value = cause instanceof Error ? cause.message : t('audit.errors.exportFailed')
  } finally {
    exporting.value = false
  }
}

function toAuditRow(record: ApiRecord): AuditRow {
  return {
    id: readString(record, ['id', 'eventId'], 'aud_unknown'),
    eventType: readString(record, ['eventType'], 'audit.event'),
    actorType: readString(record, ['actorType'], 'user'),
    actorId: readString(record, ['actorId'], t('auditFormat.fallbacks.unknown')),
    action: readString(record, ['action'], 'audit.record'),
    resourceType: readString(record, ['resourceType'], 'auditLog'),
    resourceId: readOptionalString(record, ['resourceId']),
    result: readString(record, ['result', 'status'], 'success'),
    riskLevel: readOptionalString(record, ['riskLevel']),
    requestId: readOptionalString(record, ['requestId']),
    detail: readPath(record, 'detail'),
    presentation: readPresentation(record),
    createdAt: readString(record, ['createdAt', 'timestamp'], ''),
    raw: record,
  }
}

function openDetail(row: AuditRow): void {
  detailRow.value = row
  detailOpen.value = true
}

function formatRawLog(row: AuditRow | null): string {
  if (!row) return ''
  try {
    return JSON.stringify(row.raw, null, 2)
  } catch {
    return String(row.raw)
  }
}

function readPresentation(record: ApiRecord): AuditPresentation | undefined {
  const value = readPath(record, 'presentation')
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const kind = (value as Record<string, unknown>).kind
  const params = (value as Record<string, unknown>).params
  if (typeof kind !== 'string' || !params || typeof params !== 'object' || Array.isArray(params)) return undefined
  return { kind, params: params as Record<string, unknown> }
}

function compareAuditRowsDesc(left: AuditRow, right: AuditRow): number {
  return toTime(right.createdAt) - toTime(left.createdAt)
}

function toTime(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function readOptionalString(record: ApiRecord, candidates: readonly string[]): string | undefined {
  const value = readString(record, candidates, '')
  return value || undefined
}

function readString(record: ApiRecord, candidates: readonly string[], fallback = '—'): string {
  for (const key of candidates) {
    const value = readPath(record, key)
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }
  return fallback
}

function readPath(record: ApiRecord, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, record)
}
</script>

<template>
  <section class="gc-page audit-page">
    <p v-if="exportError" class="audit-page__error" role="alert">{{ exportError }}</p>

    <section class="audit-page__metrics" :aria-label="t('audit.metrics.ariaLabel')">
      <article class="audit-page__metric audit-page__metric--total">
        <div class="audit-page__metric-topline">
          <span class="audit-page__metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 4.5 6v5.25c0 4.61 3.2 8.9 7.5 9.75 4.3-.85 7.5-5.14 7.5-9.75V6L12 3Z" /></svg></span>
          <strong>{{ total }}</strong>
        </div>
        <span class="audit-page__metric-label">{{ t('audit.metrics.total.title') }}</span>
      </article>
      <article class="audit-page__metric audit-page__metric--failed">
        <div class="audit-page__metric-topline">
          <span class="audit-page__metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 2.75 20h18.5L12 3Zm0 6v5m0 3.5v.5" /></svg></span>
          <strong>{{ failedCount }}</strong>
        </div>
        <span class="audit-page__metric-label">{{ t('audit.metrics.failed.title') }}</span>
      </article>
      <article class="audit-page__metric audit-page__metric--user">
        <div class="audit-page__metric-topline">
          <span class="audit-page__metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z" /></svg></span>
          <strong>{{ userActionCount }}</strong>
        </div>
        <span class="audit-page__metric-label">{{ t('audit.metrics.userActions.title') }}</span>
      </article>
      <article class="audit-page__metric audit-page__metric--success">
        <div class="audit-page__metric-topline">
          <span class="audit-page__metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg></span>
          <strong>{{ successCount }}</strong>
        </div>
        <span class="audit-page__metric-label">{{ t('audit.metrics.success.title') }}</span>
      </article>
    </section>

    <GcEmptyState v-if="error" :title="t('audit.errors.loadFailed')" :description="error">
      <button class="gc-button" type="button" @click="loadAudits">{{ t('businessPage.retry') }}</button>
    </GcEmptyState>

    <section v-else class="gc-card audit-list" :aria-label="t('audit.list.ariaLabel')">
      <header class="audit-list__header">
        <div>
          <h2>{{ t('audit.list.title') }}</h2>
        </div>
        <div class="audit-list__actions">
          <label class="audit-list__filter">
            <input
              v-model="keywordDraft"
              type="search"
              :aria-label="t('audit.filters.apply')"
              :placeholder="t('audit.filters.keywordPlaceholder')"
              @keyup.enter="applyKeywordFilter"
            />
          </label>
          <button class="gc-button" type="button" :disabled="loading" @click="applyKeywordFilter">
            {{ t('audit.filters.apply') }}
          </button>
          <GcPermissionButton permission="audit.export" :disabled="exporting" @click="exportEvidence">
            {{ exporting ? t('audit.actions.exporting') : t('audit.actions.exportEvidence') }}
          </GcPermissionButton>
          <button class="gc-button" type="button" :disabled="loading" @click="loadAudits">
            {{ loading ? t('audit.actions.refreshing') : t('common.refresh') }}
          </button>
        </div>
      </header>

      <div v-if="loading" class="audit-list__state">{{ t('designSystem.dataTable.loading') }}</div>
      <ol v-else-if="rows.length" class="audit-list__items">
        <li v-for="item in rows" :key="item.id" :data-result="item.result">
          <GcStatusTag class="audit-list__result" :status="item.result" :label="auditResultLabel(item.result, t)" :tone="auditResultTone(item.result)" />
          <div class="audit-list__body">
            <div class="audit-list__title-row">
              <strong>{{ auditReadableTitle(item, t) }}</strong>
              <span class="audit-list__type">{{ auditTypeLabel(item, t) }}</span>
            </div>
            <p>{{ auditSummary(item, t) }}</p>
          </div>
          <div class="audit-list__meta">
            <button class="audit-list__detail-button" type="button" @click.stop="openDetail(item)">
              {{ t('audit.actions.viewDetail') }}
            </button>
            <time>{{ item.createdAt ? formatBrowserLocalTime(item.createdAt, { includeSeconds: false }) : t('audit.list.timeNotRecorded') }}</time>
          </div>
        </li>
      </ol>
      <GcEmptyState v-else :title="t('audit.empty.title')" :description="t('audit.empty.description')" />

      <footer v-if="total > 0" class="audit-list__pagination">
        <GcPagination
          :total="total"
          :page="currentPage"
          :page-size="pageSize"
          :disabled="loading"
          @update:page="changePage"
          @update:page-size="changePageSize"
        />
      </footer>
    </section>

    <GcModal
      v-model:open="detailOpen"
      :title="t('audit.detail.title')"
      :description="t('audit.detail.description')"
      size="lg"
    >
      <pre class="audit-detail__raw">{{ formatRawLog(detailRow) }}</pre>
    </GcModal>
  </section>
</template>

<style scoped>
.audit-page {
  gap: var(--gc-space-5);
}

.audit-page__error {
  margin: 0;
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  border-radius: var(--gc-radius-md);
  padding: var(--gc-space-3) var(--gc-space-4);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
  font-weight: 750;
}

.audit-page__metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr));
  gap: var(--gc-space-3);
}

.audit-page__metric {
  display: grid;
  align-content: space-between;
  gap: var(--gc-space-3);
  min-height: calc(var(--gc-space-12) + var(--gc-space-12) + var(--gc-space-3));
  padding: var(--gc-space-5);
  border: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  border-radius: var(--gc-radius-xl);
  background: var(--gc-color-surface-workspace-glass);
  box-shadow: var(--gc-shadow-card);
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.audit-page__metric:hover {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-surface-hover);
  box-shadow: var(--gc-shadow-hover);
  transform: translateY(calc(var(--gc-space-tight) * -1));
}

.audit-page__metric-topline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-3);
}

.audit-page__metric-icon {
  display: grid;
  place-items: center;
  inline-size: var(--gc-space-8);
  block-size: var(--gc-space-8);
  border-radius: var(--gc-radius-md);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
}

.audit-page__metric-icon svg {
  inline-size: var(--gc-size-icon-md);
  block-size: var(--gc-size-icon-md);
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: var(--gc-border-width-thick);
}

.audit-page__metric-label {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 850;
}

.audit-page__metric strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-xl);
  line-height: var(--gc-line-height-tight);
  font-weight: 800;
  letter-spacing: 0;
}

.audit-page__metric--failed .audit-page__metric-icon {
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-soft);
}

.audit-page__metric--user .audit-page__metric-icon {
  color: var(--gc-color-info);
  background: var(--gc-color-info-soft);
}

.audit-page__metric--success .audit-page__metric-icon {
  color: var(--gc-color-success);
  background: var(--gc-color-success-soft);
}

.audit-list {
  overflow: hidden;
  border-radius: var(--gc-radius-card);
  padding: 0;
}

.audit-list__header {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-4);
  align-items: center;
  padding: var(--gc-space-4);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
  background: var(--gc-color-surface-muted);
}

.audit-list__actions {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
  flex-wrap: wrap;
  justify-content: flex-end;
}

.audit-list__filter {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 750;
}

.audit-list__filter input {
  inline-size: min(18rem, 34vw);
  min-height: var(--gc-control-height-sm);
  padding: 0 var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-field);
  font: inherit;
}

.audit-list__filter input:focus {
  border-color: var(--gc-color-focus);
  outline: none;
  box-shadow: var(--gc-shadow-focus);
}

.audit-list__pagination {
  padding: var(--gc-space-control) var(--gc-space-5);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border);
  background: var(--gc-color-surface-glass);
}

.audit-list__header h2,
.audit-list__header p {
  margin: 0;
}

.audit-list__header h2 {
  font-size: var(--gc-font-size-lg);
  letter-spacing: 0;
}

.audit-list__header p {
  margin-top: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 650;
}

.audit-list__state {
  padding: var(--gc-space-12) var(--gc-space-4);
  text-align: center;
  color: var(--gc-color-text-muted);
  font-weight: 850;
}

.audit-list__items {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.audit-list__items li {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content;
  gap: var(--gc-space-2) var(--gc-space-3);
  align-items: start;
  padding: var(--gc-space-3) var(--gc-space-4);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.audit-list__items li:last-child {
  border-bottom: 0;
}

.audit-list__body {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.audit-list__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gc-space-2);
  min-width: 0;
}

.audit-list__title-row strong,
.audit-list__body p {
  overflow-wrap: anywhere;
}

.audit-list__title-row strong {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-tight);
  font-weight: 950;
}

.audit-list__type {
  display: inline-flex;
  align-items: center;
  min-height: var(--gc-control-height-xs);
  border-radius: var(--gc-radius-full);
  padding: 0 var(--gc-space-2);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
  line-height: 1;
  white-space: nowrap;
}

.audit-list__body p {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-tight);
  font-weight: 650;
}

.audit-list time {
  padding-top: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
  white-space: nowrap;
}

.audit-list__meta {
  display: grid;
  justify-items: end;
  gap: var(--gc-space-1);
  min-width: max-content;
}

.audit-list__detail-button {
  padding: 0;
  border: 0;
  color: var(--gc-color-primary);
  background: transparent;
  font: inherit;
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  cursor: pointer;
}

.audit-list__detail-button:hover {
  text-decoration: underline;
}

.audit-list__detail-button:focus-visible {
  border-radius: var(--gc-radius-sm);
  outline: var(--gc-border-width-default) solid var(--gc-color-focus);
  outline-offset: var(--gc-space-tight);
}

.audit-detail__raw {
  max-block-size: min(60vh, 36rem);
  margin: 0;
  overflow: auto;
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  border-radius: var(--gc-radius-md);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-field);
  font-family: var(--gc-font-family-mono);
  font-size: var(--gc-font-size-xs);
  line-height: var(--gc-line-height-relaxed);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (max-width: 56rem) {
  .audit-list__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .audit-list__actions {
    width: 100%;
    justify-content: flex-start;
  }

  .audit-list__filter {
    flex: 1 1 100%;
  }

  .audit-list__filter input {
    inline-size: 100%;
  }

  .audit-list__items li {
    grid-template-columns: 1fr;
    gap: var(--gc-space-1);
  }

  .audit-list time {
    padding-top: 0;
    white-space: normal;
  }

  .audit-list__meta {
    justify-items: start;
  }
}
</style>

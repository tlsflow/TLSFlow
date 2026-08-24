<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcEmptyState, GcPageHeader, GcPermissionButton, GcStatusTag, type StatusTone } from '@/design-system/components'
import { exportAuditEvidence, listAudits } from '@/api/modules/audits.api'
import type { ApiRecord } from '@/api/modules/common'
import { ApiClientError } from '@/api/client'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { auditReadableTitle, auditResultLabel, auditSummary, auditTypeLabel, type AuditDisplayItem } from '@/utils/audit-format'

interface AuditRow extends AuditDisplayItem {
  readonly id: string
  readonly createdAt: string
}

const rows = ref<AuditRow[]>([])
const total = ref(0)
const loading = ref(false)
const exporting = ref(false)
const error = ref('')
const exportError = ref('')
const { t } = useI18n()

const failedCount = computed(() => rows.value.filter((row) => row.result === 'failure' || row.result === 'denied').length)
const userActionCount = computed(() => rows.value.filter((row) => row.actorType === 'user').length)

function auditResultTone(result: string): StatusTone {
  if (result === 'success') return 'success'
  if (result === 'denied') return 'warning'
  if (result === 'failure') return 'danger'
  return 'muted'
}

onMounted(() => {
  void loadAudits()
})

async function loadAudits() {
  loading.value = true
  error.value = ''
  try {
    const result = await listAudits({ page: 1, pageSize: 50, sort: 'createdAt:desc' })
    const page = result.data ?? { items: [], page: 1, pageSize: 50, total: 0 }
    rows.value = page.items.map(toAuditRow).sort(compareAuditRowsDesc)
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
    summary: readOptionalString(record, ['summary']),
    createdAt: readString(record, ['createdAt', 'timestamp'], ''),
  }
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
    <GcPageHeader :title="t('audit.page.title')" :description="t('audit.page.description')">
      <template #actions>
        <GcPermissionButton permission="audit.export" :disabled="exporting" @click="exportEvidence">
          {{ exporting ? t('audit.actions.exporting') : t('audit.actions.exportEvidence') }}
        </GcPermissionButton>
      </template>
    </GcPageHeader>

    <p v-if="exportError" class="audit-page__error" role="alert">{{ exportError }}</p>

    <section class="audit-page__metrics" :aria-label="t('audit.metrics.ariaLabel')">
      <article class="gc-card audit-page__metric">
        <span>{{ t('audit.metrics.total.title') }}</span>
        <strong>{{ total }}</strong>
        <p>{{ t('audit.metrics.total.description') }}</p>
      </article>
      <article class="gc-card audit-page__metric">
        <span>{{ t('audit.metrics.failed.title') }}</span>
        <strong>{{ failedCount }}</strong>
        <p>{{ t('audit.metrics.failed.description') }}</p>
      </article>
      <article class="gc-card audit-page__metric">
        <span>{{ t('audit.metrics.userActions.title') }}</span>
        <strong>{{ userActionCount }}</strong>
        <p>{{ t('audit.metrics.userActions.description') }}</p>
      </article>
    </section>

    <GcEmptyState v-if="error" :title="t('audit.errors.loadFailed')" :description="error">
      <button class="gc-button" type="button" @click="loadAudits">{{ t('businessPage.retry') }}</button>
    </GcEmptyState>

    <section v-else class="gc-card audit-list" :aria-label="t('audit.list.ariaLabel')">
      <header class="audit-list__header">
        <div>
          <h2>{{ t('audit.list.title') }}</h2>
          <p>{{ t('audit.list.summary', { total }) }}</p>
        </div>
        <button class="gc-button" type="button" :disabled="loading" @click="loadAudits">
          {{ loading ? t('audit.actions.refreshing') : t('common.refresh') }}
        </button>
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
          <time>{{ item.createdAt ? formatBrowserLocalTime(item.createdAt, { includeSeconds: false }) : t('audit.list.timeNotRecorded') }}</time>
        </li>
      </ol>
      <GcEmptyState v-else :title="t('audit.empty.title')" :description="t('audit.empty.description')" />
    </section>
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
  grid-template-columns: repeat(3, minmax(var(--gc-size-card-min), 1fr));
  gap: var(--gc-space-3);
}

.audit-page__metric {
  display: grid;
  gap: var(--gc-space-2);
  min-height: var(--gc-size-card-min);
  border-radius: var(--gc-radius-card);
  padding: var(--gc-space-4);
}

.audit-page__metric span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 850;
}

.audit-page__metric strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-2xl);
  line-height: 1;
  font-weight: 950;
  letter-spacing: 0;
}

.audit-page__metric p {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
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
  padding: var(--gc-space-4);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.audit-list__items li:last-child {
  border-bottom: 0;
}

.audit-list__body {
  display: grid;
  gap: var(--gc-space-2);
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
  line-height: var(--gc-line-height-relaxed);
  font-weight: 700;
}

.audit-list time {
  padding-top: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
  white-space: nowrap;
}

@media (max-width: 56rem) {
  .audit-page__metrics {
    grid-template-columns: 1fr;
  }

  .audit-list__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .audit-list__items li {
    grid-template-columns: 1fr;
  }

  .audit-list time {
    padding-top: 0;
    white-space: normal;
  }
}
</style>

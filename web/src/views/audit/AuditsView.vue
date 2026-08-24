<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { GcEmptyState, GcPageHeader, GcPermissionButton } from '@/design-system/components'
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

const failedCount = computed(() => rows.value.filter((row) => row.result === 'failure' || row.result === 'denied').length)
const userActionCount = computed(() => rows.value.filter((row) => row.actorType === 'user').length)

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
    error.value = cause instanceof ApiClientError ? `${cause.message}（${cause.requestId}）` : cause instanceof Error ? cause.message : '审计日志加载失败'
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
    exportError.value = cause instanceof Error ? cause.message : '导出审计证据失败'
  } finally {
    exporting.value = false
  }
}

function toAuditRow(record: ApiRecord): AuditRow {
  return {
    id: readString(record, ['id', 'eventId'], 'aud_unknown'),
    eventType: readString(record, ['eventType'], 'audit.event'),
    actorType: readString(record, ['actorType'], 'user'),
    actorId: readString(record, ['actorId'], '未知'),
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
    <GcPageHeader title="审计日志" description="按用户操作、失败/拒绝和关键业务变更组织日志，保留可读摘要。">
      <template #actions>
        <GcPermissionButton permission="audit.export" :disabled="exporting" @click="exportEvidence">
          {{ exporting ? '导出中…' : '导出审计证据' }}
        </GcPermissionButton>
      </template>
    </GcPageHeader>

    <p v-if="exportError" class="audit-page__error">{{ exportError }}</p>

    <section class="audit-page__metrics" aria-label="审计概览">
      <article class="gc-card audit-page__metric">
        <span>审计总数</span>
        <strong>{{ total }}</strong>
        <p>当前筛选范围内可追踪的操作记录。</p>
      </article>
      <article class="gc-card audit-page__metric">
        <span>失败 / 拒绝</span>
        <strong>{{ failedCount }}</strong>
        <p>需要优先复核的失败执行和拒绝访问。</p>
      </article>
      <article class="gc-card audit-page__metric">
        <span>用户操作</span>
        <strong>{{ userActionCount }}</strong>
        <p>由用户直接发起的业务变更和访问动作。</p>
      </article>
    </section>

    <GcEmptyState v-if="error" title="审计日志加载失败" :description="error">
      <button class="gc-button" type="button" @click="loadAudits">重试</button>
    </GcEmptyState>

    <section v-else class="gc-card audit-list" aria-label="审计日志列表">
      <header class="audit-list__header">
        <div>
          <h2>日志列表</h2>
          <p>共 {{ total }} 条，默认按最新时间排序。</p>
        </div>
        <button class="gc-button" type="button" :disabled="loading" @click="loadAudits">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </header>

      <div v-if="loading" class="audit-list__state">加载中...</div>
      <ol v-else-if="rows.length" class="audit-list__items">
        <li v-for="item in rows" :key="item.id" :data-result="item.result">
          <span class="audit-list__result" :data-result="item.result">{{ auditResultLabel(item.result) }}</span>
          <div class="audit-list__body">
            <div class="audit-list__title-row">
              <strong>{{ auditReadableTitle(item) }}</strong>
              <span class="audit-list__type">{{ auditTypeLabel(item) }}</span>
            </div>
            <p>{{ auditSummary(item) }}</p>
          </div>
          <time>{{ item.createdAt ? formatBrowserLocalTime(item.createdAt, { includeSeconds: false }) : '未记录时间' }}</time>
        </li>
      </ol>
      <GcEmptyState v-else title="暂无审计事件" description="关键操作应能回溯到对应的操作记录和任务记录。" />
    </section>
  </section>
</template>

<style scoped>
.audit-page {
  gap: var(--gc-space-5);
}

.audit-page__error {
  margin: 0;
  border: 1px solid var(--gc-color-danger-border);
  border-radius: 8px;
  padding: 12px 14px;
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  font-weight: 750;
}

.audit-page__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(180px, 1fr));
  gap: var(--gc-space-3);
}

.audit-page__metric {
  display: grid;
  gap: var(--gc-space-2);
  min-height: 126px;
  border-radius: 8px;
  padding: 16px;
}

.audit-page__metric span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 850;
}

.audit-page__metric strong {
  color: var(--gc-color-text-strong);
  font-size: 34px;
  line-height: 1;
  font-weight: 950;
  letter-spacing: 0;
}

.audit-page__metric p {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: 1.45;
}

.audit-list {
  overflow: hidden;
  border-radius: 8px;
  padding: 0;
}

.audit-list__header {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-4);
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--gc-color-border);
  background: var(--gc-color-surface-muted);
}

.audit-list__header h2,
.audit-list__header p {
  margin: 0;
}

.audit-list__header h2 {
  font-size: 18px;
  letter-spacing: 0;
}

.audit-list__header p {
  margin-top: 4px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 650;
}

.audit-list__state {
  padding: 48px 16px;
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
  grid-template-columns: 56px minmax(0, 1fr) max-content;
  gap: 10px 12px;
  align-items: start;
  padding: 14px 16px;
  border-bottom: 1px solid var(--gc-color-border-subtle);
}

.audit-list__items li:last-child {
  border-bottom: 0;
}

.audit-list__result {
  display: inline-grid;
  place-items: center;
  min-width: 48px;
  min-height: 24px;
  border: 1px solid var(--gc-color-border);
  border-radius: 999px;
  padding: 0 8px;
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-soft);
  font-size: var(--gc-font-size-xs);
  font-weight: 900;
  white-space: nowrap;
}

.audit-list__result[data-result="success"] {
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
  border-color: var(--gc-color-success-border);
}

.audit-list__result[data-result="failure"] {
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  border-color: var(--gc-color-danger-border);
}

.audit-list__result[data-result="denied"] {
  color: var(--gc-color-warning);
  background: var(--gc-color-warning-bg);
  border-color: var(--gc-color-warning-border);
}

.audit-list__body {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.audit-list__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.audit-list__title-row strong,
.audit-list__body p {
  overflow-wrap: anywhere;
}

.audit-list__title-row strong {
  color: var(--gc-color-text);
  font-size: 15px;
  line-height: 1.25;
  font-weight: 950;
}

.audit-list__type {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  border-radius: 999px;
  padding: 0 8px;
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
  line-height: 1.45;
  font-weight: 700;
}

.audit-list time {
  padding-top: 3px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
  white-space: nowrap;
}

@media (max-width: 900px) {
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

  .audit-list__result {
    justify-self: start;
  }

  .audit-list time {
    padding-top: 0;
    white-space: normal;
  }
}
</style>

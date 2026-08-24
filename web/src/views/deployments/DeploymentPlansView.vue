<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { listBindings } from '@/api/modules/bindings.api'
import { listCertificates } from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'
import { GcConfirmAction, GcDeploymentWizard, GcEmptyState, GcModal, GcPermissionButton, GcStatusTag } from '@/design-system/components'
import type { DeploymentWizardPlan } from '@/design-system/components/GcDeploymentWizard.vue'
import { usePermissionStore } from '@/stores/permission.store'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import type { ViewRow } from '@/composables/useBusinessPage'
import { deploymentPlanActions, deploymentPlansPageConfig, deploymentPlanUiActions, latestRunId, requirePlanId } from './deployment-plan.config'

interface ActionErrorState {
  readonly message: string
  readonly errorCode: string
  readonly requestId: string
}

interface DetailBlock {
  readonly key: string
  readonly title: string
  readonly text: string
}

const route = useRoute()
const permissionStore = usePermissionStore()
const certificates = ref<ApiRecord[]>([])
const bindings = ref<ApiRecord[]>([])
const wizardOpen = ref(false)
const wizardLoading = ref(false)
const wizardError = ref('')
const dryRunRequestId = ref('')
const submitRequestId = ref('')
const approvalHint = ref('')
const currentPlanId = ref('')
const selectedPlan = ref<ViewRow | null>(null)
const actionPendingKey = ref('')
const actionRequestId = ref('')
const actionError = ref<ActionErrorState | null>(null)
const resourcePage = ref<InstanceType<typeof BusinessResourcePage> | null>(null)

const pageConfig = computed<BusinessPageConfig>(() => ({
  ...deploymentPlansPageConfig,
  primaryAction: openWizard,
  onSelectionChange: (row) => {
    selectedPlan.value = row
  }
}))

const initialCertificateId = computed(() => {
  const value = route.query.certificateId
  return typeof value === 'string' && value ? value : null
})

const selectedStatus = computed(() => normalizeStatus(selectedPlan.value?.status ?? ''))
const visiblePlanActions = computed(() => {
  if (!selectedPlan.value) return []
  return deploymentPlanUiActions.filter((action) => {
    return permissionStore.hasPermission(action.permission) && action.visibleWhen.includes(selectedStatus.value)
  })
})

const planIdLabel = computed(() => selectedPlan.value ? safeRead(selectedPlan.value.raw, ['id', 'planId'], selectedPlan.value.id) : '—')
const approvalIdLabel = computed(() => selectedPlan.value ? safeRead(selectedPlan.value.raw, ['approvalId', 'approval.id', 'approval.approvalId']) : '—')
const snapshotHashLabel = computed(() => selectedPlan.value ? safeRead(selectedPlan.value.raw, ['snapshotHash', 'snapshot.hash', 'dryRun.snapshotHash']) : '—')
const failureReasonLabel = computed(() => selectedPlan.value ? safeRead(selectedPlan.value.raw, ['failureReason', 'error.message', 'latestRun.failureReason', 'runs.0.failureReason']) : '—')
const latestRunIdLabel = computed(() => selectedPlan.value ? latestRunId(selectedPlan.value) || '—' : '—')
const detailBlocks = computed<DetailBlock[]>(() => {
  if (!selectedPlan.value) return []
  const raw = selectedPlan.value.raw
  return [
    { key: 'targets', title: 'Targets 目标', text: formatValue(readFirst(raw, ['targets', 'targetIds', 'affectedTargets', 'targetSummary'])) },
    { key: 'runs', title: 'Runs 执行批次', text: formatValue(readFirst(raw, ['runs', 'executionRuns', 'latestRun'])) },
    { key: 'steps', title: 'Steps 步骤', text: formatValue(readFirst(raw, ['steps', 'executionSteps', 'workflow.steps'])) }
  ]
})

function openWizard() {
  currentPlanId.value = ''
  dryRunRequestId.value = ''
  submitRequestId.value = ''
  approvalHint.value = ''
  wizardOpen.value = true
}

function closeWizard() {
  wizardOpen.value = false
}

void loadWizardOptions()

async function loadWizardOptions() {
  wizardLoading.value = true
  wizardError.value = ''
  try {
    const [certificateResult, bindingResult] = await Promise.all([
      listCertificates({ page: 1, pageSize: 50, sort: 'updatedAt:desc' }),
      listBindings({ page: 1, pageSize: 50, sort: 'lastVerifiedAt:desc' })
    ])
    certificates.value = [...(certificateResult.data?.items ?? [])]
    bindings.value = filterBindings(bindingResult.data?.items ?? [])
  } catch (cause) {
    wizardError.value = cause instanceof Error ? cause.message : '部署向导初始化失败'
  } finally {
    wizardLoading.value = false
  }
}

function filterBindings(items: readonly ApiRecord[]): ApiRecord[] {
  const queryBindingId = typeof route.query.bindingId === 'string' ? route.query.bindingId : ''
  const queryCertificateId = typeof route.query.certificateId === 'string' ? route.query.certificateId : ''
  const queryHostId = typeof route.query.hostId === 'string' ? route.query.hostId : ''
  return [...items].filter((item) => {
    const certificate = typeof item.certificate === 'object' && item.certificate ? (item.certificate as Record<string, unknown>) : null
    const host = typeof item.host === 'object' && item.host ? (item.host as Record<string, unknown>) : null
    if (queryBindingId && ![item.id, item.bindingId].includes(queryBindingId)) return false
    if (queryCertificateId && ![item.certificateId, certificate?.id].includes(queryCertificateId)) return false
    if (queryHostId && ![item.hostId, item.assetId, host?.id].includes(queryHostId)) return false
    return true
  })
}

async function ensureDraftPlan(plan: DeploymentWizardPlan): Promise<string> {
  if (currentPlanId.value) return currentPlanId.value
  const created = await deploymentPlanActions.createDeploymentPlan({
    name: buildPlanName(plan),
    certificateId: plan.certificateId,
    certificateVersionId: plan.certificateVersionId,
    planType: 'UPDATE',
    targets: plan.bindingIds.map((certificateBindingId) => ({ certificateBindingId })),
    policy: { riskLevel: 'low', approvalRequired: false, failurePolicy: 'rollback' }
  })
  const planId = String(created.data?.id ?? created.data?.planId ?? '')
  if (!planId) throw new Error('后端未返回部署计划 ID')
  currentPlanId.value = planId
  actionRequestId.value = created.requestId
  return planId
}

async function handleDryRun(plan: DeploymentWizardPlan) {
  const planId = await ensureDraftPlan(plan)
  const result = await deploymentPlanActions.dryRunDeploymentPlan({ planId })
  dryRunRequestId.value = result.requestId
  actionRequestId.value = result.requestId
  await resourcePage.value?.reload()
}

async function handleSubmit(plan: DeploymentWizardPlan) {
  const planId = await ensureDraftPlan(plan)
  const result = await deploymentPlanActions.submitDeploymentPlan(planId)
  submitRequestId.value = result.requestId
  actionRequestId.value = result.requestId
  approvalHint.value = buildApprovalHint(result.data)
  await resourcePage.value?.reload()
  if (!approvalHint.value) closeWizard()
}

async function handleExecute(plan: DeploymentWizardPlan) {
  const planId = await ensureDraftPlan(plan)
  const submitted = await deploymentPlanActions.submitDeploymentPlan(planId)
  submitRequestId.value = submitted.requestId
  actionRequestId.value = submitted.requestId
  const status = String(submitted.data?.status ?? '')
  if (normalizeStatus(status) === 'PENDING_APPROVAL') {
    approvalHint.value = buildApprovalHint(submitted.data) || '计划已提交并等待审批；审批通过后才能执行。'
    await resourcePage.value?.reload()
    return
  }
  const result = await deploymentPlanActions.executeDeploymentPlan(planId)
  submitRequestId.value = result.requestId
  actionRequestId.value = result.requestId
  await resourcePage.value?.reload()
  closeWizard()
}

async function runPlanAction(actionKey: string) {
  const row = selectedPlan.value
  const action = deploymentPlanUiActions.find((item) => item.key === actionKey)
  if (!row || !action || actionPendingKey.value) return
  const disabledReason = planActionDisabledReason(action, row)
  if (disabledReason) return

  actionPendingKey.value = action.key
  actionError.value = null
  actionRequestId.value = ''
  try {
    const result = await action.run(row) as { requestId?: string }
    actionRequestId.value = String(result?.requestId ?? '')
    await resourcePage.value?.reload()
  } catch (cause) {
    actionError.value = normalizeActionError(cause)
  } finally {
    actionPendingKey.value = ''
  }
}

function planActionDisabledReason(action: { disabledReason?: (row: ViewRow) => string }, row: ViewRow): string {
  const missingPlanId = (() => {
    try {
      return requirePlanId(row) ? '' : '缺少 planId'
    } catch (cause) {
      return cause instanceof Error ? cause.message : '缺少 planId'
    }
  })()
  return missingPlanId || action.disabledReason?.(row) || ''
}

function buildPlanName(plan: DeploymentWizardPlan): string {
  const targetCount = plan.bindingIds.length
  return `证书 ${plan.certificateVersionId} 部署到 ${targetCount} 个目标`
}

function buildApprovalHint(data: ApiRecord | undefined): string {
  if (!data) return ''
  const approvalId = safeRead(data, ['approvalId', 'approval.id', 'approval.approvalId'])
  const status = normalizeStatus(String(data.status ?? data.state ?? ''))
  if (!approvalId && status !== 'PENDING_APPROVAL') return ''
  return `计划已提交并等待审批${approvalId !== '—' ? `，approvalId：${approvalId}` : ''}。审批通过后才能执行。`
}

function normalizeActionError(cause: unknown): ActionErrorState {
  if (cause instanceof ApiClientError) {
    return { message: cause.message, errorCode: cause.errorCode, requestId: cause.requestId }
  }
  return {
    message: cause instanceof Error ? cause.message : '部署计划操作失败',
    errorCode: 'NETWORK_OR_RUNTIME_ERROR',
    requestId: '未返回 requestId，请检查浏览器网络面板中的 X-Request-Id'
  }
}

function normalizeStatus(status: string): string {
  return status.trim().toUpperCase() || 'UNKNOWN'
}

function safeRead(record: ApiRecord, candidates: readonly string[], fallback = '—'): string {
  const value = readFirst(record, candidates)
  if (value === undefined || value === null || value === '') return fallback
  if (Array.isArray(value)) return String(value.length)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function readFirst(record: ApiRecord, candidates: readonly string[]): unknown {
  for (const candidate of candidates) {
    const value = readPath(record, candidate)
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function readPath(record: ApiRecord, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    if (Array.isArray(current) && /^\d+$/.test(segment)) return current[Number(segment)]
    return (current as Record<string, unknown>)[segment]
  }, record)
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.map((item, index) => `${index + 1}. ${formatInline(item)}`).join('\n') : '[]'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

defineExpose({ openWizard })

function formatInline(value: unknown): string {
  if (!value || typeof value !== 'object') return String(value)
  const record = value as Record<string, unknown>
  const id = record.id ?? record.planId ?? record.runId ?? record.certificateBindingId ?? record.bindingId ?? record.name ?? ''
  const status = record.status ?? record.state ?? record.result ?? ''
  const reason = record.failureReason ?? record.reason ?? record.message ?? ''
  const pieces = [id, status, reason].filter((item) => item !== undefined && item !== null && item !== '')
  return pieces.length ? pieces.map(String).join(' · ') : JSON.stringify(value)
}
</script>

<template>
  <section class="gc-page gc-deployment-page">
    <GcEmptyState v-if="wizardError" title="部署向导初始化失败" :description="wizardError" />

    <GcModal
      v-model:open="wizardOpen"
      title="创建部署计划"
      description="选择证书和绑定目标，按 create → dry-run → submit → approval → execute 闭环推进。"
      size="xl"
    >
      <GcDeploymentWizard
        :certificates="certificates"
        :bindings="bindings"
        :loading="wizardLoading"
        :dry-run-request-id="dryRunRequestId"
        :submit-request-id="submitRequestId"
        :approval-hint="approvalHint"
        :initial-certificate-id="initialCertificateId"
        @dry-run="handleDryRun"
        @submit="handleSubmit"
        @execute="handleExecute"
      />
    </GcModal>

    <BusinessResourcePage ref="resourcePage" :config="pageConfig" />

    <section v-if="selectedPlan" class="gc-card gc-deployment-page__state" aria-label="部署计划状态闭环">
      <header class="gc-deployment-page__state-header">
        <div>
          <p>真实状态闭环</p>
          <h2>{{ selectedPlan.name }}</h2>
          <span>planId：{{ planIdLabel }} · latestRunId：{{ latestRunIdLabel }}</span>
        </div>
        <GcStatusTag :status="selectedStatus" />
      </header>

      <div class="gc-deployment-page__flow" aria-label="状态流程">
        <span :class="{ 'is-active': ['DRAFT', 'DRY_RUN_FAILED'].includes(selectedStatus) }">create</span>
        <span :class="{ 'is-active': selectedStatus === 'DRY_RUN_PASSED' }">dry-run</span>
        <span :class="{ 'is-active': selectedStatus === 'PENDING_APPROVAL' }">submit / approval</span>
        <span :class="{ 'is-active': ['APPROVED', 'READY', 'RUNNING'].includes(selectedStatus) }">execute</span>
        <span :class="{ 'is-active': ['FAILED', 'SUCCEEDED', 'CANCELED', 'ROLLED_BACK', 'ROLLBACK_FAILED'].includes(selectedStatus) }">cancel / retry / rollback</span>
      </div>

      <dl class="gc-deployment-page__facts">
        <div><dt>approvalId</dt><dd>{{ approvalIdLabel }}</dd></div>
        <div><dt>snapshotHash</dt><dd>{{ snapshotHashLabel }}</dd></div>
        <div><dt>失败原因</dt><dd>{{ failureReasonLabel }}</dd></div>
        <div><dt>最近 requestId</dt><dd>{{ actionRequestId || '等待操作' }}</dd></div>
      </dl>

      <p v-if="selectedStatus === 'PENDING_APPROVAL'" class="gc-deployment-page__approval">
        已提交并等待审批。approvalId 可见后，审批通过才显示执行入口；这不是自动执行。
      </p>
      <p v-if="actionError" class="gc-deployment-page__error">
        操作失败：{{ actionError.message }}；错误码：{{ actionError.errorCode }}；requestId：{{ actionError.requestId }}
      </p>

      <div v-if="visiblePlanActions.length" class="gc-deployment-page__actions" aria-label="状态化操作">
        <template v-for="action in visiblePlanActions" :key="action.key">
          <button
            v-if="planActionDisabledReason(action, selectedPlan)"
            class="gc-button"
            type="button"
            disabled
            :title="planActionDisabledReason(action, selectedPlan)"
          >
            {{ action.label }}（{{ planActionDisabledReason(action, selectedPlan) }}）
          </button>
          <GcConfirmAction
            v-else-if="action.danger || action.confirmText"
            :action-name="actionPendingKey === action.key ? '处理中…' : action.label"
            :impact-count="1"
            :risk-text="action.riskText"
            :confirm-text="action.confirmText"
            @confirm="runPlanAction(action.key)"
          />
          <GcPermissionButton v-else :permission="action.permission" :disabled="Boolean(actionPendingKey)" @click="runPlanAction(action.key)">
            {{ actionPendingKey === action.key ? '处理中…' : action.label }}
          </GcPermissionButton>
        </template>
      </div>
      <p v-else class="gc-deployment-page__muted">当前状态没有可执行动作，或账号缺少对应权限。</p>
    </section>

    <section v-if="selectedPlan" class="gc-card gc-deployment-page__detail" aria-label="部署计划详情增强">
      <header>
        <p>计划详情增强</p>
        <h2>targets / runs / steps</h2>
      </header>
      <div class="gc-deployment-page__detail-grid">
        <article v-for="block in detailBlocks" :key="block.key">
          <h3>{{ block.title }}</h3>
          <pre>{{ block.text }}</pre>
        </article>
      </div>
    </section>
  </section>
</template>

<style scoped>
.gc-deployment-page { display: grid; gap: var(--gc-space-5); }
.gc-deployment-page__state, .gc-deployment-page__detail { display: grid; gap: var(--gc-space-4); padding: 26px; }
.gc-deployment-page__state-header { display: flex; justify-content: space-between; gap: var(--gc-space-4); align-items: flex-start; }
.gc-deployment-page__state-header p, .gc-deployment-page__state-header h2, .gc-deployment-page__detail p, .gc-deployment-page__detail h2 { margin: 0; }
.gc-deployment-page__state-header h2, .gc-deployment-page__detail h2 { margin-top: var(--gc-space-1); letter-spacing: -0.04em; }
.gc-deployment-page__state-header p, .gc-deployment-page__state-header span, .gc-deployment-page__detail p { color: var(--gc-color-text-muted); font-weight: 800; }
.gc-deployment-page__flow { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.gc-deployment-page__flow span { border: 1px solid var(--gc-color-border); border-radius: 999px; padding: 7px 11px; color: var(--gc-color-text-muted); background: var(--gc-color-surface-soft); font-size: var(--gc-font-size-sm); font-weight: 850; }
.gc-deployment-page__flow span.is-active { border-color: #bfdbfe; color: var(--gc-color-primary); background: var(--gc-color-primary-weak); }
.gc-deployment-page__facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: var(--gc-space-3); margin: 0; }
.gc-deployment-page__facts div { border: 1px solid var(--gc-color-border); border-radius: 14px; padding: 12px; background: var(--gc-color-surface-soft); }
.gc-deployment-page__facts dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 850; }
.gc-deployment-page__facts dd { margin: var(--gc-space-1) 0 0; overflow-wrap: anywhere; font-weight: 800; }
.gc-deployment-page__approval { margin: 0; border: 1px solid #fde68a; border-radius: 14px; padding: 12px 14px; color: #92400e; background: #fffbeb; font-weight: 800; }
.gc-deployment-page__error { margin: 0; border: 1px solid #fecaca; border-radius: 14px; padding: 12px 14px; color: var(--gc-color-danger); background: var(--gc-color-danger-bg); font-weight: 800; }
.gc-deployment-page__actions { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.gc-deployment-page__muted { margin: 0; color: var(--gc-color-text-muted); }
.gc-deployment-page__detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--gc-space-3); }
.gc-deployment-page__detail article { display: grid; gap: var(--gc-space-2); border: 1px solid var(--gc-color-border); border-radius: 14px; padding: 14px; background: var(--gc-color-surface-soft); }
.gc-deployment-page__detail h3 { margin: 0; font-size: 15px; }
.gc-deployment-page__detail pre { min-height: 120px; max-height: 260px; margin: 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 750 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: var(--gc-color-text-muted); }
</style>

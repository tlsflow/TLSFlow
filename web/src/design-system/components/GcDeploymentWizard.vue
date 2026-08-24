<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ApiRecord } from '@/api/modules/common'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import type { CapabilityMatrixItem } from './GcCapabilityMatrix.vue'
import type { DeploymentWizardPlan } from './GcDeploymentWizard.types'

type WizardStep = 1 | 2 | 3

const props = withDefaults(defineProps<{
  certificates: readonly ApiRecord[]
  certificateVersions: readonly ApiRecord[]
  certificateFormats: readonly ApiRecord[]
  targets: readonly ApiRecord[]
  loading?: boolean
  dryRunRequestId?: string
  submitRequestId?: string
  approvalHint?: string
  initialCertificateId?: string | null
  dryRunChecks?: readonly ApiRecord[]
}>(), {
  loading: false,
  dryRunRequestId: '',
  submitRequestId: '',
  approvalHint: '',
  initialCertificateId: null,
  dryRunChecks: () => [],
})

const emit = defineEmits<{
  save: [plan: DeploymentWizardPlan]
  dryRun: [plan: DeploymentWizardPlan]
  submit: [plan: DeploymentWizardPlan]
  execute: [plan: DeploymentWizardPlan]
}>()

const LATEST_VERSION_MARKER = '__LATEST__'

const currentStep = ref<WizardStep>(1)
const selectedCertificateId = ref('')
const selectedCertificateVersionId = ref('')
const selectedCertificateFormatId = ref('')
const selectedTargetId = ref('')
const targetKeyword = ref('')

watch(() => props.initialCertificateId, (value) => {
  if (value) selectedCertificateId.value = value
}, { immediate: true })

watch(() => props.certificates, (items) => {
  if (!selectedCertificateId.value && items[0]) {
    selectedCertificateId.value = readString(items[0], ['id', 'certificateId'])
  }
}, { immediate: true })

const filteredVersions = computed(() => {
  if (!selectedCertificateId.value) return []
  return props.certificateVersions.filter((item) => readString(item, ['certificateAssetId', 'certificateId']) === selectedCertificateId.value)
})

const sortedVersions = computed(() =>
  [...filteredVersions.value].sort((left, right) => {
    const rightNotAfter = Date.parse(readString(right, ['notAfter', 'validTo', 'expiresAt']))
    const leftNotAfter = Date.parse(readString(left, ['notAfter', 'validTo', 'expiresAt']))
    if (Number.isFinite(rightNotAfter) && Number.isFinite(leftNotAfter) && rightNotAfter !== leftNotAfter) return rightNotAfter - leftNotAfter

    const rightCreatedAt = Date.parse(readString(right, ['createdAt', 'issuedAt']))
    const leftCreatedAt = Date.parse(readString(left, ['createdAt', 'issuedAt']))
    if (Number.isFinite(rightCreatedAt) && Number.isFinite(leftCreatedAt) && rightCreatedAt !== leftCreatedAt) return rightCreatedAt - leftCreatedAt

    return readString(right, ['id']).localeCompare(readString(left, ['id']))
  }),
)

const latestVersion = computed(() => sortedVersions.value[0] ?? null)

watch(sortedVersions, (items) => {
  if (selectedCertificateVersionId.value === LATEST_VERSION_MARKER && latestVersion.value) return
  if (items.some((item) => readString(item, ['id', 'certificateVersionId']) === selectedCertificateVersionId.value)) return
  selectedCertificateVersionId.value = latestVersion.value ? LATEST_VERSION_MARKER : ''
}, { immediate: true })

const resolvedCertificateVersionId = computed(() =>
  selectedCertificateVersionId.value === LATEST_VERSION_MARKER
    ? readString(latestVersion.value, ['id', 'certificateVersionId'])
    : selectedCertificateVersionId.value,
)

const filteredFormats = computed(() => {
  if (!resolvedCertificateVersionId.value) return []
  return props.certificateFormats
})

watch(filteredFormats, (items) => {
  const preferred = items.find((item) => readString(item, ['certificateVersionId']) === resolvedCertificateVersionId.value)
  if (items.some((item) => readString(item, ['id']) === selectedCertificateFormatId.value)) return
  selectedCertificateFormatId.value = readString(preferred ?? items[0] ?? null, ['id'])
}, { immediate: true })

const filteredTargets = computed(() => {
  const keyword = targetKeyword.value.trim().toLowerCase()
  if (!keyword) return props.targets
  return props.targets.filter((item) => {
    const haystack = [
      readString(item, ['name', 'displayName', 'domainName']),
      readString(item, ['siteName']),
      readString(item, ['bindingName', 'bindingSummary']),
      readString(item, ['managedTargetLabel', 'managedTargetId']),
    ].join(' ').toLowerCase()
    return haystack.includes(keyword)
  })
})

watch(filteredTargets, (items) => {
  if (items.some((item) => readString(item, ['id']) === selectedTargetId.value)) return
  selectedTargetId.value = items[0] ? readString(items[0], ['id']) : ''
}, { immediate: true })

const selectedTargets = computed(() =>
  props.targets.filter((item) => readString(item, ['id']) === selectedTargetId.value),
)

const selectedCertificate = computed(() =>
  props.certificates.find((item) => readString(item, ['id', 'certificateId']) === selectedCertificateId.value) ?? null,
)
const selectedVersion = computed(() =>
  props.certificateVersions.find((item) => readString(item, ['id', 'certificateVersionId']) === resolvedCertificateVersionId.value) ?? null,
)
const selectedFormat = computed(() =>
  props.certificateFormats.find((item) => readString(item, ['id']) === selectedCertificateFormatId.value) ?? null,
)
const selectedTarget = computed(() => selectedTargets.value[0] ?? null)

const stepOneReady = computed(() => Boolean(
  selectedCertificateId.value
  && resolvedCertificateVersionId.value
  && selectedCertificateFormatId.value,
))
const stepTwoReady = computed(() => Boolean(stepOneReady.value && selectedTargetId.value))
const currentAvailableStep = computed<WizardStep>(() => {
  if (!stepOneReady.value) return 1
  if (!stepTwoReady.value) return 2
  return 3
})

watch(currentAvailableStep, (step) => {
  if (currentStep.value > step) currentStep.value = step
}, { immediate: true })

const capabilityItems = computed<CapabilityMatrixItem[]>(() => [{
  key: 'target-selection',
  label: '部署目标选择',
  state: selectedTargets.value.length > 0 ? 'manualRisk' : 'missing',
  level: 'L3',
  source: '部署目标',
  detail: selectedTargets.value.length > 0 ? '已选择部署目标，建议先完成 dry-run 再提交执行。' : '尚未选择部署目标。',
}])

const previewSummary = computed(() => {
  if (!stepOneReady.value) return '先完成证书材料选择。'
  if (!stepTwoReady.value) return '完成证书材料选择后，再指定要下发的应用资产目标。'
  return `将把 ${formatConfigName(selectedFormat.value)} 对应的证书材料部署到 ${selectedTargets.value.length} 个应用资产目标。`
})

const formatHint = computed(() => {
  if (!selectedCertificateId.value) return ''
  if (filteredFormats.value.length > 0) return ''
  return '当前没有可选的证书产物配置，请先创建对应配置。'
})

const canOperate = computed(() => Boolean(
  selectedCertificateId.value
  && resolvedCertificateVersionId.value
  && selectedCertificateFormatId.value
  && selectedTargetId.value,
))

const dryRunCheckSummary = computed(() => props.dryRunChecks.reduce<{
  passed: number
  failed: number
  warning: number
  unknown: number
}>((summary, item) => {
  const status = String(item.status ?? 'unknown')
  if (status === 'passed') summary.passed += 1
  else if (status === 'failed') summary.failed += 1
  else if (status === 'warning') summary.warning += 1
  else summary.unknown += 1
  return summary
}, { passed: 0, failed: 0, warning: 0, unknown: 0 }))

const hasDryRunChecks = computed(() => props.dryRunChecks.length > 0)
const latestStatusText = computed(() => {
  if (props.approvalHint) return props.approvalHint
  if (hasDryRunChecks.value) return '预检结果已返回，可根据结果决定保存、提交或直接执行。'
  if (props.dryRunRequestId) return 'Dry-run 已发起，请在执行结果面板中查看进度。'
  if (props.submitRequestId) return '计划已提交。'
  return '建议先发起 dry-run，再决定是否提交执行。'
})

const readinessTone = computed(() => {
  if (hasDryRunChecks.value && dryRunCheckSummary.value.failed > 0) return 'danger'
  if (hasDryRunChecks.value && dryRunCheckSummary.value.warning > 0) return 'warning'
  if (hasDryRunChecks.value && dryRunCheckSummary.value.passed > 0) return 'success'
  if (canOperate.value) return 'info'
  return 'muted'
})

const canGoPrevious = computed(() => currentStep.value > 1)
const canGoNext = computed(() => (
  (currentStep.value === 1 && stepOneReady.value)
  || (currentStep.value === 2 && stepTwoReady.value)
))
const progressPercent = computed(() => `${(currentStep.value / 3) * 100}%`)

function buildPlan(): DeploymentWizardPlan {
  const primaryTarget = selectedTargets.value[0]
  return {
    certificateId: selectedCertificateId.value,
    certificateVersionId: resolvedCertificateVersionId.value,
    certificateFormatId: selectedCertificateFormatId.value,
    targetIds: selectedTargetId.value ? [selectedTargetId.value] : [],
    applicationAssetId: readString(primaryTarget, ['applicationAssetId']) || undefined,
    selectionMode: selectedCertificateVersionId.value === LATEST_VERSION_MARKER ? 'LATEST_AUTO' : 'EXPLICIT',
    capabilityItems: capabilityItems.value,
    dryRunChecks: props.dryRunChecks,
    previewSummary: previewSummary.value,
    dryRunSummary: props.dryRunRequestId ? '最近一次 dry-run 已完成。' : undefined,
    submitSummary: props.submitRequestId ? '最近一次提交已完成。' : undefined,
  }
}

function goToStep(step: WizardStep) {
  if (step > currentAvailableStep.value) return
  currentStep.value = step
}

function goPrevious() {
  if (currentStep.value === 2) currentStep.value = 1
  else if (currentStep.value === 3) currentStep.value = 2
}

function goNext() {
  if (currentStep.value === 1 && stepOneReady.value) currentStep.value = 2
  else if (currentStep.value === 2 && stepTwoReady.value) currentStep.value = 3
}

function versionLabel(item: ApiRecord): string {
  const id = readString(item, ['id', 'certificateVersionId'], '未命名版本')
  const notBefore = formatDate(readString(item, ['notBefore', 'validFrom', 'issuedAt']))
  const notAfter = formatDate(readString(item, ['notAfter', 'validTo', 'expiresAt']))
  if (!notBefore && !notAfter) return id
  return `${id} (${notBefore || '未知开始'} ~ ${notAfter || '未知结束'})`
}

function formatLabel(item: ApiRecord): string {
  const format = readString(item, ['format'], 'unknown').toUpperCase()
  const privateKey = readBoolean(item, ['containsPrivateKey']) ? '含私钥' : '无私钥'
  const extraPrivateKeyFile = readBoolean(item, ['parameters.generatePrivateKeyFile']) ? '额外私钥文件' : ''
  const configName = formatConfigName(item)
  const runtime = runtimeSummary(item)
  const extension = readString(item, ['parameters.extension'])
  return [configName, format, privateKey, extraPrivateKeyFile, runtime, extension ? `.${extension}` : ''].filter(Boolean).join(' / ')
}

function targetLabel(item: ApiRecord): string {
  const name = readString(item, ['name', 'displayName', 'domainName'], readString(item, ['id']))
  const siteName = readString(item, ['siteName'], '未命名站点')
  const binding = readString(item, ['bindingName', 'bindingSummary'], '未提供绑定信息')
  return `${name} / ${siteName} / ${binding}`
}

function formatConfigName(item: ApiRecord | null | undefined): string {
  return readString(item, ['parameters.configName', 'parameters.alias', 'parameters.friendlyName', 'name'], '未命名配置')
}

function runtimeSummary(item: ApiRecord | null | undefined): string {
  return [readString(item, ['parameters.systemPlatform']), readString(item, ['parameters.runtimePlatform'])].filter(Boolean).join(' / ')
}

function formatDate(value: string): string {
  if (!value) return ''
  return formatBrowserLocalTime(value, { includeTime: false }) || value
}

function stepState(step: WizardStep): 'done' | 'active' | 'pending' {
  if (step < currentStep.value) return 'done'
  if (step === currentStep.value) return 'active'
  return 'pending'
}

function stepStateLabel(step: WizardStep): string {
  const state = stepState(step)
  if (state === 'done') return '已完成'
  if (state === 'active') return '进行中'
  return '待开始'
}

function readCheckDetail(item: ApiRecord): string {
  const detail = item.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') return JSON.stringify(detail)
  return ''
}

function readPath(record: ApiRecord | null | undefined, path: string): unknown {
  if (!record) return undefined
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, record)
}

function readString(record: ApiRecord | null | undefined, candidates: readonly string[], fallback = ''): string {
  for (const key of candidates) {
    const value = readPath(record, key)
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }
  return fallback
}

function readBoolean(record: ApiRecord | null | undefined, candidates: readonly string[]): boolean {
  for (const key of candidates) {
    const value = readPath(record, key)
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') return value === 'true'
  }
  return false
}
</script>

<template>
  <section class="gc-card gc-deployment-wizard" aria-label="部署向导">
    <header class="gc-deployment-wizard__header">
      <div class="gc-deployment-wizard__title">
        <span class="gc-deployment-wizard__eyebrow">部署向导</span>
        <strong>分步骤完成部署计划配置</strong>
        <p>把证书材料、部署目标和执行前预检拆开处理，减少一次性堆叠的输入干扰。</p>
      </div>
      <div class="gc-deployment-wizard__header-meta">
        <span class="gc-deployment-wizard__status" :class="`is-${readinessTone}`">
          步骤 {{ currentStep }} / 3
        </span>
        <span class="gc-deployment-wizard__count">已选 {{ selectedTargets.length }} 个目标</span>
      </div>
    </header>

    <div class="gc-deployment-wizard__progress">
      <div class="gc-deployment-wizard__progress-bar">
        <span class="gc-deployment-wizard__progress-fill" :style="{ width: progressPercent }"></span>
      </div>
      <ol class="gc-deployment-wizard__steps" aria-label="部署步骤">
        <li class="gc-deployment-wizard__step" :class="`is-${stepState(1)}`">
          <button type="button" class="gc-deployment-wizard__step-button" @click="goToStep(1)">
            <span class="gc-deployment-wizard__step-index">1</span>
            <div class="gc-deployment-wizard__step-copy">
              <strong>选择证书材料</strong>
              <p>证书资产、版本、产物配置</p>
              <span class="gc-deployment-wizard__step-state">{{ stepStateLabel(1) }}</span>
            </div>
          </button>
        </li>
        <li class="gc-deployment-wizard__step" :class="`is-${stepState(2)}`">
          <button type="button" class="gc-deployment-wizard__step-button" :disabled="currentAvailableStep < 2" @click="goToStep(2)">
            <span class="gc-deployment-wizard__step-index">2</span>
            <div class="gc-deployment-wizard__step-copy">
              <strong>选择部署目标</strong>
              <p>应用资产、站点与绑定</p>
              <span class="gc-deployment-wizard__step-state">{{ stepStateLabel(2) }}</span>
            </div>
          </button>
        </li>
        <li class="gc-deployment-wizard__step" :class="`is-${stepState(3)}`">
          <button type="button" class="gc-deployment-wizard__step-button" :disabled="currentAvailableStep < 3" @click="goToStep(3)">
            <span class="gc-deployment-wizard__step-index">3</span>
            <div class="gc-deployment-wizard__step-copy">
              <strong>预检并提交</strong>
              <p>Dry-run、保存、提交、执行</p>
              <span class="gc-deployment-wizard__step-state">{{ stepStateLabel(3) }}</span>
            </div>
          </button>
        </li>
      </ol>
    </div>

    <section class="gc-deployment-wizard__panel">
      <template v-if="currentStep === 1">
        <header class="gc-deployment-wizard__panel-header">
          <div>
            <h3>1. 证书材料</h3>
            <p>先确定本次部署使用的证书资产、证书版本和产物配置。</p>
          </div>
          <span class="gc-deployment-wizard__panel-state" :class="`is-${stepOneReady ? 'done' : 'active'}`">
            {{ stepOneReady ? '可进入下一步' : '待完成' }}
          </span>
        </header>

        <div class="gc-deployment-wizard__field-grid">
          <label class="gc-form-field">
            <span>证书资产</span>
            <select v-model="selectedCertificateId" :disabled="loading">
              <option v-for="item in certificates" :key="readString(item, ['id', 'certificateId'])" :value="readString(item, ['id', 'certificateId'])">
                {{ readString(item, ['primaryDomain', 'name', 'commonName'], readString(item, ['id'])) }}
              </option>
            </select>
          </label>

          <label class="gc-form-field">
            <span>证书版本</span>
            <select v-model="selectedCertificateVersionId" :disabled="loading || sortedVersions.length === 0">
              <option v-if="latestVersion" :value="LATEST_VERSION_MARKER">
                自动选择最新可部署证书 / {{ versionLabel(latestVersion) }}
              </option>
              <option v-for="item in sortedVersions" :key="readString(item, ['id', 'certificateVersionId'])" :value="readString(item, ['id', 'certificateVersionId'])">
                {{ versionLabel(item) }}
              </option>
            </select>
          </label>

          <label class="gc-form-field gc-deployment-wizard__field-span-2">
            <span>证书产物配置</span>
            <select v-model="selectedCertificateFormatId" :disabled="loading || filteredFormats.length === 0">
              <option v-for="item in filteredFormats" :key="readString(item, ['id'])" :value="readString(item, ['id'])">
                {{ formatLabel(item) }}
              </option>
            </select>
          </label>
        </div>

        <p v-if="formatHint" class="gc-deployment-wizard__hint">{{ formatHint }}</p>

        <div class="gc-deployment-wizard__summary-grid">
          <div class="gc-deployment-wizard__summary-item">
            <span>证书资产</span>
            <strong>{{ readString(selectedCertificate, ['primaryDomain', 'name', 'commonName'], '未选择') }}</strong>
          </div>
          <div class="gc-deployment-wizard__summary-item">
            <span>证书版本</span>
            <strong>{{ selectedVersion ? versionLabel(selectedVersion) : '未选择' }}</strong>
          </div>
          <div class="gc-deployment-wizard__summary-item">
            <span>产物配置</span>
            <strong>{{ formatConfigName(selectedFormat) }}</strong>
            <small>{{ selectedFormat ? formatLabel(selectedFormat) : '未选择' }}</small>
          </div>
        </div>
      </template>

      <template v-else-if="currentStep === 2">
        <header class="gc-deployment-wizard__panel-header">
          <div>
            <h3>2. 部署目标</h3>
            <p>选择本次换证要落到哪个应用资产目标。</p>
          </div>
          <span class="gc-deployment-wizard__panel-state" :class="`is-${stepTwoReady ? 'done' : 'active'}`">
            {{ stepTwoReady ? '可进入下一步' : '待完成' }}
          </span>
        </header>

        <div class="gc-deployment-wizard__compact-review">
          <div class="gc-deployment-wizard__compact-review-head">
            <span>当前证书材料</span>
            <strong>{{ readString(selectedCertificate, ['primaryDomain', 'name', 'commonName'], '未选择') }}</strong>
          </div>
          <div class="gc-deployment-wizard__tag-row">
            <span class="gc-deployment-wizard__tag">
              {{ selectedCertificateVersionId === LATEST_VERSION_MARKER ? '自动最新版本' : '固定版本' }}
            </span>
            <span class="gc-deployment-wizard__tag">
              {{ readString(selectedFormat, ['format'], 'unknown').toUpperCase() }}
            </span>
            <span class="gc-deployment-wizard__tag">
              {{ readBoolean(selectedFormat, ['parameters.generatePrivateKeyFile']) ? '分离私钥文件' : '单文件产物' }}
            </span>
          </div>
          <small>{{ selectedFormat ? formatLabel(selectedFormat) : '未选择产物配置' }}</small>
        </div>

        <div class="gc-deployment-wizard__field-grid">
          <label class="gc-form-field gc-deployment-wizard__field-span-2">
            <span>关键字检索</span>
            <input v-model.trim="targetKeyword" type="text" :disabled="loading || targets.length === 0" placeholder="按域名、站点、绑定信息检索" />
          </label>

          <label class="gc-form-field gc-deployment-wizard__field-span-2">
            <span>应用资产部署目标</span>
            <select v-model="selectedTargetId" :disabled="loading || filteredTargets.length === 0">
              <option value="">{{ filteredTargets.length === 0 ? '暂无可选应用资产目标' : '请选择应用资产目标' }}</option>
              <option v-for="item in filteredTargets" :key="readString(item, ['id'])" :value="readString(item, ['id'])">
                {{ targetLabel(item) }}
              </option>
            </select>
          </label>
        </div>

        <div v-if="selectedTarget" class="gc-deployment-wizard__target-card">
          <div class="gc-deployment-wizard__target-head">
            <strong>{{ readString(selectedTarget, ['name', 'displayName', 'domainName'], readString(selectedTarget, ['id'])) }}</strong>
            <span>{{ readString(selectedTarget, ['managedTargetLabel', 'managedTargetId'], '未识别受管目标') }}</span>
          </div>
          <dl class="gc-deployment-wizard__target-meta">
            <div>
              <dt>站点</dt>
              <dd>{{ readString(selectedTarget, ['siteName'], '未命名站点') }}</dd>
            </div>
            <div>
              <dt>绑定</dt>
              <dd>{{ readString(selectedTarget, ['bindingName', 'bindingSummary'], '未提供绑定信息') }}</dd>
            </div>
          </dl>
        </div>
        <p v-else class="gc-deployment-wizard__empty">请选择一个应用资产部署目标。</p>
      </template>

      <template v-else>
        <header class="gc-deployment-wizard__panel-header">
          <div>
            <h3>3. 预检与提交</h3>
            <p>确认计划内容后发起 dry-run、保存计划、提交审批或直接执行。</p>
          </div>
          <span class="gc-deployment-wizard__panel-state" :class="`is-${canOperate ? 'active' : 'pending'}`">
            {{ canOperate ? '可操作' : '待完成前置选择' }}
          </span>
        </header>

        <dl class="gc-deployment-wizard__review-list">
          <div>
            <dt>证书资产</dt>
            <dd>{{ readString(selectedCertificate, ['primaryDomain', 'name', 'commonName'], '未选择') }}</dd>
          </div>
          <div>
            <dt>证书版本</dt>
            <dd>{{ selectedVersion ? versionLabel(selectedVersion) : '未选择' }}</dd>
          </div>
          <div>
            <dt>产物配置</dt>
            <dd>{{ selectedFormat ? formatLabel(selectedFormat) : '未选择' }}</dd>
          </div>
          <div>
            <dt>部署目标</dt>
            <dd>{{ selectedTarget ? targetLabel(selectedTarget) : '未选择' }}</dd>
          </div>
        </dl>

        <p class="gc-deployment-wizard__preview-text">{{ previewSummary }}</p>

        <div class="gc-deployment-wizard__feedback-inline" :class="`is-${readinessTone}`">
          <strong>当前状态</strong>
          <p>{{ latestStatusText }}</p>
        </div>

        <div v-if="hasDryRunChecks" class="gc-deployment-wizard__check-summary">
          <span class="gc-deployment-wizard__check-pill is-passed">通过 {{ dryRunCheckSummary.passed }}</span>
          <span class="gc-deployment-wizard__check-pill is-warning">警告 {{ dryRunCheckSummary.warning }}</span>
          <span class="gc-deployment-wizard__check-pill is-failed">失败 {{ dryRunCheckSummary.failed }}</span>
          <span class="gc-deployment-wizard__check-pill is-unknown">未知 {{ dryRunCheckSummary.unknown }}</span>
        </div>

        <ul v-if="hasDryRunChecks" class="gc-deployment-wizard__check-list">
          <li v-for="item in dryRunChecks" :key="String(item.key ?? item.label ?? item.id)" class="gc-deployment-wizard__check-item">
            <div class="gc-deployment-wizard__check-head">
              <strong>{{ String(item.label ?? item.key ?? '未命名检查项') }}</strong>
              <span class="gc-deployment-wizard__check-status" :class="`is-${String(item.status ?? 'unknown')}`">
                {{ String(item.status ?? 'unknown') }}
              </span>
            </div>
            <p v-if="readCheckDetail(item)">{{ readCheckDetail(item) }}</p>
          </li>
        </ul>
      </template>
    </section>

    <footer class="gc-deployment-wizard__footer">
      <button class="gc-button" type="button" :disabled="!canGoPrevious || loading" @click="goPrevious">上一步</button>

      <div class="gc-deployment-wizard__footer-actions">
        <button v-if="currentStep < 3" class="gc-button gc-button--primary" type="button" :disabled="!canGoNext || loading" @click="goNext">下一步</button>
        <template v-else>
          <button class="gc-button gc-button--primary" type="button" :disabled="!canOperate || loading" @click="emit('dryRun', buildPlan())">先做 Dry-run</button>
          <button class="gc-button" type="button" :disabled="!canOperate || loading" @click="emit('save', buildPlan())">保存计划</button>
          <button class="gc-button" type="button" :disabled="!canOperate || loading" @click="emit('submit', buildPlan())">提交计划</button>
          <button class="gc-button gc-button--danger" type="button" :disabled="!canOperate || loading" @click="emit('execute', buildPlan())">提交并执行</button>
        </template>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.gc-deployment-wizard {
  display: grid;
  gap: 16px;
  padding: 8px;
  border-radius: 20px;
  background:
    radial-gradient(circle at top right, rgb(219 234 254 / 52%), transparent 30%),
    linear-gradient(180deg, rgb(248 250 252 / 98%), rgb(241 245 249 / 94%));
}

.gc-deployment-wizard__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  padding: 2px 4px 0;
}

.gc-deployment-wizard__eyebrow {
  display: inline-flex;
  margin-bottom: 10px;
  color: rgb(10 132 255);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.gc-deployment-wizard__title strong {
  display: block;
  font-size: 24px;
  line-height: 1.15;
  letter-spacing: 0;
}

.gc-deployment-wizard__title p {
  max-width: 700px;
  margin: 6px 0 0;
  color: var(--gc-color-text-muted);
  font-size: 14px;
  line-height: 1.5;
}

.gc-deployment-wizard__header-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: flex-end;
}

.gc-deployment-wizard__status,
.gc-deployment-wizard__panel-state,
.gc-deployment-wizard__check-status,
.gc-deployment-wizard__step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
}

.gc-deployment-wizard__status,
.gc-deployment-wizard__panel-state,
.gc-deployment-wizard__check-status {
  padding: 6px 12px;
  border: 1px solid transparent;
  box-shadow: 0 6px 14px rgb(15 23 42 / 6%);
}

.gc-deployment-wizard__status.is-success,
.gc-deployment-wizard__panel-state.is-done,
.gc-deployment-wizard__check-status.is-passed {
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
  border-color: rgb(52 199 89 / 18%);
}

.gc-deployment-wizard__status.is-warning,
.gc-deployment-wizard__check-status.is-warning {
  color: var(--gc-color-warning);
  background: var(--gc-color-warning-bg);
  border-color: rgb(245 158 11 / 18%);
}

.gc-deployment-wizard__status.is-danger,
.gc-deployment-wizard__check-status.is-failed {
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  border-color: rgb(239 68 68 / 18%);
}

.gc-deployment-wizard__status.is-info,
.gc-deployment-wizard__panel-state.is-active {
  color: var(--gc-color-info);
  background: var(--gc-color-info-bg);
  border-color: rgb(10 132 255 / 18%);
}

.gc-deployment-wizard__status.is-muted,
.gc-deployment-wizard__panel-state.is-pending,
.gc-deployment-wizard__check-status.is-unknown {
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-muted);
  border-color: rgb(148 163 184 / 14%);
}

.gc-deployment-wizard__count {
  color: var(--gc-color-text-muted);
  font-size: 13px;
  font-weight: 600;
  padding: 5px 10px;
  border: 1px solid rgb(226 232 240 / 88%);
  border-radius: 999px;
  background: rgb(255 255 255 / 76%);
}

.gc-deployment-wizard__progress {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgb(255 255 255 / 65%);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 92%), rgb(248 250 252 / 88%));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 75%),
    0 8px 20px rgb(15 23 42 / 5%);
}

.gc-deployment-wizard__progress-bar {
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: rgb(226 232 240 / 88%);
  overflow: hidden;
}

.gc-deployment-wizard__progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgb(10 132 255), rgb(64 156 255));
  box-shadow: 0 0 0 1px rgb(255 255 255 / 18%) inset;
  transition: width 180ms ease;
}

.gc-deployment-wizard__steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.gc-deployment-wizard__step {
  position: relative;
  border: 1px solid rgb(226 232 240 / 90%);
  border-radius: 14px;
  background: rgb(255 255 255 / 84%);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 78%),
    0 6px 14px rgb(15 23 42 / 4%);
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.gc-deployment-wizard__step::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  border-radius: 14px 0 0 14px;
  background: transparent;
}

.gc-deployment-wizard__step-button {
  display: flex;
  width: 100%;
  gap: 10px;
  align-items: center;
  min-height: 76px;
  padding: 12px 14px;
  border: 0;
  outline: 0;
  appearance: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.gc-deployment-wizard__step-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.gc-deployment-wizard__step-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.gc-deployment-wizard__step strong {
  display: block;
  font-size: 15px;
  line-height: 1.2;
}

.gc-deployment-wizard__step p {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.35;
}

.gc-deployment-wizard__step-state {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  margin-top: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgb(241 245 249);
  color: rgb(100 116 139);
  font-size: 11px;
  font-weight: 700;
}

.gc-deployment-wizard__step-index {
  width: 30px;
  min-width: 30px;
  height: 30px;
  background: linear-gradient(180deg, rgb(255 255 255), rgb(241 245 249));
  color: var(--gc-color-text-muted);
  border: 1px solid rgb(203 213 225 / 92%);
  box-shadow: 0 4px 10px rgb(15 23 42 / 6%);
}

.gc-deployment-wizard__step.is-active {
  border-color: rgb(10 132 255 / 24%);
  background: linear-gradient(180deg, rgb(239 246 255 / 96%), rgb(248 250 252 / 92%));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 82%),
    0 10px 18px rgb(10 132 255 / 10%);
  transform: translateY(-1px);
}

.gc-deployment-wizard__step.is-active::before {
  background: linear-gradient(180deg, rgb(10 132 255), rgb(64 156 255));
}

.gc-deployment-wizard__step.is-active .gc-deployment-wizard__step-index,
.gc-deployment-wizard__step.is-done .gc-deployment-wizard__step-index {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(180deg, rgb(10 132 255), rgb(64 156 255));
  box-shadow: 0 6px 14px rgb(10 132 255 / 18%);
}

.gc-deployment-wizard__step.is-active .gc-deployment-wizard__step-state {
  background: rgb(219 234 254);
  color: rgb(29 78 216);
}

.gc-deployment-wizard__step.is-done {
  border-color: rgb(52 199 89 / 22%);
  background: linear-gradient(180deg, rgb(240 253 244 / 96%), rgb(248 250 252 / 92%));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 82%),
    0 8px 16px rgb(52 199 89 / 8%);
}

.gc-deployment-wizard__step.is-done::before {
  background: linear-gradient(180deg, rgb(52 199 89), rgb(74 222 128));
}

.gc-deployment-wizard__step.is-done .gc-deployment-wizard__step-state {
  background: rgb(220 252 231);
  color: rgb(21 128 61);
}

.gc-deployment-wizard__panel {
  display: grid;
  gap: 18px;
  min-height: 0;
  border: 1px solid rgb(255 255 255 / 65%);
  border-radius: 20px;
  padding: 20px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 96%), rgb(248 250 252 / 94%));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 75%),
    0 12px 28px rgb(15 23 42 / 6%);
}

.gc-deployment-wizard__panel-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  padding-bottom: 2px;
  border-bottom: 1px solid rgb(226 232 240 / 72%);
}

.gc-deployment-wizard__panel-header h3 {
  margin: 0;
  font-size: 24px;
  line-height: 1.15;
}

.gc-deployment-wizard__panel-header p {
  margin: 6px 0 0;
  color: var(--gc-color-text-muted);
  font-size: 14px;
}

.gc-deployment-wizard__field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.gc-deployment-wizard__field-span-2 {
  grid-column: 1 / -1;
}

.gc-deployment-wizard :deep(.gc-form-field) {
  min-width: 0;
  gap: 8px;
}

.gc-deployment-wizard :deep(.gc-form-field > span) {
  color: rgb(71 85 105);
  font-size: 13px;
  font-weight: 700;
}

.gc-deployment-wizard :deep(.gc-form-field input),
.gc-deployment-wizard :deep(.gc-form-field select) {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 44px;
  box-sizing: border-box;
  border-radius: 12px;
  border-color: rgb(203 213 225 / 90%);
  background: rgb(255 255 255 / 92%);
  box-shadow:
    inset 0 1px 2px rgb(15 23 42 / 4%),
    0 1px 0 rgb(255 255 255 / 8%);
  padding-inline: 14px;
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease,
    background-color 140ms ease;
}

.gc-deployment-wizard :deep(.gc-form-field select) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gc-deployment-wizard :deep(.gc-form-field input:focus),
.gc-deployment-wizard :deep(.gc-form-field select:focus) {
  outline: none;
  border-color: rgb(10 132 255 / 48%);
  box-shadow:
    0 0 0 4px rgb(10 132 255 / 12%),
    inset 0 1px 2px rgb(15 23 42 / 4%);
}

.gc-deployment-wizard__summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.gc-deployment-wizard__summary-item,
.gc-deployment-wizard__compact-review,
.gc-deployment-wizard__target-card,
.gc-deployment-wizard__feedback-inline,
.gc-deployment-wizard__check-item {
  border: 1px solid rgb(226 232 240 / 88%);
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 90%), rgb(248 250 252 / 90%));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 75%),
    0 10px 24px rgb(15 23 42 / 4%);
}

.gc-deployment-wizard__summary-item,
.gc-deployment-wizard__compact-review {
  display: grid;
  gap: 8px;
  padding: 14px;
}

.gc-deployment-wizard__summary-item span,
.gc-deployment-wizard__compact-review span,
.gc-deployment-wizard__review-list dt,
.gc-deployment-wizard__target-meta dt {
  color: var(--gc-color-text-muted);
  font-size: 13px;
  font-weight: 700;
}

.gc-deployment-wizard__summary-item strong,
.gc-deployment-wizard__compact-review strong,
.gc-deployment-wizard__review-list dd,
.gc-deployment-wizard__target-meta dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 16px;
  line-height: 1.25;
}

.gc-deployment-wizard__summary-item small,
.gc-deployment-wizard__compact-review small {
  color: var(--gc-color-text-muted);
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.4;
}

.gc-deployment-wizard__compact-review-head {
  display: grid;
  gap: 6px;
}

.gc-deployment-wizard__tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.gc-deployment-wizard__tag,
.gc-deployment-wizard__check-pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.gc-deployment-wizard__tag {
  border: 1px solid rgb(191 219 254 / 90%);
  background: rgb(239 246 255 / 90%);
  color: rgb(29 78 216);
}

.gc-deployment-wizard__target-card {
  display: grid;
  gap: 12px;
  padding: 16px;
}

.gc-deployment-wizard__target-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
}

.gc-deployment-wizard__target-head strong {
  font-size: 20px;
  line-height: 1.15;
}

.gc-deployment-wizard__target-head span {
  color: var(--gc-color-text-muted);
  font-size: 14px;
  font-weight: 600;
}

.gc-deployment-wizard__target-meta,
.gc-deployment-wizard__review-list {
  display: grid;
  gap: 12px;
  margin: 0;
}

.gc-deployment-wizard__review-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.gc-deployment-wizard__target-meta div,
.gc-deployment-wizard__review-list div {
  display: grid;
  gap: 8px;
}

.gc-deployment-wizard__target-meta div:first-child,
.gc-deployment-wizard__review-list div:first-child {
  padding-top: 0;
}

.gc-deployment-wizard__review-list div {
  padding: 14px 16px;
  border: 1px solid rgb(226 232 240 / 88%);
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 92%), rgb(248 250 252 / 92%));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 72%),
    0 10px 22px rgb(15 23 42 / 4%);
}

.gc-deployment-wizard__target-meta div {
  padding-top: 12px;
  border-top: 1px solid rgb(226 232 240 / 72%);
}

.gc-deployment-wizard__review-list dd,
.gc-deployment-wizard__target-meta dd {
  margin: 0;
  font-size: 15px;
  line-height: 1.4;
}

.gc-deployment-wizard__preview-text,
.gc-deployment-wizard__empty {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 15px;
  line-height: 1.6;
}

.gc-deployment-wizard__feedback-inline {
  display: grid;
  gap: 8px;
  padding: 14px 16px;
}

.gc-deployment-wizard__feedback-inline strong {
  font-size: 15px;
}

.gc-deployment-wizard__feedback-inline p {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 14px;
  line-height: 1.5;
}

.gc-deployment-wizard__feedback-inline.is-success {
  border-color: rgb(52 199 89 / 22%);
  background: linear-gradient(180deg, rgb(240 253 244 / 96%), rgb(248 250 252 / 92%));
}

.gc-deployment-wizard__feedback-inline.is-warning {
  border-color: rgb(245 158 11 / 24%);
  background: linear-gradient(180deg, rgb(255 251 235 / 98%), rgb(248 250 252 / 92%));
}

.gc-deployment-wizard__feedback-inline.is-danger {
  border-color: rgb(239 68 68 / 22%);
  background: linear-gradient(180deg, rgb(254 242 242 / 98%), rgb(248 250 252 / 92%));
}

.gc-deployment-wizard__feedback-inline.is-info {
  border-color: rgb(10 132 255 / 22%);
  background: linear-gradient(180deg, rgb(239 246 255 / 96%), rgb(248 250 252 / 92%));
}

.gc-deployment-wizard__hint {
  margin: 0;
  color: var(--gc-color-danger);
  font-size: 14px;
  font-weight: 700;
}

.gc-deployment-wizard__check-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.gc-deployment-wizard__check-pill {
  border: 1px solid transparent;
}

.gc-deployment-wizard__check-pill.is-passed {
  color: var(--gc-color-success);
  border-color: rgb(52 199 89 / 18%);
  background: var(--gc-color-success-bg);
}

.gc-deployment-wizard__check-pill.is-warning {
  color: var(--gc-color-warning);
  border-color: rgb(245 158 11 / 18%);
  background: var(--gc-color-warning-bg);
}

.gc-deployment-wizard__check-pill.is-failed {
  color: var(--gc-color-danger);
  border-color: rgb(239 68 68 / 18%);
  background: var(--gc-color-danger-bg);
}

.gc-deployment-wizard__check-pill.is-unknown {
  color: var(--gc-color-text-muted);
  border-color: rgb(148 163 184 / 14%);
  background: var(--gc-color-surface-muted);
}

.gc-deployment-wizard__check-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.gc-deployment-wizard__check-item {
  display: grid;
  gap: 10px;
  padding: 14px;
}

.gc-deployment-wizard__check-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.gc-deployment-wizard__check-head strong {
  font-size: 16px;
}

.gc-deployment-wizard__check-item p {
  margin: 0;
  color: var(--gc-color-text-muted);
  line-height: 1.55;
}

.gc-deployment-wizard__footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding: 14px 16px;
  border: 1px solid rgb(255 255 255 / 65%);
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 94%), rgb(248 250 252 / 90%));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 75%),
    0 8px 20px rgb(15 23 42 / 5%);
}

.gc-deployment-wizard__footer-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.gc-deployment-wizard__footer :deep(.gc-button) {
  min-height: 40px;
  padding-inline: 16px;
  border-radius: 12px;
}

@media (max-width: 780px) {
  .gc-deployment-wizard__steps,
  .gc-deployment-wizard__field-grid,
  .gc-deployment-wizard__summary-grid,
  .gc-deployment-wizard__review-list {
    grid-template-columns: minmax(0, 1fr);
  }

  .gc-deployment-wizard__header,
  .gc-deployment-wizard__panel-header,
  .gc-deployment-wizard__target-head,
  .gc-deployment-wizard__footer {
    flex-direction: column;
  }

  .gc-deployment-wizard__header-meta,
  .gc-deployment-wizard__footer-actions {
    justify-content: flex-start;
    width: 100%;
  }

  .gc-deployment-wizard__panel {
    min-height: auto;
    padding: 16px;
  }

  .gc-deployment-wizard__title strong {
    font-size: 22px;
  }

  .gc-deployment-wizard__panel-header h3 {
    font-size: 22px;
  }

  .gc-deployment-wizard__target-head strong,
  .gc-deployment-wizard__summary-item strong,
  .gc-deployment-wizard__compact-review strong {
    font-size: 18px;
  }
}
</style>

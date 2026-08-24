<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ApiRecord } from '@/api/modules/common'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import type { CapabilityMatrixItem } from './GcCapabilityMatrix.vue'
import GcCapabilityMatrix from './GcCapabilityMatrix.vue'
import GcDryRunChecklist from './GcDryRunChecklist.vue'

export interface DeploymentWizardPlan {
  readonly certificateId: string
  readonly certificateVersionId: string
  readonly certificateFormatId: string
  readonly targetIds: readonly string[]
  readonly applicationAssetId?: string
  readonly selectionMode: 'EXPLICIT' | 'LATEST_AUTO'
  readonly capabilityItems: readonly CapabilityMatrixItem[]
  readonly dryRunChecks: readonly ApiRecord[]
  readonly previewSummary?: string
  readonly dryRunSummary?: string
  readonly submitSummary?: string
}

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

const compatibleFormats = computed(() =>
  props.certificateFormats.filter((item) => {
    const format = readString(item, ['format']).toLowerCase()
    if (format !== 'pfx') return false
    if (!readBoolean(item, ['containsPrivateKey'])) return false
    const systemPlatform = readString(item, ['parameters.systemPlatform']).toLowerCase()
    const runtimePlatform = readString(item, ['parameters.runtimePlatform']).toLowerCase()
    return (!systemPlatform || systemPlatform === 'windows') && (!runtimePlatform || runtimePlatform === 'iis')
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
  return compatibleFormats.value
})

watch(filteredFormats, (items) => {
  const preferred = items.find((item) => readString(item, ['format']).toLowerCase() === 'pfx' && readBoolean(item, ['containsPrivateKey']))
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

const capabilityItems = computed<CapabilityMatrixItem[]>(() => [{
  key: 'target-selection',
  label: '部署目标选择',
  state: selectedTargets.value.length > 0 ? 'manualRisk' : 'missing',
  level: 'L3',
  source: '部署目标',
  detail: selectedTargets.value.length > 0 ? '已选择部署目标，但尚未拿到 dry-run 预检结果。' : '尚未选择部署目标。',
}])

const previewSummary = computed(() => {
  if (!selectedCertificateId.value || !resolvedCertificateVersionId.value || !selectedCertificateFormatId.value) return '请先选择证书、证书版本和证书格式配置。'
  if (selectedTargets.value.length === 0) return '请至少选择一个应用资产部署目标。'
  return `将把证书版本 ${versionLabelById(resolvedCertificateVersionId.value)} 的产物部署到 ${selectedTargets.value.length} 个应用资产目标。`
})

const formatHint = computed(() => {
  if (!resolvedCertificateVersionId.value) return ''
  if (filteredFormats.value.length > 0) return ''
  return '当前没有可用于 Windows / IIS 的 PFX 格式配置，请先创建对应的证书格式配置。'
})

const canOperate = computed(() => Boolean(
  selectedCertificateId.value
  && resolvedCertificateVersionId.value
  && selectedCertificateFormatId.value
  && selectedTargetId.value,
))

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

function versionLabel(item: ApiRecord): string {
  const id = readString(item, ['id', 'certificateVersionId'], '未命名版本')
  const notBefore = formatDate(readString(item, ['notBefore', 'validFrom', 'issuedAt']))
  const notAfter = formatDate(readString(item, ['notAfter', 'validTo', 'expiresAt']))
  if (!notBefore && !notAfter) return id
  return `${id} (${notBefore || '未知开始'} ~ ${notAfter || '未知结束'})`
}

function versionLabelById(id: string): string {
  const item = props.certificateVersions.find((entry) => readString(entry, ['id', 'certificateVersionId']) === id)
  return item ? versionLabel(item) : id
}

function formatLabel(item: ApiRecord): string {
  const format = readString(item, ['format'], 'unknown').toUpperCase()
  const privateKey = readBoolean(item, ['containsPrivateKey']) ? '含私钥' : '无私钥'
  const configName = readString(item, ['parameters.configName', 'parameters.alias', 'parameters.friendlyName', 'name'])
  const runtime = [readString(item, ['parameters.systemPlatform']), readString(item, ['parameters.runtimePlatform'])].filter(Boolean).join(' / ')
  const extension = readString(item, ['parameters.extension'])
  return [configName, format, privateKey, runtime, extension ? `.${extension}` : ''].filter(Boolean).join(' / ')
}

function targetLabel(item: ApiRecord): string {
  const name = readString(item, ['name', 'displayName', 'domainName'], readString(item, ['id']))
  const siteName = readString(item, ['siteName'], '未命名站点')
  const binding = readString(item, ['bindingName', 'bindingSummary'], '未提供绑定信息')
  return `${name} / ${siteName} / ${binding}`
}

function formatDate(value: string): string {
  if (!value) return ''
  return formatBrowserLocalTime(value, { includeTime: false }) || value
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
      <div>
        <strong>应用资产部署目标</strong>
        <p>先选证书和证书产物，再选应用资产目标，最后做 dry-run 只读预检。</p>
      </div>
      <span class="gc-deployment-wizard__step">已选 {{ selectedTargets.length }} 个目标</span>
    </header>

    <div class="gc-deployment-wizard__grid">
      <section class="gc-deployment-wizard__column">
        <h3>1. 选择证书</h3>
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
        <label class="gc-form-field">
          <span>证书产物配置</span>
          <select v-model="selectedCertificateFormatId" :disabled="loading || filteredFormats.length === 0">
            <option v-for="item in filteredFormats" :key="readString(item, ['id'])" :value="readString(item, ['id'])">
              {{ formatLabel(item) }}
            </option>
          </select>
        </label>
        <p v-if="formatHint" class="gc-deployment-wizard__hint">{{ formatHint }}</p>
      </section>

      <section class="gc-deployment-wizard__column">
        <h3>2. 选择应用资产部署目标</h3>
        <label class="gc-form-field">
          <span>关键字检索</span>
          <input v-model.trim="targetKeyword" type="text" :disabled="loading || targets.length === 0" placeholder="按域名、站点、绑定信息检索" />
        </label>
        <label class="gc-form-field">
          <span>应用资产部署目标</span>
          <select v-model="selectedTargetId" :disabled="loading || filteredTargets.length === 0">
            <option value="">{{ filteredTargets.length === 0 ? '暂无可选应用资产目标' : '请选择应用资产目标' }}</option>
            <option v-for="item in filteredTargets" :key="readString(item, ['id'])" :value="readString(item, ['id'])">
              {{ targetLabel(item) }}
            </option>
          </select>
        </label>
        <div v-if="selectedTargets[0]" class="gc-deployment-wizard__target-summary">
          <strong>{{ readString(selectedTargets[0], ['name', 'displayName', 'domainName'], readString(selectedTargets[0], ['id'])) }}</strong>
          <p>{{ readString(selectedTargets[0], ['siteName'], '未命名站点') }}</p>
          <p>{{ readString(selectedTargets[0], ['bindingName', 'bindingSummary'], '未提供绑定信息') }}</p>
          <p>{{ readString(selectedTargets[0], ['managedTargetLabel', 'managedTargetId'], '未识别受管目标') }}</p>
        </div>
        <p v-else class="gc-deployment-wizard__empty">暂无可选应用资产目标。</p>
      </section>
    </div>

    <section class="gc-deployment-wizard__preview">
      <h3>3. 计划预览</h3>
      <p>{{ previewSummary }}</p>
      <p v-if="dryRunRequestId">最近一次 dry-run 已完成。</p>
      <p v-if="submitRequestId">最近一次提交流程已完成。</p>
      <p v-if="approvalHint" class="gc-deployment-wizard__approval">{{ approvalHint }}</p>
    </section>

    <GcDryRunChecklist
      :items="dryRunChecks"
      title="4. Dry-run 预检结论"
      description="这里展示 Agent 回传的只读预检结果，直接说明通过、失败、警告和未知项。"
    />

    <GcCapabilityMatrix
      :items="capabilityItems"
      title="5. 部署准备状态"
      description="这里保留向导本地可判断的准备状态，不再混入 dry-run 预检条目。"
    />

    <footer class="gc-deployment-wizard__actions">
      <button class="gc-button" type="button" :disabled="!canOperate || loading" @click="emit('dryRun', buildPlan())">Dry-run</button>
      <button class="gc-button" type="button" :disabled="!canOperate || loading" @click="emit('save', buildPlan())">保存计划</button>
      <button class="gc-button" type="button" :disabled="!canOperate || loading" @click="emit('submit', buildPlan())">提交计划</button>
      <button class="gc-button gc-button--danger" type="button" :disabled="!canOperate || loading" @click="emit('execute', buildPlan())">提交并执行</button>
    </footer>
  </section>
</template>

<style scoped>
.gc-deployment-wizard { display: grid; gap: var(--gc-space-4); }
.gc-deployment-wizard__header { display: flex; justify-content: space-between; gap: var(--gc-space-4); align-items: flex-start; }
.gc-deployment-wizard__header p { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text-muted); }
.gc-deployment-wizard__step { color: var(--gc-color-text-muted); }
.gc-deployment-wizard__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--gc-space-4); }
.gc-deployment-wizard__column, .gc-deployment-wizard__preview { display: grid; gap: var(--gc-space-2); min-width: 0; }
.gc-deployment-wizard__column h3, .gc-deployment-wizard__preview h3 { margin: 0; font-size: 16px; }
.gc-deployment-wizard__target-summary { border: 1px solid var(--gc-color-border); border-radius: 8px; padding: 12px; background: var(--gc-color-surface-soft); display: grid; gap: var(--gc-space-1); }
.gc-deployment-wizard__target-summary p { margin: 0; color: var(--gc-color-text-muted); }
.gc-deployment-wizard :deep(.gc-form-field) { min-width: 0; }
.gc-deployment-wizard :deep(.gc-form-field input),
.gc-deployment-wizard :deep(.gc-form-field select) {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.gc-deployment-wizard :deep(.gc-form-field select) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gc-deployment-wizard__empty, .gc-deployment-wizard__preview p { margin: 0; color: var(--gc-color-text-muted); }
.gc-deployment-wizard__hint { margin: 0; color: var(--gc-color-danger); font-size: var(--gc-font-size-sm); font-weight: 700; }
.gc-deployment-wizard__approval { border: 1px solid #fde68a; border-radius: 8px; padding: 10px 12px; color: #92400e !important; background: #fffbeb; font-weight: 800; }
.gc-deployment-wizard__actions { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ApiRecord } from '@/api/modules/common'
import type { CapabilityMatrixItem } from './GcCapabilityMatrix.vue'
import GcCapabilityMatrix from './GcCapabilityMatrix.vue'

export interface DeploymentWizardPlan {
  readonly certificateId: string
  readonly certificateVersionId: string
  readonly bindingIds: readonly string[]
  readonly capabilityItems: readonly CapabilityMatrixItem[]
  readonly previewSummary?: string
  readonly dryRunSummary?: string
  readonly submitSummary?: string
}

const props = withDefaults(defineProps<{
  certificates: readonly ApiRecord[]
  bindings: readonly ApiRecord[]
  loading?: boolean
  dryRunRequestId?: string
  submitRequestId?: string
  approvalHint?: string
  initialCertificateId?: string | null
}>(), {
  loading: false,
  dryRunRequestId: '',
  submitRequestId: '',
  approvalHint: '',
  initialCertificateId: null
})

const emit = defineEmits<{
  dryRun: [plan: DeploymentWizardPlan]
  submit: [plan: DeploymentWizardPlan]
  execute: [plan: DeploymentWizardPlan]
}>()

const selectedCertificateId = ref<string>('')
const selectedBindingIds = ref<string[]>([])

watch(() => props.initialCertificateId, (value) => {
  if (value) selectedCertificateId.value = value
}, { immediate: true })

watch(() => props.certificates, (items) => {
  if (!selectedCertificateId.value && items[0]) {
    selectedCertificateId.value = readString(items[0], ['id', 'certificateId'])
  }
}, { immediate: true })

const selectedCertificate = computed(() => props.certificates.find((item) => readString(item, ['id', 'certificateId']) === selectedCertificateId.value) ?? null)
const selectedCertificateVersionId = computed(() => readString(selectedCertificate.value, ['currentVersionId', 'certificateVersionId', 'currentVersion.id'], selectedCertificateId.value))
const selectedBindings = computed(() => props.bindings.filter((item) => selectedBindingIds.value.includes(readString(item, ['id', 'bindingId']))))

const capabilityItems = computed<CapabilityMatrixItem[]>(() => {
  const certificateItems = normalizeCapabilityItems(selectedCertificate.value, '证书')
  const bindingItems = selectedBindings.value.flatMap((item) => normalizeCapabilityItems(item, '绑定'))
  const merged = [...certificateItems, ...bindingItems]
  return merged.length ? merged : fallbackCapabilityItems(selectedCertificate.value, selectedBindings.value)
})

const previewSummary = computed(() => {
  if (!selectedCertificate.value) return '尚未选择证书。'
  return `证书 ${readString(selectedCertificate.value, ['primaryDomain', 'name', 'commonName'], selectedCertificateId.value)} 将尝试绑定到 ${selectedBindings.value.length} 个目标。`
})

const selectedBindingCount = computed(() => selectedBindings.value.length)
const canOperate = computed(() => Boolean(selectedCertificateId.value) && selectedBindingIds.value.length > 0)

function readString(record: ApiRecord | null | undefined, candidates: readonly string[], fallback = ''): string {
  if (!record) return fallback
  for (const key of candidates) {
    const value = key.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') return undefined
      return (current as Record<string, unknown>)[segment]
    }, record)
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }
  return fallback
}

function normalizeCapabilityItems(record: ApiRecord | null, source: string): CapabilityMatrixItem[] {
  if (!record) return []
  const compatibility = typeof record.compatibility === 'object' && record.compatibility ? (record.compatibility as Record<string, unknown>) : null
  const raw = record.capabilities ?? record.capabilityChecks ?? compatibility?.items
  if (!Array.isArray(raw)) return []
  return raw.map((item, index) => {
    const current = (item ?? {}) as Record<string, unknown>
    return {
      key: String(current.key ?? current.capabilityKey ?? `${source}-${index + 1}`),
      label: String(current.label ?? current.name ?? current.key ?? current.capabilityKey ?? `能力 ${index + 1}`),
      state: normalizeState(current.state ?? current.result ?? current.status),
      level: normalizeLevel(current.level ?? current.compatibilityLevel ?? current.rank),
      source,
      detail: readCapabilityDetail(current)
    }
  })
}

function normalizeState(value: unknown): CapabilityMatrixItem['state'] {
  const normalized = String(value ?? 'unknown').toLowerCase()
  if (normalized === 'satisfied') return 'satisfied'
  if (normalized === 'missing') return 'missing'
  if (normalized === 'manualrisk' || normalized === 'manual_risk' || normalized === 'manual-risk') return 'manualRisk'
  return 'unknown'
}

function normalizeLevel(value: unknown): CapabilityMatrixItem['level'] {
  const normalized = String(value ?? 'L3').toUpperCase()
  return ['L1', 'L2', 'L3', 'L4', 'L5'].includes(normalized) ? (normalized as CapabilityMatrixItem['level']) : 'L3'
}

function readCapabilityDetail(record: Record<string, unknown>): string {
  const detail = record.detail ?? record.message ?? record.reason ?? record.observation
  if (detail === undefined || detail === null || detail === '') return ''
  return typeof detail === 'string' ? detail : JSON.stringify(detail)
}

function fallbackCapabilityItems(certificate: ApiRecord | null, bindings: readonly ApiRecord[]): CapabilityMatrixItem[] {
  const privateKeyStatus = readString(certificate, ['hasPrivateKey', 'currentVersion.hasPrivateKey'], 'false')
  return [
    {
      key: 'certificate-material',
      label: '证书材料',
      state: privateKeyStatus === 'true' ? 'satisfied' : 'manualRisk',
      level: 'L2',
      source: '证书',
      detail: '后端 capability 明细缺失时，只能根据私钥状态做最低限度判断。'
    },
    {
      key: 'binding-targets',
      label: '目标绑定覆盖',
      state: bindings.length > 0 ? 'unknown' : 'missing',
      level: 'L3',
      source: '绑定',
      detail: bindings.length > 0 ? '目标已选择，但缺少 capability 结果，需 dry-run 再确认。' : '未选择任何绑定目标。'
    }
  ]
}

function toggleBinding(bindingId: string) {
  if (selectedBindingIds.value.includes(bindingId)) {
    selectedBindingIds.value = selectedBindingIds.value.filter((id) => id !== bindingId)
    return
  }
  selectedBindingIds.value = [...selectedBindingIds.value, bindingId]
}

function buildPlan(): DeploymentWizardPlan {
  return {
    certificateId: selectedCertificateId.value,
    certificateVersionId: selectedCertificateVersionId.value,
    bindingIds: [...selectedBindingIds.value],
    capabilityItems: capabilityItems.value,
    previewSummary: previewSummary.value,
    dryRunSummary: props.dryRunRequestId ? `最近 dry-run 已完成` : undefined,
    submitSummary: props.submitRequestId ? `最近一次提交流程已完成` : undefined
  }
}
</script>

<template>
  <section class="gc-card gc-deployment-wizard" aria-label="部署向导">
    <header class="gc-deployment-wizard__header">
      <div>
        <strong>部署向导真实闭环</strong>
        <p>按 create → dry-run → submit → approval 提示 → execute 推进，所有操作都依赖后端返回的真实 planId。</p>
      </div>
      <span class="gc-deployment-wizard__step">当前选择 {{ selectedBindingCount }} 个目标</span>
    </header>

    <div class="gc-deployment-wizard__grid">
      <section class="gc-deployment-wizard__column">
        <h3>1. 选择证书</h3>
        <p v-if="certificates.length === 0" class="gc-deployment-wizard__empty">暂无可选证书。</p>
        <label v-else class="gc-form-field">
          <span>证书</span>
          <select v-model="selectedCertificateId" :disabled="loading">
            <option v-for="item in certificates" :key="readString(item, ['id', 'certificateId'])" :value="readString(item, ['id', 'certificateId'])">
              {{ readString(item, ['primaryDomain', 'name', 'commonName'], readString(item, ['id', 'certificateId'])) }}
            </option>
          </select>
        </label>
      </section>

      <section class="gc-deployment-wizard__column">
        <h3>2. 选择绑定目标</h3>
        <p v-if="bindings.length === 0" class="gc-deployment-wizard__empty">暂无绑定目标。</p>
        <ul v-else class="gc-deployment-wizard__targets">
          <li v-for="item in bindings" :key="readString(item, ['id', 'bindingId'])">
            <label>
              <input
                type="checkbox"
                :checked="selectedBindingIds.includes(readString(item, ['id', 'bindingId']))"
                :disabled="loading"
                @change="toggleBinding(readString(item, ['id', 'bindingId']))"
              />
              <span>{{ readString(item, ['domainName', 'name', 'bindingName'], readString(item, ['id', 'bindingId'])) }}</span>
            </label>
          </li>
        </ul>
      </section>
    </div>

    <section class="gc-deployment-wizard__preview">
      <h3>3. 计划预览</h3>
      <p>{{ previewSummary }}</p>
      <p>已选目标：{{ selectedBindingIds.join(', ') || '无' }}</p>
      <p v-if="dryRunRequestId">最近 dry-run 已完成。</p>
      <p v-if="submitRequestId">最近一次提交流程已完成。</p>
      <p v-if="approvalHint" class="gc-deployment-wizard__approval">{{ approvalHint }}</p>
    </section>

    <GcCapabilityMatrix
      :items="capabilityItems"
      title="4. Capability 兼容性"
      description="兼容性状态只分 satisfied / missing / unknown / manualRisk，并保留 L1-L5。"
    />

    <footer class="gc-deployment-wizard__actions">
      <button class="gc-button" type="button" :disabled="!canOperate || loading" @click="emit('dryRun', buildPlan())">Dry-run</button>
      <button class="gc-button" type="button" :disabled="!canOperate || loading" @click="emit('submit', buildPlan())">提交计划</button>
      <button class="gc-button gc-button--danger" type="button" :disabled="!canOperate || loading" @click="emit('execute', buildPlan())">提交并在可执行时执行</button>
    </footer>
  </section>
</template>

<style scoped>
.gc-deployment-wizard { display: grid; gap: var(--gc-space-4); }
.gc-deployment-wizard__header { display: flex; justify-content: space-between; gap: var(--gc-space-4); align-items: flex-start; }
.gc-deployment-wizard__header p { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text-muted); }
.gc-deployment-wizard__step { color: var(--gc-color-text-muted); }
.gc-deployment-wizard__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--gc-space-4); }
.gc-deployment-wizard__column, .gc-deployment-wizard__preview { display: grid; gap: var(--gc-space-2); }
.gc-deployment-wizard__column h3, .gc-deployment-wizard__preview h3 { margin: 0; font-size: 16px; }
.gc-deployment-wizard__targets { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--gc-space-2); }
.gc-deployment-wizard__targets label { display: flex; gap: var(--gc-space-2); align-items: center; }
.gc-deployment-wizard__empty, .gc-deployment-wizard__preview p { margin: 0; color: var(--gc-color-text-muted); }
.gc-deployment-wizard__approval { border: 1px solid #fde68a; border-radius: 12px; padding: 10px 12px; color: #92400e !important; background: #fffbeb; font-weight: 800; }
.gc-deployment-wizard__actions { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
</style>

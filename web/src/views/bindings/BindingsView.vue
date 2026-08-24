<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ApiClientError } from '@/api/client'
import type { ApiRecord } from '@/api/modules/common'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { createBinding, deleteBinding, detectBindingDrift, listBindings, listBindingUsages, patchBindingStatus, persistBindingDriftResult, verifyBinding } from '@/api/modules/bindings.api'
import { GcModal } from '@/design-system/components'
import type { ViewRow } from '@/composables/useBusinessPage'

interface BindingDraft {
  serviceInstanceId: string
  domainName: string
  bindingType: string
  certPath: string
  keyPath: string
  keystorePath: string
  keystoreType: string
  reloadCommand: string
  verifyMethod: string
  desiredFingerprintSha256: string
  observedFingerprintSha256: string
  localFingerprintSha256: string
  remoteFingerprintSha256: string
}

const pageRef = ref<InstanceType<typeof BusinessResourcePage> | null>(null)
const dialogOpen = ref(false)
const loading = ref(false)
const error = ref('')
const requestId = ref('')
const driftPreview = ref<Record<string, unknown> | null>(null)
const selectedBinding = ref<ViewRow | null>(null)
const usageItems = ref<ApiRecord[]>([])
const usageRequestId = ref('')
const usageError = ref('')
const draft = reactive<BindingDraft>(emptyDraft())
const submitDisabled = computed(() => loading.value || !draft.serviceInstanceId.trim())
const selectedBindingId = computed(() => selectedBinding.value?.id ?? '')

const config: BusinessPageConfig = {
  title: '证书绑定',
  description: '域名、端口、服务、本地证书路径、远端 TLS 指纹和漂移状态。',
  readPermission: 'binding.read',
  primaryPermission: 'binding.write',
  primaryActionLabel: '新增绑定',
  primaryAction: openCreateDialog,
  moduleName: 'bindings',
  resourceName: '绑定',
  defaultStatus: 'DRIFTED',
  defaultRisk: 'HIGH',
  columns: [
    { key: 'name', title: '域名/绑定', candidates: ['domainName', 'name', 'bindingName'] },
    { key: 'status', title: '漂移状态', candidates: ['driftStatus', 'status', 'state'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel'] },
    { key: 'port', title: '端口', candidates: ['port', 'endpoint.port'] },
    { key: 'fingerprint', title: '远端指纹', candidates: ['remoteFingerprintSha256', 'observedFingerprintSha256', 'remoteFingerprint', 'fingerprint'] }
  ],
  metrics: [
    { title: '绑定总数', description: '证书版本、服务实例和端口之间的实际关系。', status: 'MANAGED', risk: 'MEDIUM' },
    { title: '高危待处理', description: '本地配置和远端观测不一致的绑定。', status: 'DRIFTED', risk: 'HIGH' }
  ],
  detailFields: [
    { label: '绑定 ID', candidates: ['id', 'bindingId'] },
    { label: '证书 ID', candidates: ['certificateId', 'certificateVersionId', 'certificate.id'] },
    { label: '资产 ID', candidates: ['hostId', 'assetId', 'host.id'] },
    { label: '服务实例', candidates: ['serviceInstanceId', 'service.id', 'serviceName'] },
    { label: '域名', candidates: ['domainName', 'endpoint.host'] },
    { label: '绑定类型', candidates: ['bindingType'] },
    { label: '本地指纹', candidates: ['localFingerprintSha256', 'metadata.localFingerprintSha256'] },
    { label: '远端指纹', candidates: ['remoteFingerprintSha256', 'observedFingerprintSha256', 'remoteFingerprint', 'fingerprint'] },
    { label: '目标指纹', candidates: ['desiredFingerprintSha256'] },
    { label: '证书路径', candidates: ['certPath'] },
    { label: '私钥路径', candidates: ['keyPath'] },
    { label: 'Keystore 路径', candidates: ['keystorePath'] },
    { label: 'Reload 命令', candidates: ['reloadCommand'] },
    { label: '验证方式', candidates: ['verifyMethod'] },
    { label: 'Drift 状态', candidates: ['driftStatus', 'status', 'state'] },
    { label: '最后验证', candidates: ['lastVerifiedAt', 'updatedAt'] }
  ],
  contextLinks: [
    { label: '查看证书', to: '/certificates', queryKey: 'certificateId', candidates: ['certificateId', 'certificateVersionId', 'certificate.id'] },
    { label: '查看资产', to: '/assets', queryKey: 'hostId', candidates: ['hostId', 'assetId', 'host.id'] },
    { label: '查看部署计划', to: '/deployment-plans', queryKey: 'bindingId', candidates: ['id', 'bindingId'] }
  ],
  emptyTitle: '暂无证书绑定',
  emptyDescription: '没有绑定就无法回答“证书在哪里使用”。先发现服务或手工登记绑定。',
  load: () => listBindings({ page: 1, pageSize: 20, sort: 'lastVerifiedAt:desc' }),
  actions: [
    { label: '重新验证绑定', permission: 'binding.write', danger: true, confirmText: 'VERIFY', riskText: '验证会访问目标 TLS 端口，请确认不会触发安全设备误报。', requiresSelection: true, run: (row) => verifyBinding(row?.id ?? '', { dryRun: true }) },
    { label: '标记为已纳管', permission: 'binding.write', danger: false, requiresSelection: true, run: (row) => patchBindingStatus(row?.id ?? '', 'MANAGED', { reason: 'manual_mark_managed_from_console' }) },
    { label: '软删除绑定', permission: 'binding.write', danger: true, confirmText: 'DELETE', riskText: '删除绑定会影响部署目标选择；后端必须检查历史计划和审计引用。', requiresSelection: true, run: (row) => deleteBinding(row?.id ?? '', { reason: 'manual_soft_delete_from_console' }) }
  ],
  onSelectionChange: handleBindingSelection
}

function emptyDraft(): BindingDraft {
  return {
    serviceInstanceId: '',
    domainName: '',
    bindingType: 'FILE_PATH',
    certPath: '',
    keyPath: '',
    keystorePath: '',
    keystoreType: 'PKCS12',
    reloadCommand: '',
    verifyMethod: 'TLS_CONNECT',
    desiredFingerprintSha256: '',
    observedFingerprintSha256: '',
    localFingerprintSha256: '',
    remoteFingerprintSha256: ''
  }
}

function openCreateDialog() {
  Object.assign(draft, emptyDraft())
  error.value = ''
  requestId.value = ''
  driftPreview.value = null
  dialogOpen.value = true
}

function closeDialog() {
  if (!loading.value) dialogOpen.value = false
}

function handleBindingSelection(row: ViewRow | null) {
  selectedBinding.value = row
  void refreshBindingUsage(row)
}

function buildCreatePayload() {
  return stripEmpty({
    serviceInstanceId: draft.serviceInstanceId.trim(),
    domainName: draft.domainName.trim(),
    bindingType: draft.bindingType,
    certPath: draft.certPath.trim(),
    keyPath: draft.keyPath.trim(),
    keystorePath: draft.keystorePath.trim(),
    keystoreType: draft.bindingType === 'KEYSTORE' ? draft.keystoreType : '',
    reloadCommand: draft.reloadCommand.trim(),
    verifyMethod: draft.verifyMethod,
    desiredFingerprintSha256: normalizeFingerprint(draft.desiredFingerprintSha256),
    observedFingerprintSha256: normalizeFingerprint(draft.observedFingerprintSha256),
    metadata: stripEmpty({
      localFingerprintSha256: normalizeFingerprint(draft.localFingerprintSha256),
      remoteFingerprintSha256: normalizeFingerprint(draft.remoteFingerprintSha256)
    }),
    status: 'DISCOVERED'
  })
}

async function submitBinding() {
  if (!draft.serviceInstanceId.trim()) {
    error.value = 'serviceInstanceId 不能为空。'
    return
  }
  loading.value = true
  error.value = ''
  requestId.value = ''
  try {
    const result = await createBinding(buildCreatePayload())
    requestId.value = result.requestId
    dialogOpen.value = false
    await pageRef.value?.reload()
  } catch (cause) {
    handleError(cause, '新增绑定失败，请检查路径、指纹和绑定类型。')
  } finally {
    loading.value = false
  }
}

async function previewDrift() {
  loading.value = true
  error.value = ''
  requestId.value = ''
  driftPreview.value = null
  try {
    const result = await detectBindingDrift({
      localFingerprintSha256: normalizeFingerprint(draft.localFingerprintSha256),
      remoteFingerprintSha256: normalizeFingerprint(draft.remoteFingerprintSha256 || draft.observedFingerprintSha256),
      desiredFingerprintSha256: normalizeFingerprint(draft.desiredFingerprintSha256),
      reachable: true
    })
    requestId.value = result.requestId
    driftPreview.value = result.data ?? null
  } catch (cause) {
    handleError(cause, '漂移预览失败。')
  } finally {
    loading.value = false
  }
}

async function persistDriftForSelected() {
  if (!selectedBindingId.value && !draft.serviceInstanceId.trim()) {
    error.value = '必须先选择绑定或填写 serviceInstanceId。'
    return
  }
  loading.value = true
  error.value = ''
  requestId.value = ''
  try {
    const result = await persistBindingDriftResult(stripEmpty({
      bindingId: selectedBindingId.value,
      serviceInstanceId: draft.serviceInstanceId.trim(),
      localFingerprintSha256: normalizeFingerprint(draft.localFingerprintSha256),
      remoteFingerprintSha256: normalizeFingerprint(draft.remoteFingerprintSha256 || draft.observedFingerprintSha256),
      desiredFingerprintSha256: normalizeFingerprint(draft.desiredFingerprintSha256),
      driftPreview: driftPreview.value ?? undefined
    }))
    requestId.value = result.requestId
    await pageRef.value?.reload()
  } catch (cause) {
    handleError(cause, '保存漂移验证结果失败。')
  } finally {
    loading.value = false
  }
}

async function refreshBindingUsage(row: ViewRow | null) {
  usageItems.value = []
  usageError.value = ''
  if (!row) return
  try {
    const raw = row.raw
    const result = await listBindingUsages({
      page: 1,
      pageSize: 10,
      filters: stripEmpty({
        bindingId: row.id,
        certificateVersionId: toFilterValue(raw.certificateVersionId),
        certificateId: toFilterValue(raw.certificateId),
        fingerprint: toFilterValue(raw.desiredFingerprintSha256 ?? raw.observedFingerprintSha256 ?? raw.remoteFingerprintSha256)
      })
    })
    usageRequestId.value = result.requestId
    usageItems.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      usageError.value = cause.message
      return
    }
    usageError.value = cause instanceof Error ? cause.message : '加载绑定使用关系失败。'
  }
}

function stripEmpty<T extends Record<string, unknown>>(record: T): T {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value === '' || value === undefined || value === null) continue
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0) continue
    next[key] = value
  }
  return next as T
}

function normalizeFingerprint(value: string): string | undefined {
  const normalized = value.trim().replaceAll(':', '').toLowerCase()
  return normalized || undefined
}

function toFilterValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return undefined
}

function handleError(cause: unknown, fallback: string) {
  if (cause instanceof ApiClientError) {
    error.value = `${cause.message}（${cause.errorCode}）`
    requestId.value = cause.requestId
    return
  }
  error.value = cause instanceof Error ? cause.message : fallback
}
</script>

<template>
  <BusinessResourcePage ref="pageRef" :config="config" />

  <section class="binding-usage gc-card" aria-label="绑定使用关系">
    <header class="binding-usage__header">
      <div>
        <p>使用关系/影响范围</p>
        <h2>{{ selectedBinding?.name ?? '未选择绑定' }}</h2>
        <span>按 bindingId、certificateVersionId 或 fingerprint 调用 usage 集合查询，前端不猜使用关系。</span>
      </div>
      <span class="binding-usage__request">{{ usageRequestId ? '使用关系已刷新' : '等待选择绑定' }}</span>
    </header>
    <p v-if="usageError" class="binding-form__error">{{ usageError }}</p>
    <ul v-if="usageItems.length" class="binding-usage__list">
      <li v-for="usage in usageItems" :key="String(usage.id ?? usage.bindingId ?? usage.hostId)">
        <strong>{{ usage.domainName ?? usage.bindingName ?? usage.id }}</strong>
        <span>host={{ usage.hostId ?? '—' }} · service={{ usage.serviceInstanceId ?? usage.serviceName ?? '—' }} · drift={{ usage.driftStatus ?? usage.status ?? '—' }}</span>
      </li>
    </ul>
    <p v-else class="binding-usage__empty">暂无 usage 返回；如果这是未知证书或 stale 绑定，后端应明确返回状态而不是让用户猜。</p>
  </section>

  <GcModal
    v-model:open="dialogOpen"
    title="新增证书绑定"
    description="绑定是部署计划的目标单位。别绕过 ServiceInstance 直接部署到 Host，那是灾难入口。"
    size="xl"
  >
    <section class="binding-form">
      <div class="binding-form__grid">
        <label class="binding-form__field"><span>ServiceInstance ID <strong>*</strong></span><input v-model="draft.serviceInstanceId" autocomplete="off" /></label>
        <label class="binding-form__field"><span>域名</span><input v-model="draft.domainName" placeholder="www.example.com" autocomplete="off" /></label>
        <label class="binding-form__field"><span>绑定类型</span><select v-model="draft.bindingType"><option value="FILE_PATH">FILE_PATH</option><option value="KEYSTORE">KEYSTORE</option><option value="WINDOWS_CERT_STORE">WINDOWS_CERT_STORE</option></select></label>
        <label class="binding-form__field"><span>验证方式</span><select v-model="draft.verifyMethod"><option value="TLS_CONNECT">TLS_CONNECT</option><option value="LOCAL_FILE">LOCAL_FILE</option><option value="STORE_QUERY">STORE_QUERY</option><option value="CUSTOM">CUSTOM</option></select></label>
        <label class="binding-form__field"><span>certPath</span><input v-model="draft.certPath" placeholder="/etc/nginx/certs/site.pem" autocomplete="off" /></label>
        <label class="binding-form__field"><span>keyPath</span><input v-model="draft.keyPath" placeholder="/etc/nginx/private/site.key" autocomplete="off" /></label>
        <label class="binding-form__field"><span>keystorePath</span><input v-model="draft.keystorePath" placeholder="/opt/tomcat/conf/app.p12" autocomplete="off" /></label>
        <label class="binding-form__field"><span>keystoreType</span><select v-model="draft.keystoreType"><option value="PKCS12">PKCS12</option><option value="JKS">JKS</option></select></label>
        <label class="binding-form__field binding-form__field--wide"><span>reloadCommand</span><input v-model="draft.reloadCommand" placeholder="systemctl reload nginx" autocomplete="off" /></label>
        <label class="binding-form__field"><span>desired fingerprint</span><input v-model="draft.desiredFingerprintSha256" placeholder="64 位 sha256" autocomplete="off" /></label>
        <label class="binding-form__field"><span>observed fingerprint</span><input v-model="draft.observedFingerprintSha256" placeholder="远端观测指纹" autocomplete="off" /></label>
        <label class="binding-form__field"><span>local fingerprint</span><input v-model="draft.localFingerprintSha256" placeholder="本地配置指纹" autocomplete="off" /></label>
        <label class="binding-form__field"><span>remote fingerprint</span><input v-model="draft.remoteFingerprintSha256" placeholder="远端 TLS 实测指纹" autocomplete="off" /></label>
      </div>

      <div class="binding-form__preview">
        <button class="gc-button" type="button" :disabled="loading" @click="previewDrift">预览漂移</button>
        <button class="gc-button" type="button" :disabled="loading" @click="persistDriftForSelected">保存验证结果</button>
        <pre v-if="driftPreview">{{ JSON.stringify(driftPreview, null, 2) }}</pre>
      </div>
      <p v-if="error" class="binding-form__error">{{ error }}</p>
    </section>

    <template #actions>
      <button class="gc-button" type="button" :disabled="loading" @click="closeDialog">取消</button>
      <button class="gc-button gc-button--danger" type="button" :disabled="submitDisabled" @click="submitBinding">{{ loading ? '提交中…' : '确认新增' }}</button>
    </template>
  </GcModal>
</template>

<style scoped>
.binding-form,
.binding-usage { display: grid; gap: var(--gc-space-4); }
.binding-usage { margin-top: var(--gc-space-5); }
.binding-usage__header { display: flex; justify-content: space-between; gap: var(--gc-space-4); align-items: flex-start; }
.binding-usage__header p,
.binding-usage__header h2,
.binding-usage__header span,
.binding-usage__empty,
.binding-usage__request { margin: 0; }
.binding-usage__header p,
.binding-usage__header span,
.binding-usage__empty,
.binding-usage__request { color: var(--gc-color-text-muted); font-weight: 750; }
.binding-usage__header h2 { margin-top: var(--gc-space-1); letter-spacing: -0.03em; }
.binding-usage__list { display: grid; gap: var(--gc-space-2); padding: 0; margin: 0; list-style: none; }
.binding-usage__list li { display: grid; gap: var(--gc-space-1); border: 1px solid var(--gc-color-border); border-radius: 12px; padding: var(--gc-space-3); }
.binding-usage__list span { color: var(--gc-color-text-muted); }
.binding-form__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.binding-form__field { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 850; }
.binding-form__field--wide { grid-column: 1 / -1; }
.binding-form__field strong,
.binding-form__error { color: var(--gc-color-danger); }
.binding-form__field input,
.binding-form__field select { width: 100%; border: 1px solid var(--gc-color-border); border-radius: 12px; padding: 10px 12px; color: var(--gc-color-text); background: var(--gc-color-surface-muted); outline: none; }
.binding-form__field input:focus,
.binding-form__field select:focus { border-color: #60a5fa; box-shadow: 0 0 0 4px rgb(96 165 250 / 14%); background: #fff; }
.binding-form__preview { display: grid; gap: var(--gc-space-2); justify-items: start; }
.binding-form__preview pre { width: 100%; max-height: 180px; overflow: auto; border: 1px solid var(--gc-color-border); border-radius: 12px; padding: var(--gc-space-3); background: #0f172a; color: #e2e8f0; }
.binding-form__error,
.binding-form__request { margin: 0; font-weight: 850; }
.binding-form__request { color: var(--gc-color-text-muted); }
@media (max-width: 760px) { .binding-form__grid { grid-template-columns: 1fr; } }
</style>

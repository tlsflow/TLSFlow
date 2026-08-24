<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ApiClientError } from '@/api/client'
import {
  createCertificateFormat,
  deleteCertificateFormat,
  listCertificateFormats,
  updateCertificateFormat,
} from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'
import {
  GcDataTable,
  GcEmptyState,
  GcModal,
  GcPermissionButton,
} from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'

type PresetFormat = 'pfx' | 'pem' | 'cer' | 'crt' | 'key' | 'jks' | 'p7b' | 'custom'
type BackendFormat = 'pem' | 'pfx' | 'jks' | 'p7b' | 'der'
type PublicEncoding = 'pem' | 'der' | 'base64'
type PrivateEncoding = 'pem' | 'pkcs8' | 'base64'
type BundleMode = 'leaf_only' | 'leaf_with_chain' | 'leaf_chain_with_key'

interface ArtifactDraft {
  id: string
  configName: string
  presetFormat: PresetFormat
  customBackendFormat: BackendFormat
  customExtension: string
  publicEncoding: PublicEncoding
  privateEncoding: PrivateEncoding
  bundleMode: BundleMode
  generateChainFile: boolean
  generatePrivateKeyFile: boolean
  containsPrivateKey: boolean
  passwordSecretRef: string
  alias: string
  expiresAt: string
  artifactRef: string
}

interface FormatRow extends Record<string, unknown> {
  id: string
  configName: string
  alias: string
  displayFormat: string
  extension: string
  encodingSummary: string
  exportSummary: string
  expiresAt: string
  raw: ApiRecord
}

const loading = ref(false)
const submitLoading = ref(false)
const deleteLoadingId = ref('')
const dialogOpen = ref(false)
const error = ref('')
const actionError = ref('')
const requestId = ref('')
const editMode = ref<'create' | 'edit'>('create')
const formatItems = ref<ApiRecord[]>([])
const filters = reactive({
  keyword: '',
  format: '',
})
const draft = reactive(createEmptyDraft())

const resolvedBackendFormat = computed(() => resolveBackendFormat(draft))
const resolvedExtension = computed(() => resolveExtension(draft))
const needsPassword = computed(() => resolvedBackendFormat.value === 'pfx' || resolvedBackendFormat.value === 'jks')

const rows = computed<FormatRow[]>(() => {
  const keyword = filters.keyword.trim().toLowerCase()
  const format = filters.format.trim().toLowerCase()
  return formatItems.value
    .map((item, index) => {
      const parameters = readRecord(item.parameters)
      const presetFormat = normalizePresetFormat(String(parameters.outputPreset ?? item.format ?? 'pem'))
      const displayFormat = presetFormat.toUpperCase()
      const extension = String(parameters.extension ?? item.format ?? '-')
      const configName = String(parameters.configName ?? parameters.alias ?? `未命名配置-${index + 1}`)
      const alias = String(parameters.alias ?? '-')
      const encodingSummary = renderEncodingSummary(parameters)
      const exportSummary = renderExportSummary(item, parameters)
      const expiresAt = readString(item, ['expiresAt'], '-')
      return {
        id: readString(item, ['id'], `certfmt-${index + 1}`),
        configName,
        alias,
        displayFormat,
        extension,
        encodingSummary,
        exportSummary,
        expiresAt,
        raw: item,
      }
    })
    .filter((item) => {
      if (format && item.displayFormat.toLowerCase() !== format) return false
      if (!keyword) return true
      return [
        item.configName,
        item.alias,
        item.displayFormat,
        item.extension,
        item.encodingSummary,
        item.exportSummary,
      ].join('\n').toLowerCase().includes(keyword)
    })
})

const columns: DataTableColumn<FormatRow>[] = [
  { key: 'configName', title: '配置文件名称', width: '22%' },
  { key: 'displayFormat', title: '格式', width: '10%' },
  { key: 'extension', title: '扩展名', width: '10%' },
  { key: 'encodingSummary', title: '编码选择', width: '20%' },
  { key: 'exportSummary', title: '导出选项', width: '24%' },
  { key: 'expiresAt', title: '失效时间', width: '14%' },
  { key: 'actions', title: '操作', width: '12%' },
]

onMounted(loadFormats)

async function loadFormats() {
  loading.value = true
  error.value = ''
  try {
    const result = await listCertificateFormats({ page: 1, pageSize: 200, sort: 'createdAt:desc' })
    formatItems.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    error.value = toErrorMessage(cause, '加载证书产物配置文件失败')
  } finally {
    loading.value = false
  }
}

function createEmptyDraft(): ArtifactDraft {
  return {
    id: '',
    configName: '',
    presetFormat: 'pfx',
    customBackendFormat: 'pem',
    customExtension: '',
    publicEncoding: 'pem',
    privateEncoding: 'pem',
    bundleMode: 'leaf_with_chain',
    generateChainFile: true,
    generatePrivateKeyFile: false,
    containsPrivateKey: true,
    passwordSecretRef: '',
    alias: '',
    expiresAt: '',
    artifactRef: '',
  }
}

function openCreateDialog() {
  Object.assign(draft, createEmptyDraft())
  editMode.value = 'create'
  actionError.value = ''
  requestId.value = ''
  dialogOpen.value = true
}

function openEditDialog(row: FormatRow) {
  const parameters = readRecord(row.raw.parameters)
  const presetFormat = normalizePresetFormat(String(parameters.outputPreset ?? row.raw.format ?? 'pem'))
  Object.assign(draft, {
    id: row.id,
    configName: String(parameters.configName ?? row.configName ?? ''),
    presetFormat,
    customBackendFormat: normalizeBackendFormat(String(parameters.engineFormat ?? row.raw.format ?? 'pem')),
    customExtension: presetFormat === 'custom' ? String(parameters.extension ?? '') : '',
    publicEncoding: normalizePublicEncoding(String(parameters.publicEncoding ?? 'pem')),
    privateEncoding: normalizePrivateEncoding(String(parameters.privateEncoding ?? 'pem')),
    bundleMode: normalizeBundleMode(String(parameters.bundleMode ?? 'leaf_only')),
    generateChainFile: Boolean(parameters.generateChainFile),
    generatePrivateKeyFile: Boolean(parameters.generatePrivateKeyFile),
    containsPrivateKey: Boolean(row.raw.containsPrivateKey),
    passwordSecretRef: readString(row.raw, ['passwordSecretRef'], ''),
    alias: String(parameters.alias ?? ''),
    expiresAt: readString(row.raw, ['expiresAt'], ''),
    artifactRef: readString(row.raw, ['artifactRef'], ''),
  } satisfies ArtifactDraft)
  editMode.value = 'edit'
  actionError.value = ''
  requestId.value = ''
  dialogOpen.value = true
}

function closeDialog() {
  if (!submitLoading.value) {
    dialogOpen.value = false
  }
}

async function submitDraft() {
  if (!draft.configName.trim()) {
    actionError.value = '必须填写配置文件名称'
    return
  }

  submitLoading.value = true
  actionError.value = ''
  requestId.value = ''

  try {
    const payload = buildPayload()
    const result = editMode.value === 'create'
      ? await createCertificateFormat(payload)
      : await updateCertificateFormat({ id: draft.id, ...payload })
    requestId.value = result.requestId
    dialogOpen.value = false
    await loadFormats()
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      actionError.value = `${cause.message}（${cause.errorCode}）`
      requestId.value = cause.requestId
    } else {
      actionError.value = toErrorMessage(cause, '保存证书产物配置文件失败')
    }
  } finally {
    submitLoading.value = false
  }
}

async function removeRow(row: FormatRow) {
  deleteLoadingId.value = row.id
  error.value = ''
  try {
    await deleteCertificateFormat(row.id)
    await loadFormats()
  } catch (cause) {
    error.value = toErrorMessage(cause, '删除证书产物配置文件失败')
  } finally {
    deleteLoadingId.value = ''
  }
}

function buildPayload() {
  return {
    format: resolvedBackendFormat.value,
    artifactRef: draft.artifactRef || buildArtifactRef(),
    containsPrivateKey: resolveContainsPrivateKey(),
    ...(needsPassword.value && draft.passwordSecretRef.trim() ? { passwordSecretRef: draft.passwordSecretRef.trim() } : {}),
    ...(draft.expiresAt.trim() ? { expiresAt: draft.expiresAt.trim() } : {}),
    parameters: {
      configName: draft.configName.trim(),
      outputPreset: draft.presetFormat,
      engineFormat: resolvedBackendFormat.value,
      extension: resolvedExtension.value,
      publicEncoding: draft.publicEncoding,
      privateEncoding: draft.privateEncoding,
      bundleMode: draft.bundleMode,
      generateChainFile: draft.generateChainFile,
      generatePrivateKeyFile: draft.generatePrivateKeyFile,
      ...(draft.alias.trim() ? { alias: draft.alias.trim() } : {}),
    },
  }
}

function buildArtifactRef() {
  const slug = toSlug(draft.configName.trim() || 'certificate-format-config')
  return `artifact://certificate-format-config/${slug}/${resolvedBackendFormat.value}/${Date.now()}`
}

function resolveContainsPrivateKey() {
  if (needsPassword.value) {
    return draft.containsPrivateKey
  }
  return draft.bundleMode === 'leaf_chain_with_key' || draft.presetFormat === 'key'
}

function resolveBackendFormat(input: ArtifactDraft): BackendFormat {
  switch (input.presetFormat) {
    case 'pfx':
      return 'pfx'
    case 'jks':
      return 'jks'
    case 'p7b':
      return 'p7b'
    case 'cer':
    case 'crt':
      return 'der'
    case 'custom':
      return input.customBackendFormat
    default:
      return 'pem'
  }
}

function resolveExtension(input: ArtifactDraft) {
  if (input.presetFormat === 'custom') {
    return input.customExtension.trim() || input.customBackendFormat
  }
  return {
    pfx: 'pfx',
    pem: 'pem',
    cer: 'cer',
    crt: 'crt',
    key: 'key',
    jks: 'jks',
    p7b: 'p7b',
    custom: '',
  }[input.presetFormat]
}

function renderEncodingSummary(parameters: Record<string, unknown>) {
  const publicEncoding = String(parameters.publicEncoding ?? 'pem').toUpperCase()
  const privateEncoding = String(parameters.privateEncoding ?? 'pem').toUpperCase()
  return `公钥 ${publicEncoding} / 私钥 ${privateEncoding}`
}

function renderExportSummary(item: ApiRecord, parameters: Record<string, unknown>) {
  const segments = [renderBundleMode(String(parameters.bundleMode ?? 'leaf_only'))]
  if (parameters.generateChainFile) segments.push('额外链文件')
  if (parameters.generatePrivateKeyFile) segments.push('额外私钥文件')
  if (item.containsPrivateKey) segments.push('主产物含私钥')
  return segments.join(' · ')
}

function renderBundleMode(value: string) {
  switch (value) {
    case 'leaf_only':
      return '仅服务器公钥'
    case 'leaf_with_chain':
      return '服务器公钥 + 证书链'
    case 'leaf_chain_with_key':
      return '服务器公钥 + 证书链 + 私钥'
    default:
      return value
  }
}

function normalizePresetFormat(value: string): PresetFormat {
  if (['pfx', 'pem', 'cer', 'crt', 'key', 'jks', 'p7b', 'custom'].includes(value)) {
    return value as PresetFormat
  }
  if (value === 'der') return 'cer'
  return 'pem'
}

function normalizeBackendFormat(value: string): BackendFormat {
  if (['pem', 'pfx', 'jks', 'p7b', 'der'].includes(value)) {
    return value as BackendFormat
  }
  return 'pem'
}

function normalizePublicEncoding(value: string): PublicEncoding {
  if (['pem', 'der', 'base64'].includes(value)) {
    return value as PublicEncoding
  }
  return 'pem'
}

function normalizePrivateEncoding(value: string): PrivateEncoding {
  if (['pem', 'pkcs8', 'base64'].includes(value)) {
    return value as PrivateEncoding
  }
  return 'pem'
}

function normalizeBundleMode(value: string): BundleMode {
  if (['leaf_only', 'leaf_with_chain', 'leaf_chain_with_key'].includes(value)) {
    return value as BundleMode
  }
  return 'leaf_only'
}

function readString(record: ApiRecord, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = key.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') return undefined
      return (current as Record<string, unknown>)[segment]
    }, record)
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  return fallback
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function toSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'certificate-format-config'
}

function toErrorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback
}
</script>

<template>
  <section class="gc-page artifact-page">
    <section class="artifact-page__toolbar">
      <section class="gc-card artifact-page__filters">
        <label class="artifact-page__filter">
          <span class="artifact-page__filter-label">关键字</span>
          <input v-model="filters.keyword" placeholder="配置名称 / Alias / 格式 / 扩展名" />
        </label>
        <label class="artifact-page__filter">
          <span class="artifact-page__filter-label">格式</span>
          <select v-model="filters.format">
            <option value="">全部</option>
            <option value="PFX">PFX</option>
            <option value="PEM">PEM</option>
            <option value="CER">CER</option>
            <option value="CRT">CRT</option>
            <option value="KEY">KEY</option>
            <option value="JKS">JKS</option>
            <option value="P7B">P7B</option>
          </select>
        </label>
        <div class="artifact-page__filter-actions">
          <button class="gc-button" type="button" @click="loadFormats">刷新</button>
        </div>
      </section>

      <div class="artifact-page__toolbar-actions">
        <GcPermissionButton class="artifact-page__create-button" permission="certificate.format.create" @click="openCreateDialog">
          新建配置文件
        </GcPermissionButton>
      </div>
    </section>

    <GcEmptyState v-if="error" title="证书产物配置文件加载失败" :description="error">
      <button class="gc-button" type="button" @click="loadFormats">重试</button>
    </GcEmptyState>

    <GcDataTable
      v-else
      class="artifact-page__table"
      :columns="columns"
      :rows="rows"
      :loading="loading"
      empty-text="暂无证书产物配置文件"
    >
      <template #toolbar>
        <div class="artifact-page__table-toolbar">
          <div class="artifact-page__table-heading">
            <strong>证书产物配置文件列表</strong>
            <span>这里保存的是导出规则模板，不绑定具体证书版本。当前 {{ rows.length }} 条</span>
          </div>
        </div>
      </template>

      <template #cell-configName="{ row }">
        <div class="artifact-page__cell-stack">
          <strong>{{ row.configName }}</strong>
          <span>{{ row.alias === '-' ? '未设置 Alias' : `Alias：${row.alias}` }}</span>
        </div>
      </template>

      <template #cell-actions="{ row }">
        <div class="artifact-page__actions-cell">
          <GcPermissionButton permission="certificate.format.create" @click="openEditDialog(row as FormatRow)">
            编辑
          </GcPermissionButton>
          <GcPermissionButton
            permission="certificate.format.create"
            danger
            :disabled="deleteLoadingId === String(row.id)"
            @click="removeRow(row as FormatRow)"
          >
            {{ deleteLoadingId === String(row.id) ? '删除中...' : '删除' }}
          </GcPermissionButton>
        </div>
      </template>
    </GcDataTable>

    <GcModal
      v-model:open="dialogOpen"
      :title="editMode === 'create' ? '新建证书产物配置文件' : '编辑证书产物配置文件'"
      description="这里只保存导出规则配置，不会立即生成真实产物。"
      size="xl"
    >
      <section class="artifact-form">
        <section class="artifact-form__section">
          <header class="artifact-form__section-header">
            <div>
              <h3>基础信息</h3>
              <p>先定义配置文件身份和最终输出格式。</p>
            </div>
          </header>
          <div class="artifact-form__grid">
            <label class="artifact-form__field">
              <span>配置文件名称</span>
              <input v-model="draft.configName" placeholder="例如：Nginx-PFX-标准模板" />
            </label>
            <label class="artifact-form__field">
              <span>Alias（可选）</span>
              <input v-model="draft.alias" placeholder="例如 gcac-cert" />
            </label>
            <label class="artifact-form__field">
              <span>格式类型</span>
              <select v-model="draft.presetFormat">
                <option value="pfx">PFX / PKCS#12</option>
                <option value="pem">PEM</option>
                <option value="cer">CER</option>
                <option value="crt">CRT</option>
                <option value="key">KEY</option>
                <option value="jks">JKS</option>
                <option value="p7b">P7B</option>
                <option value="custom">自定义</option>
              </select>
            </label>
            <label v-if="draft.presetFormat === 'custom'" class="artifact-form__field">
              <span>底层格式</span>
              <select v-model="draft.customBackendFormat">
                <option value="pem">PEM</option>
                <option value="der">DER</option>
                <option value="pfx">PFX</option>
                <option value="jks">JKS</option>
                <option value="p7b">P7B</option>
              </select>
            </label>
            <label class="artifact-form__field">
              <span>扩展名</span>
              <input v-model="draft.customExtension" :placeholder="draft.presetFormat === 'custom' ? '例如 certbundle' : resolvedExtension" />
            </label>
            <label class="artifact-form__field">
              <span>配置失效时间（可选）</span>
              <input v-model="draft.expiresAt" placeholder="2026-12-31T23:59:59Z" />
            </label>
          </div>
        </section>

        <section class="artifact-form__section">
          <header class="artifact-form__section-header">
            <div>
              <h3>编码选择</h3>
              <p>分别定义公钥与私钥的导出编码。</p>
            </div>
          </header>
          <div class="artifact-form__grid">
            <label class="artifact-form__field">
              <span>公钥编码</span>
              <select v-model="draft.publicEncoding">
                <option value="pem">PEM</option>
                <option value="der">DER</option>
                <option value="base64">Base64</option>
              </select>
            </label>
            <label class="artifact-form__field">
              <span>私钥编码</span>
              <select v-model="draft.privateEncoding">
                <option value="pem">PEM</option>
                <option value="pkcs8">PKCS#8</option>
                <option value="base64">Base64</option>
              </select>
            </label>
          </div>
        </section>

        <section class="artifact-form__section">
          <header class="artifact-form__section-header">
            <div>
              <h3>导出选项</h3>
              <p>定义文件组织方式、额外输出物，以及加密容器专属选项。</p>
            </div>
          </header>
          <div class="artifact-form__grid">
            <label class="artifact-form__field artifact-form__field--wide">
              <span>公钥文件组织方式</span>
              <select v-model="draft.bundleMode">
                <option value="leaf_only">仅服务器公钥</option>
                <option value="leaf_with_chain">服务器公钥 + 证书链</option>
                <option value="leaf_chain_with_key">服务器公钥 + 证书链 + 私钥</option>
              </select>
            </label>

            <label class="artifact-form__check">
              <input v-model="draft.generateChainFile" type="checkbox" />
              <span>额外生成证书链文件</span>
            </label>

            <label class="artifact-form__check">
              <input v-model="draft.generatePrivateKeyFile" type="checkbox" />
              <span>额外生成私钥文件</span>
            </label>

            <template v-if="needsPassword">
              <label class="artifact-form__check">
                <input v-model="draft.containsPrivateKey" type="checkbox" />
                <span>主产物包含私钥</span>
              </label>

              <label class="artifact-form__field">
                <span>passwordSecretRef</span>
                <input v-model="draft.passwordSecretRef" placeholder="secret://pfx_password/..." />
              </label>
            </template>
          </div>
        </section>

        <p v-if="actionError" class="artifact-form__error">{{ actionError }}</p>
        <p v-else-if="requestId" class="artifact-form__request">请求 ID：{{ requestId }}</p>
      </section>

      <template #actions>
        <button class="gc-button" type="button" :disabled="submitLoading" @click="closeDialog">取消</button>
        <button class="gc-button gc-button--danger" type="button" :disabled="submitLoading" @click="submitDraft">
          {{ submitLoading ? '保存中...' : '确认保存' }}
        </button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.artifact-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
}

.artifact-page__toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: stretch;
}

.artifact-page__filters {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(180px, 220px) auto;
  gap: 8px;
  align-items: center;
  padding: 0;
  border-radius: 16px;
}

.artifact-page__filter {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.artifact-page__filter-label {
  flex: 0 0 auto;
  white-space: nowrap;
}

.artifact-page__filter input,
.artifact-page__filter select {
  flex: 1;
  border: 1px solid var(--gc-color-border);
  border-radius: 12px;
  min-height: 32px;
  padding: 6px 10px;
  background: rgb(255 255 255 / 76%);
}

.artifact-page__filter-actions,
.artifact-page__toolbar-actions {
  display: flex;
  align-items: center;
}

.artifact-page__create-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 0 18px;
  border: 0;
  border-radius: 16px;
  color: #fff;
  background: linear-gradient(180deg, #1783ff, #0a6bff);
  box-shadow: 0 10px 24px rgb(10 107 255 / 22%);
  font-weight: 700;
  white-space: nowrap;
}

.artifact-page__table :deep(table) {
  table-layout: fixed;
}

.artifact-page__table-toolbar,
.artifact-page__table-heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.artifact-page__table-heading {
  display: grid;
  color: var(--gc-color-text-muted);
}

.artifact-page__table-heading strong {
  color: var(--gc-color-text);
}

.artifact-page__cell-stack {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.artifact-page__cell-stack span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.artifact-page__actions-cell {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.artifact-form {
  display: grid;
  gap: 14px;
}

.artifact-form__section {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid rgb(15 23 42 / 8%);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 96%), rgb(247 250 255 / 92%)),
    radial-gradient(circle at top right, rgb(23 131 255 / 8%), transparent 40%);
}

.artifact-form__section-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.artifact-form__section-header h3,
.artifact-form__section-header p {
  margin: 0;
}

.artifact-form__section-header h3 {
  color: var(--gc-color-text);
  font-size: 16px;
  font-weight: 800;
}

.artifact-form__section-header p {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.artifact-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.artifact-form__field,
.artifact-form__check {
  display: grid;
  gap: 8px;
}

.artifact-form__field {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 800;
}

.artifact-form__field--wide {
  grid-column: 1 / -1;
}

.artifact-form__field input,
.artifact-form__field select {
  width: 100%;
  border: 1px solid rgb(15 23 42 / 10%);
  border-radius: 14px;
  padding: 12px 14px;
  background: #fff;
  box-shadow: inset 0 1px 2px rgb(15 23 42 / 3%);
}

.artifact-form__check {
  grid-template-columns: auto 1fr;
  align-items: center;
  min-height: 48px;
  padding: 0 2px;
  color: var(--gc-color-text);
  font-weight: 700;
}

.artifact-form__error,
.artifact-form__request {
  margin: 0;
  font-weight: 800;
}

.artifact-form__error {
  color: var(--gc-color-danger);
}

.artifact-form__request {
  color: var(--gc-color-text-muted);
}

@media (max-width: 900px) {
  .artifact-page__toolbar {
    grid-template-columns: 1fr;
  }

  .artifact-page__filters {
    grid-template-columns: 1fr;
  }

  .artifact-page__toolbar-actions {
    justify-content: stretch;
  }

  .artifact-page__create-button {
    width: 100%;
    min-height: 44px;
  }

  .artifact-form__grid {
    grid-template-columns: 1fr;
  }
}
</style>

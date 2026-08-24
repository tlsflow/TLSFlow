<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ApiClientError } from '@/api/client'
import { createSecret } from '@/api/modules/security.api'
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

type PresetFormat = 'pfx' | 'pem_bundle' | 'pem_cert' | 'pem_key' | 'cer' | 'crt' | 'jks' | 'p7b' | 'custom'
type BackendFormat = 'pem' | 'pfx' | 'jks' | 'p7b' | 'der'
type PublicEncoding = 'pem' | 'der' | 'base64'
type PrivateEncoding = 'pem' | 'pkcs8' | 'base64'
type SystemPlatform = 'windows' | 'linux' | ''
type RuntimePlatform = 'iis' | 'nginx' | 'apache' | 'tomcat' | 'other' | ''

interface ArtifactDraft {
  id: string
  configName: string
  alias: string
  systemPlatform: SystemPlatform
  runtimePlatform: RuntimePlatform
  presetFormat: PresetFormat
  customBackendFormat: BackendFormat
  customExtension: string
  publicEncoding: PublicEncoding
  privateEncoding: PrivateEncoding
  includeLeafCertificate: boolean
  includeCertificateChain: boolean
  includePrivateKey: boolean
  generateChainFile: boolean
  generatePrivateKeyFile: boolean
  passwordValue: string
  hasSavedPassword: boolean
  passwordSecretRef: string
  expiresAt: string
}

interface FormatRow extends Record<string, unknown> {
  id: string
  configName: string
  alias: string
  targetSummary: string
  displayFormat: string
  extension: string
  encodingSummary: string
  exportSummary: string
  raw: ApiRecord
}

interface TemplatePreset {
  readonly configName: string
  readonly alias: string
  readonly presetFormat: PresetFormat
  readonly publicEncoding: PublicEncoding
  readonly privateEncoding: PrivateEncoding
  readonly includeLeafCertificate: boolean
  readonly includeCertificateChain: boolean
  readonly includePrivateKey: boolean
  readonly generateChainFile: boolean
  readonly generatePrivateKeyFile: boolean
  readonly passwordSecretRef: string
  readonly description: string
}

const TEMPLATE_PRESETS: Record<Exclude<SystemPlatform, ''>, Record<Exclude<RuntimePlatform, ''>, TemplatePreset>> = {
  windows: {
    iis: {
      configName: 'Windows-IIS-PKCS12-标准模板',
      alias: '',
      presetFormat: 'pfx',
      publicEncoding: 'pem',
      privateEncoding: 'pkcs8',
      includeLeafCertificate: true,
      includeCertificateChain: true,
      includePrivateKey: true,
      generateChainFile: false,
      generatePrivateKeyFile: false,
      passwordSecretRef: '',
      description: 'IIS 使用 PKCS#12/PFX 容器最常见，主产物内直接携带服务器证书、证书链和私钥。',
    },
    nginx: {
      configName: 'Windows-NGINX-PEM-标准模板',
      alias: '',
      presetFormat: 'pem_bundle',
      publicEncoding: 'pem',
      privateEncoding: 'pem',
      includeLeafCertificate: true,
      includeCertificateChain: true,
      includePrivateKey: false,
      generateChainFile: false,
      generatePrivateKeyFile: true,
      passwordSecretRef: '',
      description: 'NGINX 主流使用 PEM 单文件承载服务器证书与链，再配独立私钥文件。',
    },
    apache: {
      configName: 'Windows-Apache-PEM-标准模板',
      alias: '',
      presetFormat: 'pem_bundle',
      publicEncoding: 'pem',
      privateEncoding: 'pem',
      includeLeafCertificate: true,
      includeCertificateChain: true,
      includePrivateKey: false,
      generateChainFile: true,
      generatePrivateKeyFile: true,
      passwordSecretRef: '',
      description: 'Apache 通常以 PEM 证书文件和独立私钥交付，链文件额外导出便于兼容不同运维习惯。',
    },
    tomcat: {
      configName: 'Windows-Tomcat-PKCS12-标准模板',
      alias: 'tomcat',
      presetFormat: 'pfx',
      publicEncoding: 'pem',
      privateEncoding: 'pkcs8',
      includeLeafCertificate: true,
      includeCertificateChain: true,
      includePrivateKey: true,
      generateChainFile: false,
      generatePrivateKeyFile: false,
      passwordSecretRef: '',
      description: 'Tomcat 以 JKS/PKCS#12 keystore 为主，这里默认使用更通用的 PKCS#12。',
    },
    other: {
      configName: 'Windows-设备兼容单文件PEM模板',
      alias: '',
      presetFormat: 'pem_bundle',
      publicEncoding: 'pem',
      privateEncoding: 'pem',
      includeLeafCertificate: true,
      includeCertificateChain: true,
      includePrivateKey: true,
      generateChainFile: false,
      generatePrivateKeyFile: false,
      passwordSecretRef: '',
      description: '兼容部分设备要求：单文件中同时包含公钥证书、证书链与私钥，扩展名可再改成 .crt/.cer。',
    },
  },
  linux: {
    iis: {
      configName: 'Linux-IIS-兼容模板',
      alias: '',
      presetFormat: 'pfx',
      publicEncoding: 'pem',
      privateEncoding: 'pkcs8',
      includeLeafCertificate: true,
      includeCertificateChain: true,
      includePrivateKey: true,
      generateChainFile: false,
      generatePrivateKeyFile: false,
      passwordSecretRef: '',
      description: '如果最终目标仍是 IIS，最合理的交付物仍然是 PKCS#12/PFX 容器。',
    },
    nginx: {
      configName: 'Linux-NGINX-PEM-标准模板',
      alias: '',
      presetFormat: 'pem_bundle',
      publicEncoding: 'pem',
      privateEncoding: 'pem',
      includeLeafCertificate: true,
      includeCertificateChain: true,
      includePrivateKey: false,
      generateChainFile: false,
      generatePrivateKeyFile: true,
      passwordSecretRef: '',
      description: 'NGINX 官方配置围绕 PEM 单文件证书链与独立私钥展开。',
    },
    apache: {
      configName: 'Linux-Apache-PEM-标准模板',
      alias: '',
      presetFormat: 'pem_bundle',
      publicEncoding: 'pem',
      privateEncoding: 'pem',
      includeLeafCertificate: true,
      includeCertificateChain: true,
      includePrivateKey: false,
      generateChainFile: true,
      generatePrivateKeyFile: true,
      passwordSecretRef: '',
      description: 'Apache 常见做法是 PEM 证书文件配独立私钥，链文件额外导出便于拆分部署。',
    },
    tomcat: {
      configName: 'Linux-Tomcat-PKCS12-标准模板',
      alias: 'tomcat',
      presetFormat: 'pfx',
      publicEncoding: 'pem',
      privateEncoding: 'pkcs8',
      includeLeafCertificate: true,
      includeCertificateChain: true,
      includePrivateKey: true,
      generateChainFile: false,
      generatePrivateKeyFile: false,
      passwordSecretRef: '',
      description: 'Tomcat 默认建议交付 keystore 容器，这里使用更通用的 PKCS#12。',
    },
    other: {
      configName: 'Linux-设备兼容单文件PEM模板',
      alias: '',
      presetFormat: 'pem_bundle',
      publicEncoding: 'pem',
      privateEncoding: 'pem',
      includeLeafCertificate: true,
      includeCertificateChain: true,
      includePrivateKey: false,
      generateChainFile: false,
      generatePrivateKeyFile: true,
      passwordSecretRef: '',
      description: 'Linux 通用设备若接受单文件 PEM，可先用 bundle 形式，再按目标设备调整扩展名与包含内容。',
    },
  },
}

const SYSTEM_PLATFORM_OPTIONS: Array<{ value: Exclude<SystemPlatform, ''>; label: string }> = [
  { value: 'windows', label: 'Windows' },
  { value: 'linux', label: 'Linux' },
]

const RUNTIME_PLATFORM_OPTIONS: Record<Exclude<SystemPlatform, ''>, Array<{ value: Exclude<RuntimePlatform, ''>; label: string }>> = {
  windows: [
    { value: 'iis', label: 'IIS' },
    { value: 'nginx', label: 'NGINX' },
    { value: 'apache', label: 'Apache' },
    { value: 'tomcat', label: 'Tomcat' },
    { value: 'other', label: 'Other' },
  ],
  linux: [
    { value: 'nginx', label: 'NGINX' },
    { value: 'apache', label: 'Apache' },
    { value: 'tomcat', label: 'Tomcat' },
    { value: 'other', label: 'Other' },
    { value: 'iis', label: 'IIS' },
  ],
}

const FORMAT_OPTIONS: Array<{ value: PresetFormat; label: string }> = [
  { value: 'pfx', label: 'PKCS#12 / PFX 容器' },
  { value: 'jks', label: 'JKS 容器' },
  { value: 'pem_bundle', label: 'PEM 单文件 Bundle' },
  { value: 'pem_cert', label: 'PEM 证书文件' },
  { value: 'pem_key', label: '私钥文件' },
  { value: 'cer', label: '证书文件（.cer）' },
  { value: 'crt', label: '证书文件（.crt）' },
  { value: 'p7b', label: 'PKCS#7 / P7B 证书链' },
  { value: 'custom', label: '自定义' },
]

const loading = ref(false)
const submitLoading = ref(false)
const deleteLoadingId = ref('')
const dialogOpen = ref(false)
const error = ref('')
const actionError = ref('')
const requestId = ref('')
const templateMessage = ref('')
const editMode = ref<'create' | 'edit'>('create')
const formatItems = ref<ApiRecord[]>([])
const filters = reactive({
  keyword: '',
  format: '',
})
const draft = reactive(createEmptyDraft())

const resolvedBackendFormat = computed(() => resolveBackendFormat(draft))
const resolvedExtension = computed(() => resolveExtension(draft))
const isContainerFormat = computed(() => resolvedBackendFormat.value === 'pfx' || resolvedBackendFormat.value === 'jks')
const isPemBundleFormat = computed(() => draft.presetFormat === 'pem_bundle')
const isCertificateOnlyFormat = computed(() => ['pem_cert', 'cer', 'crt'].includes(draft.presetFormat))
const isPrivateKeyOnlyFormat = computed(() => draft.presetFormat === 'pem_key')
const isChainOnlyFormat = computed(() => draft.presetFormat === 'p7b')
const showsPublicEncoding = computed(() => !isContainerFormat.value && !isPrivateKeyOnlyFormat.value && !isChainOnlyFormat.value)
const showsPrivateEncoding = computed(() => !isContainerFormat.value && (isPemBundleFormat.value || isPrivateKeyOnlyFormat.value || draft.presetFormat === 'custom'))
const showsContentSelection = computed(() => !isContainerFormat.value)
const showsPasswordSecret = computed(() => isContainerFormat.value)
const runtimeOptions = computed(() => {
  if (!draft.systemPlatform) return []
  return RUNTIME_PLATFORM_OPTIONS[draft.systemPlatform]
})
const selectedTemplate = computed(() => {
  if (!draft.systemPlatform || !draft.runtimePlatform) return null
  return TEMPLATE_PRESETS[draft.systemPlatform][draft.runtimePlatform]
})

const rows = computed<FormatRow[]>(() => {
  const keyword = filters.keyword.trim().toLowerCase()
  const format = filters.format.trim().toLowerCase()
  return formatItems.value
    .map((item, index) => {
      const parameters = readRecord(item.parameters)
      const presetFormat = normalizePresetFormat(String(parameters.outputPreset ?? item.format ?? 'pem_bundle'))
      const configName = String(parameters.configName ?? parameters.alias ?? `未命名配置-${index + 1}`)
      const alias = String(parameters.alias ?? '-')
      const targetSummary = renderTargetSummary(parameters)
      const displayFormat = renderFormatLabel(presetFormat)
      const extension = String(parameters.extension ?? item.format ?? '-')
      const encodingSummary = renderEncodingSummary(item, parameters)
      const exportSummary = renderExportSummary(item, parameters)
      return {
        id: readString(item, ['id'], `certfmt-${index + 1}`),
        configName,
        alias,
        targetSummary,
        displayFormat,
        extension,
        encodingSummary,
        exportSummary,
        raw: item,
      }
    })
    .filter((item) => {
      if (format && item.displayFormat.toLowerCase() !== format) return false
      if (!keyword) return true
      return [
        item.configName,
        item.alias,
        item.targetSummary,
        item.displayFormat,
        item.extension,
        item.encodingSummary,
        item.exportSummary,
      ].join('\n').toLowerCase().includes(keyword)
    })
})

const columns: DataTableColumn<FormatRow>[] = [
  { key: 'configName', title: '配置文件名称', width: '22%' },
  { key: 'targetSummary', title: '目标环境', width: '16%' },
  { key: 'displayFormat', title: '内容格式', width: '14%' },
  { key: 'extension', title: '扩展名', width: '10%' },
  { key: 'encodingSummary', title: '编码', width: '14%' },
  { key: 'exportSummary', title: '包含内容 / 导出选项', width: '22%' },
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
    error.value = toErrorMessage(cause, '加载证书格式配置失败')
  } finally {
    loading.value = false
  }
}

function createEmptyDraft(): ArtifactDraft {
  return {
    id: '',
    configName: '',
    alias: '',
    systemPlatform: '',
    runtimePlatform: '',
    presetFormat: 'pfx',
    customBackendFormat: 'pem',
    customExtension: '',
    publicEncoding: 'pem',
    privateEncoding: 'pkcs8',
    includeLeafCertificate: true,
    includeCertificateChain: true,
    includePrivateKey: true,
    generateChainFile: false,
    generatePrivateKeyFile: false,
    passwordValue: '',
    hasSavedPassword: false,
    passwordSecretRef: '',
    expiresAt: '',
  }
}

function openCreateDialog() {
  Object.assign(draft, createEmptyDraft())
  editMode.value = 'create'
  actionError.value = ''
  requestId.value = ''
  templateMessage.value = ''
  dialogOpen.value = true
}

function openEditDialog(row: FormatRow) {
  const parameters = readRecord(row.raw.parameters)
  const presetFormat = normalizePresetFormat(String(parameters.outputPreset ?? row.raw.format ?? 'pem_bundle'))
  Object.assign(draft, {
    id: row.id,
    configName: String(parameters.configName ?? row.configName ?? ''),
    alias: String(parameters.alias ?? ''),
    systemPlatform: normalizeSystemPlatform(String(parameters.systemPlatform ?? '')),
    runtimePlatform: normalizeRuntimePlatform(String(parameters.runtimePlatform ?? '')),
    presetFormat,
    customBackendFormat: normalizeBackendFormat(String(parameters.engineFormat ?? row.raw.format ?? 'pem')),
    customExtension: isCustomLike(presetFormat) ? String(parameters.extension ?? '') : '',
    publicEncoding: normalizePublicEncoding(String(parameters.publicEncoding ?? 'pem')),
    privateEncoding: normalizePrivateEncoding(String(parameters.privateEncoding ?? 'pkcs8')),
    includeLeafCertificate: parameters.includeLeafCertificate !== false,
    includeCertificateChain: Boolean(parameters.includeCertificateChain),
    includePrivateKey: Boolean(row.raw.containsPrivateKey || parameters.includePrivateKey),
    generateChainFile: Boolean(parameters.generateChainFile),
    generatePrivateKeyFile: Boolean(parameters.generatePrivateKeyFile),
    passwordValue: '',
    hasSavedPassword: Boolean(readString(row.raw, ['passwordSecretRef'], '').trim()),
    passwordSecretRef: readString(row.raw, ['passwordSecretRef'], ''),
    expiresAt: readString(row.raw, ['expiresAt'], ''),
  } satisfies ArtifactDraft)
  editMode.value = 'edit'
  actionError.value = ''
  requestId.value = ''
  templateMessage.value = selectedTemplate.value?.description ?? ''
  dialogOpen.value = true
}

function closeDialog() {
  if (!submitLoading.value) {
    dialogOpen.value = false
  }
}

function handleSystemPlatformChange() {
  draft.runtimePlatform = ''
  templateMessage.value = ''
}

function applyTemplate() {
  if (!draft.systemPlatform || !draft.runtimePlatform) {
    templateMessage.value = '请先选择系统平台和目标平台。'
    return
  }

  const preset = TEMPLATE_PRESETS[draft.systemPlatform][draft.runtimePlatform]
  Object.assign(draft, {
    configName: preset.configName,
    alias: preset.alias,
    presetFormat: preset.presetFormat,
    customBackendFormat: 'pem',
    customExtension: '',
    publicEncoding: preset.publicEncoding,
    privateEncoding: preset.privateEncoding,
    includeLeafCertificate: preset.includeLeafCertificate,
    includeCertificateChain: preset.includeCertificateChain,
    includePrivateKey: preset.includePrivateKey,
    generateChainFile: preset.generateChainFile,
    generatePrivateKeyFile: preset.generatePrivateKeyFile,
    passwordValue: '',
    hasSavedPassword: false,
    passwordSecretRef: preset.passwordSecretRef,
  } satisfies Partial<ArtifactDraft>)
  templateMessage.value = preset.description
}

async function submitDraft() {
  if (!draft.configName.trim()) {
    actionError.value = '必须填写配置文件名称'
    return
  }

  if (showsPasswordSecret.value && !draft.passwordValue.trim() && !draft.hasSavedPassword) {
    actionError.value = 'PFX/JKS 配置必须填写导出密码'
    return
  }

  submitLoading.value = true
  actionError.value = ''
  requestId.value = ''

  try {
    await resolvePasswordSecretRef()
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
      actionError.value = toErrorMessage(cause, '保存证书格式配置失败')
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
    error.value = toErrorMessage(cause, '删除证书格式配置失败')
  } finally {
    deleteLoadingId.value = ''
  }
}

async function resolvePasswordSecretRef(): Promise<string> {
  if (!showsPasswordSecret.value) {
    return ''
  }
  if (draft.passwordValue.trim()) {
    const secret = await createSecret({
      name: `${draft.configName.trim() || '证书格式配置'} 导出密码`,
      type: 'pfx_password',
      scopeType: 'global',
      plainText: draft.passwordValue.trim(),
    })
    const secretRef = String(secret.data?.secretRef ?? '')
    if (!secretRef) {
      throw new Error('创建导出密码 Secret 失败')
    }
    draft.passwordSecretRef = secretRef
    draft.passwordValue = ''
    draft.hasSavedPassword = true
    return secretRef
  }
  if (draft.hasSavedPassword && draft.passwordSecretRef.trim()) {
    return draft.passwordSecretRef.trim()
  }
  return ''
}

function buildPayload() {
  const passwordSecretRef = showsPasswordSecret.value ? draft.passwordSecretRef.trim() : ''
  return {
    format: resolvedBackendFormat.value,
    containsPrivateKey: resolveContainsPrivateKey(),
    ...(passwordSecretRef ? { passwordSecretRef } : {}),
    ...(draft.expiresAt.trim() ? { expiresAt: draft.expiresAt.trim() } : {}),
    parameters: {
      configName: draft.configName.trim(),
      systemPlatform: draft.systemPlatform || undefined,
      runtimePlatform: draft.runtimePlatform || undefined,
      outputPreset: draft.presetFormat,
      engineFormat: resolvedBackendFormat.value,
      extension: resolvedExtension.value,
      ...(showsPublicEncoding.value ? { publicEncoding: draft.publicEncoding } : {}),
      ...(showsPrivateEncoding.value ? { privateEncoding: draft.privateEncoding } : {}),
      includeLeafCertificate: draft.includeLeafCertificate,
      includeCertificateChain: draft.includeCertificateChain,
      includePrivateKey: resolveContainsPrivateKey(),
      generateChainFile: draft.generateChainFile,
      generatePrivateKeyFile: draft.generatePrivateKeyFile,
      ...(draft.alias.trim() ? { alias: draft.alias.trim() } : {}),
    },
  }
}

function isSecretRef(value: string) {
  return /^secret:\/\/[a-z0-9_/-]+(?:#[a-z0-9_-]+)?$/i.test(value.trim())
}

function resolveContainsPrivateKey() {
  if (isContainerFormat.value) return draft.includePrivateKey
  return draft.includePrivateKey
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
  if (input.customExtension.trim()) {
    return input.customExtension.trim()
  }
  if (input.presetFormat === 'custom') {
    return input.customBackendFormat
  }
  return {
    pfx: 'pfx',
    pem_bundle: 'pem',
    pem_cert: 'pem',
    pem_key: 'key',
    cer: 'cer',
    crt: 'crt',
    jks: 'jks',
    p7b: 'p7b',
    custom: '',
  }[input.presetFormat]
}

function renderTargetSummary(parameters: Record<string, unknown>) {
  const systemPlatform = renderSystemPlatform(String(parameters.systemPlatform ?? ''))
  const runtimePlatform = renderRuntimePlatform(String(parameters.runtimePlatform ?? ''))
  if (!systemPlatform && !runtimePlatform) return '未指定'
  return [systemPlatform, runtimePlatform].filter(Boolean).join(' / ')
}

function renderFormatLabel(value: PresetFormat) {
  return FORMAT_OPTIONS.find((item) => item.value === value)?.label ?? value
}

function renderEncodingSummary(item: ApiRecord, parameters: Record<string, unknown>) {
  const format = normalizePresetFormat(String(parameters.outputPreset ?? item.format ?? 'pem_bundle'))
  switch (format) {
    case 'pfx':
      return 'PKCS#12 容器'
    case 'jks':
      return 'JKS 容器'
    case 'pem_key':
      return `私钥 ${String(parameters.privateEncoding ?? 'pem').toUpperCase()}`
    case 'p7b':
      return 'PKCS#7 证书链'
    default:
      return [
        parameters.publicEncoding ? `证书 ${String(parameters.publicEncoding).toUpperCase()}` : '',
        parameters.privateEncoding ? `私钥 ${String(parameters.privateEncoding).toUpperCase()}` : '',
      ].filter(Boolean).join(' / ') || '默认'
  }
}

function renderExportSummary(item: ApiRecord, parameters: Record<string, unknown>) {
  const segments: string[] = []
  if (parameters.includeLeafCertificate !== false) segments.push('公钥')
  if (parameters.includeCertificateChain) segments.push('证书链')
  if (item.containsPrivateKey || parameters.includePrivateKey) segments.push('私钥')
  if (parameters.generateChainFile) segments.push('额外链文件')
  if (parameters.generatePrivateKeyFile) segments.push('额外私钥文件')
  return segments.length > 0 ? segments.join(' · ') : '未指定'
}

function renderSystemPlatform(value: string) {
  switch (value) {
    case 'windows':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return ''
  }
}

function renderRuntimePlatform(value: string) {
  switch (value) {
    case 'iis':
      return 'IIS'
    case 'nginx':
      return 'NGINX'
    case 'apache':
      return 'Apache'
    case 'tomcat':
      return 'Tomcat'
    case 'other':
      return 'Other'
    default:
      return ''
  }
}

function isCustomLike(value: PresetFormat) {
  return value === 'custom'
}

function normalizePresetFormat(value: string): PresetFormat {
  if (['pfx', 'pem_bundle', 'pem_cert', 'pem_key', 'cer', 'crt', 'jks', 'p7b', 'custom'].includes(value)) {
    return value as PresetFormat
  }
  if (value === 'pem') return 'pem_bundle'
  if (value === 'der') return 'cer'
  return 'pem_bundle'
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
  return 'pkcs8'
}

function normalizeSystemPlatform(value: string): SystemPlatform {
  if (value === 'windows' || value === 'linux') return value
  return ''
}

function normalizeRuntimePlatform(value: string): RuntimePlatform {
  if (['iis', 'nginx', 'apache', 'tomcat', 'other'].includes(value)) return value as RuntimePlatform
  return ''
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
          <input v-model="filters.keyword" placeholder="配置名称 / 目标环境 / Alias / 内容格式" />
        </label>
        <label class="artifact-page__filter">
          <span class="artifact-page__filter-label">内容格式</span>
          <select v-model="filters.format">
            <option value="">全部</option>
            <option v-for="item in FORMAT_OPTIONS" :key="item.value" :value="item.label.toUpperCase()">{{ item.label }}</option>
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

    <GcEmptyState v-if="error" title="证书格式配置加载失败" :description="error">
      <button class="gc-button" type="button" @click="loadFormats">重试</button>
    </GcEmptyState>

    <GcDataTable
      v-else
      class="artifact-page__table"
      :columns="columns"
      :rows="rows"
      :loading="loading"
      empty-text="暂无证书格式配置"
    >
      <template #toolbar>
        <div class="artifact-page__table-toolbar">
          <div class="artifact-page__table-heading">
            <strong>证书格式配置列表</strong>
            <span>这里保存的是可复用的证书格式模板。当前 {{ rows.length }} 条</span>
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
      :title="editMode === 'create' ? '新建证书格式配置' : '编辑证书格式配置'"
      description="这里先选择系统平台与目标平台，再套用内置模板，最后仍可逐项调整，并明确单文件中包含哪些内容。"
      size="xl"
    >
      <section class="artifact-form">
        <section class="artifact-form__section artifact-form__section--template">
          <header class="artifact-form__section-header">
            <div>
              <h3>内置模板</h3>
              <p>模板基于各平台常见 TLS 落地方式预填内容格式、包含内容和导出规则，套用后仍可继续修改。</p>
            </div>
          </header>
          <div class="artifact-form__grid">
            <label class="artifact-form__field">
              <span>系统平台</span>
              <select v-model="draft.systemPlatform" @change="handleSystemPlatformChange">
                <option value="">请选择</option>
                <option v-for="item in SYSTEM_PLATFORM_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
            <label class="artifact-form__field">
              <span>目标平台</span>
              <select v-model="draft.runtimePlatform" :disabled="!draft.systemPlatform">
                <option value="">请选择</option>
                <option v-for="item in runtimeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
          </div>
          <div class="artifact-form__template-actions">
            <button class="gc-button" type="button" :disabled="!draft.systemPlatform || !draft.runtimePlatform" @click="applyTemplate">
              套用内置模板
            </button>
            <p v-if="templateMessage" class="artifact-form__template-message">{{ templateMessage }}</p>
            <p v-else-if="selectedTemplate" class="artifact-form__template-message">{{ selectedTemplate.description }}</p>
          </div>
        </section>

        <section class="artifact-form__section">
          <header class="artifact-form__section-header">
            <div>
              <h3>基础信息</h3>
              <p>先定义配置文件身份、真实内容格式，以及最终扩展名。</p>
            </div>
          </header>
          <div class="artifact-form__grid">
            <label class="artifact-form__field">
              <span>配置文件名称</span>
              <input v-model="draft.configName" placeholder="例如：设备兼容单文件PEM" />
            </label>
            <label class="artifact-form__field">
              <span>Alias（可选）</span>
              <input v-model="draft.alias" placeholder="例如 gcac-cert" />
            </label>
            <label class="artifact-form__field">
              <span>内容格式</span>
              <select v-model="draft.presetFormat">
                <option v-for="item in FORMAT_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
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
              <span>输出扩展名</span>
              <input v-model="draft.customExtension" :placeholder="resolvedExtension" />
            </label>
            <label class="artifact-form__field">
              <span>配置失效时间（可选）</span>
              <input v-model="draft.expiresAt" placeholder="2026-12-31T23:59:59Z" />
            </label>
          </div>
        </section>

        <section v-if="showsPublicEncoding || showsPrivateEncoding" class="artifact-form__section">
          <header class="artifact-form__section-header">
            <div>
              <h3>编码选择</h3>
              <p>只显示对当前内容格式真正成立的编码项。</p>
            </div>
          </header>
          <div class="artifact-form__grid">
            <label v-if="showsPublicEncoding" class="artifact-form__field">
              <span>{{ isCertificateOnlyFormat ? '证书编码' : '证书内容编码' }}</span>
              <select v-model="draft.publicEncoding">
                <option value="pem">PEM</option>
                <option value="der">DER</option>
                <option value="base64">Base64</option>
              </select>
            </label>
            <label v-if="showsPrivateEncoding" class="artifact-form__field">
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
              <h3>包含内容</h3>
              <p>这里定义主产物文件中实际包含哪些内容：公钥、证书链、私钥。</p>
            </div>
          </header>
          <div class="artifact-form__grid">
            <label v-if="showsContentSelection" class="artifact-form__check">
              <input v-model="draft.includeLeafCertificate" type="checkbox" />
              <span>包含公钥证书</span>
            </label>
            <label v-if="showsContentSelection" class="artifact-form__check">
              <input v-model="draft.includeCertificateChain" type="checkbox" />
              <span>包含证书链</span>
            </label>
            <label v-if="showsContentSelection || isContainerFormat" class="artifact-form__check">
              <input v-model="draft.includePrivateKey" type="checkbox" />
              <span>包含私钥</span>
            </label>
          </div>
        </section>

        <section class="artifact-form__section">
          <header class="artifact-form__section-header">
            <div>
              <h3>导出选项</h3>
              <p>定义是否额外生成链文件、私钥文件，以及容器专属密码选项。</p>
            </div>
          </header>
          <div class="artifact-form__grid">
            <label class="artifact-form__check">
              <input v-model="draft.generateChainFile" type="checkbox" />
              <span>{{ isContainerFormat ? '主产物包含证书链' : '额外生成证书链文件' }}</span>
            </label>
            <label class="artifact-form__check">
              <input v-model="draft.generatePrivateKeyFile" type="checkbox" />
              <span>额外生成私钥文件</span>
            </label>
            <label v-if="showsPasswordSecret" class="artifact-form__field">
              <span>导出密码</span>
              <input v-model="draft.passwordValue" type="password" placeholder="请输入 PFX/JKS 导出密码" />
            </label>
          </div>
          <p v-if="showsPasswordSecret && draft.hasSavedPassword" class="artifact-form__template-message">已配置导出密码；如需更换，请直接输入新密码覆盖。</p>
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
  grid-template-columns: minmax(0, 1.3fr) minmax(220px, 280px) auto;
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

.artifact-page__toolbar-actions {
  gap: 10px;
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

.artifact-form__section--template {
  background:
    linear-gradient(180deg, rgb(240 247 255 / 96%), rgb(255 255 255 / 92%)),
    radial-gradient(circle at top left, rgb(10 107 255 / 10%), transparent 45%);
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

.artifact-form__template-actions {
  display: grid;
  gap: 10px;
}

.artifact-form__template-message {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.7;
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

.artifact-export {
  display: grid;
  gap: 14px;
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

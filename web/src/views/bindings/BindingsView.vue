<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
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
  GcPageHeader,
  GcPageToolbar,
  GcPermissionButton,
} from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'

type PresetFormat = 'pfx' | 'pem_bundle' | 'pem_cert' | 'pem_key' | 'cer' | 'crt' | 'jks' | 'p7b' | 'custom'
type BackendFormat = 'pem' | 'pfx' | 'jks' | 'p7b' | 'der'
type PublicEncoding = 'pem' | 'der' | 'base64'
type PrivateEncoding = 'pem' | 'pkcs8' | 'base64'
type SystemPlatform = 'windows' | 'linux' | ''

interface ArtifactDraft {
  id: string
  configName: string
  alias: string
  systemPlatform: SystemPlatform
  runtimePlatform: string
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
  readonly configNameKey: string
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
  readonly descriptionKey: string
}

const { t } = useI18n()
const shouldTeleportToolbarActions = computed(() => typeof document !== 'undefined' && Boolean(document.querySelector('#gc-shell-hero-actions')))

const PLATFORM_PRESETS: Record<Exclude<SystemPlatform, ''>, TemplatePreset> = {
  windows: {
    configNameKey: 'bindings.templates.windowsOther.configName',
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
    descriptionKey: 'bindings.templates.windowsOther.description',
  },
  linux: {
    configNameKey: 'bindings.templates.linuxOther.configName',
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
    descriptionKey: 'bindings.templates.linuxOther.description',
  },
}

const SYSTEM_PLATFORM_OPTIONS: Array<{ value: Exclude<SystemPlatform, ''>; labelKey: string }> = [
  { value: 'windows', labelKey: 'assets.platforms.windows' },
  { value: 'linux', labelKey: 'assets.platforms.linux' },
]

const FORMAT_OPTION_DEFINITIONS: Array<{ value: PresetFormat; labelKey: string }> = [
  { value: 'pfx', labelKey: 'bindings.formats.pfx' },
  { value: 'jks', labelKey: 'bindings.formats.jks' },
  { value: 'pem_bundle', labelKey: 'bindings.formats.pemBundle' },
  { value: 'pem_cert', labelKey: 'bindings.formats.pemCert' },
  { value: 'pem_key', labelKey: 'bindings.formats.pemKey' },
  { value: 'cer', labelKey: 'bindings.formats.cer' },
  { value: 'crt', labelKey: 'bindings.formats.crt' },
  { value: 'p7b', labelKey: 'bindings.formats.p7b' },
  { value: 'custom', labelKey: 'bindings.formats.custom' },
]

const loading = ref(false)
const submitLoading = ref(false)
const deleteLoadingId = ref('')
const dialogOpen = ref(false)
const error = ref('')
const actionError = ref('')
const requestId = ref('')
const templateMessageKey = ref('')
const editMode = ref<'create' | 'edit'>('create')
const formatItems = ref<ApiRecord[]>([])
const filters = reactive({
  keyword: '',
  format: '',
})
const filtersVisible = ref(false)
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
const formatOptions = computed(() => FORMAT_OPTION_DEFINITIONS.map((item) => ({ ...item, label: t(item.labelKey) })))
const selectedTemplate = computed(() => {
  if (!draft.systemPlatform) return null
  return PLATFORM_PRESETS[draft.systemPlatform]
})
const templateMessage = computed(() => {
  if (templateMessageKey.value) return t(templateMessageKey.value)
  return selectedTemplate.value ? t(selectedTemplate.value.descriptionKey) : ''
})

const rows = computed<FormatRow[]>(() => {
  const keyword = filters.keyword.trim().toLowerCase()
  const format = filters.format.trim().toLowerCase()
  return formatItems.value
    .map((item, index) => {
      const parameters = readRecord(item.parameters)
      const presetFormat = normalizePresetFormat(String(parameters.outputPreset ?? item.format ?? 'pem_bundle'))
      const configName = String(parameters.configName ?? parameters.alias ?? t('bindings.fallbacks.unnamedConfig', { index: index + 1 }))
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

const columns = computed<DataTableColumn<FormatRow>[]>(() => [
  { key: 'configName', title: t('bindings.columns.configName'), width: '22%' },
  { key: 'targetSummary', title: t('bindings.columns.targetSummary'), width: '16%' },
  { key: 'displayFormat', title: t('bindings.columns.displayFormat'), width: '14%' },
  { key: 'extension', title: t('bindings.columns.extension'), width: '10%' },
  { key: 'encodingSummary', title: t('bindings.columns.encodingSummary'), width: '14%' },
  { key: 'exportSummary', title: t('bindings.columns.exportSummary'), width: '22%' },
  { key: 'actions', title: t('bindings.columns.actions'), width: '12%' },
])

onMounted(loadFormats)

function toggleFilters(): void {
  filtersVisible.value = !filtersVisible.value
}

async function loadFormats() {
  loading.value = true
  error.value = ''
  try {
    const result = await listCertificateFormats({ page: 1, pageSize: 200, sort: 'createdAt:desc' })
    formatItems.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    error.value = toErrorMessage(cause, t('bindings.errors.loadFailed'))
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
  templateMessageKey.value = ''
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
  templateMessageKey.value = selectedTemplate.value?.descriptionKey ?? ''
  dialogOpen.value = true
}

function closeDialog() {
  if (!submitLoading.value) {
    dialogOpen.value = false
  }
}

function handleSystemPlatformChange() {
  draft.runtimePlatform = ''
  templateMessageKey.value = ''
}

function applyTemplate() {
  if (!draft.systemPlatform || !draft.runtimePlatform) {
    templateMessageKey.value = 'bindings.validation.selectPlatformsFirst'
    return
  }

  const preset = PLATFORM_PRESETS[draft.systemPlatform]
  Object.assign(draft, {
    configName: t(preset.configNameKey),
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
  templateMessageKey.value = preset.descriptionKey
}

async function submitDraft() {
  if (!draft.configName.trim()) {
    actionError.value = t('bindings.validation.configNameRequired')
    return
  }

  if (showsPasswordSecret.value && !draft.passwordValue.trim() && !draft.hasSavedPassword) {
    actionError.value = t('bindings.validation.passwordRequired')
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
      actionError.value = t('bindings.errors.withCode', { message: cause.message, code: cause.errorCode })
      requestId.value = cause.requestId
    } else {
      actionError.value = toErrorMessage(cause, t('bindings.errors.saveFailed'))
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
    error.value = toErrorMessage(cause, t('bindings.errors.deleteFailed'))
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
      name: t('bindings.secret.exportPasswordName', { name: draft.configName.trim() || t('bindings.secret.defaultConfigName') }),
      type: 'pfx_password',
      scopeType: 'global',
      plainText: draft.passwordValue.trim(),
    })
    const secretRef = String(secret.data?.secretRef ?? '')
    if (!secretRef) {
      throw new Error(t('bindings.errors.createExportSecretFailed'))
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
  if (!systemPlatform && !runtimePlatform) return t('bindings.fallbacks.unspecified')
  return [systemPlatform, runtimePlatform].filter(Boolean).join(' / ')
}

function renderFormatLabel(value: PresetFormat) {
  return formatOptions.value.find((item) => item.value === value)?.label ?? value
}

function renderEncodingSummary(item: ApiRecord, parameters: Record<string, unknown>) {
  const format = normalizePresetFormat(String(parameters.outputPreset ?? item.format ?? 'pem_bundle'))
  switch (format) {
    case 'pfx':
      return t('bindings.encoding.pkcs12Container')
    case 'jks':
      return t('bindings.encoding.jksContainer')
    case 'pem_key':
      return t('bindings.encoding.privateKeyWithEncoding', { encoding: String(parameters.privateEncoding ?? 'pem').toUpperCase() })
    case 'p7b':
      return t('bindings.encoding.pkcs7Chain')
    default:
      return [
        parameters.publicEncoding ? t('bindings.encoding.certificateWithEncoding', { encoding: String(parameters.publicEncoding).toUpperCase() }) : '',
        parameters.privateEncoding ? t('bindings.encoding.privateKeyWithEncoding', { encoding: String(parameters.privateEncoding).toUpperCase() }) : '',
      ].filter(Boolean).join(' / ') || t('bindings.encoding.default')
  }
}

function renderExportSummary(item: ApiRecord, parameters: Record<string, unknown>) {
  const segments: string[] = []
  if (parameters.includeLeafCertificate !== false) segments.push(t('bindings.export.leafCertificate'))
  if (parameters.includeCertificateChain) segments.push(t('bindings.export.certificateChain'))
  if (item.containsPrivateKey || parameters.includePrivateKey) segments.push(t('bindings.export.privateKey'))
  if (parameters.generateChainFile) segments.push(t('bindings.export.extraChainFile'))
  if (parameters.generatePrivateKeyFile) segments.push(t('bindings.export.extraPrivateKeyFile'))
  return segments.length > 0 ? segments.join(t('bindings.separators.export')) : t('bindings.fallbacks.unspecified')
}

function renderSystemPlatform(value: string) {
  switch (value) {
    case 'windows':
      return t('assets.platforms.windows')
    case 'linux':
      return t('assets.platforms.linux')
    default:
      return ''
  }
}

function renderRuntimePlatform(value: string) {
  return value.trim()
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

function normalizeRuntimePlatform(value: string): string {
  return value.trim()
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
    <GcPageHeader
      :title="t('bindings.list.title')"
      :description="t('bindings.list.descriptionWithCount', { count: rows.length })"
    />

    <Teleport to="#gc-shell-hero-actions" :disabled="!shouldTeleportToolbarActions">
      <GcPageToolbar class="artifact-page__hero-actions">
        <template #actions>
          <button class="gc-button" type="button" :aria-expanded="filtersVisible" @click="toggleFilters">{{ t('bindings.actions.toggleFilters') }}</button>
          <button class="gc-button" type="button" @click="loadFormats">{{ t('common.refresh') }}</button>
        </template>
        <template #primary>
          <GcPermissionButton class="gc-button gc-button--primary" permission="certificate.format.create" @click="openCreateDialog">
            {{ t('bindings.actions.create') }}
          </GcPermissionButton>
        </template>
      </GcPageToolbar>
    </Teleport>

    <section v-if="filtersVisible" class="gc-card artifact-page__filters">
      <label class="artifact-page__filter">
        <span class="artifact-page__filter-label">{{ t('certificates.list.filters.keyword') }}</span>
        <input v-model="filters.keyword" :placeholder="t('bindings.filters.keywordPlaceholder')" />
      </label>
      <label class="artifact-page__filter">
        <span class="artifact-page__filter-label">{{ t('bindings.fields.contentFormat') }}</span>
        <select v-model="filters.format">
          <option value="">{{ t('businessPage.all') }}</option>
          <option v-for="item in formatOptions" :key="item.value" :value="item.label.toUpperCase()">{{ item.label }}</option>
        </select>
      </label>
    </section>

    <GcEmptyState v-if="error" :title="t('bindings.errors.loadFailed')" :description="error">
      <button class="gc-button" type="button" @click="loadFormats">{{ t('businessPage.retry') }}</button>
    </GcEmptyState>

    <GcDataTable
      v-else
      class="artifact-page__table"
      :columns="columns"
      :rows="rows"
      :loading="loading"
      :empty-text="t('bindings.empty.text')"
    >
      <template #toolbar>
        <div class="artifact-page__table-toolbar">
          <div class="artifact-page__table-heading">
            <strong>{{ t('bindings.list.title') }}</strong>
          </div>
        </div>
      </template>

      <template #cell-configName="{ row }">
        <div class="artifact-page__cell-stack">
          <strong>{{ row.configName }}</strong>
          <span>{{ row.alias === '-' ? t('bindings.fallbacks.aliasUnset') : t('bindings.labels.aliasWithValue', { alias: row.alias }) }}</span>
        </div>
      </template>

      <template #cell-actions="{ row }">
        <div class="artifact-page__actions-cell">
          <GcPermissionButton permission="certificate.format.create" @click="openEditDialog(row as FormatRow)">
            {{ t('bindings.actions.edit') }}
          </GcPermissionButton>
          <GcPermissionButton
            permission="certificate.format.create"
            danger
            :disabled="deleteLoadingId === String(row.id)"
            @click="removeRow(row as FormatRow)"
          >
            {{ deleteLoadingId === String(row.id) ? t('bindings.actions.deleting') : t('bindings.actions.delete') }}
          </GcPermissionButton>
        </div>
      </template>
    </GcDataTable>

    <GcModal
      v-model:open="dialogOpen"
      :title="editMode === 'create' ? t('bindings.dialog.createTitle') : t('bindings.dialog.editTitle')"
      :description="t('bindings.dialog.description')"
      size="xl"
    >
      <section class="artifact-form">
        <section class="artifact-form__section artifact-form__section--template">
          <header class="artifact-form__section-header">
            <div>
              <h3>{{ t('bindings.sections.templates.title') }}</h3>
              <p>{{ t('bindings.sections.templates.description') }}</p>
            </div>
          </header>
          <div class="artifact-form__grid">
            <label class="artifact-form__field">
              <span>{{ t('bindings.fields.systemPlatform') }}</span>
              <select v-model="draft.systemPlatform" @change="handleSystemPlatformChange">
                <option value="">{{ t('bindings.select.placeholder') }}</option>
                <option v-for="item in SYSTEM_PLATFORM_OPTIONS" :key="item.value" :value="item.value">{{ t(item.labelKey) }}</option>
              </select>
            </label>
            <label class="artifact-form__field">
              <span>{{ t('bindings.fields.runtimePlatform') }}</span>
              <input
                v-model="draft.runtimePlatform"
                data-testid="runtime-platform-input"
                :disabled="!draft.systemPlatform"
                :placeholder="t('bindings.select.placeholder')"
              />
            </label>
          </div>
          <div class="artifact-form__template-actions">
            <button class="gc-button" type="button" :disabled="!draft.systemPlatform || !draft.runtimePlatform" @click="applyTemplate">
              {{ t('bindings.actions.applyTemplate') }}
            </button>
            <p v-if="templateMessage" class="artifact-form__template-message">{{ templateMessage }}</p>
          </div>
        </section>

        <section class="artifact-form__section">
          <header class="artifact-form__section-header">
            <div>
              <h3>{{ t('bindings.sections.basic.title') }}</h3>
              <p>{{ t('bindings.sections.basic.description') }}</p>
            </div>
          </header>
          <div class="artifact-form__grid">
            <label class="artifact-form__field">
              <span>{{ t('bindings.fields.configName') }}</span>
              <input v-model="draft.configName" :placeholder="t('bindings.placeholders.configName')" />
            </label>
            <label class="artifact-form__field">
              <span>{{ t('certificates.formats.fields.alias') }}</span>
              <input v-model="draft.alias" :placeholder="t('certificates.formats.placeholders.alias')" />
            </label>
            <label class="artifact-form__field">
              <span>{{ t('bindings.fields.contentFormat') }}</span>
              <select v-model="draft.presetFormat">
                <option v-for="item in formatOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
            <label v-if="draft.presetFormat === 'custom'" class="artifact-form__field">
              <span>{{ t('bindings.fields.backendFormat') }}</span>
              <select v-model="draft.customBackendFormat">
                <option value="pem">PEM</option>
                <option value="der">DER</option>
                <option value="pfx">PFX</option>
                <option value="jks">JKS</option>
                <option value="p7b">P7B</option>
              </select>
            </label>
            <label class="artifact-form__field">
              <span>{{ t('bindings.fields.outputExtension') }}</span>
              <input v-model="draft.customExtension" :placeholder="resolvedExtension" />
            </label>
            <label class="artifact-form__field">
              <span>{{ t('bindings.fields.expiresAt') }}</span>
              <input v-model="draft.expiresAt" />
            </label>
          </div>
        </section>

        <section v-if="showsPublicEncoding || showsPrivateEncoding" class="artifact-form__section">
          <header class="artifact-form__section-header">
            <div>
              <h3>{{ t('bindings.sections.encoding.title') }}</h3>
              <p>{{ t('bindings.sections.encoding.description') }}</p>
            </div>
          </header>
          <div class="artifact-form__grid">
            <label v-if="showsPublicEncoding" class="artifact-form__field">
              <span>{{ isCertificateOnlyFormat ? t('bindings.fields.certificateEncoding') : t('bindings.fields.certificateContentEncoding') }}</span>
              <select v-model="draft.publicEncoding">
                <option value="pem">PEM</option>
                <option value="der">DER</option>
                <option value="base64">Base64</option>
              </select>
            </label>
            <label v-if="showsPrivateEncoding" class="artifact-form__field">
              <span>{{ t('bindings.fields.privateKeyEncoding') }}</span>
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
              <h3>{{ t('bindings.sections.content.title') }}</h3>
              <p>{{ t('bindings.sections.content.description') }}</p>
            </div>
          </header>
          <div class="artifact-form__grid">
            <label v-if="showsContentSelection" class="artifact-form__check">
              <input v-model="draft.includeLeafCertificate" type="checkbox" />
              <span>{{ t('bindings.fields.includeLeafCertificate') }}</span>
            </label>
            <label v-if="showsContentSelection" class="artifact-form__check">
              <input v-model="draft.includeCertificateChain" type="checkbox" />
              <span>{{ t('bindings.fields.includeCertificateChain') }}</span>
            </label>
            <label v-if="showsContentSelection || isContainerFormat" class="artifact-form__check">
              <input v-model="draft.includePrivateKey" type="checkbox" />
              <span>{{ t('bindings.fields.includePrivateKey') }}</span>
            </label>
          </div>
        </section>

        <section class="artifact-form__section">
          <header class="artifact-form__section-header">
            <div>
              <h3>{{ t('bindings.sections.export.title') }}</h3>
              <p>{{ t('bindings.sections.export.description') }}</p>
            </div>
          </header>
          <div class="artifact-form__grid">
            <label class="artifact-form__check">
              <input v-model="draft.generateChainFile" type="checkbox" />
              <span>{{ isContainerFormat ? t('bindings.fields.mainArtifactIncludesChain') : t('bindings.fields.generateChainFile') }}</span>
            </label>
            <label class="artifact-form__check">
              <input v-model="draft.generatePrivateKeyFile" type="checkbox" />
              <span>{{ t('bindings.fields.generatePrivateKeyFile') }}</span>
            </label>
            <label v-if="showsPasswordSecret" class="artifact-form__field">
              <span>{{ t('bindings.fields.exportPassword') }}</span>
              <input v-model="draft.passwordValue" type="password" :placeholder="t('bindings.placeholders.exportPassword')" />
            </label>
          </div>
          <p v-if="showsPasswordSecret && draft.hasSavedPassword" class="artifact-form__template-message">{{ t('bindings.hints.savedPassword') }}</p>
        </section>

        <p v-if="actionError" class="artifact-form__error">{{ actionError }}</p>
        <p v-else-if="requestId" class="artifact-form__request">{{ t('bindings.labels.requestId', { requestId }) }}</p>
      </section>

      <template #actions>
        <button class="gc-button" type="button" :disabled="submitLoading" @click="closeDialog">{{ t('designSystem.confirm.cancel') }}</button>
        <button class="gc-button gc-button--danger" type="button" :disabled="submitLoading" @click="submitDraft">
          {{ submitLoading ? t('bindings.actions.saving') : t('bindings.actions.confirmSave') }}
        </button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.artifact-page {
  display: flex;
  flex-direction: column;
  gap: var(--gc-space-5);
  flex: 1;
  min-height: 0;
}

.artifact-page__filters {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(var(--gc-size-card-min), var(--gc-size-sidebar));
  gap: var(--gc-space-3);
  align-items: end;
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-card);
  background: var(--gc-color-surface-solid);
  box-shadow: var(--gc-shadow-sm);
}

.artifact-page__filter {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
  min-width: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 600;
}

.artifact-page__filter-label {
  flex: 0 0 auto;
  white-space: nowrap;
}

.artifact-page__filter input,
.artifact-page__filter select {
  flex: 1;
  min-width: 0;
  min-height: var(--gc-control-height-sm);
  padding: 0 var(--gc-space-3);
  color: var(--gc-color-text);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  background: var(--gc-color-surface-field);
}

.artifact-page__table :deep(table) {
  table-layout: fixed;
}

.artifact-page__table-toolbar,
.artifact-page__table-heading {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-4);
  align-items: flex-start;
}

.artifact-page__table-heading {
  display: grid;
  gap: var(--gc-space-1);
}

.artifact-page__table-heading strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-md);
}

.artifact-page__cell-stack {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.artifact-page__cell-stack span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  overflow-wrap: anywhere;
}

.artifact-page__actions-cell {
  display: flex;
  gap: var(--gc-space-2);
  flex-wrap: wrap;
}

.artifact-form {
  display: grid;
  gap: var(--gc-space-4);
}

.artifact-form__section {
  display: grid;
  gap: var(--gc-space-4);
  padding: var(--gc-space-5);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-card);
  background: var(--gc-gradient-surface);
}

.artifact-form__section--template {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-gradient-surface-soft);
}

.artifact-form__section-header {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-3);
  align-items: flex-start;
}

.artifact-form__section-header h3,
.artifact-form__section-header p {
  margin: 0;
}

.artifact-form__section-header h3 {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-md);
  font-weight: 800;
}

.artifact-form__section-header p {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  line-height: var(--gc-line-height-relaxed);
}

.artifact-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-4);
}

.artifact-form__field,
.artifact-form__check {
  display: grid;
  gap: var(--gc-space-2);
}

.artifact-form__field {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 800;
}

.artifact-form__field input,
.artifact-form__field select {
  width: 100%;
  min-height: var(--gc-control-height-md);
  padding: 0 var(--gc-space-3);
  color: var(--gc-color-text);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  background: var(--gc-color-surface-field);
  box-shadow: var(--gc-shadow-sm);
}

.artifact-form__field input:focus,
.artifact-form__field select:focus,
.artifact-page__filter input:focus,
.artifact-page__filter select:focus {
  border-color: var(--gc-color-focus);
  outline: none;
  box-shadow: var(--gc-shadow-focus);
}

.artifact-form__check {
  grid-template-columns: auto 1fr;
  align-items: center;
  min-height: var(--gc-control-height-md);
  padding: 0 var(--gc-space-1);
  color: var(--gc-color-text);
  font-weight: 700;
}

.artifact-form__template-actions {
  display: grid;
  gap: var(--gc-space-2);
}

.artifact-form__template-message {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  line-height: var(--gc-line-height-relaxed);
}

.artifact-form__error,
.artifact-form__request {
  margin: 0;
  font-weight: 800;
  border-radius: var(--gc-radius-control);
  padding: var(--gc-space-3);
}

.artifact-form__error {
  color: var(--gc-color-danger);
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  background: var(--gc-color-danger-bg);
}

.artifact-form__request {
  color: var(--gc-color-text-muted);
  border: var(--gc-border-width-default) solid var(--gc-color-info-border);
  background: var(--gc-color-info-soft);
}

.artifact-export {
  display: grid;
  gap: var(--gc-space-4);
}

@media (max-width: 56rem) {
  .artifact-page__filters {
    grid-template-columns: 1fr;
  }

  .artifact-form__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 40rem) {
  .artifact-page__filter {
    align-items: stretch;
    flex-direction: column;
  }

  .artifact-page__filter input,
  .artifact-page__filter select {
    width: 100%;
  }

  .artifact-form__section {
    padding: var(--gc-space-4);
  }
}
</style>

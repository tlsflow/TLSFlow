<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiRecord } from '@/api/modules/common'
import {
  compileWorkflowCanvas,
  createWorkflowDraftFromPlugin,
  createWorkflowFromPlugin,
  deleteWorkflowTemplate,
  listPluginWorkflowSources,
  createWorkflowTemplateVersion,
  listWorkflowTemplateVersions,
  listWorkflowTemplates,
  publishWorkflowTemplateVersion,
  renameWorkflowTemplate,
  updateCurrentWorkflowTemplateDraftVersion,
  updateWorkflowTemplateVersionNote,
} from '@/api/modules/workflow-templates.api'
import { GcModal, GcPluginWorkflowSourceSelector, GcStatusTag } from '@/design-system/components'
import { readString, type ViewRow } from '@/composables/useBusinessPage'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import type { BusinessPageConfig } from '@/views/business-page.types'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import WorkflowCanvasEditor from './WorkflowCanvasEditor.vue'
import {
  createDefaultWorkflowCanvas,
  isWorkflowDslCanvasImportable,
  workflowDslToCanvas,
  type WorkflowCanvasDefinition,
  type WorkflowDslV1,
} from './workflow-canvas.model'

const pageRef = ref<InstanceType<typeof BusinessResourcePage> | null>(null)
const { t, locale } = useI18n()
const detailModalOpen = ref(false)
const versionManagerModalOpen = ref(false)
const editorModalOpen = ref(false)
const detailRow = ref<ViewRow | null>(null)
const detailNameEditing = ref(false)
const detailNameDraft = ref('')
const detailNameSaving = ref(false)
const detailNameMessage = ref('')
const detailNameError = ref('')
const versionManagerRow = ref<ViewRow | null>(null)
const editorRow = ref<ViewRow | null>(null)
const versionItems = ref<ApiRecord[]>([])
const versionLoading = ref(false)
const versionError = ref('')
const versionCreating = ref(false)
const versionNoteDrafts = ref<Record<string, string>>({})
const versionNoteSavingId = ref('')
const publishLoading = ref(false)
const publishMessage = ref('')
const canvasSaving = ref(false)
const canvasMessage = ref('')
const canvasDraft = ref<WorkflowCanvasDefinition>(createDefaultWorkflowCanvas())
const activeTab = ref<'summary' | 'versions'>('summary')
const pluginSourceModalOpen = ref(false)
const pluginSourceMode = ref<'create' | 'apply'>('create')
const pluginSourceItems = ref<ApiRecord[]>([])
const pluginSourceLoading = ref(false)
const pluginSourcePending = ref(false)
const pluginSourceError = ref('')
const selectedPluginSourceId = ref('')
const pluginSourceTargetRow = ref<ViewRow | null>(null)
const pluginSourceWorkflowName = ref('')
const pluginSourceSuggestedName = ref('')
const showNonDeploymentWorkflows = ref(false)

const config: BusinessPageConfig = {
  title: t('workflows.templates.title'),
  description: t('workflows.templates.description'),
  showHeader: false,
  showMetrics: false,
  readPermission: 'workflow.read',
  primaryPermission: 'workflow.create',
  primaryActionLabel: t('workflows.templates.pluginSources.createTitle'),
  primaryAction: async () => openPluginSourceModal('create'),
  moduleName: 'workflows',
  resourceName: t('workflows.templates.resourceName'),
  defaultStatus: 'draft',
  defaultRisk: 'MEDIUM',
  showDetailPanel: false,
  showActionPanel: false,
  columns: [
    { key: 'name', title: t('workflows.templates.fields.name'), candidates: ['name'] },
    {
      key: 'origin',
      title: t('workflows.templates.fields.origin'),
      candidates: ['origin'],
      format: (record) => t(`workflows.templates.origins.${normalizeWorkflowOrigin(readString(record, ['origin'], 'user'))}`),
    },
    { key: 'status', title: t('workflows.templates.fields.status'), candidates: ['status'] },
    { key: 'currentVersionLabel', title: t('workflows.templates.fields.currentVersion'), candidates: ['currentVersionLabel', 'currentVersion'] },
    { key: 'updatedAt', title: t('workflows.templates.fields.updatedAt'), candidates: ['updatedAt', 'createdAt'], kind: 'date' },
    { key: 'actions', title: t('workflows.templates.fields.actions'), candidates: [] },
  ],
  metrics: [],
  detailFields: [
    { label: t('workflows.templates.fields.id'), candidates: ['id'] },
    { label: t('workflows.templates.fields.name'), candidates: ['name'] },
    { label: t('workflows.templates.fields.currentStatus'), candidates: ['status'] },
    { label: t('workflows.templates.fields.currentVersionId'), candidates: ['currentVersionId'] },
    { label: t('workflows.templates.fields.createdAt'), candidates: ['createdAt'] },
    { label: t('workflows.templates.fields.updatedAt'), candidates: ['updatedAt'] },
  ],
  emptyTitle: t('workflows.templates.empty.title'),
  emptyDescription: t('workflows.templates.empty.description'),
  load: async () => {
    const result = await listWorkflowTemplates({ page: 1, pageSize: 50, sort: 'updatedAt:desc' })
    if (!result.data) return result
    const items = result.data.items.filter((item) => shouldShowWorkflow(item))
    return {
      ...result,
      data: {
        ...result.data,
        items,
        total: items.length,
      },
    }
  },
  actions: [],
  rowActions: [
    {
      label: t('workflows.templates.actions.edit'),
      permission: 'workflow.update',
      reloadAfterRun: false,
      hidden: (row) => readString(row.raw, ['status']) !== 'draft' || isPluginInternal(row),
      run: async (row) => {
        await openEditor(row)
      },
    },
    {
      label: t('workflows.templates.pluginSources.applyAction'),
      permission: 'workflow.update',
      reloadAfterRun: false,
      hidden: (row) => !isUserOwnedWorkflow(row),
      run: async (row) => openPluginSourceModal('apply', row),
    },
    {
      label: t('workflows.templates.actions.detail'),
      permission: 'workflow.read',
      reloadAfterRun: false,
      run: async (row) => {
        await openDetail(row)
      },
    },
    {
      label: t('workflows.templates.actions.versionManagement'),
      permission: 'workflow.update',
      reloadAfterRun: false,
      hidden: (row) => isPluginInternal(row),
      run: async (row) => {
        await openVersionManager(row)
      },
    },
    {
      label: t('workflows.templates.actions.delete'),
      permission: 'workflow.delete',
      danger: true,
      confirmText: 'DELETE',
      riskText: t('workflows.templates.delete.riskText'),
      reloadAfterRun: true,
      hidden: (row) => readString(row.raw, ['status']) === 'disabled' || isPluginInternal(row),
      run: async (row) => {
        await deleteWorkflowTemplate(readString(row.raw, ['id']))
      },
    },
  ],
}

const publishedVersionLabel = computed(() => {
  const currentId = readString(detailRow.value?.raw ?? {}, ['currentVersionId'], '')
  const published = versionItems.value.find((item) =>
    readString(item, ['status']) === 'published'
    && (!currentId || readString(item, ['id']) === currentId),
  ) ?? versionItems.value.find((item) => readString(item, ['status']) === 'published')
  return published ? workflowVersionDisplayLabel(published, detailRow.value) : '—'
})

const pluginSourceModalTitle = computed(() => pluginSourceMode.value === 'create' ? t('workflows.templates.pluginSources.createTitle') : t('workflows.templates.pluginSources.applyTitle'))
const pluginSourceActionLabel = computed(() => pluginSourceMode.value === 'create' ? t('workflows.templates.pluginSources.createAction') : t('workflows.templates.pluginSources.applyAction'))
const selectedPluginSource = computed(() => pluginSourceItems.value.find((item) => pluginSourceId(item) === selectedPluginSourceId.value) ?? null)

watch(selectedPluginSource, (source) => {
  if (!pluginSourceModalOpen.value || pluginSourceMode.value !== 'create' || !source) return
  const suggestedName = suggestPluginWorkflowName(source)
  if (!suggestedName) return
  if (!pluginSourceWorkflowName.value.trim() || pluginSourceWorkflowName.value === pluginSourceSuggestedName.value) {
    pluginSourceWorkflowName.value = suggestedName
    pluginSourceSuggestedName.value = suggestedName
  }
})

function isPluginInternal(row: ViewRow): boolean {
  return workflowOrigin(row) === 'plugin_internal'
}

function isUserOwnedWorkflow(row: ViewRow): boolean {
  return workflowOrigin(row) === 'user'
}

function workflowOrigin(row: ViewRow): string {
  return normalizeWorkflowOrigin(readString(row.raw, ['origin'], 'user'))
}

function normalizeWorkflowOrigin(origin: string): 'plugin_internal' | 'user' {
  const normalized = origin.trim().toLowerCase().replace(/-/g, '_')
  return normalized === 'plugin_internal' ? 'plugin_internal' : 'user'
}

function workflowCapabilities(record: ApiRecord): string[] {
  const capabilities = record.capabilities
  return Array.isArray(capabilities) ? capabilities.map((capability) => String(capability)) : []
}

function shouldShowWorkflow(record: ApiRecord): boolean {
  if (normalizeWorkflowOrigin(readString(record, ['origin'], 'user')) === 'user') return true
  if (showNonDeploymentWorkflows.value) return true
  return workflowCapabilities(record).includes('certificate.deploy')
}

function pluginSourceId(item: ApiRecord): string {
  return `${readString(item, ['pluginVersionId'])}:${readString(item, ['capabilityKey'])}`
}
function isCurrentWorkflowVersion(item: ApiRecord, row: ViewRow | null = versionManagerRow.value): boolean {
  if (!row) return false
  const currentVersionId = readString(row.raw, ['currentVersionId'], '')
  const versionId = readString(item, ['id'], '')
  if (currentVersionId && versionId && currentVersionId === versionId) return true
  const currentVersion = readString(row.raw, ['currentVersion'], '')
  return Boolean(currentVersion && currentVersion !== '—' && currentVersion === readString(item, ['version'], ''))
}

function workflowVersionDisplayLabel(item: ApiRecord, row: ViewRow | null): string {
  if (row && isPluginInternal(row)) {
    return readString(item, ['content.metadata.version'], readString(item, ['version'], '—'))
  }
  const version = readString(item, ['version'], '')
  return version ? `V${version}` : '—'
}

interface VersionStatusBadge {
  readonly label: string
  readonly tone: string
}

function versionStatusBadges(item: ApiRecord): VersionStatusBadge[] {
  const status = readString(item, ['status'], 'draft')
  return [{
    label: status === 'published'
      ? t('workflows.templates.versionStatuses.published')
      : status === 'disabled'
        ? t('workflows.templates.versionStatuses.disabled')
        : t('workflows.templates.versionStatuses.draft'),
    tone: status === 'published' ? 'published' : status === 'disabled' ? 'disabled' : 'draft',
  }]
}

function canRunVersionAction(item: ApiRecord): boolean {
  const owner = versionManagerRow.value ?? detailRow.value
  if (owner && isPluginInternal(owner)) return false
  const status = readString(item, ['status'], 'draft')
  if (status === 'draft') return true
  if (status !== 'published') return false
  return !isCurrentWorkflowVersion(item)
}

function versionActionLabel(item: ApiRecord): string {
  return readString(item, ['status'], 'draft') === 'published' ? t('workflows.templates.actions.switchVersion') : t('workflows.templates.actions.publishVersion')
}

function deriveTemplateStatusFromVersions(items: readonly ApiRecord[]): string {
  const enabled = items.filter((item) => readString(item, ['status'], 'draft') !== 'disabled')
  if (enabled.some((item) => readString(item, ['status'], 'draft') === 'draft')) return 'draft'
  return enabled.length > 0 ? 'published' : 'draft'
}

async function openDetail(row: ViewRow) {
  detailRow.value = row
  detailModalOpen.value = true
  activeTab.value = 'summary'
  publishMessage.value = ''
  cancelDetailNameEdit()
  await loadVersions(row)
}

function beginDetailNameEdit() {
  if (!detailRow.value) return
  detailNameDraft.value = readString(detailRow.value.raw, ['name'], detailRow.value.id)
  detailNameEditing.value = true
  detailNameMessage.value = ''
  detailNameError.value = ''
}

function cancelDetailNameEdit() {
  detailNameEditing.value = false
  detailNameDraft.value = ''
  detailNameSaving.value = false
  detailNameMessage.value = ''
  detailNameError.value = ''
}

async function saveDetailName() {
  if (!detailRow.value) return
  const templateId = readString(detailRow.value.raw, ['id'])
  const currentName = readString(detailRow.value.raw, ['name'], detailRow.value.id)
  const name = detailNameDraft.value.trim()
  if (!name) {
    detailNameError.value = t('workflows.templates.rename.errors.required')
    return
  }
  if (name === currentName) {
    detailNameEditing.value = false
    detailNameError.value = ''
    return
  }
  detailNameSaving.value = true
  detailNameMessage.value = ''
  detailNameError.value = ''
  try {
    const result = await renameWorkflowTemplate(templateId, name)
    const template = result.data ?? {}
    syncTemplateRows(template, templateId)
    detailNameDraft.value = readString(template, ['name'], name)
    detailNameEditing.value = false
    detailNameMessage.value = t('workflows.templates.rename.messages.success')
    await pageRef.value?.reload()
  } catch (cause) {
    detailNameError.value = cause instanceof Error ? cause.message : t('workflows.templates.rename.errors.failed')
  } finally {
    detailNameSaving.value = false
  }
}

async function openVersionManager(row: ViewRow) {
  versionManagerRow.value = row
  versionManagerModalOpen.value = true
  publishMessage.value = ''
  versionError.value = ''
  versionNoteSavingId.value = ''
  await loadVersions(row)
}

async function openEditor(row: ViewRow) {
  editorRow.value = row
  editorModalOpen.value = true
  canvasMessage.value = ''
  canvasDraft.value = createDefaultWorkflowCanvas(readString(row.raw, ['name'], 'workflow-canvas-draft'))
  await loadVersions(row)
  hydrateCanvasFromEditableDraft(row)
}

async function openPluginSourceModal(mode: 'create' | 'apply', row?: ViewRow) {
  pluginSourceMode.value = mode
  pluginSourceTargetRow.value = row ?? null
  pluginSourceWorkflowName.value = mode === 'apply' && row ? readString(row.raw, ['name']) : ''
  pluginSourceSuggestedName.value = ''
  pluginSourceModalOpen.value = true
  pluginSourceError.value = ''
  selectedPluginSourceId.value = ''
  await loadPluginSources()
}

async function loadVersions(row: ViewRow) {
  versionLoading.value = true
  versionError.value = ''
  try {
    const result = await listWorkflowTemplateVersions(readString(row.raw, ['id']))
    versionItems.value = [...(result.data?.items ?? [])]
    syncVersionNoteDrafts()
  } catch (cause) {
    versionItems.value = []
    versionNoteDrafts.value = {}
    versionError.value = cause instanceof Error ? cause.message : t('workflows.templates.errors.loadVersionsFailed')
  } finally {
    versionLoading.value = false
  }
}

function syncVersionNoteDrafts() {
  versionNoteDrafts.value = Object.fromEntries(versionItems.value.map((item) => [
    readString(item, ['id']),
    readString(item, ['changeSummary'], ''),
  ]).filter(([id]) => Boolean(id)))
}

async function loadPluginSources() {
  pluginSourceLoading.value = true
  pluginSourceError.value = ''
  try {
    const result = await listPluginWorkflowSources(locale.value)
    pluginSourceItems.value = [...(result.data?.items ?? [])]
    selectedPluginSourceId.value = ''
  } catch (cause) {
    pluginSourceItems.value = []
    pluginSourceError.value = cause instanceof Error ? cause.message : t('workflows.templates.pluginSources.errors.loadFailed')
  } finally {
    pluginSourceLoading.value = false
  }
}

watch(locale, () => {
  if (pluginSourceModalOpen.value) void loadPluginSources()
})

function hydrateCanvasFromLatestVersion() {
  const latest = [...versionItems.value].sort((left, right) => Number(readString(right, ['version'], '0')) - Number(readString(left, ['version'], '0')))[0]
  const content = latest?.content
  if (isWorkflowDsl(content)) {
    canvasDraft.value = workflowDslToCanvas(content)
  } else {
    const row = editorRow.value ?? detailRow.value
    if (row) canvasDraft.value = createDefaultWorkflowCanvas(readString(row.raw, ['name'], 'workflow-canvas-draft'))
  }
}

function hydrateCanvasFromEditableDraft(row: ViewRow) {
  const currentVersionId = readString(row.raw, ['currentVersionId'], '')
  const draft = versionItems.value.find((item) =>
    readString(item, ['id']) === currentVersionId && readString(item, ['status']) === 'draft',
  ) ?? [...versionItems.value]
    .filter((item) => readString(item, ['status']) === 'draft')
    .sort((left, right) => Number(readString(right, ['version'], '0')) - Number(readString(left, ['version'], '0')))[0]
  const content = draft?.content
  canvasDraft.value = isWorkflowDsl(content)
    ? workflowDslToCanvas(content)
    : createDefaultWorkflowCanvas(readString(row.raw, ['name'], 'workflow-canvas-draft'))
}

async function submitPluginSourceAction() {
  const source = selectedPluginSource.value
  if (!source || pluginSourcePending.value) return
  pluginSourcePending.value = true
  pluginSourceError.value = ''
  try {
    const sourcePayload = {
      pluginVersionId: readString(source, ['pluginVersionId']),
      capabilityKey: readString(source, ['capabilityKey']),
      name: pluginSourceWorkflowName.value.trim(),
    }
    const actionTime = new Date().toISOString()
    if (pluginSourceMode.value === 'create') {
      if (!sourcePayload.name) throw new Error(t('workflows.templates.pluginSources.errors.nameRequired'))
      const result = await createWorkflowFromPlugin({
        ...sourcePayload,
        changeSummary: t('workflows.templates.changeSummaries.createFromPlugin'),
      })
      const templateId = readString(result.data ?? {}, ['id'], '')
      if (templateId) {
        pageRef.value?.upsertRecord({
          id: templateId,
          name: sourcePayload.name,
          origin: 'user',
          status: 'draft',
          capabilities: sourcePayload.capabilityKey ? [sourcePayload.capabilityKey] : [],
          createdAt: actionTime,
          updatedAt: actionTime,
        }, { prepend: true })
      }
    } else {
      const row = pluginSourceTargetRow.value
      if (!row) throw new Error(t('workflows.templates.pluginSources.errors.missingApplyTarget'))
      if (!isUserOwnedWorkflow(row)) throw new Error(t('workflows.templates.pluginSources.errors.actionFailed'))
      const templateId = readString(row.raw, ['id'])
      const result = await createWorkflowDraftFromPlugin(templateId, {
        ...sourcePayload,
        changeSummary: t('workflows.templates.changeSummaries.applyFromPlugin'),
      })
      const versionId = readString(result.data ?? {}, ['id'], '')
      pageRef.value?.patchRecord(templateId, {
        status: 'draft',
        updatedAt: actionTime,
        ...(versionId ? { currentVersionId: versionId } : {}),
      })
      syncTemplateRows({
        status: 'draft',
        updatedAt: actionTime,
        ...(versionId ? { currentVersionId: versionId } : {}),
      }, templateId)
      if (editorRow.value && readString(editorRow.value.raw, ['id']) === readString(row.raw, ['id'])) {
        await loadVersions(editorRow.value)
        hydrateCanvasFromLatestVersion()
      }
    }
    pluginSourceModalOpen.value = false
  } catch (cause) {
    pluginSourceError.value = cause instanceof Error ? cause.message : t('workflows.templates.pluginSources.errors.actionFailed')
  } finally {
    pluginSourcePending.value = false
  }
}

function suggestPluginWorkflowName(source: ApiRecord): string {
  const workflowName = readString(source, ['workflowName'], '').trim()
  if (workflowName && workflowName !== '—') return workflowName
  return readString(source, ['workflowDisplayName', 'displayName', 'pluginId'], '').trim()
}

function updatePluginSourceWorkflowName(event: Event) {
  pluginSourceWorkflowName.value = event.target instanceof HTMLInputElement ? event.target.value : ''
}

async function saveCanvasDraft(payload: { canvas: WorkflowCanvasDefinition }) {
  if (!editorRow.value) return
  canvasSaving.value = true
  canvasMessage.value = ''
  try {
    const compiled = await compileCanvasOnBackend(payload.canvas)
    const result = await updateCurrentWorkflowTemplateDraftVersion({
      templateId: readString(editorRow.value.raw, ['id']),
      content: compiled.content,
      changeSummary: t('workflows.templates.changeSummaries.saveCanvasDraft'),
    })
    syncCreatedDraftVersion(result.data ?? {})
    canvasMessage.value = t('workflows.templates.messages.canvasDraftUpdated')
    await loadVersions(editorRow.value)
    await pageRef.value?.reload()
  } catch (cause) {
    canvasMessage.value = cause instanceof Error ? cause.message : t('workflows.templates.errors.saveCanvasDraftFailed')
  } finally {
    canvasSaving.value = false
  }
}

async function createManagedVersion() {
  const row = versionManagerRow.value
  if (!row || isPluginInternal(row) || versionCreating.value) return
  versionCreating.value = true
  publishMessage.value = ''
  versionError.value = ''
  try {
    const sourceContent = resolveManagedVersionSourceContent(row)
    if (!sourceContent) throw new Error(t('workflows.templates.errors.missingWorkflowDsl'))
    const result = await createWorkflowTemplateVersion({
      templateId: readString(row.raw, ['id']),
      content: sourceContent,
      changeSummary: t('workflows.templates.changeSummaries.createVersionDraft'),
      allowDuplicateContent: true,
    })
    publishMessage.value = t('workflows.templates.messages.versionDraftCreated')
    await loadVersions(row)
    syncCreatedDraftVersion(result.data ?? {})
    await pageRef.value?.reload()
  } catch (cause) {
    versionError.value = cause instanceof Error ? cause.message : t('workflows.templates.errors.createVersionFailed')
  } finally {
    versionCreating.value = false
  }
}

function versionNoteChanged(item: ApiRecord): boolean {
  const versionId = readString(item, ['id'])
  return (versionNoteDrafts.value[versionId] ?? '') !== readString(item, ['changeSummary'], '')
}

function updateVersionNoteDraft(item: ApiRecord, event: Event) {
  const versionId = readString(item, ['id'])
  if (!versionId) return
  versionNoteDrafts.value[versionId] = event.target instanceof HTMLInputElement ? event.target.value : ''
}

async function saveVersionNote(item: ApiRecord) {
  const versionId = readString(item, ['id'])
  if (!versionId || versionNoteSavingId.value || !versionNoteChanged(item)) return
  versionNoteSavingId.value = versionId
  publishMessage.value = ''
  versionError.value = ''
  try {
    const result = await updateWorkflowTemplateVersionNote(versionId, versionNoteDrafts.value[versionId] ?? '')
    const changedVersion = {
      ...item,
      ...(result.data ?? {}),
      id: readString(result.data ?? {}, ['id'], versionId),
    }
    versionItems.value = versionItems.value.map((version) =>
      readString(version, ['id']) === versionId ? changedVersion : version,
    )
    syncVersionNoteDrafts()
    publishMessage.value = t('workflows.templates.messages.versionNoteUpdated')
  } catch (cause) {
    versionError.value = cause instanceof Error ? cause.message : t('workflows.templates.errors.updateVersionNoteFailed')
  } finally {
    versionNoteSavingId.value = ''
  }
}

async function compileCanvasOnBackend(canvas: WorkflowCanvasDefinition): Promise<{ content: WorkflowDslV1 }> {
  const result = await compileWorkflowCanvas({ canvas })
  const content = result.data?.content
  if (!content) throw new Error(t('workflows.templates.errors.missingWorkflowDsl'))
  return { content: content as WorkflowDslV1 }
}

function resolveManagedVersionSourceContent(row: ViewRow): WorkflowDslV1 | null {
  const currentVersionId = readString(row.raw, ['currentVersionId'], '')
  const sortedVersions = [...versionItems.value].sort((left, right) =>
    Number(readString(right, ['version'], '0')) - Number(readString(left, ['version'], '0')),
  )
  const candidates = [
    versionItems.value.find((item) => readString(item, ['id']) === currentVersionId),
    ...sortedVersions,
  ]
  for (const candidate of candidates) {
    if (candidate && isWorkflowDsl(candidate.content)) return candidate.content
  }
  return null
}

async function publishVersion(versionId: string) {
  publishLoading.value = true
  publishMessage.value = ''
  try {
    const beforeAction = versionItems.value.find((item) => readString(item, ['id']) === versionId)
    const result = await publishWorkflowTemplateVersion(versionId)
    const changedVersion = {
      ...(beforeAction ?? {}),
      ...(result.data ?? {}),
      id: readString(result.data ?? {}, ['id'], versionId),
      status: 'published',
    }
    syncCurrentVersionRow(changedVersion)
    const versionNumber = readString(result.data ?? {}, ['version'], '')
    publishMessage.value = t('workflows.templates.messages.switchedVersion', { version: versionNumber ? `V${versionNumber}` : versionId })
    if (detailRow.value) {
      await loadVersions(detailRow.value)
    }
    if (versionManagerRow.value) {
      await loadVersions(versionManagerRow.value)
    }
    syncCurrentVersionRow(changedVersion)
    await pageRef.value?.reload()
  } catch (cause) {
    publishMessage.value = cause instanceof Error ? cause.message : t('workflows.templates.errors.publishVersionFailed')
  } finally {
    publishLoading.value = false
  }
}

function syncCreatedDraftVersion(version: ApiRecord) {
  const versionId = readString(version, ['id'], '')
  const existing = versionItems.value.find((item) => readString(item, ['id']) === versionId)
  const syncedVersion = { ...(existing ?? {}), ...version, status: 'draft' }
  if (versionId && existing) {
    versionItems.value = versionItems.value.map((item) =>
      readString(item, ['id']) === versionId ? syncedVersion : item,
    )
  } else if (versionId) {
    versionItems.value = [...versionItems.value, syncedVersion]
  }
  const versionNumber = readString(syncedVersion, ['version'], '')
  syncTemplateRows({
    currentVersionId: versionId || undefined,
    currentVersion: versionNumber ? Number(versionNumber) : undefined,
    currentVersionLabel: versionNumber ? `V${versionNumber}` : undefined,
    status: 'draft',
    updatedAt: new Date().toISOString(),
  }, readString(syncedVersion, ['templateId'], ''))
}

function syncCurrentVersionRow(version: ApiRecord) {
  const versionId = readString(version, ['id'], '')
  const versionNumber = readString(version, ['version'], '')
  if (!versionId) return
  const templateId = readString(version, ['templateId'], '')
  versionItems.value = versionItems.value.map((item) =>
    readString(item, ['id']) === versionId
      ? { ...item, ...version, status: 'published' }
      : item,
  )
  const patch = {
    currentVersionId: versionId,
    currentVersion: versionNumber ? Number(versionNumber) : undefined,
    currentVersionLabel: versionNumber ? `V${versionNumber}` : undefined,
    status: deriveTemplateStatusFromVersions(versionItems.value),
    updatedAt: new Date().toISOString(),
  }
  syncTemplateRows(patch, templateId)
}

function syncTemplateRows(patch: Record<string, unknown>, templateId = '') {
  if (versionManagerRow.value && (!templateId || readString(versionManagerRow.value.raw, ['id']) === templateId)) {
    versionManagerRow.value = {
      ...versionManagerRow.value,
      currentVersionLabel: typeof patch.currentVersionLabel === 'string' ? patch.currentVersionLabel : versionManagerRow.value.currentVersionLabel,
      status: typeof patch.status === 'string' ? patch.status : versionManagerRow.value.status,
      raw: {
        ...versionManagerRow.value.raw,
        ...patch,
      },
    }
  }
  if (detailRow.value && (!templateId || readString(detailRow.value.raw, ['id']) === templateId)) {
    detailRow.value = {
      ...detailRow.value,
      status: typeof patch.status === 'string' ? patch.status : detailRow.value.status,
      raw: {
        ...detailRow.value.raw,
        ...patch,
      },
    }
  }
}

function isWorkflowDsl(value: unknown): value is WorkflowDslV1 {
  return isWorkflowDslCanvasImportable(value)
}
</script>

<template>
  <section class="workflow-templates-page">
    <BusinessResourcePage ref="pageRef" :config="config">
      <template #toolbar-actions-before-refresh>
        <label class="workflow-templates__visibility-toggle">
          <input v-model="showNonDeploymentWorkflows" type="checkbox" @change="pageRef?.reload()" />
          <span>{{ t('workflows.templates.filters.showNonDeployment') }}</span>
        </label>
      </template>
    </BusinessResourcePage>

    <GcModal
      v-model:open="detailModalOpen"
      :title="detailRow ? t('workflows.templates.detail.titleWithName', { name: readString(detailRow.raw, ['name'], detailRow.id) }) : t('workflows.templates.detail.title')"
      :description="t('workflows.templates.detail.description')"
      size="xl"
      width="min(1280px, calc(100vw - 32px))"
    >
      <section v-if="detailRow" class="workflow-template-detail">
        <section class="workflow-template-detail__hero">
          <div class="workflow-template-detail__hero-copy">
            <p class="workflow-template-detail__eyebrow">Workflow</p>
            <div class="workflow-template-detail__title-row">
              <h2>{{ readString(detailRow.raw, ['name'], detailRow.id) }}</h2>
              <button v-if="!detailNameEditing && !isPluginInternal(detailRow)" class="gc-button" type="button" @click="beginDetailNameEdit">
                {{ t('workflows.templates.actions.rename') }}
              </button>
            </div>
            <form v-if="detailNameEditing" class="workflow-template-detail__name-form" @submit.prevent="saveDetailName">
              <label>
                <span>{{ t('workflows.templates.fields.name') }}</span>
                <input v-model="detailNameDraft" class="gc-input" type="text" :disabled="detailNameSaving" :placeholder="t('workflows.templates.rename.placeholder')" autofocus />
              </label>
              <div class="workflow-template-detail__name-actions">
                <button class="gc-button" type="button" :disabled="detailNameSaving" @click="cancelDetailNameEdit">{{ t('workflows.templates.actions.cancel') }}</button>
                <button class="gc-button gc-button--primary" type="submit" :disabled="detailNameSaving || !detailNameDraft.trim()">
                  {{ detailNameSaving ? t('workflows.templates.states.saving') : t('workflows.templates.actions.saveName') }}
                </button>
              </div>
            </form>
            <p v-if="detailNameMessage" class="workflow-template-detail__message">{{ detailNameMessage }}</p>
            <p v-if="detailNameError" class="workflow-template-detail__error">{{ detailNameError }}</p>
            <span>{{ t('workflows.templates.detail.publishedVersion', { version: publishedVersionLabel }) }}</span>
          </div>
          <div class="workflow-template-detail__hero-side">
            <GcStatusTag :status="readString(detailRow.raw, ['status'])" />
            <div class="workflow-template-detail__spotlight">
              <small>{{ t('workflows.templates.fields.currentVersionId') }}</small>
              <strong>{{ readString(detailRow.raw, ['currentVersionId']) }}</strong>
            </div>
          </div>
        </section>

        <div class="workflow-template-detail__tabs">
          <button class="workflow-template-detail__tab" type="button" :data-active="activeTab === 'summary'" @click="activeTab = 'summary'">{{ t('workflows.templates.tabs.summary') }}</button>
          <button class="workflow-template-detail__tab" type="button" :data-active="activeTab === 'versions'" @click="activeTab = 'versions'">{{ t('workflows.templates.tabs.versions') }}</button>
        </div>

        <section v-if="activeTab === 'summary'" class="workflow-template-detail__section">
          <dl class="workflow-template-detail__facts">
            <div><dt>{{ t('workflows.templates.fields.id') }}</dt><dd>{{ readString(detailRow.raw, ['id']) }}</dd></div>
            <div><dt>{{ t('workflows.templates.fields.name') }}</dt><dd>{{ readString(detailRow.raw, ['name']) }}</dd></div>
            <div><dt>{{ t('workflows.templates.fields.currentStatus') }}</dt><dd>{{ readString(detailRow.raw, ['status']) }}</dd></div>
            <div><dt>{{ t('workflows.templates.fields.currentVersionId') }}</dt><dd>{{ readString(detailRow.raw, ['currentVersionId']) }}</dd></div>
            <div><dt>{{ t('workflows.templates.fields.createdAt') }}</dt><dd>{{ formatBrowserLocalTime(readString(detailRow.raw, ['createdAt'])) || readString(detailRow.raw, ['createdAt']) }}</dd></div>
            <div><dt>{{ t('workflows.templates.fields.updatedAt') }}</dt><dd>{{ formatBrowserLocalTime(readString(detailRow.raw, ['updatedAt'])) || readString(detailRow.raw, ['updatedAt']) }}</dd></div>
            <div><dt>{{ t('workflows.templates.fields.origin') }}</dt><dd>{{ t(`workflows.templates.origins.${workflowOrigin(detailRow)}`) }}</dd></div>
          </dl>
        </section>

        <section v-else class="workflow-template-detail__section">
          <p v-if="publishMessage" class="workflow-template-detail__message">{{ publishMessage }}</p>
          <p v-if="versionLoading" class="workflow-template-detail__loading">{{ t('workflows.templates.loading.versions') }}</p>
          <p v-else-if="versionError" class="workflow-template-detail__error">{{ versionError }}</p>
          <ul v-else-if="versionItems.length" class="workflow-template-detail__list">
            <li v-for="item in versionItems" :key="readString(item, ['id'])" class="workflow-template-detail__list-item">
              <div class="workflow-template-detail__list-head">
                <strong>{{ workflowVersionDisplayLabel(item, detailRow) }}</strong>
                <GcStatusTag :status="readString(item, ['status'])" />
              </div>
              <p>{{ readString(item, ['changeSummary'], t('workflows.templates.empty.noChangeSummary')) }}</p>
              <small v-if="readString(item, ['pluginSource.pluginVersionId'])">{{ t('workflows.templates.pluginSources.versionSource', { plugin: readString(item, ['pluginSource.pluginId']), version: readString(item, ['pluginSource.pluginVersionId']), capability: readString(item, ['pluginSource.capabilityKey']) }) }}</small>
              <small>{{ formatBrowserLocalTime(readString(item, ['createdAt'])) || readString(item, ['createdAt']) }}</small>
              <button
                v-if="canRunVersionAction(item)"
                class="gc-button"
                type="button"
                :disabled="publishLoading"
                @click="publishVersion(readString(item, ['id']))"
              >
                {{ publishLoading ? t('workflows.templates.states.processing') : versionActionLabel(item) }}
              </button>
            </li>
          </ul>
          <p v-else class="workflow-template-detail__loading">{{ t('workflows.templates.empty.noVersions') }}</p>
        </section>
      </section>

      <template #actions>
        <button class="gc-button" type="button" @click="detailModalOpen = false">{{ t('workflows.templates.actions.close') }}</button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="versionManagerModalOpen"
      :title="versionManagerRow ? t('workflows.templates.versionManager.titleWithName', { name: readString(versionManagerRow.raw, ['name'], versionManagerRow.id) }) : t('workflows.templates.actions.versionManagement')"
      :description="t('workflows.templates.versionManager.description')"
      size="xl"
      width="min(980px, calc(100vw - 32px))"
    >
      <section v-if="versionManagerRow" class="workflow-version-manager">
        <header class="workflow-version-manager__head">
          <div class="workflow-version-manager__current">
            <span>{{ t('workflows.templates.fields.currentVersion') }}</span>
            <strong>{{ readString(versionManagerRow.raw, ['currentVersionLabel', 'currentVersion'], '—') }}</strong>
            <small>{{ readString(versionManagerRow.raw, ['status'], 'draft') }}</small>
          </div>
          <button v-if="!isPluginInternal(versionManagerRow)" class="gc-button gc-button--primary" type="button" :disabled="versionCreating" @click="createManagedVersion">
            {{ versionCreating ? t('workflows.templates.states.creating') : t('workflows.templates.actions.addVersion') }}
          </button>
        </header>

        <p v-if="publishMessage" class="workflow-template-detail__message">{{ publishMessage }}</p>
        <p v-if="versionLoading" class="workflow-template-detail__loading">{{ t('workflows.templates.loading.versions') }}</p>
        <p v-else-if="versionError" class="workflow-template-detail__error">{{ versionError }}</p>
        <ul v-else-if="versionItems.length" class="workflow-version-manager__list">
          <li v-for="item in versionItems" :key="readString(item, ['id'])" class="workflow-version-manager__item">
            <div class="workflow-version-manager__version">
              <strong>{{ workflowVersionDisplayLabel(item, versionManagerRow) }}</strong>
              <small>{{ formatBrowserLocalTime(readString(item, ['createdAt'])) || readString(item, ['createdAt']) }}</small>
            </div>
            <div class="workflow-version-manager__summary">
              <label>
                <span>{{ t('workflows.templates.fields.note') }}</span>
                <input
                  :value="versionNoteDrafts[readString(item, ['id'])] ?? ''"
                  class="gc-input"
                  type="text"
                  maxlength="120"
                  :placeholder="t('workflows.templates.empty.noChangeSummaryShort')"
                  :disabled="isPluginInternal(versionManagerRow) || versionNoteSavingId === readString(item, ['id'])"
                  @input="updateVersionNoteDraft(item, $event)"
                />
              </label>
              <button
                v-if="!isPluginInternal(versionManagerRow)"
                class="gc-button workflow-version-manager__note-save"
                type="button"
                :disabled="versionNoteSavingId === readString(item, ['id']) || !versionNoteChanged(item)"
                @click="saveVersionNote(item)"
              >
                {{ versionNoteSavingId === readString(item, ['id']) ? t('workflows.templates.states.saving') : t('workflows.templates.actions.saveNote') }}
              </button>
            </div>
            <div class="workflow-version-manager__badges">
              <span
                v-for="badge in versionStatusBadges(item)"
                :key="`${readString(item, ['id'])}:${badge.tone}`"
                class="workflow-version-manager__status"
                :data-status="badge.tone"
              >
                {{ badge.label }}
              </span>
            </div>
            <div class="workflow-version-manager__action-cell">
              <button
                v-if="canRunVersionAction(item)"
                class="gc-button workflow-version-manager__action"
                type="button"
                :disabled="publishLoading"
                @click="publishVersion(readString(item, ['id']))"
              >
                {{ publishLoading ? t('workflows.templates.states.processing') : versionActionLabel(item) }}
              </button>
              <span
                v-else-if="isCurrentWorkflowVersion(item)"
                class="workflow-version-manager__status workflow-version-manager__current-badge"
                data-status="current"
              >
                {{ t('workflows.templates.fields.currentVersion') }}
              </span>
            </div>
          </li>
        </ul>
        <p v-else class="workflow-template-detail__loading">{{ t('workflows.templates.empty.noVersions') }}</p>
      </section>

      <template #actions>
        <button class="gc-button" type="button" @click="versionManagerModalOpen = false">{{ t('workflows.templates.actions.close') }}</button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="editorModalOpen"
      frameless
      :close-on-backdrop="false"
      width="calc(100vw - 28px)"
    >
      <section v-if="editorRow" class="workflow-template-editor-shell">
        <WorkflowCanvasEditor
          v-model="canvasDraft"
          class="workflow-template-editor-shell__editor"
          :readonly="readString(editorRow.raw, ['status']) === 'published' || isPluginInternal(editorRow)"
          :save-message="canvasMessage"
          :saving="canvasSaving"
          @save="saveCanvasDraft"
        >
          <template #toolbar-actions>
            <GcStatusTag :status="readString(editorRow.raw, ['status'])" />
            <button class="gc-button" type="button" @click="editorModalOpen = false">{{ t('workflows.templates.actions.close') }}</button>
          </template>
        </WorkflowCanvasEditor>
      </section>
    </GcModal>

    <GcModal
      v-model:open="pluginSourceModalOpen"
      :title="pluginSourceModalTitle"
      :description="t('workflows.templates.pluginSources.description')"
      size="xl"
      width="min(1080px, calc(100vw - 32px))"
    >
      <section class="workflow-file-template-modal">
        <p v-if="pluginSourceMode === 'apply' && pluginSourceTargetRow" class="workflow-file-template-modal__target">
          {{ t('workflows.templates.pluginSources.currentTarget', { name: readString(pluginSourceTargetRow.raw, ['name'], pluginSourceTargetRow.id) }) }}
        </p>
        <label v-if="pluginSourceMode === 'create'" class="workflow-file-template-modal__field gc-form-field">
          <span>{{ t('workflows.templates.fields.name') }} <strong aria-hidden="true">*</strong></span>
          <input :value="pluginSourceWorkflowName" type="text" required aria-required="true" :placeholder="t('workflows.templates.pluginSources.namePlaceholder')" @input="updatePluginSourceWorkflowName" />
        </label>
        <p v-if="pluginSourceError" class="workflow-file-template-modal__error">{{ pluginSourceError }}</p>
        <GcPluginWorkflowSourceSelector
          v-model="selectedPluginSourceId"
          :items="pluginSourceItems"
          :loading="pluginSourceLoading"
          :labels="{
            loading: t('workflows.templates.pluginSources.loading'),
            empty: t('workflows.templates.pluginSources.empty'),
            deploy: t('workflows.templates.pluginSources.capabilities.deploy'),
            rollback: t('workflows.templates.pluginSources.capabilities.rollback'),
            version: t('workflows.templates.pluginSources.version'),
          }"
        />
      </section>
      <template #actions>
        <button class="gc-button" type="button" @click="pluginSourceModalOpen = false">{{ t('workflows.templates.actions.cancel') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="pluginSourcePending || !selectedPluginSourceId || (pluginSourceMode === 'create' && !pluginSourceWorkflowName.trim())" @click="submitPluginSourceAction">
          {{ pluginSourcePending ? t('workflows.templates.states.processing') : pluginSourceActionLabel }}
        </button>
      </template>
    </GcModal>

  </section>
</template>

<style scoped>
.workflow-templates-page {
  display: grid;
  gap: var(--gc-space-4);
}

.workflow-templates__visibility-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 650;
  white-space: nowrap;
}

.workflow-templates__visibility-toggle input {
  accent-color: var(--gc-color-primary);
}

.workflow-template-detail {
  display: grid;
  gap: 12px;
}

.workflow-template-detail__hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 14px;
  padding: 16px 18px;
  border: 1px solid var(--gc-color-info-border);
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, var(--gc-color-primary-soft), transparent 26%),
    linear-gradient(140deg, var(--gc-color-surface-hover) 0%, var(--gc-color-surface-solid) 54%, var(--gc-color-surface-subtle) 100%);
}

.workflow-template-detail__hero-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.workflow-template-detail__eyebrow {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.workflow-template-detail__hero-copy h2 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: 24px;
  line-height: 1.06;
  overflow-wrap: anywhere;
}

.workflow-template-detail__hero-copy span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.workflow-template-detail__hero-side {
  display: grid;
  align-content: space-between;
  justify-items: end;
  gap: 8px;
  min-width: 150px;
}

.workflow-template-detail__spotlight {
  display: grid;
  gap: 4px;
  min-width: 150px;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--gc-color-text);
  color: var(--gc-color-surface-solid);
}

.workflow-template-detail__spotlight small {
  color: var(--gc-color-text-inverse-muted);
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}

.workflow-template-detail__spotlight strong {
  font-size: 16px;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.workflow-template-detail__tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  padding: 4px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 999px;
  background: var(--gc-color-surface-hover);
}

.workflow-template-detail__tab {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.workflow-template-detail__tab[data-active='true'] {
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-text);
  box-shadow: 0 4px 14px var(--gc-color-border);
}

.workflow-template-detail__section {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 16px;
  background: linear-gradient(180deg, var(--gc-color-surface-solid), var(--gc-color-surface-raised));
}

.workflow-template-detail__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.workflow-template-detail__title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--gc-space-3);
}

.workflow-template-detail__name-form label {
  display: grid;
  gap: var(--gc-space-1);
}

.workflow-template-detail__name-form label > span {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
}

.workflow-template-detail__name-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: var(--gc-space-3);
  width: 100%;
}

.workflow-template-detail__name-form .gc-input {
  min-height: var(--gc-control-height-md);
  padding: 0 var(--gc-space-3);
  border: var(--gc-space-hairline) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-text);
  font: inherit;
}

.workflow-template-detail__name-form .gc-input:focus {
  border-color: var(--gc-color-primary);
  outline: none;
}

.workflow-template-detail__name-actions {
  display: flex;
  gap: var(--gc-space-2);
}

.workflow-template-detail__facts div,
.workflow-template-detail__list-item {
  display: grid;
  gap: 5px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--gc-color-surface-hover);
  border: 1px solid var(--gc-color-border-muted);
}

.workflow-template-detail__facts dt {
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.workflow-template-detail__facts dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: 13px;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.workflow-template-detail__list {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.workflow-template-detail__list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.workflow-template-detail__list-item p,
.workflow-template-detail__list-item small,
.workflow-template-detail__loading,
.workflow-template-detail__message,
.workflow-template-detail__error {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.workflow-template-detail__error {
  color: var(--gc-color-danger);
}

.workflow-version-manager {
  display: grid;
  gap: 10px;
}

.workflow-version-manager__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 8px;
  background: var(--gc-color-surface-hover);
}

.workflow-version-manager__current {
  display: grid;
  grid-template-columns: auto auto auto;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.workflow-version-manager__current span {
  color: var(--gc-color-text);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.workflow-version-manager__current strong {
  color: var(--gc-color-text);
  font-size: 18px;
  line-height: 1;
  white-space: nowrap;
}

.workflow-version-manager__current small {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.workflow-version-manager__list {
  display: grid;
  gap: 8px;
  max-height: min(58vh, 620px);
  padding: 0;
  margin: 0;
  overflow: auto;
  list-style: none;
}

.workflow-version-manager__item {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr) minmax(170px, auto) 116px;
  align-items: center;
  gap: 10px;
  min-height: 58px;
  padding: 9px 10px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 8px;
  background: var(--gc-color-surface-hover);
}

.workflow-version-manager__version,
.workflow-version-manager__summary {
  display: grid;
  min-width: 0;
}

.workflow-version-manager__version {
  gap: 3px;
}

.workflow-version-manager__version strong {
  color: var(--gc-color-text);
  font-size: 18px;
  line-height: 1;
}

.workflow-version-manager__version small {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  line-height: 1.35;
  white-space: nowrap;
}

.workflow-version-manager__summary {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 8px;
}

.workflow-version-manager__summary label {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.workflow-version-manager__summary label span {
  color: var(--gc-color-muted);
  font-size: 11px;
  font-weight: 800;
}

.workflow-version-manager__summary .gc-input {
  width: 100%;
  min-height: 34px;
  padding: 0 9px;
  border: 1px solid var(--gc-color-border-strong);
  border-radius: 8px;
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-text);
  font-size: 13px;
  outline: none;
}

.workflow-version-manager__summary .gc-input:focus {
  border-color: var(--gc-color-focus);
  box-shadow: 0 0 0 3px var(--gc-color-focus-ring);
}

.workflow-version-manager__badges {
  display: grid;
  justify-content: end;
  justify-items: start;
  align-content: center;
  gap: 6px;
}

.workflow-version-manager__action-cell {
  display: flex;
  justify-content: flex-end;
  min-width: 116px;
}

.workflow-version-manager__action {
  width: 116px;
}

.workflow-version-manager__current-badge {
  justify-content: center;
  width: 116px;
}

.workflow-version-manager__note-save {
  min-width: 88px;
  min-height: 34px;
}

.workflow-version-manager__status {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.workflow-version-manager__status[data-status='current'] {
  color: var(--gc-color-primary-strong);
  background: var(--gc-color-info-border);
}

.workflow-version-manager__status[data-status='published'] {
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
}

.workflow-version-manager__status[data-status='draft'],
.workflow-version-manager__status[data-status='disabled'],
.workflow-version-manager__status[data-status='muted'] {
  color: var(--gc-color-muted);
  background: var(--gc-color-muted-bg);
}

.workflow-template-editor-shell {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  width: calc(100vw - 28px);
  height: calc(100vh - 28px);
  padding: 12px;
  overflow: hidden;
  border: 1px solid var(--gc-color-surface-field);
  border-radius: 18px;
  background: var(--gc-color-surface-subtle);
  box-shadow: 0 24px 80px var(--gc-color-border-strong);
}

.workflow-template-editor-shell__editor {
  min-height: 0;
}

.workflow-template-editor-shell__editor :deep(.workflow-canvas-editor) {
  height: 100%;
  min-height: 0;
  grid-template-rows: auto auto minmax(0, 1fr) minmax(150px, 22vh);
}

.workflow-template-editor-shell__editor :deep(.workflow-canvas-editor__main) {
  min-height: 0;
}

.workflow-template-editor-shell__editor :deep(.workflow-canvas-editor__surface) {
  min-height: 760px;
}

.workflow-file-template-modal {
  display: grid;
  gap: 12px;
}

.workflow-file-template-modal__target,
.workflow-file-template-modal__loading,
.workflow-file-template-modal__error {
  margin: 0;
  font-size: 13px;
}

.workflow-file-template-modal__target,
.workflow-file-template-modal__loading {
  color: var(--gc-color-muted);
}

.workflow-file-template-modal__field {
  width: min(420px, 100%);
}

.workflow-file-template-modal__field > span strong {
  color: var(--gc-color-danger);
  font-size: 13px;
}

.workflow-file-template-modal__error {
  color: var(--gc-color-danger);
}

.workflow-file-template-modal__list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: min(56vh, 640px);
  overflow: auto;
}

.workflow-file-template-modal__item {
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 8px;
  background: var(--gc-color-surface-solid);
}

.workflow-file-template-modal__item[data-valid='false'] {
  background: var(--gc-color-danger-soft);
  border-color: var(--gc-color-danger-border);
}

.workflow-file-template-modal__choice {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  padding: 12px;
  align-items: start;
}

.workflow-file-template-modal__choice input {
  margin-top: 2px;
}

.workflow-file-template-modal__body {
  display: grid;
  gap: 4px;
}

.workflow-file-template-modal__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.workflow-file-template-modal__head strong {
  color: var(--gc-color-text);
  font-size: 13px;
}

.workflow-file-template-modal__body small,
.workflow-file-template-modal__body p {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.workflow-file-template-modal__pill {
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
  background: var(--gc-color-muted-bg);
  color: var(--gc-color-muted);
}

.workflow-file-template-modal__pill[data-valid='true'] {
  background: var(--gc-color-success-bg);
  color: var(--gc-color-success);
}

.workflow-file-template-modal__pill[data-valid='false'] {
  background: var(--gc-color-danger-bg);
  color: var(--gc-color-danger);
}

@media (max-width: 900px) {
  .workflow-template-detail__hero {
    display: grid;
    grid-template-columns: 1fr;
  }

  .workflow-template-detail__facts {
    grid-template-columns: 1fr;
  }

  .workflow-template-editor-shell {
    width: calc(100vw - 16px);
    height: calc(100vh - 16px);
    padding: 8px;
    overflow: hidden;
  }

  .workflow-file-template-modal__head {
    display: grid;
    justify-content: stretch;
  }

  .workflow-version-manager__head,
  .workflow-version-manager__item {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .workflow-version-manager__current,
  .workflow-version-manager__summary {
    grid-template-columns: 1fr;
  }

  .workflow-version-manager__badges {
    justify-content: flex-start;
  }

  .workflow-version-manager__action-cell,
  .workflow-version-manager__action,
  .workflow-version-manager__note-save {
    width: 100%;
    min-width: 0;
  }

}
</style>

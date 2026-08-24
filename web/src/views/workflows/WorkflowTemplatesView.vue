<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ApiRecord } from '@/api/modules/common'
import {
  applyWorkflowTemplateFromFile,
  compileWorkflowCanvas,
  createWorkflowTemplate,
  createWorkflowTemplateFromFile,
  deleteWorkflowTemplate,
  listWorkflowFileTemplates,
  createWorkflowTemplateVersion,
  listWorkflowTemplateVersions,
  listWorkflowTemplates,
  publishWorkflowTemplateVersion,
  updateCurrentWorkflowTemplateDraftVersion,
} from '@/api/modules/workflow-templates.api'
import { createSecret } from '@/api/modules/security.api'
import { GcModal, GcStatusTag } from '@/design-system/components'
import { readString, type ViewRow } from '@/composables/useBusinessPage'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import AutomationSectionTabs from '@/views/automation/AutomationSectionTabs.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import {
  loadWorkflowCredentials,
  workflowCredentialMetadata,
  workflowCredentialSummary,
  workflowSecretTypeForCredentialKind,
  type WorkflowCredentialKind as CredentialKind,
  type WorkflowManagedCredential as ManagedCredential,
} from './workflow-credentials'
import WorkflowCanvasEditor from './WorkflowCanvasEditor.vue'
import {
  createDefaultWorkflowCanvas,
  workflowDslToCanvas,
  type WorkflowCanvasDefinition,
  type WorkflowDslV1,
} from './workflow-canvas.model'

const pageRef = ref<InstanceType<typeof BusinessResourcePage> | null>(null)
const detailModalOpen = ref(false)
const versionManagerModalOpen = ref(false)
const editorModalOpen = ref(false)
const detailRow = ref<ViewRow | null>(null)
const versionManagerRow = ref<ViewRow | null>(null)
const editorRow = ref<ViewRow | null>(null)
const versionItems = ref<ApiRecord[]>([])
const versionLoading = ref(false)
const versionError = ref('')
const versionCreating = ref(false)
const publishLoading = ref(false)
const publishMessage = ref('')
const canvasSaving = ref(false)
const canvasMessage = ref('')
const canvasDraft = ref<WorkflowCanvasDefinition>(createDefaultWorkflowCanvas())
const activeTab = ref<'summary' | 'versions'>('summary')
const fileTemplateModalOpen = ref(false)
const fileTemplateMode = ref<'create' | 'apply'>('create')
const fileTemplateItems = ref<ApiRecord[]>([])
const fileTemplateLoading = ref(false)
const fileTemplatePending = ref(false)
const fileTemplateError = ref('')
const selectedFileTemplateId = ref('')
const fileTemplateTargetRow = ref<ViewRow | null>(null)
const credentialManagerOpen = ref(false)
const credentialItems = ref<ManagedCredential[]>([])
const credentialLoading = ref(false)
const credentialSaving = ref(false)
const credentialMessage = ref('')
const credentialError = ref('')
const credentialForm = ref<CredentialForm>({
  name: '',
  username: 'root',
  kind: 'username_password',
  apiKeyName: 'X-API-Key',
  apiKeyIn: 'header',
  secretValue: '',
})

interface CredentialForm {
  name: string
  username: string
  kind: CredentialKind
  apiKeyName: string
  apiKeyIn: 'header' | 'query'
  secretValue: string
}
const credentialKindOptions: readonly { kind: CredentialKind; title: string; subtitle: string; family: '通用' | 'SSH' | 'CURL' }[] = [
  { kind: 'username_password', title: '用户名 + 密码', subtitle: 'SSH connection / CURL Basic', family: '通用' },
  { kind: 'ssh_key', title: 'SSH 私钥', subtitle: 'username + private key', family: 'SSH' },
  { kind: 'curl_bearer', title: 'CURL Bearer', subtitle: 'Authorization token', family: 'CURL' },
  { kind: 'curl_api_key', title: 'CURL API Key', subtitle: 'header or query key', family: 'CURL' },
]

const config: BusinessPageConfig = {
  title: '工作流',
  description: '按画布草稿管理 CURL/SSH/SFTP 工作流版本、发布状态与变更记录。',
  showHeader: false,
  showMetrics: false,
  showToolbarDangerHint: false,
  readPermission: 'workflow.template.read',
  primaryPermission: 'workflow.template.write',
  primaryActionLabel: '空白新建',
  primaryAction: async () => {
    const canvas = createDefaultWorkflowCanvas('workflow-canvas-draft')
    const compiled = await compileCanvasOnBackend(canvas)
    await createWorkflowTemplate({
      content: compiled.content,
      changeSummary: '前端画布创建工作流草稿',
    })
    await pageRef.value?.reload()
  },
  moduleName: 'workflow-templates',
  resourceName: '工作流',
  defaultStatus: 'draft',
  defaultRisk: 'MEDIUM',
  showDetailPanel: false,
  showActionPanel: false,
  columns: [
    { key: 'name', title: '工作流名称', candidates: ['name'] },
    { key: 'status', title: '状态', candidates: ['status'] },
    { key: 'currentVersionLabel', title: '当前版本', candidates: ['currentVersionLabel', 'currentVersion'] },
    { key: 'updatedAt', title: '更新时间', candidates: ['updatedAt', 'createdAt'], kind: 'date' },
    { key: 'actions', title: '操作', candidates: [] },
  ],
  metrics: [],
  detailFields: [
    { label: '工作流 ID', candidates: ['id'] },
    { label: '工作流名称', candidates: ['name'] },
    { label: '当前状态', candidates: ['status'] },
    { label: '当前版本 ID', candidates: ['currentVersionId'] },
    { label: '创建时间', candidates: ['createdAt'] },
    { label: '更新时间', candidates: ['updatedAt'] },
  ],
  emptyTitle: '暂无工作流',
  emptyDescription: '先创建画布草稿，再基于版本发布到正式链路。',
  load: () => listWorkflowTemplates({ page: 1, pageSize: 50, sort: 'updatedAt:desc' }),
  actions: [],
  rowActions: [
    {
      label: '编辑',
      permission: 'workflow.template.write',
      reloadAfterRun: false,
      hidden: (row) => readString(row.raw, ['status']) !== 'draft',
      run: async (row) => {
        await openEditor(row)
      },
    },
    {
      label: '套用模板',
      permission: 'workflow.template.write',
      reloadAfterRun: false,
      run: async (row) => {
        await openFileTemplateModal('apply', row)
      },
    },
    {
      label: '详情',
      permission: 'workflow.template.read',
      reloadAfterRun: false,
      run: async (row) => {
        await openDetail(row)
      },
    },
    {
      label: '版本管理',
      permission: 'workflow.template.write',
      reloadAfterRun: false,
      run: async (row) => {
        await openVersionManager(row)
      },
    },
    {
      label: '删除',
      permission: 'workflow.template.write',
      danger: true,
      confirmText: 'DELETE',
      riskText: '删除会禁用该工作流及其全部版本，列表中不再展示；历史运行记录不会被改写。',
      reloadAfterRun: true,
      hidden: (row) => readString(row.raw, ['status']) === 'disabled',
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
  return published ? `V${readString(published, ['version'])}` : '—'
})

const fileTemplateModalTitle = computed(() => fileTemplateMode.value === 'create' ? '从文件模板新建工作流' : '用文件模板覆盖工作流')
const fileTemplateActionLabel = computed(() => fileTemplateMode.value === 'create' ? '按模板创建工作流' : '按模板覆盖当前工作流')
const credentialRequiresUsername = computed(() => ['username_password', 'ssh_key'].includes(credentialForm.value.kind))
const credentialRequiresApiKeyName = computed(() => credentialForm.value.kind === 'curl_api_key')
const credentialRequiresMultilineSecret = computed(() => credentialForm.value.kind === 'ssh_key')
const selectedCredentialKindOption = computed(() => credentialKindOptions.find((item) => item.kind === credentialForm.value.kind) ?? credentialKindOptions[0]!)
const credentialTargetLabel = computed(() => {
  if (credentialForm.value.kind === 'username_password') return 'SSH / HTTP Basic'
  return credentialForm.value.kind === 'ssh_key' ? 'SSH' : 'HTTP'
})
const credentialSecretLabel = computed(() => {
  if (credentialForm.value.kind === 'ssh_key') return 'SSH 私钥'
  if (credentialForm.value.kind === 'curl_bearer') return 'Bearer Token'
  if (credentialForm.value.kind === 'curl_api_key') return 'API Key'
  return '密码'
})
const credentialValuePlaceholder = computed(() => {
  if (credentialForm.value.kind === 'ssh_key') return '粘贴 PEM 格式私钥'
  if (credentialForm.value.kind === 'curl_bearer') return '输入 Bearer Token'
  if (credentialForm.value.kind === 'curl_api_key') return '输入 API Key'
  return '输入登录密码'
})
const credentialCreateDisabled = computed(() => {
  const form = credentialForm.value
  return credentialSaving.value
    || !form.name.trim()
    || (credentialRequiresUsername.value && !form.username.trim())
    || (credentialRequiresApiKeyName.value && !form.apiKeyName.trim())
    || !form.secretValue.trim()
})

async function openCredentialManager() {
  credentialMessage.value = ''
  credentialError.value = ''
  credentialManagerOpen.value = true
  await reloadCredentials()
}

function selectCredentialKind(kind: CredentialKind) {
  credentialForm.value = {
    ...credentialForm.value,
    kind,
    username: ['username_password', 'ssh_key'].includes(kind) ? credentialForm.value.username || 'root' : credentialForm.value.username,
    apiKeyName: kind === 'curl_api_key' ? credentialForm.value.apiKeyName || 'X-API-Key' : credentialForm.value.apiKeyName,
  }
}

async function submitCredential() {
  if (credentialCreateDisabled.value) return
  credentialSaving.value = true
  credentialMessage.value = ''
  credentialError.value = ''
  try {
    const form = credentialForm.value
    const secretType = workflowSecretTypeForCredentialKind(form.kind)
    const item: ManagedCredential = {
      id: '',
      name: form.name.trim(),
      username: form.username.trim(),
      kind: form.kind,
      type: secretType,
      apiKeyName: form.kind === 'curl_api_key' ? form.apiKeyName.trim() : undefined,
      apiKeyIn: form.kind === 'curl_api_key' ? form.apiKeyIn : undefined,
      createdAt: '',
    }
    const created = await createSecret({
      name: form.name.trim(),
      type: secretType,
      scopeType: 'global',
      plainText: form.secretValue,
      metadata: workflowCredentialMetadata(item),
    })
    if (!created.data?.id) throw new Error('创建凭据未返回有效编号')
    await reloadCredentials()
    credentialForm.value = {
      ...credentialForm.value,
      name: '',
      secretValue: '',
    }
    credentialMessage.value = '凭据已创建，可直接在工作流变量、SSH 节点和 HTTP 节点中选择。'
  } catch (cause) {
    credentialError.value = cause instanceof Error ? cause.message : '创建凭据失败'
  } finally {
    credentialSaving.value = false
  }
}

async function reloadCredentials() {
  credentialLoading.value = true
  credentialError.value = ''
  try {
    credentialItems.value = await loadWorkflowCredentials()
  } catch (cause) {
    credentialItems.value = []
    credentialError.value = cause instanceof Error ? cause.message : '加载后端凭据失败'
  } finally {
    credentialLoading.value = false
  }
}

function credentialUsageSummary(item: ManagedCredential) {
  if (item.kind === 'username_password') return 'SSH / HTTP Basic'
  if (item.kind === 'ssh_key') return 'SSH'
  return 'HTTP'
}

function isCurrentWorkflowVersion(item: ApiRecord, row: ViewRow | null = versionManagerRow.value): boolean {
  if (!row) return false
  const currentVersionId = readString(row.raw, ['currentVersionId'], '')
  const versionId = readString(item, ['id'], '')
  if (currentVersionId && versionId && currentVersionId === versionId) return true
  const currentVersion = readString(row.raw, ['currentVersion'], '')
  return Boolean(currentVersion && currentVersion !== '—' && currentVersion === readString(item, ['version'], ''))
}

interface VersionStatusBadge {
  readonly label: string
  readonly tone: string
}

function versionStatusBadges(item: ApiRecord): VersionStatusBadge[] {
  const status = readString(item, ['status'], 'draft')
  const badges: VersionStatusBadge[] = [{
    label: status === 'published' ? '已发布' : status === 'disabled' ? '已禁用' : '草稿',
    tone: status === 'published' ? 'published' : status === 'disabled' ? 'disabled' : 'draft',
  }]
  if (isCurrentWorkflowVersion(item)) badges.push({ label: '当前版本', tone: 'current' })
  return badges
}

function canRunVersionAction(item: ApiRecord): boolean {
  const status = readString(item, ['status'], 'draft')
  if (status === 'draft') return true
  if (status !== 'published') return false
  return !isCurrentWorkflowVersion(item)
}

function versionActionLabel(item: ApiRecord): string {
  return readString(item, ['status'], 'draft') === 'published' ? '切换版本' : '发布版本'
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
  await loadVersions(row)
}

async function openVersionManager(row: ViewRow) {
  versionManagerRow.value = row
  versionManagerModalOpen.value = true
  publishMessage.value = ''
  versionError.value = ''
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

async function openFileTemplateModal(mode: 'create' | 'apply', row?: ViewRow) {
  fileTemplateMode.value = mode
  fileTemplateTargetRow.value = row ?? null
  fileTemplateModalOpen.value = true
  fileTemplateError.value = ''
  selectedFileTemplateId.value = ''
  await loadFileTemplates()
}

async function loadVersions(row: ViewRow) {
  versionLoading.value = true
  versionError.value = ''
  try {
    const result = await listWorkflowTemplateVersions(readString(row.raw, ['id']))
    versionItems.value = [...(result.data?.items ?? [])]
    hydrateCanvasFromLatestVersion()
  } catch (cause) {
    versionItems.value = []
    versionError.value = cause instanceof Error ? cause.message : '加载工作流版本失败'
  } finally {
    versionLoading.value = false
  }
}

async function loadFileTemplates() {
  fileTemplateLoading.value = true
  fileTemplateError.value = ''
  try {
    const result = await listWorkflowFileTemplates()
    fileTemplateItems.value = [...(result.data?.items ?? [])]
    const firstValid = fileTemplateItems.value.find((item) => Boolean(item.valid))
    selectedFileTemplateId.value = firstValid ? readString(firstValid, ['id'], '') : ''
  } catch (cause) {
    fileTemplateItems.value = []
    fileTemplateError.value = cause instanceof Error ? cause.message : '加载工作流文件模板失败'
  } finally {
    fileTemplateLoading.value = false
  }
}

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

async function submitFileTemplateAction() {
  if (!selectedFileTemplateId.value || fileTemplatePending.value) return
  fileTemplatePending.value = true
  fileTemplateError.value = ''
  try {
    if (fileTemplateMode.value === 'create') {
      await createWorkflowTemplateFromFile({
        fileTemplateId: selectedFileTemplateId.value,
        changeSummary: '从文件模板创建工作流草稿',
      })
    } else {
      const row = fileTemplateTargetRow.value
      if (!row) throw new Error('缺少待覆盖的工作流目标')
      await applyWorkflowTemplateFromFile({
        templateId: readString(row.raw, ['id']),
        fileTemplateId: selectedFileTemplateId.value,
        changeSummary: '从文件模板覆盖工作流草稿',
      })
      if (editorRow.value && readString(editorRow.value.raw, ['id']) === readString(row.raw, ['id'])) {
        await loadVersions(editorRow.value)
        hydrateCanvasFromLatestVersion()
      }
    }
    fileTemplateModalOpen.value = false
    await pageRef.value?.reload()
  } catch (cause) {
    fileTemplateError.value = cause instanceof Error ? cause.message : '执行文件模板动作失败'
  } finally {
    fileTemplatePending.value = false
  }
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
      changeSummary: '画布编辑器保存草稿版本',
    })
    syncCreatedDraftVersion(result.data ?? {})
    canvasMessage.value = '当前草稿版本已更新。'
    await loadVersions(editorRow.value)
    await pageRef.value?.reload()
  } catch (cause) {
    canvasMessage.value = cause instanceof Error ? cause.message : '保存画布草稿失败'
  } finally {
    canvasSaving.value = false
  }
}

async function createManagedVersion() {
  const row = versionManagerRow.value
  if (!row || versionCreating.value) return
  versionCreating.value = true
  publishMessage.value = ''
  versionError.value = ''
  try {
    const canvas = createDefaultWorkflowCanvas(readString(row.raw, ['name'], 'workflow-canvas-draft'))
    const compiled = await compileCanvasOnBackend(canvas)
    const result = await createWorkflowTemplateVersion({
      templateId: readString(row.raw, ['id']),
      content: compiled.content,
      changeSummary: '版本管理创建新版本草稿',
    })
    publishMessage.value = '新版本草稿已创建。'
    await loadVersions(row)
    syncCreatedDraftVersion(result.data ?? {})
    await pageRef.value?.reload()
  } catch (cause) {
    versionError.value = cause instanceof Error ? cause.message : '创建工作流版本失败'
  } finally {
    versionCreating.value = false
  }
}

async function compileCanvasOnBackend(canvas: WorkflowCanvasDefinition): Promise<{ content: WorkflowDslV1 }> {
  const result = await compileWorkflowCanvas({ canvas })
  const content = result.data?.content
  if (!content) throw new Error('后端未返回工作流 DSL')
  return { content: content as WorkflowDslV1 }
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
    publishMessage.value = `已切换到 ${versionNumber ? `V${versionNumber}` : versionId}。`
    if (detailRow.value) {
      await loadVersions(detailRow.value)
    }
    if (versionManagerRow.value) {
      await loadVersions(versionManagerRow.value)
    }
    syncCurrentVersionRow(changedVersion)
    await pageRef.value?.reload()
  } catch (cause) {
    publishMessage.value = cause instanceof Error ? cause.message : '发布工作流版本失败'
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
  return Boolean(value && typeof value === 'object' && (value as { apiVersion?: unknown }).apiVersion === 'gcac.workflow/v1')
}
</script>

<template>
  <section class="workflow-templates-page">
    <AutomationSectionTabs section="workflow" />
    <BusinessResourcePage ref="pageRef" :config="config">
      <template #toolbar-actions-before-refresh>
        <button class="gc-button" type="button" @click="openFileTemplateModal('create')">模板管理</button>
        <button class="gc-button" type="button" @click="openCredentialManager">凭据管理</button>
      </template>
    </BusinessResourcePage>

    <GcModal
      v-model:open="detailModalOpen"
      :title="detailRow ? `工作流 ${readString(detailRow.raw, ['name'], detailRow.id)}` : '工作流详情'"
      description="工作流详情、画布草稿与版本清单全部收口到模态框里，主页面只保留紧凑列表。"
      size="xl"
      width="min(1280px, calc(100vw - 32px))"
    >
      <section v-if="detailRow" class="workflow-template-detail">
        <section class="workflow-template-detail__hero">
          <div class="workflow-template-detail__hero-copy">
            <p class="workflow-template-detail__eyebrow">Workflow</p>
            <h2>{{ readString(detailRow.raw, ['name'], detailRow.id) }}</h2>
            <span>当前发布版本 {{ publishedVersionLabel }}</span>
          </div>
          <div class="workflow-template-detail__hero-side">
            <GcStatusTag :status="readString(detailRow.raw, ['status'])" />
            <div class="workflow-template-detail__spotlight">
              <small>当前版本 ID</small>
              <strong>{{ readString(detailRow.raw, ['currentVersionId']) }}</strong>
            </div>
          </div>
        </section>

        <div class="workflow-template-detail__tabs">
          <button class="workflow-template-detail__tab" type="button" :data-active="activeTab === 'summary'" @click="activeTab = 'summary'">概览</button>
          <button class="workflow-template-detail__tab" type="button" :data-active="activeTab === 'versions'" @click="activeTab = 'versions'">版本</button>
        </div>

        <section v-if="activeTab === 'summary'" class="workflow-template-detail__section">
          <dl class="workflow-template-detail__facts">
            <div><dt>工作流 ID</dt><dd>{{ readString(detailRow.raw, ['id']) }}</dd></div>
            <div><dt>工作流名称</dt><dd>{{ readString(detailRow.raw, ['name']) }}</dd></div>
            <div><dt>当前状态</dt><dd>{{ readString(detailRow.raw, ['status']) }}</dd></div>
            <div><dt>当前版本 ID</dt><dd>{{ readString(detailRow.raw, ['currentVersionId']) }}</dd></div>
            <div><dt>创建时间</dt><dd>{{ formatBrowserLocalTime(readString(detailRow.raw, ['createdAt'])) || readString(detailRow.raw, ['createdAt']) }}</dd></div>
            <div><dt>更新时间</dt><dd>{{ formatBrowserLocalTime(readString(detailRow.raw, ['updatedAt'])) || readString(detailRow.raw, ['updatedAt']) }}</dd></div>
          </dl>
        </section>

        <section v-else class="workflow-template-detail__section">
          <p v-if="publishMessage" class="workflow-template-detail__message">{{ publishMessage }}</p>
          <p v-if="versionLoading" class="workflow-template-detail__loading">正在加载版本...</p>
          <p v-else-if="versionError" class="workflow-template-detail__error">{{ versionError }}</p>
          <ul v-else-if="versionItems.length" class="workflow-template-detail__list">
            <li v-for="item in versionItems" :key="readString(item, ['id'])" class="workflow-template-detail__list-item">
              <div class="workflow-template-detail__list-head">
                <strong>v{{ readString(item, ['version']) }}</strong>
                <GcStatusTag :status="readString(item, ['status'])" />
              </div>
              <p>{{ readString(item, ['changeSummary'], '没有变更说明。') }}</p>
              <small>{{ formatBrowserLocalTime(readString(item, ['createdAt'])) || readString(item, ['createdAt']) }}</small>
              <button
                v-if="canRunVersionAction(item)"
                class="gc-button"
                type="button"
                :disabled="publishLoading"
                @click="publishVersion(readString(item, ['id']))"
              >
                {{ publishLoading ? '处理中...' : versionActionLabel(item) }}
              </button>
            </li>
          </ul>
          <p v-else class="workflow-template-detail__loading">暂无版本。</p>
        </section>
      </section>

      <template #actions>
        <button class="gc-button" type="button" @click="detailModalOpen = false">关闭</button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="versionManagerModalOpen"
      :title="versionManagerRow ? `版本管理：${readString(versionManagerRow.raw, ['name'], versionManagerRow.id)}` : '版本管理'"
      description="这里只管理工作流版本的新建和发布，不修改工作流画布内容。"
      size="xl"
      width="min(980px, calc(100vw - 32px))"
    >
      <section v-if="versionManagerRow" class="workflow-version-manager">
        <header class="workflow-version-manager__head">
          <div>
            <strong>当前工作流版本</strong>
            <span>{{ readString(versionManagerRow.raw, ['currentVersionLabel', 'currentVersion'], '—') }}</span>
          </div>
          <button class="gc-button gc-button--primary" type="button" :disabled="versionCreating" @click="createManagedVersion">
            {{ versionCreating ? '创建中...' : '新增版本' }}
          </button>
        </header>

        <p v-if="publishMessage" class="workflow-template-detail__message">{{ publishMessage }}</p>
        <p v-if="versionLoading" class="workflow-template-detail__loading">正在加载版本...</p>
        <p v-else-if="versionError" class="workflow-template-detail__error">{{ versionError }}</p>
        <ul v-else-if="versionItems.length" class="workflow-template-detail__list">
          <li v-for="item in versionItems" :key="readString(item, ['id'])" class="workflow-template-detail__list-item">
            <div class="workflow-template-detail__list-head">
              <strong>V{{ readString(item, ['version']) }}</strong>
              <span
                v-for="badge in versionStatusBadges(item)"
                :key="`${readString(item, ['id'])}:${badge.tone}`"
                class="workflow-version-manager__status"
                :data-status="badge.tone"
              >
                {{ badge.label }}
              </span>
            </div>
            <p>{{ readString(item, ['changeSummary'], '没有变更说明。') }}</p>
            <small>{{ formatBrowserLocalTime(readString(item, ['createdAt'])) || readString(item, ['createdAt']) }}</small>
            <button
              v-if="canRunVersionAction(item)"
              class="gc-button"
              type="button"
              :disabled="publishLoading"
              @click="publishVersion(readString(item, ['id']))"
            >
              {{ publishLoading ? '处理中...' : versionActionLabel(item) }}
            </button>
          </li>
        </ul>
        <p v-else class="workflow-template-detail__loading">暂无版本。</p>
      </section>

      <template #actions>
        <button class="gc-button" type="button" @click="versionManagerModalOpen = false">关闭</button>
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
          :readonly="readString(editorRow.raw, ['status']) === 'published'"
          :save-message="canvasMessage"
          :saving="canvasSaving"
          @save="saveCanvasDraft"
        >
          <template #toolbar-actions>
            <GcStatusTag :status="readString(editorRow.raw, ['status'])" />
            <button class="gc-button" type="button" @click="editorModalOpen = false">关闭</button>
          </template>
        </WorkflowCanvasEditor>
      </section>
    </GcModal>

    <GcModal
      v-model:open="fileTemplateModalOpen"
      :title="fileTemplateModalTitle"
      description="模板文件来自内置模板库或用户导入目录。覆盖现有工作流时，会创建新的草稿版本，不会改写历史版本。"
      size="xl"
      width="min(1080px, calc(100vw - 32px))"
    >
      <section class="workflow-file-template-modal">
        <p v-if="fileTemplateMode === 'apply' && fileTemplateTargetRow" class="workflow-file-template-modal__target">
          当前目标：{{ readString(fileTemplateTargetRow.raw, ['name'], fileTemplateTargetRow.id) }}
        </p>
        <p v-if="fileTemplateError" class="workflow-file-template-modal__error">{{ fileTemplateError }}</p>
        <p v-if="fileTemplateLoading" class="workflow-file-template-modal__loading">正在扫描文件模板...</p>
        <ul v-else-if="fileTemplateItems.length" class="workflow-file-template-modal__list">
          <li
            v-for="item in fileTemplateItems"
            :key="readString(item, ['id'])"
            class="workflow-file-template-modal__item"
            :data-valid="item.valid ? 'true' : 'false'"
          >
            <label class="workflow-file-template-modal__choice">
              <input
                type="radio"
                name="workflow-file-template"
                :value="readString(item, ['id'])"
                :checked="selectedFileTemplateId === readString(item, ['id'])"
                :disabled="!item.valid"
                @change="selectedFileTemplateId = readString(item, ['id'])"
              />
              <div class="workflow-file-template-modal__body">
                <div class="workflow-file-template-modal__head">
                  <strong>{{ readString(item, ['metadata.displayName'], readString(item, ['metadata.name'], readString(item, ['fileName']))) }}</strong>
                  <span class="workflow-file-template-modal__pill" :data-valid="item.valid ? 'true' : 'false'">{{ item.valid ? '可用' : '无效' }}</span>
                </div>
                <small>{{ readString(item, ['source']) === 'builtin' ? '内置' : '用户导入' }} / {{ readString(item, ['relativePath']) }}</small>
                <p v-if="item.valid">
                  标识 {{ readString(item, ['metadata.name']) }} / steps {{ readString(item, ['stepCount'], '0') }} / rollback {{ readString(item, ['rollbackCount'], '0') }}
                </p>
                <p v-else>{{ readString(item, ['error'], '文件无效') }}</p>
              </div>
            </label>
          </li>
        </ul>
        <p v-else class="workflow-file-template-modal__loading">暂无可识别的工作流模板文件。</p>
      </section>
      <template #actions>
        <button class="gc-button" type="button" @click="fileTemplateModalOpen = false">取消</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="fileTemplatePending || !selectedFileTemplateId" @click="submitFileTemplateAction">
          {{ fileTemplatePending ? '处理中...' : fileTemplateActionLabel }}
        </button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="credentialManagerOpen"
      title="凭据管理"
      description="集中创建工作流要复用的登录凭据与 API 凭据。前端只做选择和复用，不再要求手工维护内部引用串。"
      size="xl"
      width="min(1080px, calc(100vw - 32px))"
    >
      <section class="credential-manager">
        <form class="credential-manager__form" @submit.prevent="submitCredential">
          <div class="credential-manager__form-head">
            <div>
              <strong>新增凭据</strong>
              <span>{{ selectedCredentialKindOption.family }} / {{ credentialTargetLabel }}</span>
            </div>
            <span class="credential-manager__badge">{{ selectedCredentialKindOption.title }}</span>
          </div>

          <fieldset class="credential-manager__type-picker">
            <legend>凭据类型</legend>
            <button
              v-for="option in credentialKindOptions"
              :key="option.kind"
              class="credential-manager__type-option"
              type="button"
              :data-active="credentialForm.kind === option.kind"
              :data-family="option.family"
              @click="selectCredentialKind(option.kind)"
            >
              <span>{{ option.title }}</span>
              <small>{{ option.subtitle }}</small>
            </button>
          </fieldset>

          <div class="credential-manager__grid">
            <label>
              <span>凭据名称</span>
              <input v-model="credentialForm.name" class="gc-input" type="text" placeholder="edge-01 root" />
            </label>
            <label v-if="credentialRequiresUsername">
              <span>用户名</span>
              <input v-model="credentialForm.username" class="gc-input" type="text" placeholder="root" />
            </label>
            <label v-if="credentialRequiresApiKeyName">
              <span>Header / 参数名</span>
              <input v-model="credentialForm.apiKeyName" class="gc-input" type="text" placeholder="X-API-Key" />
            </label>
            <fieldset v-if="credentialRequiresApiKeyName" class="credential-manager__segmented">
              <legend>传递位置</legend>
              <button type="button" :data-active="credentialForm.apiKeyIn === 'header'" @click="credentialForm.apiKeyIn = 'header'">Header</button>
              <button type="button" :data-active="credentialForm.apiKeyIn === 'query'" @click="credentialForm.apiKeyIn = 'query'">Query</button>
            </fieldset>
          </div>
          <label class="credential-manager__secret">
            <span>{{ credentialSecretLabel }}</span>
            <textarea
              v-if="credentialRequiresMultilineSecret"
              v-model="credentialForm.secretValue"
              class="gc-input credential-manager__secret-control credential-manager__secret-control--masked"
              :placeholder="credentialValuePlaceholder"
              rows="7"
              autocomplete="new-password"
              autocapitalize="off"
              spellcheck="false"
            />
            <input
              v-else
              v-model="credentialForm.secretValue"
              class="gc-input credential-manager__secret-control"
              type="password"
              :placeholder="credentialValuePlaceholder"
              autocomplete="new-password"
              autocapitalize="off"
              spellcheck="false"
            />
          </label>
          <div class="credential-manager__form-summary">
            <div>
              <span>存储类型</span>
              <strong>{{ workflowSecretTypeForCredentialKind(credentialForm.kind) }}</strong>
            </div>
            <div>
              <span>引用位置</span>
              <strong>{{ credentialTargetLabel }}</strong>
            </div>
          </div>
          <p v-if="credentialMessage" class="credential-manager__message">{{ credentialMessage }}</p>
          <p v-if="credentialError" class="credential-manager__error">{{ credentialError }}</p>
          <div class="credential-manager__form-actions">
            <button class="gc-button gc-button--primary" type="submit" :disabled="credentialCreateDisabled">
              {{ credentialSaving ? '创建中...' : '创建凭据' }}
            </button>
          </div>
        </form>

        <section class="credential-manager__list-section">
          <div class="credential-manager__section-head">
            <strong>已登记凭据</strong>
            <span>{{ credentialLoading ? '加载中...' : `${credentialItems.length} 个` }}</span>
          </div>
          <p v-if="credentialLoading" class="credential-manager__empty">正在从后端加载凭据元数据...</p>
          <ul v-else-if="credentialItems.length" class="credential-manager__list">
            <li v-for="item in credentialItems" :key="item.id" class="credential-manager__item">
              <div class="credential-manager__item-head">
                <div class="credential-manager__item-meta">
                  <strong>{{ item.name }}</strong>
                  <span>{{ workflowCredentialSummary(item) }}</span>
                </div>
                <span class="credential-manager__item-kind">{{ item.kind === 'username_password' ? '通用' : item.kind === 'ssh_key' ? 'SSH' : 'CURL' }}</span>
                <span class="credential-manager__item-usage">{{ credentialUsageSummary(item) }}</span>
              </div>
            </li>
          </ul>
          <p v-else class="credential-manager__empty">暂无后端凭据记录。创建后可直接在变量、SSH 节点和 HTTP 节点里选择。</p>
        </section>
      </section>
      <template #actions>
        <button class="gc-button" type="button" @click="credentialManagerOpen = false">关闭</button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.workflow-templates-page {
  display: grid;
  gap: var(--gc-space-4);
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
  border: 1px solid #d9e5f7;
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, rgb(59 130 246 / 12%), transparent 26%),
    linear-gradient(140deg, #f7fbff 0%, #ffffff 54%, #f3f7fc 100%);
}

.workflow-template-detail__hero-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.workflow-template-detail__eyebrow {
  margin: 0;
  color: #5b6f88;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.workflow-template-detail__hero-copy h2 {
  margin: 0;
  color: #0f172a;
  font-size: 24px;
  line-height: 1.06;
  overflow-wrap: anywhere;
}

.workflow-template-detail__hero-copy span {
  color: #64748b;
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
  background: #0f172a;
  color: #fff;
}

.workflow-template-detail__spotlight small {
  color: rgb(255 255 255 / 68%);
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
  border: 1px solid #dbe6f4;
  border-radius: 999px;
  background: #f8fbff;
}

.workflow-template-detail__tab {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #5b6f88;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.workflow-template-detail__tab[data-active='true'] {
  background: #fff;
  color: #0f172a;
  box-shadow: 0 4px 14px rgb(15 23 42 / 10%);
}

.workflow-template-detail__section {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid #e3ebf5;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff, #fbfdff);
}

.workflow-template-detail__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.workflow-template-detail__facts div,
.workflow-template-detail__list-item {
  display: grid;
  gap: 5px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #f8fbff;
  border: 1px solid #e4edf8;
}

.workflow-template-detail__facts dt {
  color: #64748b;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.workflow-template-detail__facts dd {
  margin: 0;
  color: #0f172a;
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
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.workflow-template-detail__error {
  color: var(--gc-color-danger);
}

.workflow-version-manager {
  display: grid;
  gap: 12px;
}

.workflow-version-manager__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px;
  border: 1px solid #dbe6f4;
  border-radius: 8px;
  background: #f8fbff;
}

.workflow-version-manager__head strong {
  display: block;
  color: #0f172a;
  font-size: 14px;
}

.workflow-version-manager__head span {
  display: block;
  margin-top: 3px;
  color: #64748b;
  font-size: 12px;
  font-weight: 800;
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
  color: #1d4ed8;
  background: #dbeafe;
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
  border: 1px solid rgb(255 255 255 / 72%);
  border-radius: 18px;
  background: #f4f8fd;
  box-shadow: 0 24px 80px rgb(15 23 42 / 18%);
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
  color: #475569;
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
  border: 1px solid #dbe6f4;
  border-radius: 8px;
  background: #fff;
}

.workflow-file-template-modal__item[data-valid='false'] {
  background: #fff7f7;
  border-color: #fecaca;
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
  color: #0f172a;
  font-size: 13px;
}

.workflow-file-template-modal__body small,
.workflow-file-template-modal__body p {
  margin: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.workflow-file-template-modal__pill {
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
  background: #e2e8f0;
  color: #475569;
}

.workflow-file-template-modal__pill[data-valid='true'] {
  background: #dcfce7;
  color: #166534;
}

.workflow-file-template-modal__pill[data-valid='false'] {
  background: #fee2e2;
  color: #b91c1c;
}

.credential-manager {
  display: grid;
  grid-template-columns: minmax(360px, 0.86fr) minmax(0, 1.14fr);
  gap: 16px;
  align-items: start;
}

.credential-manager__form,
.credential-manager__list-section {
  display: grid;
  gap: 14px;
  border: 1px solid #d8e4f2;
  border-radius: 8px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
  padding: 16px;
  box-shadow: 0 12px 30px rgb(15 23 42 / 6%);
}

.credential-manager__form-head,
.credential-manager__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.credential-manager__form-head strong,
.credential-manager__section-head strong,
.credential-manager__item-head strong {
  color: #0f172a;
  font-size: 14px;
}

.credential-manager__form-head span,
.credential-manager__section-head span,
.credential-manager__item-head span {
  display: block;
  margin-top: 2px;
  color: #64748b;
  font-size: 12px;
}

.credential-manager__badge,
.credential-manager__item-kind {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}

.credential-manager__type-picker {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.credential-manager__type-picker legend,
.credential-manager__segmented legend {
  padding: 0 4px;
  color: #475569;
  font-size: 12px;
  font-weight: 800;
}

.credential-manager__type-option {
  display: grid;
  gap: 3px;
  min-height: 58px;
  padding: 10px 11px;
  border: 1px solid #dbe6f4;
  border-radius: 8px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.credential-manager__type-option:hover,
.credential-manager__type-option[data-active='true'] {
  border-color: #60a5fa;
  background: #f0f7ff;
  box-shadow: 0 8px 20px rgb(37 99 235 / 10%);
}

.credential-manager__type-option span {
  color: #0f172a;
  font-size: 13px;
  font-weight: 800;
}

.credential-manager__type-option small {
  color: #64748b;
  font-size: 11px;
  line-height: 1.35;
}

.credential-manager__type-option[data-family='CURL'][data-active='true'] {
  border-color: #34d399;
  background: #f0fdf4;
  box-shadow: 0 8px 20px rgb(22 163 74 / 10%);
}

.credential-manager__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.credential-manager label,
.credential-manager__secret {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.credential-manager label span,
.credential-manager__secret span {
  color: #475569;
  font-size: 12px;
  font-weight: 800;
}

.credential-manager :deep(.gc-input),
.credential-manager .gc-input {
  min-height: 38px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: #0f172a;
  font-size: 13px;
  outline: none;
}

.credential-manager :deep(.gc-input:focus),
.credential-manager .gc-input:focus {
  border-color: #60a5fa;
  box-shadow: 0 0 0 3px rgb(96 165 250 / 18%);
}

.credential-manager__secret-control {
  width: 100%;
  padding: 9px 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

.credential-manager__secret-control[type='password'] {
  letter-spacing: 0.08em;
}

.credential-manager__secret-control--masked {
  min-height: 168px;
  resize: vertical;
  line-height: 1.5;
  -webkit-text-security: disc;
}

.credential-manager__segmented {
  display: inline-flex;
  align-self: end;
  gap: 4px;
  margin: 0;
  padding: 4px;
  border: 1px solid #dbe6f4;
  border-radius: 8px;
  background: #eef4fb;
}

.credential-manager__segmented legend {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.credential-manager__segmented button {
  min-height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #475569;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.credential-manager__segmented button[data-active='true'] {
  background: #fff;
  color: #0f172a;
  box-shadow: 0 4px 12px rgb(15 23 42 / 10%);
}

.credential-manager textarea {
  min-height: 148px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
}

.credential-manager__form-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.credential-manager__form-summary div {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid #dbe6f4;
  border-radius: 8px;
  background: #f8fbff;
}

.credential-manager__form-summary span {
  color: #64748b;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.credential-manager__form-summary strong {
  color: #0f172a;
  font-size: 13px;
}

.credential-manager__message,
.credential-manager__error,
.credential-manager__empty {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.credential-manager__message {
  color: #166534;
}

.credential-manager__error {
  color: var(--gc-color-danger);
}

.credential-manager__empty {
  color: #64748b;
}

.credential-manager__form-actions,
.credential-manager__item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.credential-manager__item-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.credential-manager__list {
  display: grid;
  gap: 8px;
  max-height: min(54vh, 620px);
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.credential-manager__item {
  display: block;
  padding: 10px 12px;
  border: 1px solid #dbe6f4;
  border-radius: 8px;
  background: #fff;
}

.credential-manager__item-meta {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.credential-manager__item-usage {
  margin-top: 0;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
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

  .credential-manager,
  .credential-manager__grid {
    grid-template-columns: 1fr;
  }
}
</style>

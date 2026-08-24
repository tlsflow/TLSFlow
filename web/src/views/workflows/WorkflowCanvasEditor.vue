<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { compileWorkflowCanvas, testWorkflowTemplateStep, validateWorkflowCanvasOnBackend } from '@/api/modules/workflow-templates.api'
import {
  findWorkflowCredentialById,
  loadWorkflowCredentials,
  workflowCredentialBinding,
  workflowCredentialLabel,
  type WorkflowCredentialKind,
  type WorkflowManagedCredential,
} from './workflow-credentials'
import {
  NODE_TYPE_DEFINITIONS,
  WORKFLOW_FLOW_LAYOUT,
  WORKFLOW_STAGE_DEFINITIONS,
  addNode,
  autoLayoutCanvas,
  cloneCanvas,
  createDefaultWorkflowCanvas,
  getNodeTypeDefinition,
  getNodeStage,
  getVariableFlow,
  isWorkflowDslV1,
  removeWorkflowVariable,
  renameWorkflowVariable,
  removeNode,
  setNodeConfigValue,
  setNodeLabel,
  setNodeStage,
  upsertWorkflowVariable,
  workflowDslToCanvas,
  type WorkflowCanvasDefinition,
  type WorkflowCanvasHttpAuthType,
  type WorkflowCanvasNode,
  type WorkflowCanvasNodeType,
  type WorkflowCanvasStage,
  type WorkflowDslV1,
  type WorkflowValidationIssue,
  type WorkflowVariableDefinition,
  type WorkflowNodeFieldDefinition,
} from './workflow-canvas.model'

interface StepTestResult {
  readonly id?: string
  readonly mode?: string
  readonly plannedOnly?: boolean
  readonly renderedStep?: Record<string, unknown>
  readonly stepResult?: Record<string, unknown>
  readonly stepOutput?: unknown
  readonly logs?: readonly string[]
}

interface StepRuntimeState {
  readonly userVariables: Record<string, unknown>
}

interface StepTestErrorDetail {
  readonly message?: string
  readonly code?: string
  readonly target?: string
  readonly stage?: string
  readonly category?: string
  readonly cause?: string
  readonly suggestion?: string
}

type BottomPanelKey = 'variables' | 'validation' | 'dsl' | 'runtime'

const props = withDefaults(defineProps<{
  readonly modelValue?: WorkflowCanvasDefinition
  readonly readonly?: boolean
  readonly saveMessage?: string
  readonly saving?: boolean
}>(), {
  readonly: false,
  saveMessage: '',
  saving: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: WorkflowCanvasDefinition]
  save: [value: { canvas: WorkflowCanvasDefinition }]
}>()

const history = ref<WorkflowCanvasDefinition[]>([])
const future = ref<WorkflowCanvasDefinition[]>([])
const selectedNodeId = ref('')
const clipboardNode = ref<WorkflowCanvasNode | null>(null)
const newNodeStage = ref<WorkflowCanvasStage>('prepare')
const activeBottomPanel = ref<BottomPanelKey>('validation')
const bottomPanelCollapsed = ref(false)
const stepTesting = ref(false)
const stepTestMessage = ref('')
const stepTestResult = ref<StepTestResult | null>(null)
const stepTestStepName = ref('')
const stepRuntimeState = ref<StepRuntimeState>({ userVariables: {} })
const dslEditorText = ref('')
const dslEditorDirty = ref(false)
const dslEditorMessage = ref('')
const managedCredentials = ref<WorkflowManagedCredential[]>([])
const credentialsLoading = ref(false)
const credentialsLoadError = ref('')

const SSH_NODE_TYPES: readonly WorkflowCanvasNodeType[] = ['ssh', 'sftp', 'scp']
const HTTP_CREDENTIAL_AUTH_TYPES: readonly WorkflowCanvasHttpAuthType[] = ['basic', 'bearer', 'api_key']

async function refreshManagedCredentials() {
  credentialsLoading.value = true
  credentialsLoadError.value = ''
  try {
    managedCredentials.value = await loadWorkflowCredentials()
  } catch (cause) {
    managedCredentials.value = []
    credentialsLoadError.value = cause instanceof Error ? cause.message : '加载后端凭据失败'
  } finally {
    credentialsLoading.value = false
  }
}

function readNodeHttpAuthType(value: unknown): WorkflowCanvasHttpAuthType {
  const authType = String(value ?? 'none')
  return ['none', 'basic', 'bearer', 'api_key'].includes(authType)
    ? authType as WorkflowCanvasHttpAuthType
    : 'none'
}

function credentialKindsForNode(node: WorkflowCanvasNode): readonly WorkflowCredentialKind[] {
  if (node.type === 'http') {
    const authType = readNodeHttpAuthType(node.config.authType)
    if (authType === 'basic') return ['username_password']
    if (authType === 'bearer') return ['curl_bearer']
    if (authType === 'api_key') return ['curl_api_key']
    return []
  }
  if (SSH_NODE_TYPES.includes(node.type)) return ['username_password', 'ssh_key']
  return []
}

function isTemplateExpression(value: string): boolean {
  return /^\s*\{\{.+\}\}\s*$/.test(value)
}

function compatibleCredentials(node: WorkflowCanvasNode): WorkflowManagedCredential[] {
  const kinds = credentialKindsForNode(node)
  return managedCredentials.value.filter((item) => kinds.includes(item.kind))
}

function resolveNodeCredential(node: WorkflowCanvasNode): WorkflowManagedCredential | null {
  const candidates = compatibleCredentials(node)
  if (candidates.length === 0) return null
  if (node.type === 'http') {
    const explicitId = String(node.config.authCredentialId ?? '').trim()
    const explicit = explicitId ? candidates.find((item) => item.id === explicitId) : undefined
    if (explicit) return explicit
    const authCredential = readCredentialId(node.config.authCredential)
    const authType = readNodeHttpAuthType(node.config.authType)
    const authUsername = String(node.config.authUsername ?? '').trim()
    const authApiKeyName = String(node.config.authApiKeyName ?? '').trim()
    return candidates.find((item) => {
      if (item.id !== authCredential) return false
      if (authType === 'basic') return !authUsername || item.username === authUsername
      if (authType === 'api_key') return !authApiKeyName || (item.apiKeyName ?? 'X-API-Key') === authApiKeyName
      return true
    }) ?? null
  }
  const explicitId = String(node.config.credentialId ?? '').trim()
  const explicit = explicitId ? candidates.find((item) => item.id === explicitId) : undefined
  if (explicit) return explicit
  const credentialId = readCredentialId(node.config.credential)
  const username = String(node.config.username ?? '').trim()
  return candidates.find((item) => item.id === credentialId && (!username || item.username === username)) ?? null
}

const selectedNodeCredentialOptions = computed(() => selectedNode.value ? compatibleCredentials(selectedNode.value) : [])
const selectedNodeCredentialId = computed(() => selectedNode.value ? resolveNodeCredential(selectedNode.value)?.id ?? '' : '')
const selectedNodeHttpAuthType = computed(() => selectedNode.value?.type === 'http' ? readNodeHttpAuthType(selectedNode.value.config.authType) : 'none')

const canvas = computed(() => props.modelValue ?? createDefaultWorkflowCanvas())
const selectedNode = computed(() => canvas.value.nodes.find((node) => node.id === selectedNodeId.value) ?? canvas.value.nodes[0] ?? null)
const selectedNodeDefinition = computed(() => selectedNode.value ? getNodeTypeDefinition(selectedNode.value.type) : null)
const validationIssues = ref<WorkflowValidationIssue[]>([])
const variableFlow = computed(() => getVariableFlow(canvas.value))
const dslPreview = ref<WorkflowDslV1 | null>(null)
const backendValidationMessage = ref('')
const canEdit = computed(() => !props.readonly)
const zoomPercent = computed(() => Math.round((canvas.value.viewport.zoom ?? 1) * 100))
const stageSections = computed(() => {
  let top = WORKFLOW_FLOW_LAYOUT.top
  return WORKFLOW_STAGE_DEFINITIONS.map((stage) => {
    const stageNodes = canvas.value.nodes.filter((node) => getNodeStage(node) === stage.key)
    const height = WORKFLOW_FLOW_LAYOUT.stageHeaderHeight + Math.max(stageNodes.length, 1) * WORKFLOW_FLOW_LAYOUT.nodeGap + WORKFLOW_FLOW_LAYOUT.stageGap
    const section = { ...stage, top, height, count: stageNodes.length }
    top += height
    return section
  })
})
const surfaceHeight = computed(() => Math.max(720, Math.ceil(stageSections.value.at(-1)?.top ?? 0) + Math.ceil(stageSections.value.at(-1)?.height ?? 0) + 24))
const stepTestStepResult = computed(() => readRecord(stepTestResult.value?.stepResult))
const stepTestRenderedStep = computed(() => readRecord(stepTestResult.value?.renderedStep))
const stepTestOutput = computed(() => stepTestResult.value?.stepOutput ?? null)
const stepTestOutputRecord = computed(() => readRecord(stepTestOutput.value))
const stepTestOutputBodyRecord = computed(() => readRecord(stepTestOutputRecord.value?.body))
const stepTestOutputRawRecord = computed(() => readRecord(stepTestOutputRecord.value?.raw))
const stepTestCommandResult = computed(() =>
  readRecord(stepTestOutputRecord.value?.commandResult)
  ?? readRecord(stepTestOutputBodyRecord.value?.commandResult)
  ?? readRecord(stepTestOutputRawRecord.value?.commandResult),
)
const stepTestPlan = computed(() => stepTestStepResult.value?.plan ?? stepTestRenderedStep.value?.preview ?? null)
const stepTestPlanText = computed(() => stepTestPlan.value === null ? '' : JSON.stringify(stepTestPlan.value, null, 2))
const stepTestOutputText = computed(() => stepTestOutput.value === null ? '' : JSON.stringify(stepTestOutput.value, null, 2))
const stepTestLogs = computed(() => [...readStringArray(stepTestStepResult.value?.logs), ...readStringArray(stepTestResult.value?.logs)])
const stepTestExitCode = computed(() =>
  firstNumber(
    stepTestOutputRecord.value?.exitCode,
    stepTestCommandResult.value?.exitCode,
    stepTestOutputBodyRecord.value?.exitCode,
    stepTestOutputRawRecord.value?.exitCode,
  ),
)
const stepTestStdout = computed(() =>
  firstString(
    stepTestOutputRecord.value?.stdout,
    stepTestCommandResult.value?.stdout,
    stepTestOutputBodyRecord.value?.stdout,
    stepTestOutputRawRecord.value?.stdout,
  ),
)
const stepTestStderr = computed(() =>
  firstString(
    stepTestOutputRecord.value?.stderr,
    stepTestCommandResult.value?.stderr,
    stepTestOutputBodyRecord.value?.stderr,
    stepTestOutputRawRecord.value?.stderr,
  ),
)
const realRunButtonLabel = computed(() => {
  if (stepTesting.value) return '试跑中...'
  if (selectedNode.value?.type === 'ssh') return '真实 SSH 执行当前节点'
  if (selectedNode.value?.type === 'sftp' || selectedNode.value?.type === 'scp') return '真实文件传输试跑'
  if (selectedNode.value?.type === 'http' || selectedNode.value?.type === 'verify') return '真实 HTTP 试跑当前节点'
  return '真实试跑当前节点'
})
const stepTestErrorDetail = computed<StepTestErrorDetail | null>(() => {
  const result = stepTestStepResult.value
  const output = stepTestOutputRecord.value
  const body = readRecord(output?.body)
  const raw = readRecord(output?.raw)
  const detail = readRecord(body?.detail) ?? readRecord(raw?.detail) ?? readRecord(output?.detail)
  const message = firstString(result?.errorMessage, output?.errorMessage, body?.errorMessage, raw?.errorMessage)
  const code = firstString(result?.errorCode, output?.errorCode, body?.errorCode, raw?.errorCode, detail?.sshErrorCode)
  const target = firstString(detail?.target)
  const stage = firstString(detail?.stage)
  const category = firstString(detail?.category)
  const cause = firstString(detail?.cause, output?.stderr)
  const suggestion = firstString(detail?.suggestion)
  if (!message && !code && !target && !cause && !suggestion) return null
  return { message, code, target, stage, category, cause, suggestion }
})
let backendCanvasSyncSeq = 0

watch(() => props.modelValue, () => {
  if (!selectedNodeId.value && canvas.value.nodes[0]) selectedNodeId.value = canvas.value.nodes[0].id
}, { immediate: true })

onMounted(() => {
  void refreshManagedCredentials()
})

watch(dslPreview, (value) => {
  if (dslEditorDirty.value) return
  dslEditorText.value = value ? JSON.stringify(value, null, 2) : ''
}, { immediate: true })

watch(canvas, (value) => {
  void syncBackendCanvasState(value)
}, { immediate: true, deep: true })

watch([canvas, selectedNodeId], () => {
  stepRuntimeState.value = mergeRuntimeState(stepRuntimeState.value, canvas.value)
}, { immediate: true, deep: true })

async function syncBackendCanvasState(value: WorkflowCanvasDefinition) {
  const seq = ++backendCanvasSyncSeq
  backendValidationMessage.value = ''
  try {
    const snapshot = cloneCanvas(value)
    const validation = await validateWorkflowCanvasOnBackend({ canvas: snapshot })
    if (seq !== backendCanvasSyncSeq) return
    validationIssues.value = Array.isArray(validation.data?.issues)
      ? validation.data.issues as WorkflowValidationIssue[]
      : []
    if (validationIssues.value.some((issue) => issue.severity === 'error')) {
      dslPreview.value = null
      return
    }
    const compiled = await compileWorkflowCanvas({ canvas: snapshot })
    if (seq !== backendCanvasSyncSeq) return
    dslPreview.value = (compiled.data?.content ?? null) as WorkflowDslV1 | null
  } catch (error) {
    if (seq !== backendCanvasSyncSeq) return
    validationIssues.value = []
    dslPreview.value = null
    backendValidationMessage.value = error instanceof Error ? error.message : '后端画布校验失败'
  }
}

function commit(next: WorkflowCanvasDefinition) {
  if (!canEdit.value) return
  history.value = [...history.value, cloneCanvas(canvas.value)]
  future.value = []
  emit('update:modelValue', cloneCanvas(next))
}

function add(type: WorkflowCanvasNodeType) {
  const next = addNode(canvas.value, type, newNodeStage.value)
  commit(next)
  selectedNodeId.value = next.nodes[next.nodes.length - 1]?.id ?? ''
}

function removeSelectedNode() {
  if (!selectedNode.value) return
  const next = removeNode(canvas.value, selectedNode.value.id)
  commit(next)
  selectedNodeId.value = next.nodes[0]?.id ?? ''
}

function copySelectedNode() {
  if (!selectedNode.value) return
  clipboardNode.value = cloneCanvas({ ...canvas.value, nodes: [selectedNode.value] }).nodes[0] ?? null
}

function pasteNode() {
  if (!clipboardNode.value) return
  const copy: WorkflowCanvasNode = {
    ...clipboardNode.value,
    id: `${clipboardNode.value.type}_${Date.now()}_copy`,
    label: `${clipboardNode.value.label} 副本`,
    position: {
      x: clipboardNode.value.position.x + 36,
      y: clipboardNode.value.position.y + 36,
    },
    ui: { ...(clipboardNode.value.ui ?? {}), stage: getNodeStage(clipboardNode.value) },
  }
  commit(autoLayoutCanvas({ ...canvas.value, nodes: [...canvas.value.nodes, copy] }))
  selectedNodeId.value = copy.id
}

function undo() {
  const previous = history.value[history.value.length - 1]
  if (!previous) return
  history.value = history.value.slice(0, -1)
  future.value = [cloneCanvas(canvas.value), ...future.value]
  emit('update:modelValue', previous)
  selectedNodeId.value = previous.nodes[0]?.id ?? ''
}

function redo() {
  const next = future.value[0]
  if (!next) return
  future.value = future.value.slice(1)
  history.value = [...history.value, cloneCanvas(canvas.value)]
  emit('update:modelValue', next)
  selectedNodeId.value = next.nodes[0]?.id ?? ''
}

function zoom(delta: number) {
  const nextZoom = Math.min(1.6, Math.max(0.6, Number((canvas.value.viewport.zoom + delta).toFixed(2))))
  commit({ ...canvas.value, viewport: { ...canvas.value.viewport, zoom: nextZoom } })
}

function layout() {
  commit(autoLayoutCanvas(canvas.value))
}

function updateField(field: WorkflowNodeFieldDefinition, event: Event) {
  if (!selectedNode.value) return
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  const value = field.kind === 'number' ? Number(target.value) : target.value
  commit(setNodeConfigValue(canvas.value, selectedNode.value.id, field.key, value))
}

function updateLabel(event: Event) {
  if (!selectedNode.value) return
  const target = event.target as HTMLInputElement
  commit(setNodeLabel(canvas.value, selectedNode.value.id, target.value))
}

function updateStage(event: Event) {
  if (!selectedNode.value) return
  const target = event.target as HTMLSelectElement
  commit(setNodeStage(canvas.value, selectedNode.value.id, target.value as WorkflowCanvasStage))
}

function updateSelectedNodeConfig(patch: Record<string, unknown>) {
  if (!selectedNode.value) return
  const next = {
    ...canvas.value,
    nodes: canvas.value.nodes.map((node) => node.id === selectedNode.value?.id ? { ...node, config: { ...node.config, ...patch } } : node),
  }
  commit(next)
}

function updateHttpAuthType(event: Event) {
  const target = event.target as HTMLSelectElement
  updateSelectedNodeConfig({ authType: target.value, authCredentialId: '' })
}

function updateSelectedCredential(event: Event) {
  const node = selectedNode.value
  if (!node) return
  const target = event.target as HTMLSelectElement
  const credential = managedCredentials.value.find((item) => item.id === target.value) ?? null
  if (node.type === 'http') {
    const authType = readNodeHttpAuthType(node.config.authType)
    if (!HTTP_CREDENTIAL_AUTH_TYPES.includes(authType)) return
    const currentUsername = String(node.config.authUsername ?? '')
    const currentApiKeyName = String(node.config.authApiKeyName ?? 'X-API-Key')
    const patch: Record<string, unknown> = {
      authCredentialId: credential?.id ?? '',
      authCredential: credential ? workflowCredentialBinding(credential) : '',
    }
    if (authType === 'basic' && credential) {
      patch.authUsername = !currentUsername.trim() || isTemplateExpression(currentUsername) ? credential.username : currentUsername
    }
    if (authType === 'api_key' && credential) {
      patch.authApiKeyName = !currentApiKeyName.trim() || currentApiKeyName === 'X-API-Key'
        ? (credential.apiKeyName ?? 'X-API-Key')
        : currentApiKeyName
      patch.authApiKeyIn = credential.apiKeyIn ?? node.config.authApiKeyIn ?? 'header'
    }
    updateSelectedNodeConfig(patch)
    return
  }
  if (!SSH_NODE_TYPES.includes(node.type)) return
  const currentUsername = String(node.config.username ?? '')
  updateSelectedNodeConfig({
    credentialId: credential?.id ?? '',
    credential: credential ? workflowCredentialBinding(credential) : '',
    username: credential && (!currentUsername.trim() || isTemplateExpression(currentUsername))
      ? credential.username
      : currentUsername,
  })
}

function credentialSelectorHint(node: WorkflowCanvasNode): string {
  if (node.type === 'http') {
    const authType = readNodeHttpAuthType(node.config.authType)
    if (authType === 'basic') return '已保存的用户名 + 密码'
    if (authType === 'bearer') return '已保存的 Bearer Token'
    if (authType === 'api_key') return '已保存的 API Key'
  }
  return '已保存的 SSH / SFTP 凭据'
}

function resolveVariableCredential(definition: WorkflowVariableDefinition): WorkflowManagedCredential | null {
  const id = readCredentialId(definition.default)
  return id ? findWorkflowCredentialById(id, managedCredentials.value) : null
}

function resolveVariableCredentialId(definition: WorkflowVariableDefinition): string {
  return resolveVariableCredential(definition)?.id ?? ''
}

function updateVariableCredential(name: string, event: Event) {
  const target = event.target as HTMLSelectElement
  const credential = managedCredentials.value.find((item) => item.id === target.value) ?? null
  const current = canvas.value.variables[name]
  if (!current) return
  commit(upsertWorkflowVariable(canvas.value, name, {
    ...current,
    default: credential ? workflowCredentialBinding(credential) : undefined,
    sensitive: true,
  }))
}

function runtimeCredentialOptions(key: string): WorkflowManagedCredential[] {
  const node = selectedNode.value
  if (node) {
    const candidates = compatibleCredentials(node)
    if (candidates.length > 0) return candidates
  }
  if (/api|token/i.test(key)) {
    return managedCredentials.value.filter((item) => item.kind === 'curl_bearer' || item.kind === 'curl_api_key')
  }
  if (/ssh|credential/i.test(key)) {
    return managedCredentials.value.filter((item) => item.kind === 'username_password' || item.kind === 'ssh_key')
  }
  return managedCredentials.value
}

function resolveRuntimeCredentialId(key: string): string {
  return readCredentialId(stepRuntimeState.value.userVariables[key]) ?? ''
}

function updateRuntimeCredentialBinding(key: string, event: Event) {
  const target = event.target as HTMLSelectElement
  const credential = managedCredentials.value.find((item) => item.id === target.value) ?? null
  stepRuntimeState.value = {
    ...stepRuntimeState.value,
    userVariables: {
      ...stepRuntimeState.value.userVariables,
      [key]: credential ? workflowCredentialBinding(credential) : undefined,
    },
  }
}

function addVariable() {
  let index = Object.keys(canvas.value.variables).length + 1
  while (canvas.value.variables[`variable${index}`]) index += 1
  commit(upsertWorkflowVariable(canvas.value, `variable${index}`, { type: 'string', required: false, description: '自定义运行变量' }))
}

function updateVariableName(oldName: string, event: Event) {
  const target = event.target as HTMLInputElement
  commit(renameWorkflowVariable(canvas.value, oldName, target.value))
}

function updateVariableField(name: string, field: keyof WorkflowVariableDefinition, event: Event) {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  const current = canvas.value.variables[name]
  if (!current) return
  const value = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value
  const next = { ...current, [field]: value }
  if (field === 'type' && value === 'credential') {
    next.default = undefined
    next.sensitive = true
  }
  commit(upsertWorkflowVariable(canvas.value, name, next))
}

function deleteVariable(name: string) {
  commit(removeWorkflowVariable(canvas.value, name))
}

function save() {
  emit('save', { canvas: cloneCanvas(canvas.value) })
}

function resetDslEditorToCanvas() {
  dslEditorText.value = dslPreview.value ? JSON.stringify(dslPreview.value, null, 2) : ''
  dslEditorDirty.value = false
  dslEditorMessage.value = '已回填后端编译后的 DSL。'
}

function updateDslEditor(event: Event) {
  const target = event.target as HTMLTextAreaElement
  dslEditorText.value = target.value
  dslEditorDirty.value = true
  dslEditorMessage.value = ''
}

async function importDslFile(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  dslEditorText.value = await file.text()
  dslEditorDirty.value = true
  dslEditorMessage.value = `已加载文件：${file.name}`
  target.value = ''
}

function importDslIntoCanvas() {
  if (!canEdit.value) return
  try {
    const parsed = JSON.parse(dslEditorText.value) as unknown
    if (!isWorkflowDslV1(parsed)) {
      throw new Error('DSL 顶层结构无效，必须包含 apiVersion=gcac.workflow/v1、kind=CurlSshWorkflow、metadata、variables、steps。')
    }
    const imported = workflowDslToCanvas(parsed)
    commit(imported)
    selectedNodeId.value = imported.nodes[0]?.id ?? ''
    dslEditorText.value = JSON.stringify(parsed, null, 2)
    dslEditorDirty.value = false
    dslEditorMessage.value = `DSL 已导入并覆盖当前画布，共 ${imported.nodes.length} 个节点。`
  } catch (error) {
    dslEditorMessage.value = error instanceof Error ? error.message : 'DSL 导入失败'
  }
}

function selectBottomPanel(panel: BottomPanelKey) {
  activeBottomPanel.value = panel
  bottomPanelCollapsed.value = false
}

function toggleBottomPanelCollapsed() {
  bottomPanelCollapsed.value = !bottomPanelCollapsed.value
}

async function testSelectedNode() {
  await runSelectedNode('mock')
}

async function runSelectedNode(mode: 'mock' | 'real_test') {
  if (!selectedNode.value || stepTesting.value) return
  refreshManagedCredentials()
  stepTesting.value = true
  stepTestMessage.value = ''
  stepTestResult.value = null
  activeBottomPanel.value = 'runtime'
  bottomPanelCollapsed.value = false
  try {
    const compiled = await compileWorkflowCanvas({ canvas: cloneCanvas(canvas.value) })
    const compiledData = readRecord(compiled.data)
    const content = compiledData?.content as WorkflowDslV1 | undefined
    const stepNamesSource = compiledData ? readRecord(compiledData.stepNames) : null
    const stepNames = stepNamesSource ? stepNamesSource as Record<string, string> : {}
    if (!content) throw new Error('后端未返回工作流 DSL')
    const stepName = stepNames[selectedNode.value.id]
    if (!stepName) throw new Error('后端未返回当前节点对应的 stepName')
    stepTestStepName.value = stepName
    const result = await testWorkflowTemplateStep({
      content,
      stepName,
      mode,
      userVariables: mode === 'mock' ? buildMockUserVariables(canvas.value) : buildRuntimeUserVariables(),
      certificateMaterials: mode === 'mock' ? buildMockCertificateMaterials(canvas.value) : buildRuntimeCertificateMaterials(canvas.value),
    })
    stepTestResult.value = (result.data ?? {}) as StepTestResult
    const status = String(readRecord(stepTestResult.value.stepResult)?.status ?? 'unknown')
    const errorMessage = stepTestErrorDetail.value?.message
    if (status === 'failed' && errorMessage) {
      stepTestMessage.value = mode === 'real_test'
        ? `节点 ${stepName} 真实试跑失败：${errorMessage}`
        : `节点 ${stepName} 模拟失败：${errorMessage}`
    } else {
      stepTestMessage.value = mode === 'real_test'
        ? `节点 ${stepName} 真实试跑完成：${status}`
        : `节点 ${stepName} 模拟完成：${status}`
    }
  } catch (error) {
    stepTestMessage.value = error instanceof Error ? error.message : (mode === 'real_test' ? '单节点真实试跑失败。' : '单节点模拟运行失败。')
  } finally {
    stepTesting.value = false
  }
}

function issueLevelLabel(level: string) {
  if (level === 'error') return '错误'
  if (level === 'risk') return '风险'
  return '警告'
}

function mergeRuntimeState(current: StepRuntimeState, definition: WorkflowCanvasDefinition): StepRuntimeState {
  const userVariables: Record<string, unknown> = {}
  for (const [name, variable] of Object.entries(definition.variables)) {
    if (variable.type === 'certificate') continue
    if (current.userVariables[name] !== undefined) {
      userVariables[name] = current.userVariables[name]
      continue
    }
    userVariables[name] = runtimeValueForVariable(name, variable)
  }
  return { userVariables }
}

function runtimeValueForVariable(name: string, variable: WorkflowVariableDefinition): unknown {
  if (variable.default !== undefined) return variable.default
  if (variable.type === 'number') return 22
  if (variable.type === 'boolean') return true
  if (variable.type === 'enum') return variable.enum?.[0] ?? ''
  if (variable.type === 'credential') return variable.default
  if (name === 'deviceHost') return ''
  if (name === 'sshUsername') return 'admin'
  if (name === 'verifyUrl') return 'https://runtime-device.local/health'
  if (name === 'remoteFingerprint') return 'SHA256:runtime'
  return variable.required ? `runtime-${name}` : ''
}

function buildRuntimeUserVariables(): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [name, variable] of Object.entries(canvas.value.variables)) {
    if (variable.type === 'certificate') continue
    const current = stepRuntimeState.value.userVariables[name]
    if (current === undefined) {
      values[name] = runtimeValueForVariable(name, variable)
      continue
    }
    values[name] = coerceRuntimeVariableValue(variable, current)
  }
  return values
}

function buildRuntimeCertificateMaterials(definition: WorkflowCanvasDefinition): Record<string, Record<string, unknown>> {
  const certificates: Record<string, Record<string, unknown>> = {}
  for (const [name, variable] of Object.entries(definition.variables)) {
    if (variable.type !== 'certificate') continue
    certificates[name] = readRecord(variable.default) ?? {
      pem: '-----BEGIN CERTIFICATE-----\nRUNTIME_PLACEHOLDER\n-----END CERTIFICATE-----',
      privateKey: '-----BEGIN PRIVATE KEY-----\nRUNTIME_PLACEHOLDER\n-----END PRIVATE KEY-----',
      fingerprintSha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    }
  }
  return certificates
}

function coerceRuntimeVariableValue(variable: WorkflowVariableDefinition, value: unknown): unknown {
  if (variable.type === 'number') return typeof value === 'number' ? value : Number(value)
  if (variable.type === 'boolean') return typeof value === 'boolean' ? value : String(value) === 'true'
  if (variable.type === 'object') {
    if (typeof value !== 'string') return value ?? {}
    if (!value.trim()) return {}
    return JSON.parse(value)
  }
  return value
}

function buildMockUserVariables(definition: WorkflowCanvasDefinition): Record<string, unknown> {
  const fallbackValues: Record<string, unknown> = {
    deviceHost: 'mock-device.local',
    sshUsername: 'admin',
    verifyUrl: 'https://mock-device.local/health',
    remoteFingerprint: 'SHA256:mock',
  }
  const values: Record<string, unknown> = {}
  for (const [name, variable] of Object.entries(definition.variables)) {
    if (variable.type === 'certificate') continue
    if (variable.default !== undefined) {
      values[name] = variable.default
      continue
    }
    if (fallbackValues[name] !== undefined) {
      values[name] = fallbackValues[name]
      continue
    }
    values[name] = mockValueForVariable(name, variable)
  }
  return values
}

function buildMockCertificateMaterials(definition: WorkflowCanvasDefinition): Record<string, Record<string, unknown>> {
  const certificates: Record<string, Record<string, unknown>> = {}
  for (const [name, variable] of Object.entries(definition.variables)) {
    if (variable.type !== 'certificate') continue
    certificates[name] = {
      pem: '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----',
      privateKey: '-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----',
      fingerprintSha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    }
  }
  return certificates
}

function updateRuntimeVariableField(name: string, variable: WorkflowVariableDefinition, event: Event) {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  const value = target instanceof HTMLInputElement && target.type === 'checkbox'
    ? target.checked
    : target.value
  stepRuntimeState.value = {
    ...stepRuntimeState.value,
    userVariables: {
      ...stepRuntimeState.value.userVariables,
      [name]: variable.type === 'number' && typeof value === 'string' && value !== '' ? Number(value) : value,
    },
  }
}

function mockValueForVariable(name: string, variable: WorkflowVariableDefinition): unknown {
  if (variable.default !== undefined) return variable.default
  if (variable.type === 'number') return 1
  if (variable.type === 'boolean') return true
  if (variable.type === 'enum') return variable.enum?.[0] ?? ''
  if (variable.type === 'object') return {}
  if (variable.type === 'file') return `mock-${name}`
  if (variable.type === 'credential') return variable.default
  return `mock-${name}`
}

function readCredentialId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = (value as Record<string, unknown>).id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return undefined
}
</script>

<template>
  <section class="workflow-canvas-editor" :data-readonly="props.readonly ? 'true' : 'false'">
    <header class="workflow-canvas-editor__toolbar" aria-label="工作流画布工具栏">
      <div>
        <strong>{{ canvas.metadata.displayName || canvas.metadata.name }}</strong>
        <span>{{ canvas.nodes.length }} 个节点 / {{ canvas.edges.length }} 条连线 / 缩放 {{ zoomPercent }}%</span>
      </div>
      <div class="workflow-canvas-editor__toolbar-actions">
        <button class="gc-button" type="button" :disabled="!canEdit || history.length === 0" title="撤销" @click="undo">↶</button>
        <button class="gc-button" type="button" :disabled="!canEdit || future.length === 0" title="重做" @click="redo">↷</button>
        <button class="gc-button" type="button" :disabled="!canEdit || !selectedNode" title="复制节点" @click="copySelectedNode">复制</button>
        <button class="gc-button" type="button" :disabled="!canEdit || !clipboardNode" title="粘贴节点" @click="pasteNode">粘贴</button>
        <button class="gc-button" type="button" :disabled="!canEdit || !selectedNode" title="删除节点" @click="removeSelectedNode">删除</button>
        <button class="gc-button" type="button" :disabled="!canEdit" title="缩小" @click="zoom(-0.1)">−</button>
        <button class="gc-button" type="button" :disabled="!canEdit" title="放大" @click="zoom(0.1)">＋</button>
        <button class="gc-button" type="button" :disabled="!canEdit" @click="layout">整理布局</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="saving || !canEdit" @click="save">{{ saving ? '保存中...' : '保存草稿' }}</button>
        <slot name="toolbar-actions" />
      </div>
    </header>

    <p v-if="saveMessage" class="workflow-canvas-editor__message">{{ saveMessage }}</p>

    <section class="workflow-canvas-editor__main">
      <aside class="workflow-canvas-editor__palette" aria-label="节点库">
        <h3>节点库</h3>
        <label class="workflow-canvas-editor__stage-picker">
          <span>新增节点阶段</span>
          <select v-model="newNodeStage" :disabled="!canEdit">
            <option v-for="stage in WORKFLOW_STAGE_DEFINITIONS" :key="stage.key" :value="stage.key">{{ stage.title }}</option>
          </select>
        </label>
        <button
          v-for="nodeType in NODE_TYPE_DEFINITIONS"
          :key="nodeType.type"
          type="button"
          class="workflow-canvas-editor__palette-item"
          :disabled="!canEdit"
          @click="add(nodeType.type)"
        >
          <strong>{{ nodeType.displayName }}</strong>
          <span>{{ nodeType.description }}</span>
        </button>
      </aside>

      <section class="workflow-canvas-editor__surface-wrap">
        <div
          class="workflow-canvas-editor__surface"
          :style="{
            transform: `scale(${canvas.viewport.zoom})`,
            width: `${WORKFLOW_FLOW_LAYOUT.surfaceWidth}px`,
            minHeight: `${surfaceHeight}px`,
          }"
          aria-label="画布区域"
        >
          <div class="workflow-canvas-editor__stage-lanes" aria-hidden="true">
            <section
              v-for="stage in stageSections"
              :key="stage.key"
              class="workflow-canvas-editor__stage-lane"
              :style="{ top: `${stage.top}px`, height: `${stage.height}px` }"
            >
              <strong>{{ stage.title }}</strong>
              <span>{{ stage.description }}</span>
              <small>{{ stage.count }} 个节点</small>
            </section>
          </div>
          <svg class="workflow-canvas-editor__edges" :width="WORKFLOW_FLOW_LAYOUT.surfaceWidth" :height="surfaceHeight" aria-hidden="true">
            <line
              v-for="edge in canvas.edges"
              :key="edge.id"
              :x1="(canvas.nodes.find((node) => node.id === edge.sourceNodeId)?.position.x ?? 0) + WORKFLOW_FLOW_LAYOUT.nodeWidth / 2"
              :y1="(canvas.nodes.find((node) => node.id === edge.sourceNodeId)?.position.y ?? 0) + WORKFLOW_FLOW_LAYOUT.nodeHeight"
              :x2="(canvas.nodes.find((node) => node.id === edge.targetNodeId)?.position.x ?? 0) + WORKFLOW_FLOW_LAYOUT.nodeWidth / 2"
              :y2="canvas.nodes.find((node) => node.id === edge.targetNodeId)?.position.y ?? 0"
              :data-edge-type="edge.edgeType"
            />
          </svg>
          <button
            v-for="node in canvas.nodes"
            :key="node.id"
            type="button"
            class="workflow-canvas-editor__node"
            :class="{ 'workflow-canvas-editor__node--selected': selectedNodeId === node.id }"
            :style="{ left: `${node.position.x}px`, top: `${node.position.y}px` }"
            :data-node-type="node.type"
            @click="selectedNodeId = node.id"
          >
            <span>{{ getNodeTypeDefinition(node.type).displayName }}</span>
            <strong>{{ node.label }}</strong>
            <em>{{ WORKFLOW_STAGE_DEFINITIONS.find((stage) => stage.key === getNodeStage(node))?.title }}</em>
            <small>{{ node.id }}</small>
          </button>
        </div>
      </section>

      <aside class="workflow-canvas-editor__properties" aria-label="属性面板">
        <h3>属性面板</h3>
        <template v-if="selectedNode && selectedNodeDefinition">
          <label>
            <span>所属阶段</span>
            <select :value="getNodeStage(selectedNode)" :disabled="!canEdit" @change="updateStage">
              <option v-for="stage in WORKFLOW_STAGE_DEFINITIONS" :key="stage.key" :value="stage.key">{{ stage.title }}</option>
            </select>
          </label>
          <label>
            <span>节点名称</span>
            <input :value="selectedNode.label" :disabled="!canEdit" @input="updateLabel" />
          </label>
          <template v-if="selectedNode.type === 'http'">
            <label>
              <span>Method</span>
              <select :value="String(selectedNode.config.method ?? 'GET')" :disabled="!canEdit" @change="updateField({ key: 'method', label: 'Method', kind: 'select' }, $event)">
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
            </label>
            <label>
              <span>URL</span>
              <input :value="String(selectedNode.config.url ?? '')" :disabled="!canEdit" @input="updateField({ key: 'url', label: 'URL', kind: 'text' }, $event)" />
            </label>
            <div class="workflow-canvas-editor__property-group">
              <strong>HTTP 认证</strong>
              <label>
                <span>认证类型</span>
                <select :value="selectedNodeHttpAuthType" :disabled="!canEdit" @change="updateHttpAuthType">
                  <option value="none">none</option>
                  <option value="basic">basic</option>
                  <option value="bearer">bearer</option>
                  <option value="api_key">api_key</option>
                </select>
              </label>
              <label v-if="selectedNodeCredentialOptions.length && ['basic', 'bearer', 'api_key'].includes(selectedNodeHttpAuthType)">
                <span>凭据选择器</span>
                <select :value="selectedNodeCredentialId" :disabled="!canEdit" @change="updateSelectedCredential">
                  <option value="">手动填写</option>
                  <option v-for="item in selectedNodeCredentialOptions" :key="item.id" :value="item.id">{{ workflowCredentialLabel(item) }}</option>
                </select>
                <small class="workflow-canvas-editor__property-hint">{{ credentialSelectorHint(selectedNode) }}</small>
              </label>
              <p v-if="credentialsLoadError" class="workflow-canvas-editor__property-empty">{{ credentialsLoadError }}</p>
              <p v-else-if="credentialsLoading" class="workflow-canvas-editor__property-empty">正在从后端加载凭据...</p>
              <label v-if="selectedNodeHttpAuthType === 'basic'">
                <span>用户名</span>
                <input :value="String(selectedNode.config.authUsername ?? '')" :disabled="!canEdit" @input="updateField({ key: 'authUsername', label: '用户名', kind: 'text' }, $event)" />
              </label>
              <label v-if="['cookie', 'custom_header'].includes(selectedNodeHttpAuthType)">
                <span>密文值</span>
                <input type="password" :value="String(selectedNode.config.authSecretValue ?? '')" :disabled="!canEdit" @input="updateField({ key: 'authSecretValue', label: '密文值', kind: 'secret' }, $event)" />
              </label>
              <label v-if="selectedNodeHttpAuthType === 'api_key'">
                <span>Key 名称</span>
                <input :value="String(selectedNode.config.authApiKeyName ?? 'X-API-Key')" :disabled="!canEdit" @input="updateField({ key: 'authApiKeyName', label: 'Key 名称', kind: 'text' }, $event)" />
              </label>
              <label v-if="selectedNodeHttpAuthType === 'api_key'">
                <span>传递位置</span>
                <select :value="String(selectedNode.config.authApiKeyIn ?? 'header')" :disabled="!canEdit" @change="updateField({ key: 'authApiKeyIn', label: '传递位置', kind: 'select' }, $event)">
                  <option value="header">header</option>
                  <option value="query">query</option>
                </select>
              </label>
              <label v-if="selectedNodeHttpAuthType === 'cookie'">
                <span>Cookie 名称</span>
                <input :value="String(selectedNode.config.authCookieName ?? '')" :disabled="!canEdit" @input="updateField({ key: 'authCookieName', label: 'Cookie 名称', kind: 'text' }, $event)" />
              </label>
              <label v-if="selectedNodeHttpAuthType === 'custom_header'">
                <span>Header 名称</span>
                <input :value="String(selectedNode.config.authHeaderName ?? '')" :disabled="!canEdit" @input="updateField({ key: 'authHeaderName', label: 'Header 名称', kind: 'text' }, $event)" />
              </label>
              <label v-if="selectedNodeHttpAuthType === 'mtls'">
                <span>客户端证书</span>
                <input type="password" :value="String(selectedNode.config.authCertSecretRef ?? '')" :disabled="!canEdit" @input="updateField({ key: 'authCertSecretRef', label: '客户端证书', kind: 'secret' }, $event)" />
              </label>
              <label v-if="selectedNodeHttpAuthType === 'mtls'">
                <span>客户端私钥</span>
                <input type="password" :value="String(selectedNode.config.authKeySecretRef ?? '')" :disabled="!canEdit" @input="updateField({ key: 'authKeySecretRef', label: '客户端私钥', kind: 'secret' }, $event)" />
              </label>
            </div>
            <label>
              <span>Body</span>
              <textarea :value="String(selectedNode.config.body ?? '')" :disabled="!canEdit" rows="4" @input="updateField({ key: 'body', label: 'Body', kind: 'textarea' }, $event)" />
            </label>
            <label>
              <span>超时秒数</span>
              <input type="number" :value="String(selectedNode.config.timeoutSeconds ?? 30)" :disabled="!canEdit" @input="updateField({ key: 'timeoutSeconds', label: '超时秒数', kind: 'number' }, $event)" />
            </label>
          </template>
          <template v-else-if="['ssh', 'sftp', 'scp'].includes(selectedNode.type)">
            <label v-if="selectedNode.type === 'ssh'">
              <span>主机变量 / 主机名</span>
              <input :value="String(selectedNode.config.hostRef ?? '')" :disabled="!canEdit" @input="updateField({ key: 'hostRef', label: '主机变量', kind: 'text' }, $event)" />
            </label>
            <label v-else>
              <span>主机变量 / 主机名</span>
              <input :value="String(selectedNode.config.connectionRef ?? '')" :disabled="!canEdit" @input="updateField({ key: 'connectionRef', label: '连接变量', kind: 'text' }, $event)" />
            </label>
            <label>
              <span>用户名</span>
              <input :value="String(selectedNode.config.username ?? '')" :disabled="!canEdit" @input="updateField({ key: 'username', label: '用户名', kind: 'text' }, $event)" />
            </label>
            <label v-if="selectedNodeCredentialOptions.length">
              <span>凭据选择器</span>
              <select :value="selectedNodeCredentialId" :disabled="!canEdit" @change="updateSelectedCredential">
                <option value="">手动填写</option>
                <option v-for="item in selectedNodeCredentialOptions" :key="item.id" :value="item.id">{{ workflowCredentialLabel(item) }}</option>
              </select>
              <small class="workflow-canvas-editor__property-hint">{{ credentialSelectorHint(selectedNode) }}</small>
            </label>
            <p v-if="credentialsLoadError" class="workflow-canvas-editor__property-empty">{{ credentialsLoadError }}</p>
            <p v-else-if="credentialsLoading" class="workflow-canvas-editor__property-empty">正在从后端加载凭据...</p>
            <p v-else-if="!selectedNodeCredentialOptions.length" class="workflow-canvas-editor__property-empty">暂无可用凭据，请先在列表页打开“凭据管理”创建。</p>
            <template v-if="selectedNode.type === 'ssh'">
              <label>
                <span>命令</span>
                <textarea :value="String(selectedNode.config.command ?? '')" :disabled="!canEdit" rows="5" @input="updateField({ key: 'command', label: '命令', kind: 'textarea' }, $event)" />
              </label>
            </template>
            <template v-else>
              <label>
                <span>方向</span>
                <select :value="String(selectedNode.config.direction ?? 'upload')" :disabled="!canEdit" @change="updateField({ key: 'direction', label: '方向', kind: 'select' }, $event)">
                  <option value="upload">上传</option>
                  <option value="download">下载</option>
                </select>
              </label>
              <label>
                <span>远端路径</span>
                <input :value="String(selectedNode.config.remotePath ?? '')" :disabled="!canEdit" @input="updateField({ key: 'remotePath', label: '远端路径', kind: 'text' }, $event)" />
              </label>
              <label>
                <span>临时路径</span>
                <input :value="String(selectedNode.config.temporaryPath ?? '')" :disabled="!canEdit" @input="updateField({ key: 'temporaryPath', label: '临时路径', kind: 'text' }, $event)" />
              </label>
              <label>
                <span>内容引用</span>
                <input :value="String(selectedNode.config.contentRef ?? '')" :disabled="!canEdit" @input="updateField({ key: 'contentRef', label: '内容引用', kind: 'text' }, $event)" />
              </label>
              <label>
                <span>本地路径</span>
                <input :value="String(selectedNode.config.localPath ?? '')" :disabled="!canEdit" @input="updateField({ key: 'localPath', label: '本地路径', kind: 'text' }, $event)" />
              </label>
              <label>
                <span>文件权限</span>
                <input :value="String(selectedNode.config.mode ?? '')" :disabled="!canEdit" @input="updateField({ key: 'mode', label: '文件权限', kind: 'text' }, $event)" />
              </label>
            </template>
            <label>
              <span>超时秒数</span>
              <input type="number" :value="String(selectedNode.config.timeoutSeconds ?? 60)" :disabled="!canEdit" @input="updateField({ key: 'timeoutSeconds', label: '超时秒数', kind: 'number' }, $event)" />
            </label>
          </template>
          <template v-else>
            <label v-for="field in selectedNodeDefinition.fields" :key="field.key">
              <span>{{ field.label }}</span>
              <select v-if="field.kind === 'select'" :value="String(selectedNode.config[field.key] ?? '')" :disabled="!canEdit" @change="updateField(field, $event)">
                <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
              <textarea v-else-if="field.kind === 'textarea'" :value="String(selectedNode.config[field.key] ?? '')" :disabled="!canEdit" rows="4" @input="updateField(field, $event)" />
              <input v-else :type="field.kind === 'number' ? 'number' : 'text'" :value="String(selectedNode.config[field.key] ?? '')" :disabled="!canEdit" @input="updateField(field, $event)" />
            </label>
          </template>
          <div class="workflow-canvas-editor__test-actions">
            <button class="gc-button gc-button--primary workflow-canvas-editor__test-button" type="button" :disabled="stepTesting" @click="runSelectedNode('real_test')">
              {{ realRunButtonLabel }}
            </button>
            <button class="gc-button workflow-canvas-editor__test-button" type="button" :disabled="stepTesting" @click="testSelectedNode">
              {{ stepTesting ? '模拟中...' : '仅模拟当前节点' }}
            </button>
          </div>
          <small class="workflow-canvas-editor__test-hint">真实试跑会直接访问目标 HTTP/SSH/SFTP/SCP 节点并返回输出；仅模拟不会连接目标主机。</small>
        </template>
        <p v-else>选择节点后编辑配置。</p>
      </aside>
    </section>

    <section
      class="workflow-canvas-editor__bottom"
      :class="{ 'workflow-canvas-editor__bottom--collapsed': bottomPanelCollapsed }"
      :aria-expanded="!bottomPanelCollapsed"
    >
      <div class="workflow-canvas-editor__bottom-header">
        <nav class="workflow-canvas-editor__tabs" aria-label="底部面板">
          <button type="button" :data-active="activeBottomPanel === 'validation'" @click="selectBottomPanel('validation')">校验</button>
          <button type="button" :data-active="activeBottomPanel === 'variables'" @click="selectBottomPanel('variables')">变量</button>
          <button type="button" :data-active="activeBottomPanel === 'runtime'" @click="selectBottomPanel('runtime')">运行态</button>
          <button type="button" :data-active="activeBottomPanel === 'dsl'" @click="selectBottomPanel('dsl')">DSL</button>
        </nav>
        <button
          class="workflow-canvas-editor__bottom-toggle"
          type="button"
          :aria-expanded="!bottomPanelCollapsed"
          :aria-label="bottomPanelCollapsed ? '展开底部控制面板' : '向下折叠底部控制面板'"
          @click="toggleBottomPanelCollapsed"
        >
          <span class="workflow-canvas-editor__bottom-toggle-icon" aria-hidden="true"></span>
          <span>{{ bottomPanelCollapsed ? '展开面板' : '向下折叠' }}</span>
        </button>
      </div>

      <div v-if="!bottomPanelCollapsed && activeBottomPanel === 'validation'" class="workflow-canvas-editor__panel" aria-label="校验面板">
        <p v-if="backendValidationMessage" class="workflow-canvas-editor__runtime-empty">{{ backendValidationMessage }}</p>
        <p v-else-if="validationIssues.length === 0">没有阻断错误。</p>
        <ul v-else>
          <li v-for="issue in validationIssues" :key="issue.id" :data-severity="issue.severity">
            <strong>{{ issueLevelLabel(issue.severity) }}</strong>
            <span>{{ issue.message }}</span>
            <small>{{ issue.nodeId ? `节点 ${issue.nodeId}` : issue.edgeId ? `连线 ${issue.edgeId}` : '画布' }}{{ issue.field ? ` / 字段 ${issue.field}` : '' }} · {{ issue.suggestion }}</small>
          </li>
        </ul>
      </div>

      <div v-else-if="!bottomPanelCollapsed && activeBottomPanel === 'variables'" class="workflow-canvas-editor__panel" aria-label="变量面板">
        <div class="workflow-canvas-editor__variables-header">
          <strong>变量配置</strong>
          <button class="gc-button" type="button" :disabled="!canEdit" @click="addVariable">添加变量</button>
        </div>
        <p v-if="credentialsLoadError" class="workflow-canvas-editor__runtime-empty">{{ credentialsLoadError }}</p>
        <p v-else-if="credentialsLoading" class="workflow-canvas-editor__runtime-empty">正在从后端加载凭据...</p>
        <ul class="workflow-canvas-editor__variable-editor-list">
          <li v-for="(definition, name) in canvas.variables" :key="name" class="workflow-canvas-editor__variable-editor">
            <label>
              <span>变量名</span>
              <input :value="name" :disabled="!canEdit" @change="updateVariableName(String(name), $event)" />
            </label>
            <label>
              <span>类型</span>
              <select :value="definition.type" :disabled="!canEdit" @change="updateVariableField(String(name), 'type', $event)">
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="enum">enum</option>
                <option value="object">object</option>
                <option value="file">file</option>
                <option value="certificate">certificate</option>
                <option value="credential">credential</option>
              </select>
            </label>
            <label v-if="definition.type === 'credential'">
              <span>凭据</span>
              <select :value="resolveVariableCredentialId(definition)" :disabled="!canEdit" @change="updateVariableCredential(String(name), $event)">
                <option value="">未选择</option>
                <option v-for="item in managedCredentials" :key="item.id" :value="item.id">{{ workflowCredentialLabel(item) }}</option>
              </select>
            </label>
            <label v-else>
              <span>默认值</span>
              <input :value="String(definition.default ?? '')" :disabled="!canEdit" @change="updateVariableField(String(name), 'default', $event)" />
            </label>
            <label class="workflow-canvas-editor__variable-check">
              <input type="checkbox" :checked="Boolean(definition.required)" :disabled="!canEdit" @change="updateVariableField(String(name), 'required', $event)" />
              <span>必填</span>
            </label>
            <label class="workflow-canvas-editor__variable-check">
              <input type="checkbox" :checked="Boolean(definition.sensitive)" :disabled="!canEdit || definition.type === 'credential' || definition.type === 'certificate'" @change="updateVariableField(String(name), 'sensitive', $event)" />
              <span>敏感</span>
            </label>
            <label>
              <span>说明</span>
              <input :value="definition.description ?? ''" :disabled="!canEdit" @change="updateVariableField(String(name), 'description', $event)" />
            </label>
            <button class="gc-button" type="button" :disabled="!canEdit" @click="deleteVariable(String(name))">删除</button>
          </li>
        </ul>
        <div class="workflow-canvas-editor__variables-header">
          <strong>引用流</strong>
        </div>
        <ul>
          <li v-for="variable in variableFlow" :key="`${variable.source}:${variable.name}`">
            <strong>{{ variable.name }}</strong>
            <span>{{ variable.source }} / {{ variable.type }}{{ variable.sensitive ? ' / 敏感' : '' }}</span>
            <small>使用位置：{{ variable.usedBy.length ? variable.usedBy.join('、') : '未使用' }}</small>
          </li>
        </ul>
      </div>

      <div v-else-if="!bottomPanelCollapsed && activeBottomPanel === 'runtime'" class="workflow-canvas-editor__panel" aria-label="运行态面板">
        <div class="workflow-canvas-editor__runtime-header">
          <strong>单节点测试运行</strong>
          <span v-if="stepTestMessage">{{ stepTestMessage }}</span>
        </div>
        <div class="workflow-canvas-editor__runtime-inputs">
          <strong>运行时凭据变量</strong>
          <p v-if="credentialsLoadError" class="workflow-canvas-editor__runtime-empty">{{ credentialsLoadError }}</p>
          <p v-else-if="credentialsLoading" class="workflow-canvas-editor__runtime-empty">正在从后端加载凭据...</p>
          <div v-if="Object.entries(canvas.variables).some(([, definition]) => definition.type === 'credential')" class="workflow-canvas-editor__runtime-form">
            <label v-for="(definition, name) in canvas.variables" v-show="definition.type === 'credential'" :key="`runtime-credential:${name}`">
              <span>{{ name }}</span>
              <select :value="resolveRuntimeCredentialId(String(name)) || resolveVariableCredentialId(definition)" @change="updateRuntimeCredentialBinding(String(name), $event)">
                <option value="">未选择</option>
                <option v-for="item in runtimeCredentialOptions(String(name))" :key="item.id" :value="item.id">{{ workflowCredentialLabel(item) }}</option>
              </select>
            </label>
          </div>
          <p v-else class="workflow-canvas-editor__runtime-empty">当前工作流没有凭据变量。</p>
          <strong>运行时变量</strong>
          <div v-if="Object.entries(canvas.variables).filter(([, definition]) => definition.type !== 'certificate' && definition.type !== 'credential').length" class="workflow-canvas-editor__runtime-form">
            <label v-for="(definition, name) in canvas.variables" v-show="definition.type !== 'certificate' && definition.type !== 'credential'" :key="`runtime:${name}`">
              <span>{{ name }}</span>
              <select
                v-if="definition.type === 'enum'"
                :value="String(stepRuntimeState.userVariables[name] ?? '')"
                @change="updateRuntimeVariableField(String(name), definition, $event)"
              >
                <option v-for="option in definition.enum ?? []" :key="String(option)" :value="String(option)">{{ String(option) }}</option>
              </select>
              <input
                v-else-if="definition.type === 'boolean'"
                type="checkbox"
                :checked="Boolean(stepRuntimeState.userVariables[name])"
                @change="updateRuntimeVariableField(String(name), definition, $event)"
              />
              <textarea
                v-else-if="definition.type === 'object'"
                rows="3"
                :value="typeof stepRuntimeState.userVariables[name] === 'string' ? String(stepRuntimeState.userVariables[name]) : JSON.stringify(stepRuntimeState.userVariables[name] ?? {}, null, 2)"
                @change="updateRuntimeVariableField(String(name), definition, $event)"
              />
              <input
                v-else
                :type="definition.type === 'number' ? 'number' : 'text'"
                :value="String(stepRuntimeState.userVariables[name] ?? '')"
                @change="updateRuntimeVariableField(String(name), definition, $event)"
              />
            </label>
          </div>
          <p v-else class="workflow-canvas-editor__runtime-empty">当前节点没有额外运行时变量。</p>
        </div>
        <p v-if="!stepTestResult && !stepTesting">选择节点后，在属性面板点击“模拟运行当前节点”或“真实试跑当前节点”。</p>
        <p v-else-if="stepTesting">正在执行测试运行...</p>
        <div v-else class="workflow-canvas-editor__runtime-result">
          <ul>
            <li>
              <strong>{{ String(stepTestStepResult?.name ?? stepTestStepName) }}</strong>
              <span>{{ String(stepTestStepResult?.type ?? '-') }} / {{ String(stepTestStepResult?.status ?? '-') }} / attempts {{ String(stepTestStepResult?.attempts ?? '-') }}</span>
              <small>plannedOnly: {{ String(stepTestResult?.plannedOnly ?? false) }} / mode: {{ String(stepTestResult?.mode ?? 'mock') }}</small>
            </li>
          </ul>
          <div v-if="stepTestErrorDetail" class="workflow-canvas-editor__runtime-error">
            <strong>失败详情</strong>
            <dl>
              <div v-if="stepTestErrorDetail.message">
                <dt>错误</dt>
                <dd>{{ stepTestErrorDetail.message }}</dd>
              </div>
              <div v-if="stepTestErrorDetail.code">
                <dt>代码</dt>
                <dd>{{ stepTestErrorDetail.code }}</dd>
              </div>
              <div v-if="stepTestErrorDetail.target">
                <dt>目标</dt>
                <dd>{{ stepTestErrorDetail.target }}</dd>
              </div>
              <div v-if="stepTestErrorDetail.stage || stepTestErrorDetail.category">
                <dt>阶段</dt>
                <dd>{{ [stepTestErrorDetail.stage, stepTestErrorDetail.category].filter(Boolean).join(' / ') }}</dd>
              </div>
              <div v-if="stepTestErrorDetail.cause">
                <dt>原因</dt>
                <dd>{{ stepTestErrorDetail.cause }}</dd>
              </div>
              <div v-if="stepTestErrorDetail.suggestion">
                <dt>建议</dt>
                <dd>{{ stepTestErrorDetail.suggestion }}</dd>
              </div>
            </dl>
          </div>
          <dl
            v-if="stepTestExitCode !== undefined || stepTestStdout || stepTestStderr"
            class="workflow-canvas-editor__runtime-summary"
          >
            <div v-if="stepTestExitCode !== undefined">
              <dt>退出码</dt>
              <dd>{{ stepTestExitCode }}</dd>
            </div>
            <div v-if="stepTestStdout">
              <dt>标准输出</dt>
              <dd><pre>{{ stepTestStdout }}</pre></dd>
            </div>
            <div v-if="stepTestStderr">
              <dt>标准错误</dt>
              <dd><pre>{{ stepTestStderr }}</pre></dd>
            </div>
          </dl>
          <strong>执行计划</strong>
          <pre>{{ stepTestPlanText }}</pre>
          <template v-if="stepTestOutput !== null">
            <strong>节点输出</strong>
            <pre>{{ stepTestOutputText }}</pre>
          </template>
          <strong>日志</strong>
          <ul>
            <li v-for="(line, index) in stepTestLogs" :key="`${index}:${line}`">
              <span>{{ line }}</span>
            </li>
          </ul>
        </div>
      </div>

      <div v-else-if="!bottomPanelCollapsed" class="workflow-canvas-editor__panel workflow-canvas-editor__dsl-panel" aria-label="DSL 面板">
        <div class="workflow-canvas-editor__dsl-actions">
          <strong>DSL 导入与覆盖</strong>
          <div class="workflow-canvas-editor__dsl-actions-row">
            <label class="workflow-canvas-editor__dsl-file">
              <span>选择 DSL 文件</span>
              <input type="file" accept=".json,.dsl,.txt,application/json" :disabled="!canEdit" @change="importDslFile" />
            </label>
            <button class="gc-button" type="button" @click="resetDslEditorToCanvas">回填当前画布 DSL</button>
            <button class="gc-button gc-button--primary" type="button" :disabled="!canEdit" @click="importDslIntoCanvas">导入 DSL 覆盖画布</button>
          </div>
        </div>
        <p class="workflow-canvas-editor__dsl-hint">可直接粘贴外部 DSL JSON，或选择本地 DSL 文件。导入只覆盖浏览器中的当前画布，点击“保存草稿”后才会生成新的工作流版本。</p>
        <p v-if="dslEditorMessage" class="workflow-canvas-editor__dsl-message">{{ dslEditorMessage }}</p>
        <textarea
          class="workflow-canvas-editor__dsl-editor"
          :value="dslEditorText"
          :readonly="!canEdit"
          spellcheck="false"
          @input="updateDslEditor"
        />
      </div>
    </section>
  </section>
</template>

<style scoped>
.workflow-canvas-editor {
  display: grid;
  gap: 12px;
  min-height: 640px;
  color: var(--gc-color-text);
}

.workflow-canvas-editor__toolbar,
.workflow-canvas-editor__main,
.workflow-canvas-editor__bottom {
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 8px;
  background: var(--gc-color-surface-solid);
}

.workflow-canvas-editor__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
}

.workflow-canvas-editor__toolbar > div:first-child {
  display: grid;
  gap: 2px;
}

.workflow-canvas-editor__toolbar span,
.workflow-canvas-editor__palette-item span,
.workflow-canvas-editor__properties p,
.workflow-canvas-editor__panel small {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.workflow-canvas-editor__toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.workflow-canvas-editor__message {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--gc-color-primary-border);
  border-radius: 8px;
  background: var(--gc-color-surface-selected);
  color: var(--gc-color-primary-strong);
  font-size: 12px;
  font-weight: 700;
}

.workflow-canvas-editor__main {
  display: grid;
  grid-template-columns: 220px minmax(420px, 1fr) 280px;
  min-height: 430px;
  overflow: hidden;
}

.workflow-canvas-editor__palette,
.workflow-canvas-editor__properties {
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 12px;
  background: var(--gc-color-surface-hover);
}

.workflow-canvas-editor__palette {
  border-right: 1px solid var(--gc-color-border-muted);
}

.workflow-canvas-editor__properties {
  border-left: 1px solid var(--gc-color-border-muted);
}

.workflow-canvas-editor h3 {
  margin: 0 0 4px;
  font-size: 13px;
}

.workflow-canvas-editor__palette-item {
  display: grid;
  gap: 3px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 8px;
  background: var(--gc-color-surface-solid);
  text-align: left;
  cursor: pointer;
}

.workflow-canvas-editor__palette-item:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.workflow-canvas-editor__stage-picker {
  display: grid;
  gap: 4px;
  padding: 9px 10px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 8px;
  background: var(--gc-color-surface-solid);
}

.workflow-canvas-editor__stage-picker span {
  color: var(--gc-color-muted);
  font-size: 11px;
  font-weight: 800;
}

.workflow-canvas-editor__stage-picker select {
  width: 100%;
  min-height: 34px;
  border: 1px solid var(--gc-color-legacy-cbd7e6);
  border-radius: 8px;
  padding: 7px 9px;
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-text);
  font-size: 12px;
}

.workflow-canvas-editor__surface-wrap {
  display: grid;
  grid-template-rows: 1fr;
  min-width: 0;
  overflow: auto;
  background:
    linear-gradient(var(--gc-color-surface-subtle) 1px, transparent 1px),
    linear-gradient(90deg, var(--gc-color-surface-subtle) 1px, transparent 1px);
  background-size: 24px 24px;
}

.workflow-canvas-editor__properties input,
.workflow-canvas-editor__properties select,
.workflow-canvas-editor__properties textarea {
  width: 100%;
  min-height: 34px;
  border: 1px solid var(--gc-color-legacy-cbd7e6);
  border-radius: 8px;
  padding: 7px 9px;
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-text);
  font-size: 12px;
}

.workflow-canvas-editor__surface {
  position: relative;
  margin: 0 auto;
  transform-origin: top left;
}

.workflow-canvas-editor__stage-lanes {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.workflow-canvas-editor__stage-lane {
  position: absolute;
  left: 24px;
  right: 24px;
  display: grid;
  align-content: start;
  gap: 4px;
  padding: 12px 14px 0;
  border-top: 2px dashed var(--gc-color-legacy-cbd7e6);
  background: var(--gc-color-surface-hover);
}

.workflow-canvas-editor__stage-lane::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50px;
  bottom: 0;
  width: 2px;
  background: var(--gc-color-muted-bg);
  transform: translateX(-50%);
}

.workflow-canvas-editor__stage-lane strong {
  color: var(--gc-color-text);
  font-size: 13px;
  font-weight: 900;
}

.workflow-canvas-editor__stage-lane span {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  line-height: 1.4;
}

.workflow-canvas-editor__stage-lane small {
  width: fit-content;
  border-radius: 999px;
  padding: 2px 7px;
  background: var(--gc-color-muted-bg);
  color: var(--gc-color-muted);
  font-size: 10px;
  font-weight: 900;
}

.workflow-canvas-editor__edges {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

.workflow-canvas-editor__edges line {
  stroke: var(--gc-color-legacy-94a3b8);
  stroke-width: 2;
}

.workflow-canvas-editor__edges line[data-edge-type='failure'] {
  stroke: var(--gc-color-danger);
  stroke-dasharray: 6 5;
}

.workflow-canvas-editor__edges line[data-edge-type='rollback'] {
  stroke: var(--gc-color-legacy-7c3aed);
  stroke-dasharray: 3 4;
}

.workflow-canvas-editor__node {
  position: absolute;
  z-index: 2;
  display: grid;
  gap: 4px;
  width: 220px;
  min-height: 82px;
  padding: 10px 12px;
  border: 2px solid var(--gc-color-legacy-cbd7e6);
  border-radius: 8px;
  background: var(--gc-color-surface-solid);
  text-align: left;
  box-shadow: 0 10px 28px var(--gc-color-border-soft);
  cursor: pointer;
}

.workflow-canvas-editor__node--selected {
  border-color: var(--gc-color-primary-strong);
  box-shadow: 0 0 0 4px var(--gc-color-primary-soft), 0 10px 28px var(--gc-color-border);
}

.workflow-canvas-editor__node span {
  color: var(--gc-color-primary-strong);
  font-size: 11px;
  font-weight: 800;
}

.workflow-canvas-editor__node strong {
  font-size: 14px;
  overflow-wrap: anywhere;
}

.workflow-canvas-editor__node small {
  color: var(--gc-color-legacy-94a3b8);
  font-size: 10px;
  overflow-wrap: anywhere;
}

.workflow-canvas-editor__node em {
  width: fit-content;
  border-radius: 999px;
  padding: 2px 7px;
  background: var(--gc-color-surface-selected);
  color: var(--gc-color-primary-strong);
  font-size: 10px;
  font-style: normal;
  font-weight: 900;
}

.workflow-canvas-editor__properties label {
  display: grid;
  gap: 4px;
}

.workflow-canvas-editor__properties label span {
  color: var(--gc-color-muted);
  font-size: 11px;
  font-weight: 800;
}

.workflow-canvas-editor__property-group {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 8px;
  background: var(--gc-color-surface-hover);
}

.workflow-canvas-editor__property-group > strong {
  color: var(--gc-color-text);
  font-size: 12px;
}

.workflow-canvas-editor__property-hint {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  line-height: 1.4;
}

.workflow-canvas-editor__property-empty {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.workflow-canvas-editor__properties textarea {
  resize: vertical;
}

.workflow-canvas-editor__test-button {
  width: 100%;
  justify-content: center;
}

.workflow-canvas-editor__test-actions {
  display: grid;
  gap: 8px;
}

.workflow-canvas-editor__test-hint {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.workflow-canvas-editor__bottom {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 180px;
  overflow: hidden;
}

.workflow-canvas-editor__bottom--collapsed {
  min-height: 0;
}

.workflow-canvas-editor__bottom-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--gc-color-border-muted);
  background: var(--gc-color-surface-hover);
}

.workflow-canvas-editor__bottom--collapsed .workflow-canvas-editor__bottom-header {
  border-bottom: 0;
}

.workflow-canvas-editor__tabs {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: 4px;
}

.workflow-canvas-editor__tabs button,
.workflow-canvas-editor__bottom-toggle {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--gc-color-legacy-cbd7e6);
  border-radius: 8px;
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-muted);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.workflow-canvas-editor__bottom-toggle {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  background: var(--gc-color-surface-subtle);
}

.workflow-canvas-editor__bottom-toggle:hover {
  border-color: var(--gc-color-legacy-94a3b8);
  color: var(--gc-color-text);
}

.workflow-canvas-editor__bottom-toggle-icon {
  width: 8px;
  height: 8px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: translateY(-2px) rotate(45deg);
}

.workflow-canvas-editor__bottom-toggle[aria-expanded='false'] .workflow-canvas-editor__bottom-toggle-icon {
  transform: translateY(2px) rotate(225deg);
}

.workflow-canvas-editor__tabs button[data-active='true'] {
  background: var(--gc-color-text);
  color: var(--gc-color-surface-solid);
  border-color: var(--gc-color-text);
}

.workflow-canvas-editor__panel {
  max-height: 220px;
  overflow: auto;
  padding: 10px 12px;
}

.workflow-canvas-editor__panel p {
  margin: 0;
  color: var(--gc-color-success);
  font-size: 13px;
  font-weight: 800;
}

.workflow-canvas-editor__dsl-panel {
  display: grid;
  gap: 10px;
  max-height: none;
}

.workflow-canvas-editor__dsl-actions {
  display: grid;
  gap: 8px;
}

.workflow-canvas-editor__dsl-actions strong {
  color: var(--gc-color-text);
  font-size: 13px;
}

.workflow-canvas-editor__dsl-actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.workflow-canvas-editor__dsl-file {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 8px;
  background: var(--gc-color-surface-hover);
  color: var(--gc-color-text);
  font-size: 12px;
  font-weight: 700;
}

.workflow-canvas-editor__dsl-file input {
  max-width: 220px;
  font-size: 12px;
}

.workflow-canvas-editor__dsl-hint,
.workflow-canvas-editor__dsl-message {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.workflow-canvas-editor__dsl-hint {
  color: var(--gc-color-muted);
}

.workflow-canvas-editor__dsl-message {
  color: var(--gc-color-primary-strong);
  font-weight: 700;
}

.workflow-canvas-editor__runtime-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.workflow-canvas-editor__variables-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.workflow-canvas-editor__variables-header:not(:first-child) {
  margin-top: 12px;
}

.workflow-canvas-editor__variables-header strong {
  color: var(--gc-color-text);
  font-size: 12px;
}

.workflow-canvas-editor__variable-editor-list {
  margin-bottom: 10px;
}

.workflow-canvas-editor__variable-editor {
  grid-template-columns: minmax(120px, 1.2fr) minmax(100px, 0.8fr) minmax(150px, 1fr) auto auto minmax(150px, 1fr) auto;
  align-items: end;
}

.workflow-canvas-editor__variable-editor label {
  display: grid;
  gap: 4px;
}

.workflow-canvas-editor__variable-editor label span {
  color: var(--gc-color-muted);
  font-size: 10px;
  font-weight: 800;
}

.workflow-canvas-editor__variable-editor input,
.workflow-canvas-editor__variable-editor select {
  width: 100%;
  min-height: 32px;
  border: 1px solid var(--gc-color-legacy-cbd7e6);
  border-radius: 8px;
  padding: 6px 8px;
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-text);
  font-size: 12px;
}

.workflow-canvas-editor__variable-check {
  grid-template-columns: auto auto;
  align-items: center;
  align-content: center;
  min-height: 32px;
}

.workflow-canvas-editor__variable-check input {
  width: auto;
  min-height: auto;
}

.workflow-canvas-editor__runtime-header span {
  color: var(--gc-color-primary-strong);
  font-size: 12px;
  font-weight: 800;
}

.workflow-canvas-editor__runtime-inputs {
  display: grid;
  gap: 8px;
  margin-bottom: 10px;
}

.workflow-canvas-editor__runtime-inputs > strong {
  color: var(--gc-color-text);
  font-size: 12px;
}

.workflow-canvas-editor__runtime-form {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.workflow-canvas-editor__runtime-form label {
  display: grid;
  gap: 4px;
}

.workflow-canvas-editor__runtime-form label span {
  color: var(--gc-color-muted);
  font-size: 10px;
  font-weight: 800;
}

.workflow-canvas-editor__runtime-form input,
.workflow-canvas-editor__runtime-form select,
.workflow-canvas-editor__runtime-form textarea {
  width: 100%;
  min-height: 32px;
  border: 1px solid var(--gc-color-legacy-cbd7e6);
  border-radius: 8px;
  padding: 6px 8px;
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-text);
  font-size: 12px;
}

.workflow-canvas-editor__runtime-form input[type='checkbox'] {
  width: auto;
  min-height: auto;
}

.workflow-canvas-editor__runtime-empty {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.workflow-canvas-editor__runtime-result {
  display: grid;
  gap: 8px;
}

.workflow-canvas-editor__runtime-error {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--gc-color-danger-border);
  border-left: 4px solid var(--gc-color-danger);
  border-radius: 8px;
  background: var(--gc-color-legacy-fff7f7);
}

.workflow-canvas-editor__runtime-error > strong {
  color: var(--gc-color-danger);
  font-size: 12px;
}

.workflow-canvas-editor__runtime-error dl {
  display: grid;
  gap: 6px;
  margin: 0;
}

.workflow-canvas-editor__runtime-error dl > div {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 8px;
}

.workflow-canvas-editor__runtime-error dt {
  color: var(--gc-color-legacy-7f1d1d);
  font-size: 11px;
  font-weight: 900;
}

.workflow-canvas-editor__runtime-error dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.workflow-canvas-editor__runtime-summary {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--gc-color-primary-border);
  border-left: 4px solid var(--gc-color-primary-strong);
  border-radius: 8px;
  background: var(--gc-color-surface-selected);
}

.workflow-canvas-editor__runtime-summary > div {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 10px;
}

.workflow-canvas-editor__runtime-summary dt {
  color: var(--gc-color-primary-strong);
  font-size: 11px;
  font-weight: 900;
}

.workflow-canvas-editor__runtime-summary dd {
  min-width: 0;
  margin: 0;
  color: var(--gc-color-text);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.workflow-canvas-editor__runtime-summary pre {
  max-height: 180px;
  margin: 0;
  white-space: pre-wrap;
  overflow: auto;
}

.workflow-canvas-editor__runtime-result > strong {
  color: var(--gc-color-text);
  font-size: 12px;
}

.workflow-canvas-editor__runtime-result pre {
  max-height: 180px;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border-radius: 8px;
  background: var(--gc-color-text);
  color: var(--gc-color-info-border);
  font-size: 12px;
}

.workflow-canvas-editor__panel ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.workflow-canvas-editor__panel li {
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--gc-color-muted-bg);
  border-left: 4px solid var(--gc-color-text-muted);
  border-radius: 8px;
  background: var(--gc-color-surface-solid);
}

.workflow-canvas-editor__panel li[data-severity='error'] {
  border-left-color: var(--gc-color-danger);
}

.workflow-canvas-editor__panel li[data-severity='warning'] {
  border-left-color: var(--gc-color-warning);
}

.workflow-canvas-editor__panel li span {
  font-size: 12px;
}

.workflow-canvas-editor__dsl {
  max-height: 240px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  background: var(--gc-color-text);
  color: var(--gc-color-info-border);
  font-size: 12px;
}

.workflow-canvas-editor__dsl-editor {
  width: 100%;
  min-height: 280px;
  border: 1px solid var(--gc-color-legacy-cbd7e6);
  border-radius: 8px;
  padding: 10px 12px;
  resize: vertical;
  background: var(--gc-color-text);
  color: var(--gc-color-muted-bg);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 1180px) {
  .workflow-canvas-editor__main {
    grid-template-columns: 1fr;
  }

  .workflow-canvas-editor__palette,
  .workflow-canvas-editor__properties {
    border: 0;
    border-bottom: 1px solid var(--gc-color-border-muted);
  }
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { testWorkflowTemplateStep } from '@/api/modules/workflow-templates.api'
import {
  NODE_TYPE_DEFINITIONS,
  WORKFLOW_FLOW_LAYOUT,
  WORKFLOW_STAGE_DEFINITIONS,
  addNode,
  autoLayoutCanvas,
  cloneCanvas,
  createDefaultWorkflowCanvas,
  getWorkflowDslStepName,
  getNodeTypeDefinition,
  getNodeStage,
  getVariableFlow,
  removeWorkflowVariable,
  renameWorkflowVariable,
  removeNode,
  setNodeConfigValue,
  setNodeLabel,
  setNodeStage,
  upsertWorkflowVariable,
  validateWorkflowCanvas,
  workflowCanvasToDsl,
  type WorkflowCanvasDefinition,
  type WorkflowCanvasNode,
  type WorkflowCanvasNodeType,
  type WorkflowCanvasStage,
  type WorkflowVariableDefinition,
  type WorkflowNodeFieldDefinition,
} from './workflow-canvas.model'

interface StepTestResult {
  readonly id?: string
  readonly mode?: string
  readonly plannedOnly?: boolean
  readonly renderedStep?: Record<string, unknown>
  readonly stepResult?: Record<string, unknown>
  readonly logs?: readonly string[]
}

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
  save: [value: { canvas: WorkflowCanvasDefinition; dsl: ReturnType<typeof workflowCanvasToDsl> }]
}>()

const history = ref<WorkflowCanvasDefinition[]>([])
const future = ref<WorkflowCanvasDefinition[]>([])
const selectedNodeId = ref('')
const clipboardNode = ref<WorkflowCanvasNode | null>(null)
const newNodeStage = ref<WorkflowCanvasStage>('prepare')
const activeBottomPanel = ref<'variables' | 'validation' | 'dsl' | 'runtime'>('validation')
const stepTesting = ref(false)
const stepTestMessage = ref('')
const stepTestResult = ref<StepTestResult | null>(null)
const stepTestStepName = ref('')

const canvas = computed(() => props.modelValue ?? createDefaultWorkflowCanvas())
const selectedNode = computed(() => canvas.value.nodes.find((node) => node.id === selectedNodeId.value) ?? canvas.value.nodes[0] ?? null)
const selectedNodeDefinition = computed(() => selectedNode.value ? getNodeTypeDefinition(selectedNode.value.type) : null)
const validationIssues = computed(() => validateWorkflowCanvas(canvas.value))
const variableFlow = computed(() => getVariableFlow(canvas.value))
const dslPreview = computed(() => workflowCanvasToDsl(canvas.value))
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
const stepTestPlan = computed(() => stepTestStepResult.value?.plan ?? stepTestRenderedStep.value?.preview ?? null)
const stepTestPlanText = computed(() => stepTestPlan.value === null ? '' : JSON.stringify(stepTestPlan.value, null, 2))
const stepTestLogs = computed(() => [...readStringArray(stepTestStepResult.value?.logs), ...readStringArray(stepTestResult.value?.logs)])

watch(() => props.modelValue, () => {
  if (!selectedNodeId.value && canvas.value.nodes[0]) selectedNodeId.value = canvas.value.nodes[0].id
}, { immediate: true })

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
  if (field === 'type' && value === 'secret') {
    next.default = undefined
    next.sensitive = true
  }
  commit(upsertWorkflowVariable(canvas.value, name, next))
}

function deleteVariable(name: string) {
  commit(removeWorkflowVariable(canvas.value, name))
}

function save() {
  emit('save', { canvas: cloneCanvas(canvas.value), dsl: workflowCanvasToDsl(canvas.value) })
}

async function testSelectedNode() {
  if (!selectedNode.value || stepTesting.value) return
  stepTesting.value = true
  stepTestMessage.value = ''
  stepTestResult.value = null
  activeBottomPanel.value = 'runtime'
  try {
    const stepName = getWorkflowDslStepName(canvas.value, selectedNode.value.id)
    stepTestStepName.value = stepName
    const result = await testWorkflowTemplateStep({
      content: workflowCanvasToDsl(canvas.value),
      stepName,
      mode: 'mock',
      userVariables: buildMockUserVariables(canvas.value),
      certificateMaterials: buildMockCertificateMaterials(canvas.value),
      secretRefs: buildMockSecretRefs(),
    })
    stepTestResult.value = (result.data ?? {}) as StepTestResult
    const status = String(readRecord(stepTestResult.value.stepResult)?.status ?? 'unknown')
    stepTestMessage.value = `节点 ${stepName} 模拟完成：${status}`
  } catch (error) {
    stepTestMessage.value = error instanceof Error ? error.message : '单节点模拟运行失败。'
  } finally {
    stepTesting.value = false
  }
}

function issueLevelLabel(level: string) {
  if (level === 'error') return '错误'
  if (level === 'risk') return '风险'
  return '警告'
}

function buildMockUserVariables(definition: WorkflowCanvasDefinition): Record<string, unknown> {
  const values: Record<string, unknown> = {
    deviceHost: 'mock-device.local',
    sshUsername: 'admin',
    verifyUrl: 'https://mock-device.local/health',
    remoteFingerprint: 'SHA256:mock',
  }
  for (const [name, variable] of Object.entries(definition.variables)) {
    if (values[name] !== undefined || variable.type === 'certificate') continue
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

function buildMockSecretRefs(): Record<string, Record<string, unknown>> {
  return {
    'secret://workflow/ssh': { username: 'admin', password: 'mock-password', privateKey: 'mock-private-key' },
    'secret://workflow/device-api': { token: 'mock-token' },
  }
}

function mockValueForVariable(name: string, variable: WorkflowVariableDefinition): unknown {
  if (variable.type === 'number') return 1
  if (variable.type === 'boolean') return true
  if (variable.type === 'object') return {}
  if (variable.type === 'secret') return name === 'credential' ? 'secret://workflow/ssh' : `secret://workflow/${name}`
  return `mock-${name}`
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
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
          <label v-for="field in selectedNodeDefinition.fields" :key="field.key">
            <span>{{ field.label }}</span>
            <select v-if="field.kind === 'select'" :value="String(selectedNode.config[field.key] ?? '')" :disabled="!canEdit" @change="updateField(field, $event)">
              <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <textarea v-else-if="field.kind === 'textarea'" :value="String(selectedNode.config[field.key] ?? '')" :disabled="!canEdit" rows="4" @input="updateField(field, $event)" />
            <input v-else :type="field.kind === 'number' ? 'number' : 'text'" :value="String(selectedNode.config[field.key] ?? '')" :disabled="!canEdit" @input="updateField(field, $event)" />
          </label>
          <button class="gc-button workflow-canvas-editor__test-button" type="button" :disabled="stepTesting" @click="testSelectedNode">
            {{ stepTesting ? '模拟中...' : '模拟运行当前节点' }}
          </button>
          <small class="workflow-canvas-editor__test-hint">使用 mock 变量运行当前节点，适用于 HTTP/CURL、SSH、SFTP 和分支判断。</small>
        </template>
        <p v-else>选择节点后编辑配置。</p>
      </aside>
    </section>

    <section class="workflow-canvas-editor__bottom">
      <nav class="workflow-canvas-editor__tabs" aria-label="底部面板">
        <button type="button" :data-active="activeBottomPanel === 'validation'" @click="activeBottomPanel = 'validation'">校验</button>
        <button type="button" :data-active="activeBottomPanel === 'variables'" @click="activeBottomPanel = 'variables'">变量</button>
        <button type="button" :data-active="activeBottomPanel === 'runtime'" @click="activeBottomPanel = 'runtime'">运行态</button>
        <button type="button" :data-active="activeBottomPanel === 'dsl'" @click="activeBottomPanel = 'dsl'">DSL</button>
      </nav>

      <div v-if="activeBottomPanel === 'validation'" class="workflow-canvas-editor__panel" aria-label="校验面板">
        <p v-if="validationIssues.length === 0">没有阻断错误。</p>
        <ul v-else>
          <li v-for="issue in validationIssues" :key="issue.id" :data-severity="issue.severity">
            <strong>{{ issueLevelLabel(issue.severity) }}</strong>
            <span>{{ issue.message }}</span>
            <small>{{ issue.nodeId ? `节点 ${issue.nodeId}` : issue.edgeId ? `连线 ${issue.edgeId}` : '画布' }}{{ issue.field ? ` / 字段 ${issue.field}` : '' }} · {{ issue.suggestion }}</small>
          </li>
        </ul>
      </div>

      <div v-else-if="activeBottomPanel === 'variables'" class="workflow-canvas-editor__panel" aria-label="变量面板">
        <div class="workflow-canvas-editor__variables-header">
          <strong>变量配置</strong>
          <button class="gc-button" type="button" :disabled="!canEdit" @click="addVariable">添加变量</button>
        </div>
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
                <option value="object">object</option>
                <option value="file">file</option>
                <option value="certificate">certificate</option>
                <option value="secret">secretRef</option>
              </select>
            </label>
            <label>
              <span>默认值</span>
              <input :value="String(definition.default ?? '')" :disabled="!canEdit || definition.type === 'secret'" placeholder="Secret 只填写 secret:// 引用，不保存明文" @change="updateVariableField(String(name), 'default', $event)" />
            </label>
            <label class="workflow-canvas-editor__variable-check">
              <input type="checkbox" :checked="Boolean(definition.required)" :disabled="!canEdit" @change="updateVariableField(String(name), 'required', $event)" />
              <span>必填</span>
            </label>
            <label class="workflow-canvas-editor__variable-check">
              <input type="checkbox" :checked="Boolean(definition.sensitive)" :disabled="!canEdit || definition.type === 'secret' || definition.type === 'certificate'" @change="updateVariableField(String(name), 'sensitive', $event)" />
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

      <div v-else-if="activeBottomPanel === 'runtime'" class="workflow-canvas-editor__panel" aria-label="运行态面板">
        <div class="workflow-canvas-editor__runtime-header">
          <strong>单节点模拟</strong>
          <span v-if="stepTestMessage">{{ stepTestMessage }}</span>
        </div>
        <p v-if="!stepTestResult && !stepTesting">选择节点后，在属性面板点击“模拟运行当前节点”。</p>
        <p v-else-if="stepTesting">正在执行 mock 模拟运行...</p>
        <div v-else class="workflow-canvas-editor__runtime-result">
          <ul>
            <li>
              <strong>{{ String(stepTestStepResult?.name ?? stepTestStepName) }}</strong>
              <span>{{ String(stepTestStepResult?.type ?? '-') }} / {{ String(stepTestStepResult?.status ?? '-') }} / attempts {{ String(stepTestStepResult?.attempts ?? '-') }}</span>
              <small>plannedOnly: {{ String(stepTestResult?.plannedOnly ?? false) }} / mode: {{ String(stepTestResult?.mode ?? 'mock') }}</small>
            </li>
          </ul>
          <strong>执行计划</strong>
          <pre>{{ stepTestPlanText }}</pre>
          <strong>日志</strong>
          <ul>
            <li v-for="(line, index) in stepTestLogs" :key="`${index}:${line}`">
              <span>{{ line }}</span>
            </li>
          </ul>
        </div>
      </div>

      <pre v-else class="workflow-canvas-editor__dsl">{{ JSON.stringify(dslPreview, null, 2) }}</pre>
    </section>
  </section>
</template>

<style scoped>
.workflow-canvas-editor {
  display: grid;
  gap: 12px;
  min-height: 640px;
  color: #0f172a;
}

.workflow-canvas-editor__toolbar,
.workflow-canvas-editor__main,
.workflow-canvas-editor__bottom {
  border: 1px solid #dbe6f4;
  border-radius: 8px;
  background: #fff;
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
  color: #64748b;
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
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
  color: #1d4ed8;
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
  background: #f8fbff;
}

.workflow-canvas-editor__palette {
  border-right: 1px solid #dbe6f4;
}

.workflow-canvas-editor__properties {
  border-left: 1px solid #dbe6f4;
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
  border: 1px solid #dbe6f4;
  border-radius: 8px;
  background: #fff;
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
  border: 1px solid #dbe6f4;
  border-radius: 8px;
  background: #fff;
}

.workflow-canvas-editor__stage-picker span {
  color: #475569;
  font-size: 11px;
  font-weight: 800;
}

.workflow-canvas-editor__stage-picker select {
  width: 100%;
  min-height: 34px;
  border: 1px solid #cbd7e6;
  border-radius: 8px;
  padding: 7px 9px;
  background: #fff;
  color: #0f172a;
  font-size: 12px;
}

.workflow-canvas-editor__surface-wrap {
  display: grid;
  grid-template-rows: 1fr;
  min-width: 0;
  overflow: auto;
  background:
    linear-gradient(#eef4fb 1px, transparent 1px),
    linear-gradient(90deg, #eef4fb 1px, transparent 1px);
  background-size: 24px 24px;
}

.workflow-canvas-editor__properties input,
.workflow-canvas-editor__properties select,
.workflow-canvas-editor__properties textarea {
  width: 100%;
  min-height: 34px;
  border: 1px solid #cbd7e6;
  border-radius: 8px;
  padding: 7px 9px;
  background: #fff;
  color: #0f172a;
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
  border-top: 2px dashed #cbd7e6;
  background: rgb(248 251 255 / 52%);
}

.workflow-canvas-editor__stage-lane::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50px;
  bottom: 0;
  width: 2px;
  background: rgb(148 163 184 / 36%);
  transform: translateX(-50%);
}

.workflow-canvas-editor__stage-lane strong {
  color: #0f172a;
  font-size: 13px;
  font-weight: 900;
}

.workflow-canvas-editor__stage-lane span {
  color: #64748b;
  font-size: 11px;
  line-height: 1.4;
}

.workflow-canvas-editor__stage-lane small {
  width: fit-content;
  border-radius: 999px;
  padding: 2px 7px;
  background: #e2e8f0;
  color: #475569;
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
  stroke: #94a3b8;
  stroke-width: 2;
}

.workflow-canvas-editor__edges line[data-edge-type='failure'] {
  stroke: #dc2626;
  stroke-dasharray: 6 5;
}

.workflow-canvas-editor__edges line[data-edge-type='rollback'] {
  stroke: #7c3aed;
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
  border: 2px solid #cbd7e6;
  border-radius: 8px;
  background: #fff;
  text-align: left;
  box-shadow: 0 10px 28px rgb(15 23 42 / 8%);
  cursor: pointer;
}

.workflow-canvas-editor__node--selected {
  border-color: #2563eb;
  box-shadow: 0 0 0 4px rgb(37 99 235 / 14%), 0 10px 28px rgb(15 23 42 / 10%);
}

.workflow-canvas-editor__node span {
  color: #2563eb;
  font-size: 11px;
  font-weight: 800;
}

.workflow-canvas-editor__node strong {
  font-size: 14px;
  overflow-wrap: anywhere;
}

.workflow-canvas-editor__node small {
  color: #94a3b8;
  font-size: 10px;
  overflow-wrap: anywhere;
}

.workflow-canvas-editor__node em {
  width: fit-content;
  border-radius: 999px;
  padding: 2px 7px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 10px;
  font-style: normal;
  font-weight: 900;
}

.workflow-canvas-editor__properties label {
  display: grid;
  gap: 4px;
}

.workflow-canvas-editor__properties label span {
  color: #475569;
  font-size: 11px;
  font-weight: 800;
}

.workflow-canvas-editor__properties textarea {
  resize: vertical;
}

.workflow-canvas-editor__test-button {
  width: 100%;
  justify-content: center;
}

.workflow-canvas-editor__test-hint {
  color: #64748b;
  font-size: 11px;
  line-height: 1.45;
}

.workflow-canvas-editor__bottom {
  display: grid;
  min-height: 180px;
  overflow: hidden;
}

.workflow-canvas-editor__tabs {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid #dbe6f4;
  background: #f8fbff;
}

.workflow-canvas-editor__tabs button {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid #cbd7e6;
  border-radius: 8px;
  background: #fff;
  color: #475569;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.workflow-canvas-editor__tabs button[data-active='true'] {
  background: #0f172a;
  color: #fff;
  border-color: #0f172a;
}

.workflow-canvas-editor__panel {
  max-height: 220px;
  overflow: auto;
  padding: 10px 12px;
}

.workflow-canvas-editor__panel p {
  margin: 0;
  color: #15803d;
  font-size: 13px;
  font-weight: 800;
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
  color: #334155;
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
  color: #475569;
  font-size: 10px;
  font-weight: 800;
}

.workflow-canvas-editor__variable-editor input,
.workflow-canvas-editor__variable-editor select {
  width: 100%;
  min-height: 32px;
  border: 1px solid #cbd7e6;
  border-radius: 8px;
  padding: 6px 8px;
  background: #fff;
  color: #0f172a;
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
  color: #2563eb;
  font-size: 12px;
  font-weight: 800;
}

.workflow-canvas-editor__runtime-result {
  display: grid;
  gap: 8px;
}

.workflow-canvas-editor__runtime-result > strong {
  color: #334155;
  font-size: 12px;
}

.workflow-canvas-editor__runtime-result pre {
  max-height: 180px;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border-radius: 8px;
  background: #0f172a;
  color: #dbeafe;
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
  border: 1px solid #e2e8f0;
  border-left: 4px solid #64748b;
  border-radius: 8px;
  background: #fff;
}

.workflow-canvas-editor__panel li[data-severity='error'] {
  border-left-color: #dc2626;
}

.workflow-canvas-editor__panel li[data-severity='warning'] {
  border-left-color: #d97706;
}

.workflow-canvas-editor__panel li span {
  font-size: 12px;
}

.workflow-canvas-editor__dsl {
  max-height: 240px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  background: #0f172a;
  color: #dbeafe;
  font-size: 12px;
}

@media (max-width: 1180px) {
  .workflow-canvas-editor__main {
    grid-template-columns: 1fr;
  }

  .workflow-canvas-editor__palette,
  .workflow-canvas-editor__properties {
    border: 0;
    border-bottom: 1px solid #dbe6f4;
  }
}
</style>

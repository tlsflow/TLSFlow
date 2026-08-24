<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { GcCapabilityMatrix, GcConfirmAction, GcModal, GcPageHeader } from '@/design-system/components'
import type { CapabilityMatrixItem } from '@/design-system/components/GcCapabilityMatrix.vue'

interface TemplateDraft {
  readonly name: string
  readonly kind: 'CURL' | 'SSH'
  readonly command: string
  readonly variablesText: string
  readonly requiredCapabilitiesText: string
  readonly changeNote: string
}

interface TemplateValidation {
  readonly ok: boolean
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly variables: readonly string[]
  readonly capabilities: readonly string[]
}

interface DryRunPreview {
  readonly requestId: string
  readonly generatedAt: string
  readonly summary: string
  readonly steps: readonly string[]
}

const draft = reactive<TemplateDraft>({
  name: 'Linux NGINX 证书替换模板',
  kind: 'SSH',
  command: [
    'backup ${certPath}',
    'upload ${certificateSecretRef} ${certPath}',
    'reload nginx',
    'verify https://${domainName}'
  ].join('\n'),
  variablesText: 'certPath\ndomainName\ncertificateSecretRef',
  requiredCapabilitiesText: 'ssh.connect\nfile.backup\nfile.write\nprocess.exec\ntls.remote_probe',
  changeNote: ''
})

const dryRunPreview = ref<DryRunPreview | null>(null)
const publishedVersion = ref('')
const isTemplateModalOpen = ref(false)

const validation = computed<TemplateValidation>(() => validateDraft(draft))
const capabilityItems = computed<CapabilityMatrixItem[]>(() => validation.value.capabilities.map((capability) => ({
  key: capability,
  label: capability,
  state: capability.startsWith('manual.') ? 'manualRisk' : 'unknown',
  level: capability.startsWith('tls.') ? 'L3' : 'L2',
  source: draft.kind,
  detail: '模板只声明能力需求，实际 satisfied/missing/manualRisk 由后端 capability API 在部署目标上计算。'
})))

function validateDraft(input: TemplateDraft): TemplateValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const variables = normalizeLines(input.variablesText)
  const capabilities = normalizeLines(input.requiredCapabilitiesText)

  if (!input.name.trim()) errors.push('模板名称不能为空。')
  if (!input.command.trim()) errors.push('执行命令不能为空。')
  if (!input.changeNote.trim()) warnings.push('发布前建议填写变更说明，方便审计追踪。')
  if (capabilities.length === 0) errors.push('至少声明一个 required capability。')

  const secretLeak = /-----BEGIN [A-Z ]*PRIVATE KEY-----|password\s*=|token\s*=|sk-[A-Za-z0-9]{20,}/i
  if (secretLeak.test(input.command) || secretLeak.test(input.variablesText)) {
    errors.push('模板不能包含私钥、password、token 或 API Key 明文，只能引用 SecretRef。')
  }

  const missingVariables = extractVariables(input.command).filter((variable) => !variables.includes(variable))
  if (missingVariables.length > 0) {
    errors.push(`命令引用了未声明变量：${missingVariables.join(', ')}`)
  }

  if (!capabilities.some((capability) => ['ssh.connect', 'curl.request', 'workflow.manual_approval'].includes(capability))) {
    warnings.push('模板没有声明连接类能力，ProviderPlanRunner 可能无法映射执行路径。')
  }

  return { ok: errors.length === 0, errors, warnings, variables, capabilities }
}

function normalizeLines(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function extractVariables(command: string): string[] {
  return [...command.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)}/g)].map((match) => match[1]!)
}

function runDryRun() {
  const current = validation.value
  if (!current.ok) return
  dryRunPreview.value = {
    requestId: `local_dry_run_${Date.now()}`,
    generatedAt: new Date().toISOString(),
    summary: `${draft.kind} 模板将生成 ${draft.command.split('\n').filter(Boolean).length} 个步骤，依赖 ${current.capabilities.length} 项能力。`,
    steps: draft.command.split('\n').map((line, index) => `步骤 ${index + 1}: ${line}`)
  }
}

function publishTemplate() {
  const current = validation.value
  if (!current.ok) return
  publishedVersion.value = `v${new Date().toISOString()}`
  isTemplateModalOpen.value = false
}
</script>

<template>
  <section class="gc-page gc-workflow-template-page">
    <GcPageHeader
      title="工作流模板"
      description="CURL/SSH 模板编辑、变量校验、SecretRef 安全检查、dry-run 预览和发布入口。后端模板 API 尚未稳定，当前页只输出清晰的本地草案契约，不自造动态路由。"
    >
      <template #actions>
        <button class="gc-button" type="button" @click="isTemplateModalOpen = true">新建模板</button>
      </template>
    </GcPageHeader>

    <GcModal
      v-model:open="isTemplateModalOpen"
      title="模板编辑器"
      description="最小闭环是：编辑草案 -> 校验变量和敏感字段 -> dry-run 预览 -> 二次确认发布。"
      size="xl"
    >
      <section class="gc-template-editor" aria-label="模板编辑器">
        <header>
          <h2>模板编辑器</h2>
          <span class="gc-template-editor__status" :class="{ 'is-ok': validation.ok }">{{ validation.ok ? '校验通过' : '校验失败' }}</span>
        </header>

        <div class="gc-template-editor__grid">
          <label class="gc-form-field">
            <span>模板名称</span>
            <input v-model="draft.name" />
          </label>
          <label class="gc-form-field">
            <span>模板类型</span>
            <select v-model="draft.kind">
              <option value="SSH">SSH</option>
              <option value="CURL">CURL</option>
            </select>
          </label>
        </div>

        <label class="gc-form-field">
          <span>执行草案</span>
          <textarea v-model="draft.command" rows="7" spellcheck="false" />
        </label>

        <div class="gc-template-editor__grid">
          <label class="gc-form-field">
            <span>变量白名单</span>
            <textarea v-model="draft.variablesText" rows="5" spellcheck="false" />
          </label>
          <label class="gc-form-field">
            <span>Required capabilities</span>
            <textarea v-model="draft.requiredCapabilitiesText" rows="5" spellcheck="false" />
          </label>
        </div>

        <label class="gc-form-field">
          <span>变更说明</span>
          <input v-model="draft.changeNote" placeholder="例如：新增 NGINX reload 前的备份步骤" />
        </label>

        <section class="gc-template-editor__messages" aria-label="模板校验结果">
          <p v-if="validation.errors.length === 0" class="gc-template-editor__ok">没有阻断错误。</p>
          <p v-for="error in validation.errors" :key="error" class="gc-template-editor__error">{{ error }}</p>
          <p v-for="warning in validation.warnings" :key="warning" class="gc-template-editor__warning">{{ warning }}</p>
        </section>
      </section>

      <template #actions>
        <button class="gc-button" type="button" :disabled="!validation.ok" @click="runDryRun">Dry-run 预览</button>
        <GcConfirmAction
          action-name="发布模板"
          confirm-text="PUBLISH"
          risk-text="发布模板会进入后续部署计划映射链路，必须确认变量、SecretRef 和能力声明都正确。"
          :impact-count="validation.capabilities.length"
          @confirm="publishTemplate"
        />
      </template>
    </GcModal>

    <GcCapabilityMatrix
      :items="capabilityItems"
      title="Capability 需求声明"
      description="这里展示模板声明的能力需求；目标侧 satisfied/missing/unknown/manualRisk 与 L1-L5 由 capability API 计算。"
    />

    <section class="gc-card gc-template-preview" aria-label="dry-run 预览">
      <strong>Dry-run 结果</strong>
      <p v-if="!dryRunPreview">还没有执行 dry-run。不会提交任何部署任务。</p>
      <template v-else>
        <p>{{ dryRunPreview.summary }}</p>
        <p>requestId：{{ dryRunPreview.requestId }}</p>
        <ol>
          <li v-for="step in dryRunPreview.steps" :key="step">{{ step }}</li>
        </ol>
      </template>
      <p v-if="publishedVersion">已发布草案版本：{{ publishedVersion }}</p>
    </section>
  </section>
</template>

<style scoped>
.gc-workflow-template-page { display: grid; gap: var(--gc-space-5); }
.gc-template-editor { display: grid; gap: var(--gc-space-5); }
.gc-template-editor header { display: flex; justify-content: flex-end; gap: var(--gc-space-3); align-items: center; flex-wrap: wrap; }
.gc-template-editor h2 { margin: 0; font-size: 22px; letter-spacing: -0.04em; }
.gc-template-editor__grid { display: grid; gap: var(--gc-space-4); grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.gc-template-editor__status { border-radius: 999px; padding: 5px 12px; background: var(--gc-color-danger-bg); color: var(--gc-color-danger); font-size: var(--gc-font-size-sm); font-weight: 900; }
.gc-template-editor__status.is-ok { background: var(--gc-color-success-bg); color: var(--gc-color-success); }
.gc-template-editor textarea,
.gc-template-editor input,
.gc-template-editor select {
  border: 1px solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  background: #fff;
  padding: 10px 12px;
  font: inherit;
  box-shadow: inset 0 1px 1px rgb(15 23 42 / 4%);
}
.gc-template-editor textarea { min-height: 132px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.gc-template-editor__messages { border: 1px solid var(--gc-color-border); border-radius: var(--gc-radius-md); padding: var(--gc-space-4); background: #fbfdff; }
.gc-template-editor__ok { color: var(--gc-color-success); }
.gc-template-editor__error { color: var(--gc-color-danger); }
.gc-template-editor__warning { color: var(--gc-color-warning); }
.gc-template-preview { display: grid; gap: var(--gc-space-2); }
</style>

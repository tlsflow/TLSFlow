<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  CertificateImportDraft,
  CertificateImportValidationResult,
  ImportFormat,
  ImportMethod,
} from './certificate-import.shared'
import {
  certificateFormatOptions,
  importMethodOptions,
  isMaterialReady,
} from './certificate-import.shared'

const props = withDefaults(defineProps<{
  draft: CertificateImportDraft
  loading?: boolean
  validating?: boolean
  error?: string
  resultId?: string
  validationResult?: CertificateImportValidationResult | null
}>(), {
  loading: false,
  validating: false,
  error: '',
  resultId: '',
  validationResult: null,
})

const emit = defineEmits<{
  validate: []
  submit: []
  cancel: []
}>()

const currentStep = ref(1)
const fileInputKey = ref(0)
const certificateFileName = ref('')
const privateKeyFileName = ref('')

const selectedFormat = computed(() =>
  certificateFormatOptions.find((item) => item.key === props.draft.format) ?? certificateFormatOptions[0],
)
const effectiveMethod = computed<ImportMethod>(() => (
  props.draft.format === 'PFX' ? 'file' : props.draft.importMethod
))
const selectedMethod = computed(() =>
  importMethodOptions.find((item) => item.key === effectiveMethod.value) ?? importMethodOptions[0],
)
const materialReady = computed(() => isMaterialReady(props.draft))
const canGoToStepTwo = computed(() => Boolean(selectedFormat.value.supported))
const canGoToStepThree = computed(() => materialReady.value && !props.loading && !props.validating)
const canSubmit = computed(() => Boolean(props.validationResult?.importable) && !props.loading && !props.validating)

const chainCheckHint = computed(() => {
  if (props.draft.format === 'PEM') {
    return 'PEM + KEY 必须同时包含服务器证书、完整中间证书链和私钥。根证书不是强制项，缺少时只显示警告。'
  }
  return 'PFX 仅支持文件导入，且必须解出服务器证书、完整中间证书链和私钥。根证书不是强制项，缺少时只显示警告。'
})

const methodSpecificTitle = computed(() => `${selectedFormat.value.label} · ${selectedMethod.value.label}`)
const needsCertificateText = computed(() => props.draft.format === 'PEM' && effectiveMethod.value === 'text')
const needsCertificateFile = computed(() => effectiveMethod.value === 'file')
const issuerText = computed(() => stringifyDn(props.validationResult?.certificate.issuer))
const subjectText = computed(() => stringifyDn(props.validationResult?.certificate.subject))
const sanText = computed(() => props.validationResult?.certificate.sans.join(', ') || '无')
const chainCertificates = computed(() => props.validationResult?.chain.certificates ?? [])

watch(
  () => props.validationResult,
  (result) => {
    if (result) currentStep.value = 3
  },
)

watch(
  () => props.draft.format,
  (format) => {
    if (format === 'PFX' && props.draft.importMethod !== 'file') {
      props.draft.importMethod = 'file'
    }
  },
  { immediate: true },
)

function updateFormat(format: ImportFormat) {
  if (props.draft.format === format) return
  props.draft.format = format
  if (format === 'PFX') props.draft.importMethod = 'file'
  resetMaterialState()
}

function updateMethod(method: ImportMethod) {
  if (props.draft.format === 'PFX') return
  if (props.draft.importMethod === method) return
  props.draft.importMethod = method
  resetMaterialState()
}

function resetMaterialState() {
  certificateFileName.value = ''
  privateKeyFileName.value = ''
  fileInputKey.value += 1
  props.draft.certificatePem = ''
  props.draft.pfxBase64 = ''
  props.draft.pfxPassword = ''
  props.draft.privateKeyPem = ''
}

function nextStep() {
  if (currentStep.value === 1 && canGoToStepTwo.value) {
    currentStep.value = 2
    return
  }
  if (currentStep.value === 2 && canGoToStepThree.value) {
    currentStep.value = 3
  }
}

function prevStep() {
  if (currentStep.value > 1) currentStep.value -= 1
}

async function handleCertificateFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null
  const files = Array.from(input?.files ?? [])
  if (files.length === 0) return

  certificateFileName.value = files.map((file) => file.name).join(', ')

  if (props.draft.format === 'PEM') {
    const contents = await Promise.all(files.map((file) => file.text()))
    props.draft.certificatePem = contents.map((item) => item.trim()).filter(Boolean).join('\n')
    return
  }

  const firstFile = files[0]
  if (!firstFile) return
  const bytes = await firstFile.arrayBuffer()
  props.draft.pfxBase64 = arrayBufferToBase64(bytes)
}

async function handlePrivateKeyFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (!file) return

  privateKeyFileName.value = file.name
  props.draft.privateKeyPem = (await file.text()).trim()
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function stringifyDn(value: Record<string, unknown> | undefined | null) {
  if (!value) return '无'
  const raw = typeof value.raw === 'string' ? value.raw : ''
  if (raw) return raw

  return Object.entries(value)
    .filter(([key]) => key !== 'raw')
    .map(([key, item]) => `${key}=${String(item)}`)
    .join(', ') || '无'
}

function roleLabel(role: 'leaf' | 'intermediate' | 'root') {
  if (role === 'leaf') return '服务器证书'
  if (role === 'root') return '根证书'
  return '中间证书'
}

function formatDateTime(value: string | undefined) {
  if (!value) return '无'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

function submitValidation() {
  emit('validate')
}

function submitImport() {
  emit('submit')
}

function cancelImport() {
  emit('cancel')
}
</script>

<template>
  <section class="certificate-import-wizard">
    <ol class="certificate-import-wizard__steps" aria-label="导入步骤">
      <li :class="{ 'is-active': currentStep === 1, 'is-done': currentStep > 1 }">1. 选择类型与方式</li>
      <li :class="{ 'is-active': currentStep === 2, 'is-done': currentStep > 2 }">2. 填写必要材料</li>
      <li :class="{ 'is-active': currentStep === 3 }">3. 校验并导入</li>
    </ol>

    <section v-if="currentStep === 1" class="gc-card certificate-import-wizard__panel">
      <header class="certificate-import-wizard__header">
        <div>
          <h3>仅保留两种导入格式</h3>
          <p>当前入口只支持 PEM + KEY 和 PFX。PFX 仅支持文件导入，PEM 支持文件或粘贴。</p>
        </div>
      </header>

      <div class="certificate-import-wizard__choice-grid">
        <section class="certificate-import-wizard__choice-group">
          <span class="certificate-import-wizard__choice-label">导入类型</span>
          <div class="certificate-import-wizard__cards">
            <button
              v-for="format in certificateFormatOptions"
              :key="format.key"
              class="gc-card certificate-import-wizard__card"
              :class="{ 'is-active': draft.format === format.key, 'is-disabled': !format.supported }"
              type="button"
              @click="updateFormat(format.key)"
            >
              <strong>{{ format.label }}</strong>
              <span>{{ format.supported ? '支持导入' : '暂不支持' }}</span>
              <p>{{ format.hint }}</p>
            </button>
          </div>
        </section>

        <section class="certificate-import-wizard__choice-group">
          <span class="certificate-import-wizard__choice-label">导入方式</span>
          <div class="certificate-import-wizard__cards certificate-import-wizard__cards--compact">
            <button
              v-for="method in importMethodOptions"
              :key="method.key"
              class="gc-card certificate-import-wizard__card"
              :class="{ 'is-active': effectiveMethod === method.key, 'is-disabled': draft.format === 'PFX' && method.key !== 'file' }"
              type="button"
              :disabled="draft.format === 'PFX' && method.key !== 'file'"
              @click="updateMethod(method.key)"
            >
              <strong>{{ method.label }}</strong>
              <p>{{ draft.format === 'PFX' && method.key !== 'file' ? 'PFX 仅支持文件导入。' : method.hint }}</p>
            </button>
          </div>
        </section>
      </div>
    </section>

    <section v-else-if="currentStep === 2" class="gc-card certificate-import-wizard__panel">
      <header class="certificate-import-wizard__header">
        <div>
          <h3>{{ methodSpecificTitle }}</h3>
          <p>{{ chainCheckHint }}</p>
        </div>
      </header>

      <form class="certificate-import-wizard__form" @submit.prevent="nextStep">
        <label v-if="draft.format === 'PEM' && needsCertificateFile" class="certificate-import-wizard__field certificate-import-wizard__field--full">
          <span>证书链文件</span>
          <input
            :key="`certificate-${fileInputKey}`"
            class="certificate-import-wizard__file"
            type="file"
            multiple
            accept=".pem,.crt,.cer,.txt"
            @change="handleCertificateFileChange"
          />
          <small v-if="certificateFileName">已选择：{{ certificateFileName }}</small>
        </label>

        <label v-if="needsCertificateText" class="certificate-import-wizard__field certificate-import-wizard__field--full">
          <span>证书 PEM / 证书链文本</span>
          <textarea
            v-model="draft.certificatePem"
            rows="12"
            spellcheck="false"
            placeholder="按 leaf -> intermediate -> root 顺序粘贴证书链；root 可选"
          />
        </label>

        <label v-if="draft.format === 'PEM'" class="certificate-import-wizard__field certificate-import-wizard__field--full">
          <span>私钥 {{ effectiveMethod === 'file' ? '文件' : 'PEM 文本' }}</span>
          <input
            v-if="effectiveMethod === 'file'"
            :key="`private-key-${fileInputKey}`"
            class="certificate-import-wizard__file"
            type="file"
            accept=".key,.pem,.txt"
            @change="handlePrivateKeyFileChange"
          />
          <textarea
            v-else
            v-model="draft.privateKeyPem"
            rows="6"
            spellcheck="false"
            placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
          />
          <small v-if="effectiveMethod === 'file' && privateKeyFileName">已选择：{{ privateKeyFileName }}</small>
        </label>

        <label v-if="draft.format === 'PFX' && needsCertificateFile" class="certificate-import-wizard__field certificate-import-wizard__field--full">
          <span>PFX 文件</span>
          <input
            :key="`certificate-${fileInputKey}`"
            class="certificate-import-wizard__file"
            type="file"
            accept=".pfx,.p12"
            @change="handleCertificateFileChange"
          />
          <small v-if="certificateFileName">已选择：{{ certificateFileName }}</small>
        </label>

        <div class="certificate-import-wizard__meta">
          <label class="certificate-import-wizard__field">
            <span>证书名称（可选）</span>
            <input v-model="draft.name" placeholder="默认使用 CN 或 SAN" />
          </label>
          <label v-if="draft.format === 'PFX'" class="certificate-import-wizard__field">
            <span>PFX 密码</span>
            <input v-model="draft.pfxPassword" type="password" autocomplete="off" placeholder="必填" />
          </label>
        </div>
      </form>
    </section>

    <section v-else class="gc-card certificate-import-wizard__panel">
      <header class="certificate-import-wizard__header">
        <div>
          <h3>有效性与完整性校验</h3>
          <p>校验规则：必须有服务器证书、完整中间证书链和私钥，且私钥必须与叶子证书匹配。根证书不强制导入，缺少时仅警告。</p>
        </div>
      </header>

      <div class="certificate-import-wizard__summary">
        <div><span>导入类型</span><strong>{{ selectedFormat.label }}</strong></div>
        <div><span>导入方式</span><strong>{{ selectedMethod.label }}</strong></div>
        <div><span>材料状态</span><strong>{{ materialReady ? '已填写' : '未完成' }}</strong></div>
      </div>

      <div class="certificate-import-wizard__validate-actions">
        <button class="gc-button" type="button" :disabled="!materialReady || validating || loading" @click="submitValidation">
          {{ validating ? '校验中...' : '开始校验' }}
        </button>
      </div>

      <div v-if="validationResult" class="certificate-import-wizard__report">
        <div class="certificate-import-wizard__status" :class="{ 'is-success': validationResult.importable, 'is-fail': !validationResult.importable }">
          {{ validationResult.importable ? '校验通过，可以导入。' : '校验未通过，存在阻断项。' }}
        </div>

        <div class="certificate-import-wizard__report-grid">
          <article class="certificate-import-wizard__report-card">
            <h4>证书摘要</h4>
            <dl>
              <div><dt>CN</dt><dd>{{ validationResult.certificate.commonName || '无' }}</dd></div>
              <div><dt>SAN</dt><dd>{{ sanText }}</dd></div>
              <div><dt>序列号</dt><dd>{{ validationResult.certificate.serialNumber }}</dd></div>
              <div><dt>有效期</dt><dd>{{ formatDateTime(validationResult.certificate.notBefore) }} 至 {{ formatDateTime(validationResult.certificate.notAfter) }}</dd></div>
              <div><dt>颁发者</dt><dd>{{ issuerText }}</dd></div>
              <div><dt>使用者</dt><dd>{{ subjectText }}</dd></div>
            </dl>
          </article>

          <article class="certificate-import-wizard__report-card">
            <h4>链校验</h4>
            <dl>
              <div><dt>链状态</dt><dd>{{ validationResult.chain.status }}</dd></div>
              <div><dt>证书数量</dt><dd>{{ validationResult.chain.certificateCount }}</dd></div>
            </dl>
            <div v-if="chainCertificates.length" class="certificate-import-wizard__chain-list">
              <article v-for="item in chainCertificates" :key="item.fingerprintSha256" class="certificate-import-wizard__chain-item">
                <div class="certificate-import-wizard__chain-head">
                  <strong>{{ item.displayName }}</strong>
                  <span>{{ roleLabel(item.role) }}</span>
                </div>
                <p>{{ stringifyDn(item.subject) }}</p>
                <small>签发者：{{ stringifyDn(item.issuer) }}</small>
              </article>
            </div>
            <ul v-if="validationResult.chain.diagnostics.length" class="certificate-import-wizard__list">
              <li v-for="item in validationResult.chain.diagnostics" :key="item">{{ item }}</li>
            </ul>
          </article>

          <article class="certificate-import-wizard__report-card">
            <h4>私钥匹配</h4>
            <dl>
              <div><dt>是否提供</dt><dd>{{ validationResult.privateKey.provided ? '是' : '否' }}</dd></div>
              <div><dt>匹配结果</dt><dd>{{ validationResult.privateKey.matched ? '匹配' : '未匹配' }}</dd></div>
              <div><dt>私钥来源</dt><dd>{{ validationResult.privateKey.source }}</dd></div>
            </dl>
          </article>
        </div>

        <article v-if="validationResult.blockers.length" class="certificate-import-wizard__messages certificate-import-wizard__messages--error">
          <h4>阻断项</h4>
          <ul class="certificate-import-wizard__list">
            <li v-for="item in validationResult.blockers" :key="item">{{ item }}</li>
          </ul>
        </article>

        <article v-if="validationResult.warnings.length" class="certificate-import-wizard__messages certificate-import-wizard__messages--warning">
          <h4>提示</h4>
          <ul class="certificate-import-wizard__list">
            <li v-for="item in validationResult.warnings" :key="item">{{ item }}</li>
          </ul>
        </article>
      </div>

      <p v-if="error" class="certificate-import-wizard__error">{{ error }}</p>
      <p v-if="resultId" class="certificate-import-wizard__success">导入成功：{{ resultId }}</p>
    </section>

    <footer class="certificate-import-wizard__footer">
      <div class="certificate-import-wizard__footer-left">
        <button class="gc-button" type="button" :disabled="loading || validating" @click="cancelImport">取消</button>
      </div>
      <div class="certificate-import-wizard__footer-right">
        <button class="gc-button" type="button" :disabled="currentStep === 1 || loading || validating" @click="prevStep">上一步</button>
        <button
          v-if="currentStep < 3"
          class="gc-button"
          type="button"
          :disabled="currentStep === 1 ? !canGoToStepTwo : !canGoToStepThree"
          @click="nextStep"
        >
          下一步
        </button>
        <button
          v-else
          class="gc-button gc-button--danger"
          type="button"
          :disabled="!canSubmit"
          @click="submitImport"
        >
          {{ loading ? '导入中...' : '导入证书' }}
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.certificate-import-wizard {
  display: grid;
  gap: 10px;
}

.certificate-import-wizard__steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.certificate-import-wizard__steps li {
  border: 1px solid rgb(15 23 42 / 8%);
  border-radius: 999px;
  padding: 8px 12px;
  color: var(--gc-color-text-muted);
  background: rgb(255 255 255 / 40%);
  text-align: center;
  font-size: 12px;
  font-weight: 650;
}

.certificate-import-wizard__steps li.is-active,
.certificate-import-wizard__steps li.is-done {
  border-color: rgb(10 132 255 / 24%);
  color: #0a84ff;
  background: rgb(10 132 255 / 8%);
}

.certificate-import-wizard__panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
}

.certificate-import-wizard__header {
  display: grid;
  gap: 4px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgb(15 23 42 / 6%);
}

.certificate-import-wizard__header h3,
.certificate-import-wizard__report-card h4,
.certificate-import-wizard__messages h4 {
  margin: 0;
}

.certificate-import-wizard__header p,
.certificate-import-wizard__choice-label,
.certificate-import-wizard__report-card dt,
.certificate-import-wizard__messages h4 {
  color: var(--gc-color-text-muted);
}

.certificate-import-wizard__choice-grid,
.certificate-import-wizard__cards,
.certificate-import-wizard__meta,
.certificate-import-wizard__report-grid,
.certificate-import-wizard__form,
.certificate-import-wizard__report,
.certificate-import-wizard__chain-list {
  display: grid;
  gap: 10px;
}

.certificate-import-wizard__cards {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.certificate-import-wizard__cards--compact {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.certificate-import-wizard__card {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-radius: 14px;
  text-align: left;
  cursor: pointer;
}

.certificate-import-wizard__card strong {
  font-size: 13px;
  font-weight: 700;
}

.certificate-import-wizard__card span,
.certificate-import-wizard__chain-head span {
  width: fit-content;
  border-radius: 999px;
  padding: 2px 8px;
  background: rgb(10 132 255 / 10%);
  color: #0a84ff;
  font-size: 10px;
  font-weight: 700;
}

.certificate-import-wizard__card p {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.certificate-import-wizard__card.is-active {
  border-color: rgb(10 132 255 / 24%);
  box-shadow: inset 0 0 0 1px rgb(10 132 255 / 14%);
}

.certificate-import-wizard__card.is-disabled {
  opacity: .55;
  cursor: not-allowed;
}

.certificate-import-wizard__form,
.certificate-import-wizard__meta {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.certificate-import-wizard__field {
  display: grid;
  gap: 5px;
  color: var(--gc-color-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.certificate-import-wizard__field--full {
  grid-column: 1 / -1;
}

.certificate-import-wizard__field input,
.certificate-import-wizard__field textarea {
  width: 100%;
  border: 1px solid var(--gc-color-border);
  border-radius: 12px;
  min-height: 38px;
  padding: 9px 11px;
  color: var(--gc-color-text);
  background: rgb(255 255 255 / 72%);
  outline: none;
}

.certificate-import-wizard__field textarea {
  min-height: 100px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}

.certificate-import-wizard__file {
  padding: 8px 10px;
  cursor: pointer;
}

.certificate-import-wizard__summary,
.certificate-import-wizard__report-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.certificate-import-wizard__summary div,
.certificate-import-wizard__report-card,
.certificate-import-wizard__chain-item {
  display: grid;
  gap: 4px;
  border: 1px solid rgb(15 23 42 / 6%);
  border-radius: 14px;
  padding: 12px;
  background: rgb(255 255 255 / 42%);
}

.certificate-import-wizard__summary span,
.certificate-import-wizard__report-card dt {
  font-size: 11px;
  font-weight: 600;
}

.certificate-import-wizard__status {
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 700;
}

.certificate-import-wizard__status.is-success {
  color: #047857;
  background: #ecfdf5;
}

.certificate-import-wizard__status.is-fail {
  color: #b91c1c;
  background: #fef2f2;
}

.certificate-import-wizard__report-card dl {
  display: grid;
  gap: 8px;
  margin: 0;
}

.certificate-import-wizard__report-card dd,
.certificate-import-wizard__chain-item p,
.certificate-import-wizard__chain-item small {
  margin: 0;
  overflow-wrap: anywhere;
}

.certificate-import-wizard__chain-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.certificate-import-wizard__messages {
  display: grid;
  gap: 8px;
  border-radius: 14px;
  padding: 12px;
}

.certificate-import-wizard__messages--error {
  background: #fef2f2;
  color: #991b1b;
}

.certificate-import-wizard__messages--warning {
  background: #fffbeb;
  color: #92400e;
}

.certificate-import-wizard__list {
  margin: 0;
  padding-left: 18px;
}

.certificate-import-wizard__error,
.certificate-import-wizard__success {
  margin: 0;
  font-size: 12px;
  font-weight: 650;
}

.certificate-import-wizard__error {
  color: var(--gc-color-danger);
}

.certificate-import-wizard__success {
  color: #047857;
}

.certificate-import-wizard__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.certificate-import-wizard__footer-left,
.certificate-import-wizard__footer-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.certificate-import-wizard__validate-actions {
  display: flex;
  justify-content: flex-start;
}

@media (max-width: 900px) {
  .certificate-import-wizard__form,
  .certificate-import-wizard__meta,
  .certificate-import-wizard__summary,
  .certificate-import-wizard__report-grid,
  .certificate-import-wizard__steps {
    grid-template-columns: 1fr;
  }

  .certificate-import-wizard__footer {
    flex-direction: column;
    align-items: stretch;
  }

  .certificate-import-wizard__footer-left,
  .certificate-import-wizard__footer-right,
  .certificate-import-wizard__chain-head {
    justify-content: space-between;
  }
}
</style>

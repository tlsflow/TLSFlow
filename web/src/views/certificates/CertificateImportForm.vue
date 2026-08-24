<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import type {
  CertificateImportDraft,
  CertificateImportValidationResult,
  ImportFormat,
  ImportMethod,
} from './certificate-import.shared'
import {
  createCertificateFormatOptions,
  createImportMethodOptions,
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

const { t } = useI18n()
const currentStep = ref(1)
const fileInputKey = ref(0)
const certificateFileName = ref('')
const privateKeyFileName = ref('')

const certificateFormatOptions = computed(() => createCertificateFormatOptions(t))
const importMethodOptions = computed(() => createImportMethodOptions(t))
const selectedFormat = computed(() =>
  certificateFormatOptions.value.find((item) => item.key === props.draft.format) ?? certificateFormatOptions.value[0],
)
const effectiveMethod = computed<ImportMethod>(() => (
  props.draft.format === 'PFX' ? 'file' : props.draft.importMethod
))
const selectedMethod = computed(() =>
  importMethodOptions.value.find((item) => item.key === effectiveMethod.value) ?? importMethodOptions.value[0],
)
const materialReady = computed(() => isMaterialReady(props.draft))
const canGoToStepTwo = computed(() => Boolean(selectedFormat.value.supported))
const canGoToStepThree = computed(() => materialReady.value && !props.loading && !props.validating)
const canSubmit = computed(() => Boolean(props.validationResult?.importable) && !props.loading && !props.validating)

const chainCheckHint = computed(() => {
  if (props.draft.format === 'PEM') {
    return t('certificates.importForm.hints.pemChainCheck')
  }
  return t('certificates.importForm.hints.pfxChainCheck')
})

const methodSpecificTitle = computed(() => `${selectedFormat.value.label} · ${selectedMethod.value.label}`)
const needsCertificateText = computed(() => props.draft.format === 'PEM' && effectiveMethod.value === 'text')
const needsCertificateFile = computed(() => effectiveMethod.value === 'file')
const issuerText = computed(() => stringifyDn(props.validationResult?.certificate.issuer))
const subjectText = computed(() => stringifyDn(props.validationResult?.certificate.subject))
const sanText = computed(() => props.validationResult?.certificate.sans.join(', ') || t('agents.common.none'))
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
  if (!value) return t('agents.common.none')
  const raw = typeof value.raw === 'string' ? value.raw : ''
  if (raw) return raw

  return Object.entries(value)
    .filter(([key]) => key !== 'raw')
    .map(([key, item]) => `${key}=${String(item)}`)
    .join(', ') || t('agents.common.none')
}

function roleLabel(role: 'leaf' | 'intermediate' | 'root') {
  if (role === 'leaf') return t('certificates.importForm.roles.leaf')
  if (role === 'root') return t('certificates.importForm.roles.root')
  return t('certificates.importForm.roles.intermediate')
}

function formatDateTime(value: string | undefined) {
  if (!value) return t('agents.common.none')
  return formatBrowserLocalTime(value) || value
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
    <ol class="certificate-import-wizard__steps" :aria-label="t('certificates.importForm.steps.ariaLabel')">
      <li :class="{ 'is-active': currentStep === 1, 'is-done': currentStep > 1 }">1. {{ t('certificates.importForm.steps.formatAndMethod') }}</li>
      <li :class="{ 'is-active': currentStep === 2, 'is-done': currentStep > 2 }">2. {{ t('certificates.importForm.steps.materials') }}</li>
      <li :class="{ 'is-active': currentStep === 3 }">3. {{ t('certificates.importForm.steps.validateAndImport') }}</li>
    </ol>

    <section v-if="currentStep === 1" class="gc-card gc-form-panel certificate-import-wizard__panel">
      <header class="gc-form-header certificate-import-wizard__header">
        <div>
          <h3>{{ t('certificates.importForm.formatIntro.title') }}</h3>
          <p>{{ t('certificates.importForm.formatIntro.description') }}</p>
        </div>
      </header>

      <div class="certificate-import-wizard__choice-grid">
        <section class="certificate-import-wizard__choice-group">
          <span class="certificate-import-wizard__choice-label">{{ t('certificates.importForm.labels.importType') }}</span>
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
              <span>{{ format.supported ? t('certificates.importForm.status.supported') : t('certificates.importForm.status.unsupported') }}</span>
              <p>{{ format.hint }}</p>
            </button>
          </div>
        </section>

        <section class="certificate-import-wizard__choice-group">
          <span class="certificate-import-wizard__choice-label">{{ t('certificates.importForm.labels.importMethod') }}</span>
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
              <p>{{ draft.format === 'PFX' && method.key !== 'file' ? t('certificates.importForm.hints.pfxFileOnly') : method.hint }}</p>
            </button>
          </div>
        </section>
      </div>
    </section>

    <section v-else-if="currentStep === 2" class="gc-card gc-form-panel certificate-import-wizard__panel">
      <header class="gc-form-header certificate-import-wizard__header">
        <div>
          <h3>{{ methodSpecificTitle }}</h3>
          <p>{{ chainCheckHint }}</p>
        </div>
      </header>

      <form class="certificate-import-wizard__form" @submit.prevent="nextStep">
        <label v-if="draft.format === 'PEM' && needsCertificateFile" class="gc-form-field certificate-import-wizard__field certificate-import-wizard__field--full">
          <span>{{ t('certificates.importForm.fields.certificateChainFile') }}</span>
          <input
            :key="`certificate-${fileInputKey}`"
            class="certificate-import-wizard__file"
            type="file"
            multiple
            accept=".pem,.crt,.cer,.txt"
            @change="handleCertificateFileChange"
          />
          <small v-if="certificateFileName">{{ t('certificates.importForm.selectedFile', { name: certificateFileName }) }}</small>
        </label>

        <label v-if="needsCertificateText" class="gc-form-field certificate-import-wizard__field certificate-import-wizard__field--full">
          <span>{{ t('certificates.importForm.fields.certificatePemText') }}</span>
          <textarea
            v-model="draft.certificatePem"
            rows="12"
            spellcheck="false"
            :placeholder="t('certificates.importForm.placeholders.certificatePem')"
          />
        </label>

        <label v-if="draft.format === 'PEM'" class="gc-form-field certificate-import-wizard__field certificate-import-wizard__field--full">
          <span>{{ t('certificates.importForm.fields.privateKey', { kind: effectiveMethod === 'file' ? t('certificates.importForm.fields.file') : t('certificates.importForm.fields.pemText') }) }}</span>
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
          <small v-if="effectiveMethod === 'file' && privateKeyFileName">{{ t('certificates.importForm.selectedFile', { name: privateKeyFileName }) }}</small>
        </label>

        <label v-if="draft.format === 'PFX' && needsCertificateFile" class="gc-form-field certificate-import-wizard__field certificate-import-wizard__field--full">
          <span>{{ t('certificates.importForm.fields.pfxFile') }}</span>
          <input
            :key="`certificate-${fileInputKey}`"
            class="certificate-import-wizard__file"
            type="file"
            accept=".pfx,.p12"
            @change="handleCertificateFileChange"
          />
          <small v-if="certificateFileName">{{ t('certificates.importForm.selectedFile', { name: certificateFileName }) }}</small>
        </label>

        <div class="certificate-import-wizard__meta">
          <label class="gc-form-field certificate-import-wizard__field">
            <span>{{ t('certificates.importForm.fields.certificateName') }}</span>
            <input v-model="draft.name" :placeholder="t('certificates.importForm.placeholders.certificateName')" />
          </label>
          <label v-if="draft.format === 'PFX'" class="gc-form-field certificate-import-wizard__field">
            <span>{{ t('certificates.importForm.fields.pfxPassword') }}</span>
            <input v-model="draft.pfxPassword" type="password" autocomplete="off" :placeholder="t('certificates.importForm.placeholders.required')" />
          </label>
        </div>
      </form>
    </section>

    <section v-else class="gc-card gc-form-panel certificate-import-wizard__panel">
      <header class="gc-form-header certificate-import-wizard__header">
        <div>
          <h3>{{ t('certificates.importForm.validation.title') }}</h3>
          <p>{{ t('certificates.importForm.validation.description') }}</p>
        </div>
      </header>

      <div class="certificate-import-wizard__summary">
        <div><span>{{ t('certificates.importForm.labels.importType') }}</span><strong>{{ selectedFormat.label }}</strong></div>
        <div><span>{{ t('certificates.importForm.labels.importMethod') }}</span><strong>{{ selectedMethod.label }}</strong></div>
        <div><span>{{ t('certificates.importForm.labels.materialStatus') }}</span><strong>{{ materialReady ? t('certificates.importForm.status.completed') : t('certificates.importForm.status.incomplete') }}</strong></div>
      </div>

      <div class="certificate-import-wizard__validate-actions">
        <button class="gc-button" type="button" :disabled="!materialReady || validating || loading" @click="submitValidation">
          {{ validating ? t('certificates.importForm.actions.validating') : t('certificates.importForm.actions.validate') }}
        </button>
      </div>

      <div v-if="validationResult" class="certificate-import-wizard__report">
        <div class="certificate-import-wizard__status" :class="{ 'is-success': validationResult.importable, 'is-fail': !validationResult.importable }">
          {{ validationResult.importable ? t('certificates.importForm.validation.passed') : t('certificates.importForm.validation.failed') }}
        </div>

        <div class="certificate-import-wizard__report-grid">
          <article class="certificate-import-wizard__report-card">
            <h4>{{ t('certificates.importForm.report.certificateSummary') }}</h4>
            <dl>
              <div><dt>CN</dt><dd>{{ validationResult.certificate.commonName || t('agents.common.none') }}</dd></div>
              <div><dt>SAN</dt><dd>{{ sanText }}</dd></div>
              <div><dt>{{ t('certificates.importForm.report.serialNumber') }}</dt><dd>{{ validationResult.certificate.serialNumber }}</dd></div>
              <div><dt>{{ t('certificates.importForm.report.validity') }}</dt><dd>{{ t('certificates.importForm.report.validityRange', { start: formatDateTime(validationResult.certificate.notBefore), end: formatDateTime(validationResult.certificate.notAfter) }) }}</dd></div>
              <div><dt>{{ t('certificates.importForm.report.issuer') }}</dt><dd>{{ issuerText }}</dd></div>
              <div><dt>{{ t('certificates.importForm.report.subject') }}</dt><dd>{{ subjectText }}</dd></div>
            </dl>
          </article>

          <article class="certificate-import-wizard__report-card">
            <h4>{{ t('certificates.importForm.report.chainValidation') }}</h4>
            <dl>
              <div><dt>{{ t('certificates.importForm.report.chainStatus') }}</dt><dd>{{ validationResult.chain.status }}</dd></div>
              <div><dt>{{ t('certificates.importForm.report.certificateCount') }}</dt><dd>{{ validationResult.chain.certificateCount }}</dd></div>
            </dl>
            <div v-if="chainCertificates.length" class="certificate-import-wizard__chain-list">
              <article v-for="item in chainCertificates" :key="item.fingerprintSha256" class="certificate-import-wizard__chain-item">
                <div class="certificate-import-wizard__chain-head">
                  <strong>{{ item.displayName }}</strong>
                  <span>{{ roleLabel(item.role) }}</span>
                </div>
                <p>{{ stringifyDn(item.subject) }}</p>
                <small>{{ t('certificates.importForm.report.issuerWithValue', { value: stringifyDn(item.issuer) }) }}</small>
              </article>
            </div>
            <ul v-if="validationResult.chain.diagnostics.length" class="certificate-import-wizard__list">
              <li v-for="item in validationResult.chain.diagnostics" :key="item">{{ item }}</li>
            </ul>
          </article>

          <article class="certificate-import-wizard__report-card">
            <h4>{{ t('certificates.importForm.report.privateKeyMatch') }}</h4>
            <dl>
              <div><dt>{{ t('certificates.importForm.report.provided') }}</dt><dd>{{ validationResult.privateKey.provided ? t('agents.common.yes') : t('agents.common.no') }}</dd></div>
              <div><dt>{{ t('certificates.importForm.report.matchResult') }}</dt><dd>{{ validationResult.privateKey.matched ? t('certificates.importForm.status.matched') : t('certificates.importForm.status.unmatched') }}</dd></div>
              <div><dt>{{ t('certificates.importForm.report.privateKeySource') }}</dt><dd>{{ validationResult.privateKey.source }}</dd></div>
            </dl>
          </article>
        </div>

        <article v-if="validationResult.blockers.length" class="certificate-import-wizard__messages certificate-import-wizard__messages--error">
          <h4>{{ t('certificates.importForm.report.blockers') }}</h4>
          <ul class="certificate-import-wizard__list">
            <li v-for="item in validationResult.blockers" :key="item">{{ item }}</li>
          </ul>
        </article>

        <article v-if="validationResult.warnings.length" class="certificate-import-wizard__messages certificate-import-wizard__messages--warning">
          <h4>{{ t('certificates.importForm.report.warnings') }}</h4>
          <ul class="certificate-import-wizard__list">
            <li v-for="item in validationResult.warnings" :key="item">{{ item }}</li>
          </ul>
        </article>
      </div>

      <p v-if="error" class="gc-form-error certificate-import-wizard__error">{{ error }}</p>
      <p v-if="resultId" class="gc-form-success certificate-import-wizard__success">{{ t('certificates.importForm.importSuccess', { id: resultId }) }}</p>
    </section>

    <footer class="gc-form-actions certificate-import-wizard__footer">
      <div class="certificate-import-wizard__footer-left">
        <button class="gc-button" type="button" :disabled="loading || validating" @click="cancelImport">{{ t('certificates.importForm.actions.cancel') }}</button>
      </div>
      <div class="certificate-import-wizard__footer-right">
        <button class="gc-button" type="button" :disabled="currentStep === 1 || loading || validating" @click="prevStep">{{ t('certificates.importForm.actions.previous') }}</button>
        <button
          v-if="currentStep < 3"
          class="gc-button"
          type="button"
          :disabled="currentStep === 1 ? !canGoToStepTwo : !canGoToStepThree"
          @click="nextStep"
        >
          {{ t('certificates.importForm.actions.next') }}
        </button>
        <button
          v-else
          class="gc-button gc-button--danger"
          type="button"
          :disabled="!canSubmit"
          @click="submitImport"
        >
          {{ loading ? t('certificates.importForm.actions.importing') : t('certificates.importForm.actions.import') }}
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
  border: 1px solid var(--gc-color-border-soft);
  border-radius: 999px;
  padding: 8px 12px;
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-soft);
  text-align: center;
  font-size: 12px;
  font-weight: 650;
}

.certificate-import-wizard__steps li.is-active,
.certificate-import-wizard__steps li.is-done {
  border-color: var(--gc-color-primary-border);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
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
  background: var(--gc-color-primary-soft);
  color: var(--gc-color-primary);
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
  border-color: var(--gc-color-primary-border);
  box-shadow: inset 0 0 0 1px var(--gc-color-primary-weak);
}

.certificate-import-wizard__card.is-disabled {
  opacity: .55;
  cursor: not-allowed;
}

.certificate-import-wizard__form,
.certificate-import-wizard__meta {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.certificate-import-wizard__field--full {
  grid-column: 1 / -1;
}

.certificate-import-wizard__field textarea {
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
  border: 1px solid var(--gc-color-border-subtle);
  border-radius: 14px;
  padding: 12px;
  background: var(--gc-color-surface-soft);
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
  color: var(--gc-color-success);
  background: var(--gc-color-success-soft);
}

.certificate-import-wizard__status.is-fail {
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-soft);
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
  background: var(--gc-color-danger-soft);
  color: var(--gc-color-danger);
}

.certificate-import-wizard__messages--warning {
  background: var(--gc-color-warning-soft);
  color: var(--gc-color-warning);
}

.certificate-import-wizard__list {
  margin: 0;
  padding-left: 18px;
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

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcButton, GcCard, GcSelectionCard, GcStatusTag } from '@/design-system/components'
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

type ImportSource = 'manual' | 'acme'
type FlowStep = 'source' | 'format' | 'materials' | 'review'
type FormStep = FlowStep | 'acme'

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
const currentStep = ref<FormStep>('source')
const selectedSource = ref<ImportSource | null>(null)
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
const canGoToMaterials = computed(() => Boolean(selectedFormat.value.supported))
const canGoToReview = computed(() => materialReady.value && !props.loading && !props.validating)
const canSubmit = computed(() => Boolean(props.validationResult?.importable) && !props.loading && !props.validating)
const flowSteps = computed(() => [
  { id: 'source' as const, label: t('certificates.importForm.steps.source') },
  { id: 'format' as const, label: t('certificates.importForm.steps.formatAndMethod') },
  { id: 'materials' as const, label: t('certificates.importForm.steps.materials') },
  { id: 'review' as const, label: t('certificates.importForm.steps.validateAndImport') },
])
const activeFlowStep = computed<FlowStep>(() => (
  currentStep.value === 'acme' ? 'source' : currentStep.value
))
const activeStepIndex = computed(() => (
  flowSteps.value.findIndex((step) => step.id === activeFlowStep.value)
))

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
    if (!result) return
    selectedSource.value = 'manual'
    currentStep.value = 'review'
  },
  { immediate: true },
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

function selectSource(source: ImportSource) {
  selectedSource.value = source
  currentStep.value = source === 'manual' ? 'format' : 'acme'
}

function isStepDone(step: FlowStep) {
  return flowSteps.value.findIndex((item) => item.id === step) < activeStepIndex.value
}

function nextStep() {
  if (currentStep.value === 'format' && canGoToMaterials.value) {
    currentStep.value = 'materials'
    return
  }
  if (currentStep.value === 'materials' && canGoToReview.value) {
    currentStep.value = 'review'
  }
}

function prevStep() {
  if (currentStep.value === 'materials') {
    currentStep.value = 'format'
    return
  }
  if (currentStep.value === 'review') {
    currentStep.value = 'materials'
    return
  }
  if (currentStep.value === 'format' || currentStep.value === 'acme') {
    currentStep.value = 'source'
  }
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
  return formatBrowserLocalTime(value) || t('agents.common.none')
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
      <li
        v-for="(step, index) in flowSteps"
        :key="step.id"
        :class="{ 'is-active': activeFlowStep === step.id, 'is-done': isStepDone(step.id) }"
        :aria-current="activeFlowStep === step.id ? 'step' : undefined"
      >
        {{ index + 1 }}. {{ step.label }}
      </li>
    </ol>

    <section v-if="currentStep === 'source'" class="certificate-import-wizard__panel certificate-import-wizard__panel--source">
      <header class="certificate-import-wizard__header">
        <div>
          <h2>{{ t('certificates.importForm.source.title') }}</h2>
          <p>{{ t('certificates.importForm.source.description') }}</p>
        </div>
      </header>

      <div class="certificate-import-wizard__source-cards">
        <GcSelectionCard
          class="certificate-import-wizard__source-card"
          :title="t('certificates.importForm.source.manual.title')"
          :description="t('certificates.importForm.source.manual.description')"
          :model-value="selectedSource === 'manual'"
          @select="selectSource('manual')"
        >
          <GcStatusTag
            status="RECOMMENDED"
            :label="t('certificates.importForm.source.manual.recommended')"
            tone="info"
          />
        </GcSelectionCard>

        <GcSelectionCard
          class="certificate-import-wizard__source-card"
          :title="t('certificates.importForm.source.acme.title')"
          :description="t('certificates.importForm.source.acme.description')"
          :model-value="selectedSource === 'acme'"
          @select="selectSource('acme')"
        >
          <GcStatusTag
            status="UNAVAILABLE"
            :label="t('certificates.importForm.source.acme.unavailable')"
            tone="muted"
          />
        </GcSelectionCard>
      </div>
    </section>

    <section v-else-if="currentStep === 'acme'" class="certificate-import-wizard__panel certificate-import-wizard__panel--acme">
      <header class="certificate-import-wizard__header">
        <div>
          <h2>{{ t('certificates.importForm.source.unavailable.title') }}</h2>
          <p>{{ t('certificates.importForm.source.acme.description') }}</p>
        </div>
      </header>

      <GcCard as="article" class="certificate-import-wizard__acme-card">
        <template #header>
          <GcStatusTag
            status="UNAVAILABLE"
            :label="t('certificates.importForm.source.acme.unavailable')"
            tone="muted"
          />
        </template>
        <p>{{ t('certificates.importForm.source.unavailable.description') }}</p>
      </GcCard>
    </section>

    <section v-else-if="currentStep === 'format'" class="certificate-import-wizard__panel">
      <header class="certificate-import-wizard__header">
        <div>
          <h2>{{ t('certificates.importForm.formatIntro.title') }}</h2>
          <p>{{ t('certificates.importForm.formatIntro.description') }}</p>
        </div>
      </header>

      <div class="certificate-import-wizard__choice-grid">
        <section class="certificate-import-wizard__choice-group">
          <span class="certificate-import-wizard__choice-label">{{ t('certificates.importForm.labels.importType') }}</span>
          <div class="certificate-import-wizard__cards">
            <GcSelectionCard
              v-for="format in certificateFormatOptions"
              :key="format.key"
              class="certificate-import-wizard__selection"
              :title="format.label"
              :description="format.hint"
              :model-value="draft.format === format.key"
              :disabled="!format.supported"
              @select="updateFormat(format.key)"
            >
              <GcStatusTag
                :status="format.supported ? 'SUPPORTED' : 'UNSUPPORTED'"
                :label="format.supported ? t('certificates.importForm.status.supported') : t('certificates.importForm.status.unsupported')"
                :tone="format.supported ? 'success' : 'muted'"
              />
            </GcSelectionCard>
          </div>
        </section>

        <section class="certificate-import-wizard__choice-group">
          <span class="certificate-import-wizard__choice-label">{{ t('certificates.importForm.labels.importMethod') }}</span>
          <div class="certificate-import-wizard__cards certificate-import-wizard__cards--compact">
            <GcSelectionCard
              v-for="method in importMethodOptions"
              :key="method.key"
              class="certificate-import-wizard__selection"
              :title="method.label"
              :description="draft.format === 'PFX' && method.key !== 'file' ? t('certificates.importForm.hints.pfxFileOnly') : method.hint"
              :model-value="effectiveMethod === method.key"
              :disabled="draft.format === 'PFX' && method.key !== 'file'"
              @select="updateMethod(method.key)"
            >
              <GcStatusTag
                :status="draft.format === 'PFX' && method.key !== 'file' ? 'UNSUPPORTED' : 'READY'"
                :label="draft.format === 'PFX' && method.key !== 'file' ? t('certificates.importForm.status.unsupported') : t('certificates.importForm.status.supported')"
                :tone="draft.format === 'PFX' && method.key !== 'file' ? 'muted' : 'info'"
              />
            </GcSelectionCard>
          </div>
        </section>
      </div>
    </section>

    <GcCard v-else-if="currentStep === 'materials'" as="section" class="certificate-import-wizard__material-card">
      <template #header>
        <div class="certificate-import-wizard__header">
          <h2>{{ methodSpecificTitle }}</h2>
          <p>{{ chainCheckHint }}</p>
        </div>
      </template>

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
    </GcCard>

    <section v-else-if="currentStep === 'review'" class="certificate-import-wizard__panel certificate-import-wizard__panel--validation">
      <header class="certificate-import-wizard__header">
        <div>
          <h2>{{ t('certificates.importForm.validation.title') }}</h2>
          <p>{{ t('certificates.importForm.validation.description') }}</p>
        </div>
      </header>

      <dl class="certificate-import-wizard__summary">
        <div>
          <dt>{{ t('certificates.importForm.labels.importType') }}</dt>
          <dd>{{ selectedFormat.label }}</dd>
        </div>
        <div>
          <dt>{{ t('certificates.importForm.labels.importMethod') }}</dt>
          <dd>{{ selectedMethod.label }}</dd>
        </div>
        <div>
          <dt>{{ t('certificates.importForm.labels.materialStatus') }}</dt>
          <dd>
            <GcStatusTag
              :status="materialReady ? 'COMPLETED' : 'INCOMPLETE'"
              :label="materialReady ? t('certificates.importForm.status.completed') : t('certificates.importForm.status.incomplete')"
              :tone="materialReady ? 'success' : 'warning'"
            />
          </dd>
        </div>
      </dl>

      <div class="certificate-import-wizard__validate-actions">
        <GcButton variant="primary" :disabled="!materialReady || validating || loading" :loading="validating" @click="submitValidation">
          {{ validating ? t('certificates.importForm.actions.validating') : t('certificates.importForm.actions.validate') }}
        </GcButton>
      </div>

      <div v-if="validationResult" class="certificate-import-wizard__report">
        <div class="certificate-import-wizard__status">
          <GcStatusTag
            :status="validationResult.importable ? 'SUCCESS' : 'FAILED'"
            :label="validationResult.importable ? t('certificates.importForm.validation.passed') : t('certificates.importForm.validation.failed')"
            :tone="validationResult.importable ? 'success' : 'danger'"
          />
        </div>

        <div class="certificate-import-wizard__report-grid">
          <GcCard as="article" class="certificate-import-wizard__report-card">
            <template #header><h3>{{ t('certificates.importForm.report.certificateSummary') }}</h3></template>
            <dl>
              <div><dt>{{ t('certificates.detailPanel.fields.commonName') }}</dt><dd>{{ validationResult.certificate.commonName || t('agents.common.none') }}</dd></div>
              <div><dt>{{ t('certificates.detailPanel.fields.san') }}</dt><dd>{{ sanText }}</dd></div>
              <div><dt>{{ t('certificates.importForm.report.serialNumber') }}</dt><dd>{{ validationResult.certificate.serialNumber }}</dd></div>
              <div><dt>{{ t('certificates.importForm.report.validity') }}</dt><dd>{{ t('certificates.importForm.report.validityRange', { start: formatDateTime(validationResult.certificate.notBefore), end: formatDateTime(validationResult.certificate.notAfter) }) }}</dd></div>
              <div><dt>{{ t('certificates.importForm.report.issuer') }}</dt><dd>{{ issuerText }}</dd></div>
              <div><dt>{{ t('certificates.importForm.report.subject') }}</dt><dd>{{ subjectText }}</dd></div>
            </dl>
          </GcCard>

          <GcCard as="article" class="certificate-import-wizard__report-card">
            <template #header><h3>{{ t('certificates.importForm.report.chainValidation') }}</h3></template>
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
          </GcCard>

          <GcCard as="article" class="certificate-import-wizard__report-card">
            <template #header><h3>{{ t('certificates.importForm.report.privateKeyMatch') }}</h3></template>
            <dl>
              <div><dt>{{ t('certificates.importForm.report.provided') }}</dt><dd>{{ validationResult.privateKey.provided ? t('agents.common.yes') : t('agents.common.no') }}</dd></div>
              <div>
                <dt>{{ t('certificates.importForm.report.matchResult') }}</dt>
                <dd>
                  <GcStatusTag
                    :status="validationResult.privateKey.matched ? 'MATCHED' : 'UNMATCHED'"
                    :label="validationResult.privateKey.matched ? t('certificates.importForm.status.matched') : t('certificates.importForm.status.unmatched')"
                    :tone="validationResult.privateKey.matched ? 'success' : 'danger'"
                  />
                </dd>
              </div>
              <div><dt>{{ t('certificates.importForm.report.privateKeySource') }}</dt><dd>{{ validationResult.privateKey.source }}</dd></div>
            </dl>
          </GcCard>
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
        <GcButton variant="ghost" :disabled="loading || validating" @click="cancelImport">
          {{ t('certificates.importForm.actions.cancel') }}
        </GcButton>
      </div>
      <div v-if="currentStep !== 'source'" class="certificate-import-wizard__footer-right">
        <GcButton variant="secondary" :disabled="loading || validating" @click="prevStep">
          {{ t('certificates.importForm.actions.previous') }}
        </GcButton>
        <GcButton
          v-if="currentStep === 'format' || currentStep === 'materials'"
          variant="primary"
          :disabled="currentStep === 'format' ? !canGoToMaterials : !canGoToReview"
          @click="nextStep"
        >
          {{ t('certificates.importForm.actions.next') }}
        </GcButton>
        <GcButton
          v-else-if="currentStep === 'review'"
          variant="primary"
          :disabled="!canSubmit"
          :loading="loading"
          @click="submitImport"
        >
          {{ loading ? t('certificates.importForm.actions.importing') : t('certificates.importForm.actions.import') }}
        </GcButton>
      </div>
    </footer>
  </section>
</template>

<style scoped>
:global(.gc-modal:has(.certificate-import-wizard)) {
  --gc-modal-width: var(--gc-size-modal-default);
}

.certificate-import-wizard {
  display: grid;
  gap: var(--gc-space-5);
  min-width: 0;
}

.certificate-import-wizard__steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--gc-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.certificate-import-wizard__steps li {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--gc-control-height-sm);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-pill);
  padding: var(--gc-space-2) var(--gc-space-3);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-subtle);
  text-align: center;
  font-size: var(--gc-font-size-sm);
  font-weight: var(--gc-font-weight-semibold);
  line-height: var(--gc-line-height-tight);
}

.certificate-import-wizard__steps li.is-active,
.certificate-import-wizard__steps li.is-done {
  border-color: var(--gc-color-primary);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
}

.certificate-import-wizard__panel,
.certificate-import-wizard__choice-grid,
.certificate-import-wizard__choice-group,
.certificate-import-wizard__cards,
.certificate-import-wizard__source-cards,
.certificate-import-wizard__form,
.certificate-import-wizard__meta,
.certificate-import-wizard__report,
.certificate-import-wizard__chain-list {
  display: grid;
  gap: var(--gc-space-4);
}

.certificate-import-wizard__header {
  display: grid;
  gap: var(--gc-space-1);
  padding-bottom: var(--gc-space-3);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
}

.certificate-import-wizard__header h2,
.certificate-import-wizard__header p,
.certificate-import-wizard__report-card h3,
.certificate-import-wizard__messages h4 {
  margin: 0;
}

.certificate-import-wizard__header p,
.certificate-import-wizard__choice-label,
.certificate-import-wizard__report-card dt,
.certificate-import-wizard__messages h4 {
  color: var(--gc-color-text-muted);
}

.certificate-import-wizard__header h2 {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-lg);
  line-height: var(--gc-line-height-tight);
}

.certificate-import-wizard__header p {
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.certificate-import-wizard__choice-label {
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
}

.certificate-import-wizard__cards {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
}

.certificate-import-wizard__cards--compact {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
}

.certificate-import-wizard__source-card :deep(.gc-selection-card__extra) {
  display: inline-flex;
}

.certificate-import-wizard__acme-card :deep(.gc-pro-card__body) {
  display: grid;
  gap: var(--gc-space-3);
}

.certificate-import-wizard__acme-card p {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.certificate-import-wizard__selection :deep(.gc-selection-card__extra) {
  display: inline-flex;
}

.certificate-import-wizard__material-card :deep(.gc-pro-card__body) {
  display: grid;
}

.certificate-import-wizard__form,
.certificate-import-wizard__meta {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.certificate-import-wizard__field--full {
  grid-column: 1 / -1;
}

.certificate-import-wizard__field textarea {
  font-family: var(--gc-font-family-mono);
  font-size: var(--gc-font-size-sm);
}

.certificate-import-wizard__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-4);
}

.certificate-import-wizard__report-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--gc-space-4);
}

.certificate-import-wizard__summary {
  margin: 0;
}

.certificate-import-wizard__summary div {
  display: grid;
  gap: var(--gc-space-2);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-subtle);
}

.certificate-import-wizard__summary dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
}

.certificate-import-wizard__summary dd,
.certificate-import-wizard__report-card dd {
  margin: 0;
  color: var(--gc-color-text);
  overflow-wrap: anywhere;
}

.certificate-import-wizard__summary dd {
  font-size: var(--gc-font-size-sm);
  font-weight: var(--gc-font-weight-semibold);
}

.certificate-import-wizard__status {
  display: grid;
  justify-items: start;
}

.certificate-import-wizard__report-card :deep(.gc-pro-card__body) {
  display: grid;
  gap: var(--gc-space-3);
}

.certificate-import-wizard__report-card h3 {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-md);
  line-height: var(--gc-line-height-tight);
}

.certificate-import-wizard__report-card dl {
  display: grid;
  gap: var(--gc-space-3);
  margin: 0;
}

.certificate-import-wizard__report-card dl div {
  display: grid;
  gap: var(--gc-space-1);
}

.certificate-import-wizard__report-card dt {
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
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
  gap: var(--gc-space-3);
}

.certificate-import-wizard__chain-item {
  display: grid;
  gap: var(--gc-space-2);
  padding-top: var(--gc-space-3);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.certificate-import-wizard__chain-head strong {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
}

.certificate-import-wizard__chain-head span,
.certificate-import-wizard__chain-item p,
.certificate-import-wizard__chain-item small {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  line-height: var(--gc-line-height-relaxed);
}

.certificate-import-wizard__messages {
  display: grid;
  gap: var(--gc-space-2);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  padding: var(--gc-space-4);
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
  padding-left: var(--gc-space-5);
}

.certificate-import-wizard__footer-left,
.certificate-import-wizard__footer-right {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
}

.certificate-import-wizard__validate-actions {
  display: flex;
  justify-content: flex-start;
}

@media (max-width: 60rem) {
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

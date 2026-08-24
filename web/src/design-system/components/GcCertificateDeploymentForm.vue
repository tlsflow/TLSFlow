<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiRecord } from '@/api/modules/common'
import { sortDeployableCertificateVersions } from '@/views/deployments/certificate-version-selection'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import GcDryRunChecklist from './GcDryRunChecklist.vue'

const props = withDefaults(defineProps<{
  applicationAsset: ApiRecord | null
  siteName?: string
  certificate: ApiRecord | null
  certificateVersions: readonly ApiRecord[]
  preflightChecks?: readonly ApiRecord[]
  loading?: boolean
  submitLabel?: string
}>(), {
  siteName: '',
  preflightChecks: () => [],
  loading: false,
  submitLabel: '',
})

type CertificateVersionSelectionMode = 'EXPLICIT' | 'LATEST_AUTO'

const emit = defineEmits<{
  submit: [selection: { selectionMode: CertificateVersionSelectionMode; certificateVersionId: string }]
  cancel: []
}>()

const { t } = useI18n()
const LATEST_VERSION_MARKER = '__LATEST__'
const selectedVersionId = ref('')

const sortedVersions = computed(() => sortDeployableCertificateVersions(props.certificateVersions))
const latestVersion = computed(() => sortedVersions.value[0] ?? null)
const selectedVersion = computed(() => selectedVersionId.value === LATEST_VERSION_MARKER
  ? latestVersion.value
  : sortedVersions.value.find((item) => versionId(item) === selectedVersionId.value) ?? null)
const canSubmit = computed(() => Boolean(selectedVersionId.value)
  && (selectedVersionId.value !== LATEST_VERSION_MARKER || Boolean(versionId(latestVersion.value)))
  && !props.loading)

watch(sortedVersions, (items) => {
  if (selectedVersionId.value === LATEST_VERSION_MARKER) {
    if (items.length > 0) return
    selectedVersionId.value = ''
    return
  }
  if (selectedVersionId.value && items.some((item) => versionId(item) === selectedVersionId.value)) return
  selectedVersionId.value = items.length > 0 ? LATEST_VERSION_MARKER : ''
}, { immediate: true })

function submit(): void {
  if (!canSubmit.value) return
  const followsLatest = selectedVersionId.value === LATEST_VERSION_MARKER
  emit('submit', {
    selectionMode: followsLatest ? 'LATEST_AUTO' : 'EXPLICIT',
    certificateVersionId: followsLatest ? versionId(latestVersion.value) : selectedVersionId.value,
  })
}

function versionId(item: ApiRecord | null | undefined): string {
  return readString(item, ['id', 'certificateVersionId'])
}

function versionLabel(item: ApiRecord): string {
  const id = versionId(item) || t('designSystem.deploymentWizard.fallback.unnamedVersion')
  const notBefore = formatDate(readString(item, ['notBefore', 'validFrom', 'issuedAt']))
  const notAfter = formatDate(readString(item, ['notAfter', 'validTo', 'expiresAt']))
  if (!notBefore && !notAfter) return id
  return t('designSystem.deploymentWizard.version.range', {
    id,
    notBefore: notBefore || t('designSystem.deploymentWizard.fallback.unknownStart'),
    notAfter: notAfter || t('designSystem.deploymentWizard.fallback.unknownEnd'),
  })
}

function applicationLabel(): string {
  return readString(props.applicationAsset, ['displayName', 'name', 'address', 'domainName', 'id'])
    || t('designSystem.deploymentWizard.fallback.unselected')
}

function applicationAddress(): string {
  const address = readString(props.applicationAsset, ['address', 'domainName', 'verifyUrl'])
  const port = readString(props.applicationAsset, ['port'])
  const protocol = readString(props.applicationAsset, ['protocol']).toLowerCase()
  if (!address) return ''
  const defaultPort = protocol === 'https' ? '443' : protocol === 'http' ? '80' : ''
  return `${protocol ? `${protocol}://` : ''}${address}${port && port !== defaultPort ? `:${port}` : ''}`
}

function certificateLabel(): string {
  return readString(props.certificate, ['primaryDomain', 'commonName', 'name', 'displayName', 'id'])
    || t('designSystem.deploymentWizard.fallback.unselected')
}

function formatDate(value: string): string {
  if (!value) return ''
  return formatBrowserLocalTime(value, { includeTime: false }) || value
}

function readString(record: ApiRecord | null | undefined, candidates: readonly string[], fallback = ''): string {
  for (const candidate of candidates) {
    const value = candidate.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') return undefined
      return (current as Record<string, unknown>)[segment]
    }, record)
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }
  return fallback
}
</script>

<template>
  <form class="gc-certificate-deployment-form" :aria-label="t('assets.deployment.dialogTitle')" @submit.prevent="submit">
    <div class="gc-certificate-deployment-form__context">
      <div>
        <span class="gc-certificate-deployment-form__eyebrow">{{ t('assets.deployment.targetLocked') }}</span>
        <p>{{ applicationLabel() }}</p>
      </div>
      <span class="gc-certificate-deployment-form__ready" :class="{ 'is-loading': loading }">
        {{ loading ? t('common.loading') : t('designSystem.deploymentWizard.panelState.operable') }}
      </span>
    </div>

    <section class="gc-certificate-deployment-form__section">
      <div class="gc-certificate-deployment-form__section-heading">
        <div>
          <span class="gc-certificate-deployment-form__section-kicker">{{ t('assets.resourceName') }}</span>
          <h3>{{ t('assets.deployment.dialogTitle') }}</h3>
        </div>
        <span class="gc-certificate-deployment-form__section-mark">1</span>
      </div>

      <dl class="gc-certificate-deployment-form__summary">
        <div>
          <dt>{{ t('assets.fields.displayName') }}</dt>
          <dd>{{ applicationLabel() }}</dd>
          <small v-if="applicationAddress()">{{ applicationAddress() }}</small>
        </div>
        <div>
          <dt>{{ t('assets.fields.siteName') }}</dt>
          <dd>{{ siteName || t('designSystem.deploymentWizard.fallback.unnamedSite') }}</dd>
        </div>
        <div>
          <dt>{{ t('assets.fields.currentCertificate') }}</dt>
          <dd>{{ certificateLabel() }}</dd>
        </div>
      </dl>
    </section>

    <section class="gc-certificate-deployment-form__section gc-certificate-deployment-form__section--version">
      <label class="gc-certificate-deployment-form__field">
        <span>{{ t('designSystem.deploymentWizard.fields.certificateVersion') }}</span>
        <select v-model="selectedVersionId" :disabled="loading || sortedVersions.length === 0">
          <option v-if="sortedVersions.length === 0" value="">{{ t('designSystem.deploymentWizard.version.noDeployableVersion') }}</option>
          <option v-if="latestVersion" :value="LATEST_VERSION_MARKER">
            {{ t('assets.deployment.latestVersionPointer') }}
          </option>
          <option v-for="version in sortedVersions" :key="versionId(version)" :value="versionId(version)">
            {{ versionLabel(version) }}
          </option>
        </select>
      </label>
      <p class="gc-certificate-deployment-form__hint">
        {{ selectedVersion ? versionLabel(selectedVersion) : t('designSystem.deploymentWizard.version.noDeployableVersion') }}
      </p>
    </section>

    <section v-if="preflightChecks.length > 0" class="gc-certificate-deployment-form__section">
      <GcDryRunChecklist :items="preflightChecks" embedded />
    </section>

    <footer class="gc-certificate-deployment-form__footer">
      <button class="gc-button" type="button" :disabled="loading" @click="emit('cancel')">
        {{ t('designSystem.deploymentWizard.actions.cancel') }}
      </button>
      <button class="gc-button gc-button--primary" type="submit" :disabled="!canSubmit">
        {{ loading ? t('assets.actions.creating') : (submitLabel || t('assets.deployment.deployThisVersion')) }}
      </button>
    </footer>
  </form>
</template>

<style scoped>
.gc-certificate-deployment-form {
  display: grid;
  gap: var(--gc-space-4);
}

.gc-certificate-deployment-form__context {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-4);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-primary-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-primary-soft);
}

.gc-certificate-deployment-form__eyebrow,
.gc-certificate-deployment-form__section-kicker,
.gc-certificate-deployment-form__field > span {
  display: block;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-caption);
  font-weight: var(--gc-font-weight-semibold);
  text-transform: uppercase;
}

.gc-certificate-deployment-form__context p {
  max-width: var(--gc-size-content-readable);
  margin: var(--gc-space-2) 0 0;
  color: var(--gc-color-text-secondary);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.gc-certificate-deployment-form__ready {
  flex: 0 0 auto;
  padding: var(--gc-space-2) var(--gc-space-3);
  border-radius: var(--gc-radius-pill);
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
}

.gc-certificate-deployment-form__ready.is-loading {
  color: var(--gc-color-info);
  background: var(--gc-color-info-bg);
}

.gc-certificate-deployment-form__section {
  display: grid;
  gap: var(--gc-space-4);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-solid);
}

.gc-certificate-deployment-form__section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-3);
  padding-bottom: var(--gc-space-3);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.gc-certificate-deployment-form__section-heading h3 {
  margin: var(--gc-space-2) 0 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-heading-xs);
  line-height: var(--gc-line-height-tight);
}

.gc-certificate-deployment-form__section-mark {
  display: grid;
  place-items: center;
  width: var(--gc-size-step-index);
  aspect-ratio: 1;
  border-radius: var(--gc-radius-circle);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-bg);
  font-weight: var(--gc-font-weight-semibold);
}

.gc-certificate-deployment-form__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}

.gc-certificate-deployment-form__summary > div {
  min-width: 0;
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-field);
}

.gc-certificate-deployment-form__summary dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.gc-certificate-deployment-form__summary dd {
  margin: var(--gc-space-2) 0 0;
  overflow-wrap: anywhere;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
  font-weight: var(--gc-font-weight-semibold);
}

.gc-certificate-deployment-form__summary small {
  display: block;
  margin-top: var(--gc-space-1);
  overflow-wrap: anywhere;
  color: var(--gc-color-text-secondary);
  font-size: var(--gc-font-size-xs);
}

.gc-certificate-deployment-form__section--version {
  grid-template-columns: minmax(0, 1fr);
}

.gc-certificate-deployment-form__field {
  display: grid;
  gap: var(--gc-space-2);
}

.gc-certificate-deployment-form__field select {
  width: 100%;
  min-height: var(--gc-control-height-comfortable);
  padding: 0 var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-primary-border);
  border-radius: var(--gc-radius-control);
  color: var(--gc-color-text-strong);
  background: var(--gc-color-surface-field);
  font: inherit;
}

.gc-certificate-deployment-form__field select:focus {
  border-color: var(--gc-color-primary);
  outline: none;
  box-shadow: var(--gc-shadow-focus);
}

.gc-certificate-deployment-form__hint {
  margin: 0;
  color: var(--gc-color-text-secondary);
  font-size: var(--gc-font-size-xs);
  line-height: var(--gc-line-height-relaxed);
}

.gc-certificate-deployment-form__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--gc-space-3);
  padding-top: var(--gc-space-1);
}

@media (max-width: 40rem) {
  .gc-certificate-deployment-form__context {
    flex-direction: column;
  }

  .gc-certificate-deployment-form__summary {
    grid-template-columns: minmax(0, 1fr);
  }

  .gc-certificate-deployment-form__footer {
    flex-direction: column-reverse;
  }

  .gc-certificate-deployment-form__footer .gc-button {
    width: 100%;
  }
}
</style>

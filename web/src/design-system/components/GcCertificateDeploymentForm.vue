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
  certificateAssetId?: string
  certificateVersions: readonly ApiRecord[]
  supplyMode?: 'manual' | 'dedicated'
  dedicatedDetails?: {
    providerType?: 'acme' | 'internal_ca' | string
    providerName?: string
    providerStatus?: string
    custodyMode?: string
    hasCertificate?: boolean
    issuedAt?: string
    expiresAt?: string
    remainingDays?: number | null
    certificateVersionId?: string
    issuanceStatus?: string
    issuanceFailureCode?: string
    issuanceFailureMessage?: string
  } | null
  preflightChecks?: readonly ApiRecord[]
  loading?: boolean
  submitLabel?: string
}>(), {
  siteName: '',
  certificateAssetId: '',
  supplyMode: 'manual',
  dedicatedDetails: null,
  preflightChecks: () => [],
  loading: false,
  submitLabel: '',
})

type CertificateVersionSelectionMode = 'EXPLICIT' | 'LATEST_AUTO'

const emit = defineEmits<{
  submit: [selection: { certificateAssetId: string; selectionMode: CertificateVersionSelectionMode; certificateVersionId: string; reapply?: boolean }]
  cancel: []
}>()

const { t } = useI18n()
const LATEST_VERSION_MARKER = '__LATEST__'
const selectedVersionId = ref('')
const reapplyDedicatedCertificate = ref(false)

const isDedicated = computed(() => props.supplyMode === 'dedicated')

const selectedCertificateAssetId = computed(() => String(props.certificateAssetId ?? '').trim())
const selectedCertificateVersions = computed(() => sortDeployableCertificateVersions(
  props.certificateVersions.filter((item) => certificateAssetId(item) === selectedCertificateAssetId.value),
))
const latestVersion = computed(() => selectedCertificateVersions.value[0] ?? null)
const selectedVersion = computed(() => selectedVersionId.value === LATEST_VERSION_MARKER
  ? latestVersion.value
  : selectedCertificateVersions.value.find((item) => versionId(item) === selectedVersionId.value) ?? null)
const dedicatedVersionId = computed(() => String(props.dedicatedDetails?.certificateVersionId ?? '').trim())
const issuanceFailed = computed(() => ['issue_failed', 'rejected', 'cancelled'].includes(
  String(props.dedicatedDetails?.issuanceStatus ?? '').trim().toLowerCase(),
))
const canSubmit = computed(() => {
  if (isDedicated.value) {
    return !props.loading && (reapplyDedicatedCertificate.value || (!issuanceFailed.value && Boolean(dedicatedVersionId.value)))
  }
  return Boolean(selectedCertificateAssetId.value && selectedVersionId.value)
    && (selectedVersionId.value !== LATEST_VERSION_MARKER || Boolean(versionId(latestVersion.value)))
    && !props.loading
})

watch(selectedCertificateAssetId, () => {
  selectedVersionId.value = selectedCertificateVersions.value.length > 0 ? LATEST_VERSION_MARKER : ''
}, { immediate: true })

watch(selectedCertificateVersions, (items) => {
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
  if (isDedicated.value) {
    emit('submit', {
      certificateAssetId: selectedCertificateAssetId.value,
      selectionMode: 'EXPLICIT',
      certificateVersionId: dedicatedVersionId.value,
      ...(reapplyDedicatedCertificate.value ? { reapply: true } : {}),
    })
    return
  }
  const followsLatest = selectedVersionId.value === LATEST_VERSION_MARKER
  emit('submit', {
    certificateAssetId: selectedCertificateAssetId.value,
    selectionMode: followsLatest ? 'LATEST_AUTO' : 'EXPLICIT',
    certificateVersionId: followsLatest ? versionId(latestVersion.value) : selectedVersionId.value,
  })
}

function certificateAssetId(item: ApiRecord | null | undefined): string {
  return readString(item, ['certificateAssetId', 'certificateId', 'id'])
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
  return formatBrowserLocalTime(value, { includeTime: false })
}

function providerTypeLabel(value: string | undefined): string {
  return value === 'acme'
    ? t('assets.deployment.dedicated.providerTypes.acme')
    : t('assets.deployment.dedicated.providerTypes.internalCa')
}

function statusLabel(value: string | undefined): string {
  const status = String(value ?? '').trim().toLowerCase()
  if (status === 'active' || status === 'ready' || status === 'healthy') return t('assets.deployment.dedicated.status.available')
  if (status === 'disabled' || status === 'inactive' || status === 'error') return t('assets.deployment.dedicated.status.unavailable')
  return t('assets.deployment.dedicated.status.unknown')
}

function custodyModeLabel(value: string | undefined): string {
  const mode = String(value ?? '').trim().toLowerCase()
  if (mode === 'agent_local' || mode === 'local_agent') return t('assets.deployment.dedicated.custody.agentLocal')
  if (mode === 'device_local') return t('internalCa.custodyModes.deviceLocal')
  if (mode === 'managed_secret') return t('assets.deployment.dedicated.custody.managedSecret')
  return value || t('common.notAvailable')
}

function certificatePresenceLabel(value: boolean | undefined): string {
  if (issuanceFailed.value) return t('assets.deployment.dedicated.certificate.failed')
  return value ? t('assets.deployment.dedicated.certificate.exists') : t('assets.deployment.dedicated.certificate.missing')
}

function issuanceFailureText(): string {
  const message = String(props.dedicatedDetails?.issuanceFailureMessage ?? '').trim()
  const code = String(props.dedicatedDetails?.issuanceFailureCode ?? '').trim()
  if (message && code) return t('assets.deployment.dedicated.issuanceFailedWithCode', { message, code })
  return message || code || t('assets.deployment.dedicated.issuanceFailed')
}

function remainingDaysLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return t('common.notAvailable')
  return t('assets.deployment.dedicated.remainingDays', { days: Number(value) })
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
      <span class="gc-certificate-deployment-form__ready" :class="{ 'is-loading': loading, 'is-failed': issuanceFailed }">
        {{ loading ? t('common.loading') : issuanceFailed ? t('assets.deployment.dedicated.certificate.failed') : t('designSystem.deploymentWizard.panelState.operable') }}
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

    <section v-if="!isDedicated" class="gc-certificate-deployment-form__section gc-certificate-deployment-form__section--version">
      <label class="gc-certificate-deployment-form__field">
        <span>{{ t('designSystem.deploymentWizard.fields.certificateVersion') }}</span>
        <select v-model="selectedVersionId" :disabled="loading || selectedCertificateVersions.length === 0">
          <option v-if="selectedCertificateVersions.length === 0" value="">{{ t('designSystem.deploymentWizard.version.noDeployableVersion') }}</option>
          <option v-if="latestVersion" :value="LATEST_VERSION_MARKER">
            {{ t('assets.deployment.latestVersionPointer') }}
          </option>
          <option v-for="version in selectedCertificateVersions" :key="versionId(version)" :value="versionId(version)">
            {{ versionLabel(version) }}
          </option>
        </select>
      </label>
      <p class="gc-certificate-deployment-form__hint">
        {{ selectedVersion ? versionLabel(selectedVersion) : t('designSystem.deploymentWizard.version.noDeployableVersion') }}
      </p>
    </section>

    <section v-else class="gc-certificate-deployment-form__section gc-certificate-deployment-form__section--dedicated">
      <div class="gc-certificate-deployment-form__section-heading">
        <div>
          <span class="gc-certificate-deployment-form__section-kicker">{{ t('assets.deployment.dedicated.kicker') }}</span>
          <h3>{{ t('assets.deployment.dedicated.title') }}</h3>
        </div>
        <span class="gc-certificate-deployment-form__section-mark">2</span>
      </div>

      <dl class="gc-certificate-deployment-form__details">
        <div>
          <dt>{{ t('assets.deployment.dedicated.fields.providerType') }}</dt>
          <dd>{{ providerTypeLabel(dedicatedDetails?.providerType) }}</dd>
        </div>
        <template v-if="dedicatedDetails?.providerType === 'internal_ca'">
          <div>
            <dt>{{ t('assets.deployment.dedicated.fields.ca') }}</dt>
            <dd>{{ dedicatedDetails?.providerName || t('common.notAvailable') }}</dd>
          </div>
          <div>
            <dt>{{ t('assets.deployment.dedicated.fields.caStatus') }}</dt>
            <dd>{{ statusLabel(dedicatedDetails?.providerStatus) }}</dd>
          </div>
          <div>
            <dt>{{ t('assets.deployment.dedicated.fields.custodyMode') }}</dt>
            <dd>{{ custodyModeLabel(dedicatedDetails?.custodyMode) }}</dd>
          </div>
        </template>
        <div>
          <dt>{{ t('assets.deployment.dedicated.fields.certificate') }}</dt>
          <dd>{{ certificatePresenceLabel(dedicatedDetails?.hasCertificate) }}</dd>
        </div>
        <div>
          <dt>{{ t('assets.deployment.dedicated.fields.issuedAt') }}</dt>
          <dd>{{ formatDate(dedicatedDetails?.issuedAt ?? '') || t('common.notAvailable') }}</dd>
        </div>
        <div>
          <dt>{{ t('assets.deployment.dedicated.fields.expiresAt') }}</dt>
          <dd>{{ formatDate(dedicatedDetails?.expiresAt ?? '') || t('common.notAvailable') }}</dd>
        </div>
        <div>
          <dt>{{ t('assets.deployment.dedicated.fields.remainingDays') }}</dt>
          <dd>{{ remainingDaysLabel(dedicatedDetails?.remainingDays) }}</dd>
        </div>
      </dl>

      <label class="gc-certificate-deployment-form__checkbox">
        <input v-model="reapplyDedicatedCertificate" type="checkbox" :disabled="loading">
        <span>{{ t('assets.deployment.dedicated.reapply') }}</span>
      </label>
      <p class="gc-certificate-deployment-form__hint" :class="{ 'is-failed': issuanceFailed }">
        {{ issuanceFailed ? issuanceFailureText() : t('assets.deployment.dedicated.reapplyHint') }}
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
        {{ loading ? t('assets.actions.creating') : (isDedicated && reapplyDedicatedCertificate ? t('assets.deployment.dedicated.reapply') : (submitLabel || t('assets.deployment.deployThisVersion'))) }}
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

.gc-certificate-deployment-form__ready.is-failed {
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
}

.gc-certificate-deployment-form__hint.is-failed {
  color: var(--gc-color-danger);
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

.gc-certificate-deployment-form__details {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--gc-space-2);
  margin: 0;
}

.gc-certificate-deployment-form__details > div {
  min-width: 0;
  padding: var(--gc-space-2) var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-field);
}

.gc-certificate-deployment-form__details dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.gc-certificate-deployment-form__details dd {
  margin: var(--gc-space-1) 0 0;
  overflow-wrap: anywhere;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
  font-weight: var(--gc-font-weight-semibold);
}

.gc-certificate-deployment-form__section--dedicated {
  gap: var(--gc-space-3);
  padding: var(--gc-space-3);
}

.gc-certificate-deployment-form__section--dedicated .gc-certificate-deployment-form__section-heading {
  padding-bottom: var(--gc-space-2);
}

.gc-certificate-deployment-form__checkbox {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
  font-weight: var(--gc-font-weight-semibold);
}

.gc-certificate-deployment-form__checkbox input {
  width: var(--gc-size-icon-sm);
  height: var(--gc-size-icon-sm);
  accent-color: var(--gc-color-primary);
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

  .gc-certificate-deployment-form__details {
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

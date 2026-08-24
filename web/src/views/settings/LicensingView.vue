<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcModal } from '@/design-system/components'
import { ApiClientError } from '@/api/client'
import { productBrand } from '@/brand/product-brand'
import {
  createActivationRequest,
  getLicensingStatus,
  importActivationResponse,
  importLicense,
  type ActivationResponse,
  type LicenseStatus
} from '@/api/modules/licensing.api'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

const { t, locale } = useI18n()
const status = ref<LicenseStatus | null>(null)
const licenseFileInput = ref<HTMLInputElement | null>(null)
const licenseText = ref('')
const loading = ref(false)
const importing = ref(false)
const upgradeModalOpen = ref(false)
const message = ref('')
const errorMessage = ref('')

type ProductPlanCode = 'none' | 'community' | 'commercial' | 'enterprise' | 'trial'
type ComparisonPlanCode = 'community' | 'commercial' | 'enterprise'
type PlanTone = 'none' | 'community' | 'commercial' | 'enterprise'

interface ComparisonCard {
  code: ComparisonPlanCode
  title: string
  summary: string
  features: string[]
  price: string
  current: boolean
  recommended: boolean
}

const comparisonFeatureKeys: Record<ComparisonPlanCode, string[]> = {
  community: ['full', 'usage', 'automation', 'quota', 'support'],
  commercial: ['full', 'usage', 'automation', 'quota', 'support'],
  enterprise: ['full', 'usage', 'automation', 'approval', 'quota', 'customization', 'support'],
}

const displayedFeatureKeys = [
  'certificateManagementAutomation',
  'internalExternalCaManagement',
  'generalAssetManagement',
  'certificateAutomatedDeployment',
  'workflowEditor',
  'certificateApplicationMonitoring',
  'privateDeployment',
  'pluginExtension',
] as const

// 试用申请地址尚未接入，暂时打开占位页面。
const trialApplicationUrl = 'about:blank'

const stateLabel = computed(() => {
  if (!status.value) return t('common.notAvailable')
  return t(`settings.licensing.states.${status.value.state}`)
})

const stateClass = computed(() => `licensing-page__state licensing-page__state--${status.value?.state ?? 'none'}`)

const planLabel = computed(() => {
  if (!status.value?.planCode) return t('settings.licensing.summary.unconfigured')
  const key = `settings.licensing.plans.${status.value.planCode}`
  const localized = t(key)
  return localized === key ? status.value.planCode : localized
})

const userNameLabel = computed(() => {
  const userName = status.value?.userName?.trim()
  return userName || t('settings.licensing.summary.userNameUnset')
})

const userNameSummary = computed(() => t('settings.licensing.summary.userName', { userName: userNameLabel.value }))

const activePlanCode = computed<ProductPlanCode | null>(() => normalizePlanCode(status.value?.planCode))

const planTone = computed<PlanTone>(() => {
  switch (activePlanCode.value) {
    case 'community':
      return 'community'
    case 'commercial':
      return 'commercial'
    case 'enterprise':
    case 'trial':
      return 'enterprise'
    default:
      return 'none'
  }
})

const versionCompatibilityLabel = computed(() => {
  if (!status.value) return t('common.notAvailable')
  return status.value.versionCompatible
    ? t('settings.licensing.version.compatible')
    : t('settings.licensing.version.incompatible')
})

const validityLabel = computed(() => {
  if (status.value?.expiresAt) return formatBrowserLocalTime(status.value.expiresAt, { includeSeconds: false })
  if (status.value?.planCode && status.value.planCode !== 'none') return t('settings.licensing.validity.perpetual')
  return t('common.notAvailable')
})

const applicationAssetQuotaLabel = computed(() => {
  if (!status.value) return t('common.notAvailable')
  const quota = status.value.quotas.applicationAssets ?? status.value.quotas.managedTargets
  const quotaLabel = quota === null || quota === undefined ? t('settings.licensing.quotas.unlimited') : String(quota)
  const used = status.value.usage?.applicationAssets
  return typeof used === 'number'
    ? t('settings.licensing.quotas.usedAvailable', { used, quota: quotaLabel })
    : quotaLabel
})

const applicationAssetQuotaExceeded = computed(() => {
  const quota = status.value?.quotas.applicationAssets ?? status.value?.quotas.managedTargets
  const used = status.value?.usage?.applicationAssets
  return typeof used === 'number' && typeof quota === 'number' && used >= quota
})

const comparisonCards = computed<ComparisonCard[]>(() => {
  const nextUpgradeCode = activePlanCode.value === 'none' || activePlanCode.value === null
    ? 'community'
    : activePlanCode.value === 'community'
      ? 'commercial'
      : activePlanCode.value === 'commercial' || activePlanCode.value === 'trial'
        ? 'enterprise'
        : null

  const commercialPrice = locale.value.startsWith('zh')
    ? t('settings.licensing.comparison.cards.commercial.priceCny')
    : t('settings.licensing.comparison.cards.commercial.priceUsd')

  return (['community', 'commercial', 'enterprise'] as const).map((code) => ({
    code,
    title: t(`settings.licensing.plans.${code}`),
    summary: t(`settings.licensing.comparison.cards.${code}.summary`),
    features: comparisonFeatureKeys[code].map((featureKey) => t(`settings.licensing.comparison.cards.${code}.features.${featureKey}`)),
    price: code === 'community'
      ? t('settings.licensing.comparison.cards.community.price')
      : code === 'commercial'
        ? commercialPrice
        : t('settings.licensing.comparison.cards.enterprise.price'),
    current: activePlanCode.value === code,
    recommended: nextUpgradeCode === code,
  }))
})

const comparisonSummary = computed(() => {
  if (!status.value?.planCode) return t('settings.licensing.comparison.noActivePlan')
  return t('settings.licensing.comparison.currentPlan', { plan: planLabel.value })
})

async function loadStatus(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await getLicensingStatus()
    if (response.data) status.value = response.data
  } catch {
    errorMessage.value = t('settings.licensing.messages.loadFailed')
  } finally {
    loading.value = false
  }
}

async function downloadJson(fileName: string, value: unknown): Promise<void> {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

async function createRequest(): Promise<void> {
  errorMessage.value = ''
  try {
    const response = await createActivationRequest()
    if (!response.data) throw new Error('activation request data missing')
    await downloadJson(`${productBrand.slug}-activation-request-offline.json`, response.data.request)
    message.value = t('settings.licensing.messages.requestExported')
  } catch {
    errorMessage.value = t('settings.licensing.messages.operationFailed')
  }
}

function applyForTrial(): void {
  upgradeModalOpen.value = false
  window.open(trialApplicationUrl, '_blank', 'noopener,noreferrer')
}

function chooseLicenseFile(): void {
  licenseFileInput.value?.click()
}

async function handleLicenseFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  try {
    await importLicensePayload(await file.text())
  } catch {
    errorMessage.value = t('settings.licensing.messages.operationFailed')
  }
}

async function importLicensePayload(payload: string): Promise<void> {
  errorMessage.value = ''
  message.value = ''
  let parsed: {
    licenseGrant?: Record<string, unknown>
    revocationList?: Record<string, unknown>
    activationResponse?: ActivationResponse
    requestId?: string
    nonce?: string
    responseId?: string
    schemaVersion?: number
  }
  try {
    parsed = JSON.parse(payload) as typeof parsed
  } catch {
    errorMessage.value = t('settings.licensing.messages.invalidJson')
    return
  }
  importing.value = true
  try {
    const response = isActivationResponsePayload(parsed)
      ? await importActivationResponse(parsed)
      : parsed.licenseGrant
        ? await importLicense({ licenseGrant: parsed.licenseGrant, revocationList: parsed.revocationList })
        : (() => { throw new Error('license payload missing') })()
    if (response.data) status.value = response.data
    message.value = t('settings.licensing.messages.imported')
  } catch (error: unknown) {
    errorMessage.value = parsed.licenseGrant || isActivationResponsePayload(parsed)
      ? error instanceof ApiClientError && error.errorCode === 'LICENSE_TAMPERED'
        ? t('settings.licensing.messages.licenseTampered')
        : t('settings.licensing.messages.importFailed')
      : t('settings.licensing.messages.licenseMissing')
  } finally {
    importing.value = false
  }
}

async function importPastedLicense(): Promise<void> {
  const payload = licenseText.value.trim()
  if (!payload) return
  await importLicensePayload(payload)
  if (!errorMessage.value) licenseText.value = ''
}

function isActivationResponsePayload(value: unknown): value is ActivationResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const response = value as Partial<ActivationResponse>
  return (response.schemaVersion === 1 || response.schemaVersion === 2)
    && typeof response.responseId === 'string'
    && typeof response.requestId === 'string'
    && typeof response.nonce === 'string'
    && !!response.licenseGrant
}

function normalizePlanCode(planCode?: string): ProductPlanCode | null {
  switch (planCode) {
    case 'none':
      return 'none'
    case 'community':
    case 'free':
      return 'community'
    case 'commercial':
    case 'standard':
    case 'professional':
      return 'commercial'
    case 'enterprise':
      return 'enterprise'
    case 'trial':
      return 'trial'
    default:
      return null
  }
}

onMounted(loadStatus)
</script>

<template>
  <section class="gc-page licensing-page">
    <p v-if="message" class="licensing-page__message licensing-page__message--success" role="status">{{ message }}</p>
    <p v-if="errorMessage" class="licensing-page__message licensing-page__message--error" role="alert">{{ errorMessage }}</p>
    <p v-if="loading" class="licensing-page__message licensing-page__message--loading" role="status">{{ t('common.loading') }}</p>
    <p v-if="status?.integrityStatus === 'tampered'" class="licensing-page__message licensing-page__message--error" role="alert">
      {{ t('settings.licensing.messages.licenseTampered') }}
    </p>

    <section
      class="licensing-page__hero"
      :class="`licensing-page__hero--${planTone}`"
      :aria-label="t('settings.licensing.summary.title')"
    >
      <div class="licensing-page__hero-glow" aria-hidden="true" />
      <div class="licensing-page__hero-top">
        <div class="licensing-page__hero-main">
          <div class="licensing-page__hero-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="presentation">
              <path d="M12 2.5 4.5 5.8v5.2c0 4.6 3 8.5 7.5 10 4.5-1.5 7.5-5.4 7.5-10V5.8L12 2.5Z" />
              <path d="m8.6 11.6 2.3 2.3 4.6-4.8" />
            </svg>
          </div>
          <div class="licensing-page__hero-heading">
            <span class="licensing-page__eyebrow">{{ t('settings.licensing.summary.title') }}</span>
            <h2>{{ planLabel }}</h2>
            <p>{{ userNameSummary }}</p>
          </div>
        </div>
        <div class="licensing-page__hero-aside">
          <span v-if="status && status.state !== 'none'" :class="stateClass">{{ stateLabel }}</span>
          <div class="licensing-page__hero-actions">
            <button class="gc-button gc-button--primary" type="button" @click="upgradeModalOpen = true">
              {{ t('settings.licensing.actions.upgrade') }}
            </button>
            <button class="gc-button gc-button--secondary" type="button" :disabled="loading" @click="loadStatus">
              {{ loading ? t('common.loading') : t('common.refresh') }}
            </button>
          </div>
        </div>
      </div>
      <dl class="licensing-page__hero-stats">
        <div>
          <dt>{{ t('settings.licensing.fields.validity') }}</dt>
          <dd>{{ validityLabel }}</dd>
        </div>
        <div>
          <dt>{{ t('settings.licensing.fields.currentVersion') }}</dt>
          <dd>{{ status?.currentVersion || t('common.notAvailable') }}</dd>
        </div>
        <div>
          <dt>{{ t('settings.licensing.fields.versionCompatibility') }}</dt>
          <dd>{{ versionCompatibilityLabel }}</dd>
        </div>
        <div>
          <dt>{{ t('settings.licensing.fields.installationId') }}</dt>
          <dd class="licensing-page__mono">{{ status?.installationId || t('common.notAvailable') }}</dd>
        </div>
      </dl>
    </section>

    <section class="gc-card licensing-page__panel" :aria-label="t('settings.licensing.info.title')">
      <div class="licensing-page__panel-head">
        <div>
          <h2>{{ t('settings.licensing.info.title') }}</h2>
        </div>
        <span class="licensing-page__panel-badge">{{ planLabel }}</span>
      </div>
      <div class="licensing-page__quota-block">
        <h3>{{ t('settings.licensing.quotas.title') }}</h3>
        <dl class="licensing-page__quota-list">
          <div><dt>{{ t('settings.licensing.quotas.applicationAssets') }}</dt><dd :class="{ 'licensing-page__quota-value--exceeded': applicationAssetQuotaExceeded }">{{ applicationAssetQuotaLabel }}</dd></div>
          <div><dt>{{ t('settings.licensing.quotas.concurrentExecutions') }}</dt><dd>{{ status?.quotas.concurrentExecutions ?? t('settings.licensing.quotas.unlimited') }}</dd></div>
          <div><dt>{{ t('settings.licensing.quotas.plugins') }}</dt><dd>{{ status?.quotas.plugins ?? t('settings.licensing.quotas.unlimited') }}</dd></div>
        </dl>
      </div>
    </section>

    <section class="licensing-page__grid">
      <section class="gc-card licensing-page__panel" :aria-label="t('settings.licensing.features.title')">
        <h2>{{ t('settings.licensing.features.title') }}</h2>
        <ul v-if="status?.features.length" class="licensing-page__list">
          <li v-for="featureKey in displayedFeatureKeys" :key="featureKey">
            <span class="licensing-page__check" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="presentation">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            </span>
            <span>{{ t(`settings.licensing.features.items.${featureKey}`) }}</span>
          </li>
        </ul>
        <p v-else class="licensing-page__muted">{{ t('settings.licensing.features.empty') }}</p>
      </section>

      <section class="gc-card licensing-page__panel" :aria-label="t('settings.licensing.actions.title')">
        <div class="licensing-page__panel-head">
          <div>
            <h2>{{ t('settings.licensing.actions.title') }}</h2>
            <p>{{ t('settings.licensing.actions.description') }}</p>
          </div>
        </div>
        <div class="licensing-page__actions">
          <button class="gc-button gc-button--secondary" type="button" @click="createRequest">{{ t('settings.licensing.actions.offlineRequest') }}</button>
          <button class="gc-button gc-button--secondary" type="button" :disabled="importing" @click="chooseLicenseFile">
            {{ importing ? t('settings.licensing.actions.importing') : t('settings.licensing.actions.import') }}
          </button>
          <input
            ref="licenseFileInput"
            hidden
            type="file"
            accept="application/json,.json"
            :aria-label="t('settings.licensing.actions.import')"
            @change="handleLicenseFileChange"
          >
        </div>
        <label class="licensing-page__input">
          <span>{{ t('settings.licensing.actions.importLabel') }}</span>
          <textarea v-model="licenseText" rows="4" :placeholder="t('settings.licensing.actions.importPlaceholder')" />
        </label>
        <button class="gc-button gc-button--primary" type="button" :disabled="importing || !licenseText.trim()" @click="importPastedLicense">
          {{ importing ? t('settings.licensing.actions.importing') : t('settings.licensing.actions.import') }}
        </button>
      </section>
    </section>

    <GcModal
      v-model:open="upgradeModalOpen"
      frameless
      width="min(var(--gc-size-modal-wide), calc(100vw - var(--gc-space-6)))"
    >
      <section class="licensing-upgrade-modal">
        <button
          class="licensing-upgrade-modal__close"
          type="button"
          :aria-label="t('designSystem.modal.closeAria')"
          @click="upgradeModalOpen = false"
        >
          ×
        </button>

        <header class="licensing-upgrade-modal__hero">
          <div class="licensing-upgrade-modal__icon" aria-hidden="true">
            <svg viewBox="0 0 64 64" role="presentation">
              <path d="M32 4l18 10v13L32 60 14 27V14z" />
              <path d="M32 18l-8 14h7l-3 14 10-16h-7z" />
            </svg>
          </div>
          <h2>{{ t('settings.licensing.comparison.title') }}</h2>
          <p>{{ t('settings.licensing.comparison.subtitle') }}</p>
        </header>

        <p class="licensing-upgrade-modal__summary">{{ comparisonSummary }}</p>

        <section class="licensing-upgrade-modal__cards" :aria-label="t('settings.licensing.comparison.title')">
          <article
            v-for="card in comparisonCards"
            :key="card.code"
            class="licensing-upgrade-modal__card"
            :data-current="card.current"
            :data-recommended="card.recommended"
          >
            <div class="licensing-upgrade-modal__card-head">
              <div>
                <p class="licensing-upgrade-modal__eyebrow">{{ card.current ? t('settings.licensing.comparison.badges.current') : card.recommended ? t('settings.licensing.comparison.badges.recommended') : ' ' }}</p>
                <h3>{{ card.title }}</h3>
              </div>
            </div>
            <p class="licensing-upgrade-modal__card-summary">{{ card.summary }}</p>
            <ul class="licensing-upgrade-modal__features">
              <li v-for="feature in card.features" :key="feature">{{ feature }}</li>
            </ul>
            <div
              class="licensing-upgrade-modal__price-row"
              :class="{ 'licensing-upgrade-modal__price-row--with-action': card.code === 'enterprise' }"
            >
              <p class="licensing-upgrade-modal__price">{{ card.price }}</p>
              <button
                v-if="card.code === 'enterprise'"
                class="gc-button gc-button--secondary licensing-upgrade-modal__trial-action"
                type="button"
                @click="applyForTrial"
              >
                {{ t('settings.licensing.comparison.applyTrial') }}
              </button>
            </div>
          </article>
        </section>

        <footer class="licensing-upgrade-modal__footer">
          <span>{{ t('settings.licensing.comparison.footer.consult') }}</span>
          <span>{{ t('settings.licensing.comparison.footer.faq') }}</span>
        </footer>
      </section>
    </GcModal>
  </section>
</template>

<style scoped>
.licensing-page {
  display: grid;
  gap: var(--gc-space-4);
}

/* ---- 授权状态总览 ---- */

.licensing-page__hero {
  position: relative;
  display: grid;
  gap: var(--gc-space-4);
  padding: var(--gc-space-5);
  overflow: hidden;
  border: var(--gc-border-width-default) solid var(--gc-color-primary-border);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-gradient-workspace);
}

.licensing-page__hero-glow {
  position: absolute;
  top: calc(var(--gc-space-2) * -4);
  right: calc(var(--gc-space-2) * -4);
  width: calc(var(--gc-space-12) * 4);
  height: calc(var(--gc-space-12) * 4);
  border-radius: var(--gc-radius-full);
  background: radial-gradient(circle, var(--gc-color-primary-weak), transparent 70%);
  pointer-events: none;
}

.licensing-page__hero-top {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--gc-space-3);
}

.licensing-page__hero-main {
  display: flex;
  align-items: flex-start;
  gap: var(--gc-space-3);
  min-width: 0;
}

.licensing-page__hero-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: var(--gc-space-10);
  height: var(--gc-space-10);
  border-radius: var(--gc-radius-md);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-bg);
}

.licensing-page__hero-icon svg {
  width: var(--gc-space-6);
  height: var(--gc-space-6);
  fill: none;
  stroke: currentColor;
  stroke-width: var(--gc-border-width-thick);
  stroke-linecap: round;
  stroke-linejoin: round;
}

.licensing-page__hero--community .licensing-page__hero-icon { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.licensing-page__hero--commercial .licensing-page__hero-icon { color: var(--gc-color-primary); background: var(--gc-color-primary-bg); }
.licensing-page__hero--enterprise .licensing-page__hero-icon { color: var(--gc-color-accent-purple); background: var(--gc-color-primary-bg); }
.licensing-page__hero--none .licensing-page__hero-icon { color: var(--gc-color-text-muted); background: var(--gc-color-surface-muted); }

.licensing-page__hero-heading {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.licensing-page__hero-heading h2 {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-heading-md);
  line-height: var(--gc-line-height-tight);
  font-weight: 800;
  letter-spacing: 0;
}

.licensing-page__hero-heading p {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.licensing-page__hero-aside {
  display: grid;
  justify-items: end;
  gap: var(--gc-space-2);
}

.licensing-page__hero-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--gc-space-2);
}

.licensing-page__hero-stats {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
  padding-top: var(--gc-space-3);
  border-top: var(--gc-border-width-default) solid var(--gc-color-primary-border);
}

.licensing-page__hero-stats div {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.licensing-page__hero-stats dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.licensing-page__hero-stats dd {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
  font-weight: 800;
  overflow-wrap: anywhere;
}

/* ---- 通用面板 ---- */

.licensing-page__panel {
  display: grid;
  gap: var(--gc-space-3);
  padding: var(--gc-space-5);
  border-color: var(--gc-color-border-soft);
}

.licensing-page__panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--gc-space-3);
}

.licensing-page__panel-head > div {
  display: grid;
  gap: var(--gc-space-1);
}

.licensing-page h2 {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-heading-xs);
  letter-spacing: 0;
}

.licensing-page__panel-head p,
.licensing-page__muted {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.licensing-page__panel-badge {
  display: inline-flex;
  align-items: center;
  min-height: var(--gc-control-height-xs);
  padding: 0 var(--gc-space-3);
  border-radius: var(--gc-radius-pill);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
  font-size: var(--gc-font-size-sm);
  font-weight: 700;
  white-space: nowrap;
}

.licensing-page__eyebrow {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.licensing-page__hero--community .licensing-page__eyebrow { color: var(--gc-color-success); }
.licensing-page__hero--commercial .licensing-page__eyebrow { color: var(--gc-color-primary); }
.licensing-page__hero--enterprise .licensing-page__eyebrow { color: var(--gc-color-accent-purple); }
.licensing-page__hero--none .licensing-page__eyebrow { color: var(--gc-color-text-muted); }

/* ---- 授权状态徽标 ---- */

.licensing-page__state {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--gc-control-height-sm);
  padding: 0 var(--gc-space-4);
  border-radius: var(--gc-radius-pill);
  font-size: var(--gc-font-size-sm);
  font-weight: 700;
  white-space: nowrap;
}

.licensing-page__state--active { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.licensing-page__state--grace,
.licensing-page__state--upgrade_grace { color: var(--gc-color-warning); background: var(--gc-color-warning-bg); }
.licensing-page__state--revoked,
.licensing-page__state--expired,
.licensing-page__state--clock_rollback_detected { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }

.licensing-page__mono {
  overflow-x: auto;
  overflow-wrap: normal;
  font-family: var(--gc-font-family-mono);
  font-size: var(--gc-font-size-sm);
  white-space: nowrap;
  word-break: normal;
}

/* ---- 功能与额度 ---- */

.licensing-page__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: var(--gc-space-4);
}

.licensing-page__list {
  display: grid;
  gap: var(--gc-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.licensing-page__list li {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
  padding: var(--gc-space-2);
  border-radius: var(--gc-radius-sm);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-subtle);
}

.licensing-page__check {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: var(--gc-size-icon-md);
  height: var(--gc-size-icon-md);
  border-radius: var(--gc-radius-full);
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
}

.licensing-page__check svg {
  width: var(--gc-size-icon-sm);
  height: var(--gc-size-icon-sm);
  fill: none;
  stroke: currentColor;
  stroke-width: var(--gc-border-width-thick);
  stroke-linecap: round;
  stroke-linejoin: round;
}

.licensing-page__quota-block {
  display: grid;
  gap: var(--gc-space-2);
  padding-top: var(--gc-space-3);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-soft);
}

.licensing-page__quota-block h3 {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 700;
}

.licensing-page__quota-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-2);
  margin: 0;
}

.licensing-page__quota-list div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gc-space-3);
  min-width: 0;
  padding: var(--gc-space-2) var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-subtle);
}

.licensing-page__quota-list dt {
  flex: 0 0 auto;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  white-space: nowrap;
}

.licensing-page__quota-list dd {
  margin: 0;
  min-width: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
  font-weight: 800;
  overflow-wrap: anywhere;
  text-align: right;
}

.licensing-page__quota-list dd.licensing-page__quota-value--exceeded {
  color: var(--gc-color-danger);
}

/* ---- 授权文件操作 ---- */

.licensing-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-2);
}

.licensing-page__input {
  display: grid;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.licensing-page textarea {
  width: 100%;
  resize: vertical;
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  color: var(--gc-color-text);
  background: var(--gc-color-surface);
  font-family: var(--gc-font-family-mono);
  font-size: var(--gc-font-size-sm);
}

/* ---- 提示消息 ---- */

.licensing-page__message {
  margin: 0;
  padding: var(--gc-space-2) var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
}

.licensing-page__message--success { color: var(--gc-color-success); border-color: var(--gc-color-success-border); background: var(--gc-color-success-bg); }
.licensing-page__message--error { color: var(--gc-color-danger); border-color: var(--gc-color-danger-border); background: var(--gc-color-danger-bg); }
.licensing-page__message--loading { color: var(--gc-color-info); border-color: var(--gc-color-info-border); background: var(--gc-color-info-soft); }

/* ---- 版本对比弹窗 ---- */

.licensing-upgrade-modal {
  position: relative;
  display: grid;
  gap: var(--gc-space-5);
  padding: var(--gc-space-5);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-gradient-surface);
}

.licensing-upgrade-modal__close {
  position: absolute;
  top: var(--gc-space-3);
  right: var(--gc-space-3);
  width: var(--gc-control-height-sm);
  height: var(--gc-control-height-sm);
  border: 0;
  border-radius: var(--gc-radius-sm);
  background: transparent;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xl);
  line-height: 1;
}

.licensing-upgrade-modal__hero {
  display: grid;
  justify-items: center;
  gap: var(--gc-space-3);
  padding-top: var(--gc-space-4);
  text-align: center;
}

.licensing-upgrade-modal__icon {
  display: grid;
  place-items: center;
  width: var(--gc-space-12);
  height: var(--gc-space-12);
  color: var(--gc-color-info);
}

.licensing-upgrade-modal__icon svg {
  width: 100%;
  height: 100%;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: var(--gc-border-width-thick);
}

.licensing-upgrade-modal__icon svg path:last-child {
  fill: currentColor;
  stroke: none;
}

.licensing-upgrade-modal__hero h2 {
  margin: 0;
  color: var(--gc-color-info);
  font-size: var(--gc-font-size-xl);
  line-height: var(--gc-line-height-tight);
  font-weight: 800;
}

.licensing-upgrade-modal__hero p,
.licensing-upgrade-modal__summary,
.licensing-upgrade-modal__card-summary,
.licensing-upgrade-modal__footer {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.licensing-upgrade-modal__summary {
  margin: 0;
  text-align: center;
}

.licensing-upgrade-modal__cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-4);
}

.licensing-upgrade-modal__card {
  position: relative;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: var(--gc-space-4);
  min-height: calc(var(--gc-space-12) * 4);
  padding: var(--gc-space-5) var(--gc-space-5) 0;
  overflow: hidden;
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-md);
  background: var(--gc-gradient-surface);
}

.licensing-upgrade-modal__card[data-current='true'] {
  border-color: var(--gc-color-info);
  background: var(--gc-color-info-soft);
  box-shadow: var(--gc-shadow-focus);
}

.licensing-upgrade-modal__card[data-recommended='true'] {
  border-color: var(--gc-color-info-border);
}

.licensing-upgrade-modal__card-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-3);
}

.licensing-upgrade-modal__card h3 {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-2xl);
  line-height: 1.05;
}

.licensing-upgrade-modal__eyebrow {
  min-height: 1em;
  margin: 0 0 var(--gc-space-1);
  color: var(--gc-color-info);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.licensing-upgrade-modal__card-summary {
  position: relative;
  z-index: 1;
  margin: 0;
  color: var(--gc-color-text-muted);
}

.licensing-upgrade-modal__features {
  position: relative;
  z-index: 1;
  display: grid;
  gap: var(--gc-space-3);
  margin: 0;
  padding-left: var(--gc-space-5);
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  line-height: 1.55;
}

.licensing-upgrade-modal__price-row {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--gc-space-3);
  min-height: var(--gc-control-height-md);
  padding: var(--gc-space-2) 0;
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-muted);
}

.licensing-upgrade-modal__price-row--with-action {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, auto) minmax(0, 1fr);
  gap: var(--gc-space-2);
}

.licensing-upgrade-modal__price {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  color: var(--gc-color-info);
  font-size: var(--gc-font-size-md);
  font-weight: 900;
  text-align: center;
}

.licensing-upgrade-modal__price-row--with-action .licensing-upgrade-modal__price {
  grid-column: 2;
  text-align: center;
}

.licensing-upgrade-modal__trial-action {
  grid-column: 3;
  justify-self: end;
  min-height: var(--gc-control-height-xs);
  padding: var(--gc-space-1) var(--gc-space-2);
  border-color: transparent;
  color: var(--gc-color-text-muted);
  background: transparent;
  font-size: var(--gc-font-size-xs);
  font-weight: 600;
  white-space: nowrap;
  box-shadow: none;
}

.licensing-upgrade-modal__trial-action:hover:not(:disabled) {
  border-color: transparent;
  color: var(--gc-color-text);
  background: transparent;
  box-shadow: none;
}

.licensing-upgrade-modal__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--gc-space-4);
  padding-top: var(--gc-space-2);
}

@media (max-width: 68.75rem) {
  .licensing-upgrade-modal__cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 50rem) {
  .licensing-page__hero-top,
  .licensing-page__panel-head {
    display: grid;
  }

  .licensing-page__hero-aside {
    justify-items: start;
  }

  .licensing-page__hero-stats,
  .licensing-page__quota-list,
  .licensing-page__grid,
  .licensing-upgrade-modal__cards {
    grid-template-columns: 1fr;
  }
}
</style>

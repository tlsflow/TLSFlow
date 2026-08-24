<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcModal, GcPageHeader } from '@/design-system/components'
import {
  createActivationRequest,
  exportLicense,
  getLicensingStatus,
  importActivationResponse,
  importLicense,
  type ActivationResponse,
  type LicenseStatus
} from '@/api/modules/licensing.api'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

const { t, locale } = useI18n()
const status = ref<LicenseStatus | null>(null)
const licenseText = ref('')
const loading = ref(false)
const importing = ref(false)
const upgradeModalOpen = ref(false)
const message = ref('')
const errorMessage = ref('')

type ProductPlanCode = 'free' | 'commercial' | 'enterprise'

interface ComparisonCard {
  code: ProductPlanCode
  title: string
  summary: string
  features: string[]
  price: string
  current: boolean
  recommended: boolean
}

const comparisonFeatureKeys: Record<ProductPlanCode, string[]> = {
  free: ['full', 'usage', 'automation', 'quota', 'support'],
  commercial: ['full', 'usage', 'automation', 'approval', 'quota', 'term', 'support'],
  enterprise: ['full', 'usage', 'automation', 'approval', 'quota', 'support'],
}

const stateLabel = computed(() => {
  if (!status.value) return t('common.notAvailable')
  return t(`settings.licensing.states.${status.value.state}`)
})

const stateClass = computed(() => `licensing-page__state licensing-page__state--${status.value?.state ?? 'unlicensed'}`)

const planLabel = computed(() => {
  if (!status.value?.planCode) return t('settings.licensing.summary.unconfigured')
  const key = `settings.licensing.plans.${status.value.planCode}`
  const localized = t(key)
  return localized === key ? status.value.planCode : localized
})

const activePlanCode = computed<ProductPlanCode | null>(() => normalizePlanCode(status.value?.planCode))

const comparisonCards = computed<ComparisonCard[]>(() => {
  const nextUpgradeCode = activePlanCode.value === 'free'
    ? 'commercial'
    : activePlanCode.value === 'commercial'
      ? 'enterprise'
      : null

  const commercialPrice = locale.value.startsWith('zh')
    ? t('settings.licensing.comparison.cards.commercial.priceCny')
    : t('settings.licensing.comparison.cards.commercial.priceUsd')

  return (['free', 'commercial', 'enterprise'] as const).map((code) => ({
    code,
    title: t(`settings.licensing.plans.${code}`),
    summary: t(`settings.licensing.comparison.cards.${code}.summary`),
    features: comparisonFeatureKeys[code].map((featureKey) => t(`settings.licensing.comparison.cards.${code}.features.${featureKey}`)),
    price: code === 'free'
      ? t('settings.licensing.comparison.cards.free.price')
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

async function exportCurrentLicense(): Promise<void> {
  errorMessage.value = ''
  try {
    const response = await exportLicense()
    if (!response.data) throw new Error('license export data missing')
    await downloadJson('gcac-license-export.json', response.data)
    message.value = t('settings.licensing.messages.exported')
  } catch {
    errorMessage.value = t('settings.licensing.messages.operationFailed')
  }
}

async function createRequest(kind: 'online' | 'offline'): Promise<void> {
  errorMessage.value = ''
  try {
    const response = await createActivationRequest(kind)
    if (!response.data) throw new Error('activation request data missing')
    await downloadJson(`gcac-activation-request-${kind}.json`, response.data.request)
    message.value = t('settings.licensing.messages.requestExported')
  } catch {
    errorMessage.value = t('settings.licensing.messages.operationFailed')
  }
}

async function importCurrentLicense(): Promise<void> {
  errorMessage.value = ''
  message.value = ''
  let parsed: { licenseGrant?: Record<string, unknown>; revocationList?: Record<string, unknown>; activationResponse?: ActivationResponse; requestId?: string; nonce?: string; responseId?: string }
  try {
    parsed = JSON.parse(licenseText.value) as typeof parsed
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
    licenseText.value = ''
    message.value = t('settings.licensing.messages.imported')
  } catch {
    errorMessage.value = parsed.licenseGrant || isActivationResponsePayload(parsed)
      ? t('settings.licensing.messages.importFailed')
      : t('settings.licensing.messages.licenseMissing')
  } finally {
    importing.value = false
  }
}

function isActivationResponsePayload(value: unknown): value is ActivationResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const response = value as Partial<ActivationResponse>
  return response.schemaVersion === 1
    && typeof response.responseId === 'string'
    && typeof response.requestId === 'string'
    && typeof response.nonce === 'string'
    && !!response.licenseGrant
}

function normalizePlanCode(planCode?: string): ProductPlanCode | null {
  switch (planCode) {
    case 'free':
    case 'trial':
      return 'free'
    case 'commercial':
    case 'standard':
    case 'professional':
      return 'commercial'
    case 'enterprise':
      return 'enterprise'
    default:
      return null
  }
}

onMounted(loadStatus)
</script>

<template>
  <section class="gc-page licensing-page">
    <GcPageHeader :title="t('settings.licensing.title')" :description="t('settings.licensing.description')" />

    <p v-if="message" class="licensing-page__message licensing-page__message--success" role="status">{{ message }}</p>
    <p v-if="errorMessage" class="licensing-page__message licensing-page__message--error" role="alert">{{ errorMessage }}</p>

    <section class="gc-card licensing-page__summary" :aria-label="t('settings.licensing.summary.title')">
      <div class="licensing-page__summary-head">
        <div>
          <span class="licensing-page__eyebrow">{{ t('settings.licensing.summary.title') }}</span>
          <h2>{{ planLabel }}</h2>
        </div>
        <span :class="stateClass">{{ stateLabel }}</span>
      </div>
      <dl class="licensing-page__facts">
        <div>
          <dt>{{ t('settings.licensing.fields.installationId') }}</dt>
          <dd class="licensing-page__mono">{{ status?.installationId || t('common.notAvailable') }}</dd>
        </div>
        <div>
          <dt>{{ t('settings.licensing.fields.expiresAt') }}</dt>
          <dd>{{ status?.expiresAt ? formatBrowserLocalTime(status.expiresAt, { includeSeconds: false }) : t('common.notAvailable') }}</dd>
        </div>
        <div>
          <dt>{{ t('settings.licensing.fields.graceEndsAt') }}</dt>
          <dd>{{ status?.graceEndsAt ? formatBrowserLocalTime(status.graceEndsAt, { includeSeconds: false }) : t('common.notAvailable') }}</dd>
        </div>
        <div>
          <dt>{{ t('settings.licensing.fields.lastClockAt') }}</dt>
          <dd>{{ status?.lastClockAt ? formatBrowserLocalTime(status.lastClockAt, { includeSeconds: false }) : t('common.notAvailable') }}</dd>
        </div>
      </dl>
    </section>

    <section class="licensing-page__grid">
      <section class="gc-card licensing-page__panel">
        <h2>{{ t('settings.licensing.features.title') }}</h2>
        <ul v-if="status?.features.length" class="licensing-page__list">
          <li v-for="feature in status.features" :key="feature">{{ feature }}</li>
        </ul>
        <p v-else class="licensing-page__muted">{{ t('settings.licensing.features.empty') }}</p>
      </section>

      <section class="gc-card licensing-page__panel">
        <h2>{{ t('settings.licensing.quotas.title') }}</h2>
        <dl class="licensing-page__quota-list">
          <div><dt>{{ t('settings.licensing.quotas.managedTargets') }}</dt><dd>{{ status?.quotas.managedTargets ?? t('settings.licensing.quotas.unlimited') }}</dd></div>
          <div><dt>{{ t('settings.licensing.quotas.concurrentExecutions') }}</dt><dd>{{ status?.quotas.concurrentExecutions ?? t('settings.licensing.quotas.unlimited') }}</dd></div>
          <div><dt>{{ t('settings.licensing.quotas.plugins') }}</dt><dd>{{ status?.quotas.plugins ?? t('settings.licensing.quotas.unlimited') }}</dd></div>
        </dl>
      </section>
    </section>

    <section class="gc-card licensing-page__panel">
      <div class="licensing-page__panel-head">
        <div>
          <h2>{{ t('settings.licensing.actions.title') }}</h2>
          <p>{{ t('settings.licensing.actions.description') }}</p>
        </div>
        <div class="licensing-page__panel-actions">
          <button class="gc-button gc-button--primary" type="button" @click="upgradeModalOpen = true">
            {{ t('settings.licensing.actions.upgrade') }}
          </button>
          <button class="gc-button gc-button--secondary" type="button" :disabled="loading" @click="loadStatus">
            {{ loading ? t('common.loading') : t('common.refresh') }}
          </button>
        </div>
      </div>
      <div class="licensing-page__actions">
        <button class="gc-button gc-button--secondary" type="button" @click="createRequest('online')">{{ t('settings.licensing.actions.onlineRequest') }}</button>
        <button class="gc-button gc-button--secondary" type="button" @click="createRequest('offline')">{{ t('settings.licensing.actions.offlineRequest') }}</button>
        <button class="gc-button gc-button--secondary" type="button" @click="exportCurrentLicense">{{ t('settings.licensing.actions.export') }}</button>
      </div>
      <label class="licensing-page__input">
        <span>{{ t('settings.licensing.actions.importLabel') }}</span>
        <textarea v-model="licenseText" rows="8" :placeholder="t('settings.licensing.actions.importPlaceholder')" />
      </label>
      <button class="gc-button gc-button--primary" type="button" :disabled="importing || !licenseText.trim()" @click="importCurrentLicense">
        {{ importing ? t('common.saving') : t('settings.licensing.actions.import') }}
      </button>
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
            <p class="licensing-upgrade-modal__price">{{ card.price }}</p>
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
  gap: var(--gc-space-5);
}

.licensing-page__summary,
.licensing-page__panel {
  display: grid;
  gap: var(--gc-space-4);
  padding: var(--gc-space-6);
}

.licensing-page__summary {
  border: var(--gc-border-width-default) solid var(--gc-color-info-border);
  background: var(--gc-color-info-soft);
}

.licensing-page__summary-head,
.licensing-page__panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-4);
}

.licensing-page__panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-2);
  justify-content: flex-end;
}

.licensing-page__eyebrow,
.licensing-page__muted,
.licensing-page__panel-head p,
.licensing-page__facts dt,
.licensing-page__quota-list dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.licensing-page h2 {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-lg);
}

.licensing-page__summary h2 {
  margin-top: var(--gc-space-1);
}

.licensing-page__state {
  padding: var(--gc-space-1) var(--gc-space-3);
  border-radius: var(--gc-radius-sm);
  font-size: var(--gc-font-size-sm);
  font-weight: 700;
}

.licensing-page__state--active { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.licensing-page__state--grace { color: var(--gc-color-warning); background: var(--gc-color-warning-bg); }
.licensing-page__state--revoked,
.licensing-page__state--expired,
.licensing-page__state--clock_rollback_detected { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.licensing-page__state--unlicensed { color: var(--gc-color-text-muted); background: var(--gc-color-surface-muted); }

.licensing-page__facts,
.licensing-page__quota-list {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--gc-space-4);
  margin: 0;
}

.licensing-page__facts div,
.licensing-page__quota-list div {
  display: grid;
  gap: var(--gc-space-1);
}

.licensing-page__facts dd,
.licensing-page__quota-list dd {
  margin: 0;
  color: var(--gc-color-text);
  font-weight: 700;
}

.licensing-page__mono {
  overflow-wrap: anywhere;
  font-family: var(--gc-font-family-mono);
  font-size: var(--gc-font-size-sm);
}

.licensing-page__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-5);
}

.licensing-page__list {
  display: grid;
  gap: var(--gc-space-2);
  margin: 0;
  padding-left: var(--gc-space-5);
  color: var(--gc-color-text);
}

.licensing-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-3);
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

.licensing-page__message {
  margin: 0;
  padding: var(--gc-space-3) var(--gc-space-4);
  border-radius: var(--gc-radius-sm);
}

.licensing-page__message--success { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.licensing-page__message--error { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }

.licensing-upgrade-modal {
  position: relative;
  display: grid;
  gap: var(--gc-space-5);
  padding: var(--gc-space-5);
  border-radius: 22px;
  background:
    radial-gradient(circle at top, color-mix(in srgb, var(--gc-color-info-soft) 86%, transparent) 0%, transparent 20%),
    linear-gradient(180deg, var(--gc-color-surface-overlay), var(--gc-color-surface-solid));
}

.licensing-upgrade-modal__close {
  position: absolute;
  top: var(--gc-space-3);
  right: var(--gc-space-3);
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: var(--gc-radius-sm);
  background: transparent;
  color: var(--gc-color-text-muted);
  font-size: 1.75rem;
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
  width: 4rem;
  height: 4rem;
  color: var(--gc-color-info);
  filter: drop-shadow(0 12px 18px color-mix(in srgb, var(--gc-color-info) 24%, transparent));
}

.licensing-upgrade-modal__icon svg {
  width: 100%;
  height: 100%;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.2;
}

.licensing-upgrade-modal__icon svg path:last-child {
  fill: currentColor;
  stroke: none;
}

.licensing-upgrade-modal__hero h2 {
  margin: 0;
  color: var(--gc-color-info);
  font-size: clamp(2rem, 3vw, 3rem);
  line-height: 1;
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
  min-height: 20rem;
  padding: var(--gc-space-5);
  overflow: hidden;
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-md);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--gc-color-surface-overlay) 96%, transparent), var(--gc-color-surface-subtle));
}

.licensing-upgrade-modal__card::after {
  content: '';
  position: absolute;
  right: -1rem;
  bottom: -1rem;
  width: 8rem;
  height: 8rem;
  opacity: 0.08;
  background: linear-gradient(135deg, var(--gc-color-text), transparent 62%);
  clip-path: polygon(50% 0%, 62% 21%, 85% 18%, 74% 40%, 100% 58%, 72% 64%, 66% 100%, 48% 76%, 24% 100%, 27% 64%, 0 58%, 26% 40%, 15% 18%, 38% 21%);
}

.licensing-upgrade-modal__card[data-current='true'] {
  border-color: var(--gc-color-info);
  background:
    linear-gradient(180deg, var(--gc-color-info-soft), color-mix(in srgb, var(--gc-color-surface-overlay) 80%, transparent));
  box-shadow: var(--gc-shadow-focus);
}

.licensing-upgrade-modal__card[data-recommended='true'] {
  border-color: color-mix(in srgb, var(--gc-color-info) 60%, var(--gc-color-border-muted));
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

.licensing-upgrade-modal__price {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  min-height: var(--gc-control-height-md);
  padding: var(--gc-space-2) 0;
  border-top: 1px solid var(--gc-color-border-muted);
  color: var(--gc-color-info);
  font-size: var(--gc-font-size-sm);
  font-weight: 800;
  text-align: center;
}

.licensing-upgrade-modal__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-4);
  flex-wrap: wrap;
  padding-top: var(--gc-space-2);
}

@media (max-width: 800px) {
  .licensing-page__summary-head,
  .licensing-page__panel-head {
    display: grid;
  }

  .licensing-page__facts,
  .licensing-page__quota-list,
  .licensing-page__grid {
    grid-template-columns: 1fr;
  }

  .licensing-upgrade-modal__cards {
    grid-template-columns: 1fr;
  }
}
</style>

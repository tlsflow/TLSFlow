<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { initializeSystem } from '@/api/modules/system-initialization.api'
import { createActivationRequest, importActivationResponse, type ActivationRequest, type ActivationResponse } from '@/api/modules/licensing.api'
import { productBrand } from '@/brand/product-brand'
import { GcModal, GcUserFlowWizard, type UserFlowStep } from '@/design-system/components'
import { localeLabels, resolveBrowserLocale, setI18nLocale, supportedLocales, type SupportedLocale } from '@/i18n'
import { applyThemeToDocument, type ThemeMode } from '@/preferences/app-preferences'
import { useAppStore } from '@/stores/app.store'
import { useAuthStore } from '@/stores/auth.store'
import { useSystemInitializationStore } from '@/stores/system-initialization.store'

type InitializationStep = 'account' | 'license' | 'confirm' | 'complete'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const authStore = useAuthStore()
const appStore = useAppStore()
const initializationStore = useSystemInitializationStore()

const introDurationMs = 5000
const introLoadingDurationMs = 5000
type IntroPhase = 'assembling' | 'ready' | 'loading'
const showIntro = ref(true)
const introPhase = ref<IntroPhase>('assembling')
const introProgress = ref(0)
let introTimer: number | undefined
let introLoadingTimer: number | undefined
let introProgressTimer: number | undefined

const open = ref(true)
const activeStep = ref<InitializationStep>('account')
const busy = ref(false)
const licenseBusy = ref(false)
const error = ref('')
const licenseError = ref('')
const licenseConfigured = ref(false)
const activationResponseJson = ref('')
const activationRequest = ref<ActivationRequest | null>(null)
const activationRequestCopied = ref(false)
const activationResponseFileInput = ref<HTMLInputElement | null>(null)
const accountConfigured = ref(false)

const username = ref('')
const displayName = ref('')
const password = ref('')
const passwordConfirmation = ref('')
const locale = ref<SupportedLocale>(resolveBrowserLocale())
const theme = ref<ThemeMode>('light')

type IntroFragment = {
  id: number
  style: Record<string, string>
}

const introGridColumns = 28
const introGridRows = 24
const introMarkFragmentsStyle = {
  '--intro-grid-columns': `${introGridColumns}`,
  '--intro-grid-rows': `${introGridRows}`,
}

const introFragments: IntroFragment[] = Array.from({ length: introGridColumns * introGridRows }, (_, index) => {
  // 图像切片按网格保留原始 Logo 像素，同时使用黄金角生成稳定的银河式入场轨道。
  const column = index % introGridColumns
  const row = Math.floor(index / introGridColumns)
  const angle = (index * 137.508) % 360
  const radians = angle * Math.PI / 180
  const radiusX = 0.78 + (index % 9) * 0.07
  const radiusY = 0.72 + ((index * 7) % 8) * 0.06
  const x = Math.cos(radians) * radiusX
  const y = Math.sin(radians) * radiusY
  const backgroundPositionX = (column / (introGridColumns - 1)) * 100
  const backgroundPositionY = (row / (introGridRows - 1)) * 100

  return {
    id: index,
    style: {
      '--intro-x': `calc(100vw * ${x.toFixed(3)})`,
      '--intro-y': `calc(100vh * ${y.toFixed(3)})`,
      backgroundImage: `url("${productBrand.markAssetUrl}")`,
      backgroundSize: `${introGridColumns * 100}% ${introGridRows * 100}%`,
      backgroundPosition: `${backgroundPositionX.toFixed(4)}% ${backgroundPositionY.toFixed(4)}%`,
    },
  }
})

const previewMode = computed(() => import.meta.env.DEV
  && route.name === 'system.initialization.preview')

const steps = computed<readonly UserFlowStep[]>(() => [
  { id: 'account', label: t('systemInitialization.steps.account'), help: t('systemInitialization.steps.accountHelp'), helpLabel: t('systemInitialization.help') },
  { id: 'license', label: t('systemInitialization.steps.license'), help: t('systemInitialization.steps.licenseHelp'), helpLabel: t('systemInitialization.help'), completed: licenseConfigured.value },
  { id: 'confirm', label: t('systemInitialization.steps.confirm'), help: t('systemInitialization.steps.confirmHelp'), helpLabel: t('systemInitialization.help') },
  { id: 'complete', label: t('systemInitialization.steps.complete'), help: t('systemInitialization.steps.completeHelp'), helpLabel: t('systemInitialization.help') },
])

const stageTitle = computed(() => t(`systemInitialization.stage.${activeStep.value}.title`))
const stageHelp = computed(() => t(`systemInitialization.stage.${activeStep.value}.help`))
const canGoPrevious = computed(() => activeStep.value === 'license' || activeStep.value === 'confirm')
const primaryLabel = computed(() => {
  if (activeStep.value === 'account') return t('systemInitialization.actions.createAdmin')
  if (activeStep.value === 'license') return t('systemInitialization.actions.continue')
  if (activeStep.value === 'confirm') return t('systemInitialization.actions.finish')
  return t('systemInitialization.actions.login')
})

watch(locale, (value) => {
  void setI18nLocale(value)
})
watch(theme, (value) => applyThemeToDocument(value))

onMounted(() => {
  applyThemeToDocument(theme.value)
  const browserLocale = resolveBrowserLocale()
  if (locale.value !== browserLocale) locale.value = browserLocale
  void setI18nLocale(browserLocale)
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    introPhase.value = 'ready'
    return
  }
  introTimer = window.setTimeout(() => {
    introTimer = undefined
    introPhase.value = 'ready'
  }, introDurationMs)
})

onBeforeUnmount(() => {
  if (introTimer !== undefined) window.clearTimeout(introTimer)
  if (introLoadingTimer !== undefined) window.clearTimeout(introLoadingTimer)
  if (introProgressTimer !== undefined) window.clearInterval(introProgressTimer)
})

function beginUsing(): void {
  if (introPhase.value !== 'ready') return
  introPhase.value = 'loading'
  introProgress.value = 0
  const startedAt = performance.now()
  introProgressTimer = window.setInterval(() => {
    introProgress.value = Math.min(100, ((performance.now() - startedAt) / introLoadingDurationMs) * 100)
  }, 50)
  introLoadingTimer = window.setTimeout(finishIntro, introLoadingDurationMs)
}

function finishIntro(): void {
  if (introTimer !== undefined) {
    window.clearTimeout(introTimer)
    introTimer = undefined
  }
  if (introLoadingTimer !== undefined) {
    window.clearTimeout(introLoadingTimer)
    introLoadingTimer = undefined
  }
  if (introProgressTimer !== undefined) {
    window.clearInterval(introProgressTimer)
    introProgressTimer = undefined
  }
  introProgress.value = 100
  showIntro.value = false
}

function handleModalOpen(value: boolean): void {
  if (value) {
    open.value = true
    return
  }
  if (activeStep.value === 'complete') {
    void goToLogin()
    return
  }
  open.value = true
}

function selectStep(stepId: string): void {
  if (stepId === 'account') {
    if (!accountConfigured.value) activeStep.value = 'account'
    return
  }
  if (stepId === 'license' && activeStep.value !== 'account') activeStep.value = 'license'
  if (stepId === 'confirm' && (activeStep.value === 'confirm' || activeStep.value === 'complete')) activeStep.value = 'confirm'
  if (stepId === 'complete' && activeStep.value === 'complete') activeStep.value = 'complete'
}

function goPrevious(): void {
  if (activeStep.value === 'license') activeStep.value = 'account'
  else if (activeStep.value === 'confirm') activeStep.value = 'license'
}

async function runPrimary(): Promise<void> {
  if (busy.value) return
  if (activeStep.value === 'account') {
    await submitAccount()
    return
  }
  if (activeStep.value === 'license') {
    activeStep.value = 'confirm'
    return
  }
  if (activeStep.value === 'confirm') {
    activeStep.value = 'complete'
    return
  }
  await goToLogin()
}

async function submitAccount(): Promise<void> {
  error.value = ''
  if (password.value !== passwordConfirmation.value) {
    error.value = t('systemInitialization.errors.passwordMismatch')
    return
  }
  busy.value = true
  try {
    if (previewMode.value) {
      accountConfigured.value = true
      password.value = ''
      passwordConfirmation.value = ''
      activeStep.value = 'license'
      return
    }
    const result = await initializeSystem({
      username: username.value.trim(),
      displayName: displayName.value.trim(),
      password: password.value,
      passwordConfirmation: passwordConfirmation.value,
      locale: locale.value,
      theme: theme.value,
    })
    if (!result.data) throw new Error(t('systemInitialization.errors.missingSession'))
    authStore.setSession({
      token: result.data.session.token,
      permissions: result.data.session.permissions,
      user: {
        id: result.data.session.user.id,
        username: result.data.session.user.username,
        displayName: result.data.session.user.displayName,
        tenantId: result.data.session.user.tenantId,
        tenantName: result.data.session.user.tenantName,
        roles: result.data.session.user.roles.map((role) => role.code),
      },
    })
    initializationStore.markInitialized()
    appStore.applyPreferences({ theme: theme.value, locale: locale.value, version: 1 }, { cache: true })
    accountConfigured.value = true
    password.value = ''
    passwordConfirmation.value = ''
    activeStep.value = 'license'
  } catch (cause) {
    error.value = formatError(cause, t('systemInitialization.errors.createFailed'))
  } finally {
    busy.value = false
  }
}

async function createOfflineRequest(): Promise<void> {
  if (licenseBusy.value) return
  licenseError.value = ''
  licenseBusy.value = true
  try {
    if (previewMode.value) {
      activationRequest.value = {
        schemaVersion: 1,
        requestId: 'preview-request',
        nonce: 'preview-nonce',
        kind: 'offline',
        productCode: 'preview',
        installationId: 'preview-installation',
        installationPublicKey: 'preview-public-key',
        productVersion: 'preview',
        requestedAt: new Date().toLocaleString(),
      }
    } else {
      const result = await createActivationRequest()
      activationRequest.value = result.data?.request ?? null
      if (!activationRequest.value) throw new Error(t('systemInitialization.errors.activationRequestMissing'))
    }
    await downloadJson(`${productBrand.slug}-activation-request-offline.json`, activationRequest.value)
  } catch (cause) {
    licenseError.value = formatError(cause, t('systemInitialization.errors.licenseFailed'))
  } finally {
    licenseBusy.value = false
  }
}

function chooseActivationResponseFile(): void {
  activationResponseFileInput.value?.click()
}

async function handleActivationResponseFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  try {
    activationResponseJson.value = await file.text()
    await importOfflineResponse()
  } catch (cause) {
    licenseError.value = formatError(cause, t('systemInitialization.errors.licenseFailed'))
  }
}

async function importOfflineResponse(): Promise<void> {
  if (licenseBusy.value) return
  licenseError.value = ''
  licenseBusy.value = true
  try {
    const response = parseJsonObject(activationResponseJson.value)
    if (previewMode.value) {
      licenseConfigured.value = true
      return
    }
    await importActivationResponse(response as unknown as ActivationResponse)
    licenseConfigured.value = true
  } catch (cause) {
    licenseError.value = formatError(cause, t('systemInitialization.errors.licenseFailed'))
  } finally {
    licenseBusy.value = false
  }
}

async function copyActivationRequest(): Promise<void> {
  if (!activationRequest.value || licenseBusy.value) return
  const copied = await copyText(JSON.stringify(activationRequest.value, null, 2))
  activationRequestCopied.value = copied
  if (copied) window.setTimeout(() => { activationRequestCopied.value = false }, 1800)
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

async function copyText(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // 继续使用兼容旧浏览器的同步回退路径。
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}

function skipLicense(): void {
  licenseConfigured.value = false
  activeStep.value = 'confirm'
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('systemInitialization.errors.jsonObjectRequired'))
  return parsed as Record<string, unknown>
}

async function goToLogin(): Promise<void> {
  if (previewMode.value) {
    await router.push({ name: 'login' })
    return
  }
  await authStore.logout().catch(() => undefined)
  await router.push({ name: 'login' })
}

function formatError(cause: unknown, fallback: string): string {
  if (cause instanceof ApiClientError) return `${cause.message} (${cause.errorCode})`
  return cause instanceof Error ? cause.message : fallback
}
</script>

<template>
  <div v-if="showIntro" class="system-initialization__intro-screen" role="status" aria-live="polite" :aria-label="t('systemInitialization.intro.ariaLabel')">
    <div class="system-initialization__intro-stage" aria-hidden="true">
      <div class="system-initialization__intro-lockup">
        <span class="system-initialization__intro-mark">
          <img :src="productBrand.markAssetUrl" alt="">
          <span class="system-initialization__intro-mark-fragments" :style="introMarkFragmentsStyle">
            <span v-for="fragment in introFragments" :key="fragment.id" class="system-initialization__intro-fragment" :style="fragment.style" />
          </span>
        </span>
        <div class="system-initialization__intro-brand-copy">
          <span class="system-initialization__intro-name">{{ productBrand.name }}</span>
          <span class="system-initialization__intro-slogan">{{ t('systemInitialization.intro.slogan') }}</span>
        </div>
      </div>
    </div>
    <div class="system-initialization__intro-controls" :class="`is-${introPhase}`">
      <button v-if="introPhase === 'ready'" class="system-initialization__intro-start gc-button gc-button--primary" type="button" @click="beginUsing">
        {{ t('systemInitialization.intro.start') }}
      </button>
      <template v-else-if="introPhase === 'loading'">
        <div class="system-initialization__intro-progress" role="progressbar" :aria-label="t('systemInitialization.intro.progressAriaLabel')" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(introProgress)">
          <span :style="{ transform: `scaleX(${introProgress / 100})` }" />
        </div>
      </template>
    </div>
  </div>

  <GcModal
    v-else
    :open="open"
    size="xxl"
    width="min(68rem, calc(100vw - var(--gc-space-8)))"
    max-height="calc(100vh - var(--gc-space-10))"
    :busy="busy || licenseBusy"
    :title="t('systemInitialization.title')"
    @update:open="handleModalOpen"
  >
    <GcUserFlowWizard
      :steps="steps"
      :active-step="activeStep"
      :title="stageTitle"
      :help="stageHelp"
      :help-label="t('systemInitialization.help')"
      :ariaLabel="t('systemInitialization.stepsLabel')"
      :show-stage-header="activeStep !== 'license'"
      @select="selectStep"
    >
      <form v-if="activeStep === 'account'" class="system-initialization__form" @submit.prevent="runPrimary">
        <div class="system-initialization__intro">
          <h3>{{ t('systemInitialization.account.heading') }}</h3>
          <p>{{ t('systemInitialization.account.description') }}</p>
        </div>
        <div class="system-initialization__grid">
          <label><span>{{ t('systemInitialization.account.username') }}</span><input v-model="username" autocomplete="username" required :placeholder="t('systemInitialization.account.usernamePlaceholder')"></label>
          <label><span>{{ t('systemInitialization.account.displayName') }}</span><input v-model="displayName" autocomplete="name" required :placeholder="t('systemInitialization.account.displayNamePlaceholder')"></label>
          <label><span>{{ t('systemInitialization.account.password') }}</span><input v-model="password" autocomplete="new-password" required type="password" :placeholder="t('systemInitialization.account.passwordPlaceholder')"></label>
          <label><span>{{ t('systemInitialization.account.passwordConfirmation') }}</span><input v-model="passwordConfirmation" autocomplete="new-password" required type="password" :placeholder="t('systemInitialization.account.passwordConfirmationPlaceholder')"></label>
        </div>
        <div class="system-initialization__preference-grid">
          <label><span>{{ t('systemInitialization.account.locale') }}</span><select v-model="locale"><option v-for="item in supportedLocales" :key="item" :value="item">{{ localeLabels[item] }}</option></select></label>
          <fieldset><legend>{{ t('systemInitialization.account.theme') }}</legend><div class="system-initialization__segmented"><button v-for="item in (['light', 'dark'] as const)" :key="item" type="button" :class="{ 'is-active': theme === item }" @click="theme = item">{{ t(`preferences.theme${item === 'light' ? 'Light' : 'Dark'}`) }}</button></div></fieldset>
        </div>
        <p v-if="error" class="system-initialization__error" role="alert">{{ error }}</p>
      </form>

      <section v-else-if="activeStep === 'license'" class="system-initialization__license">
        <p>{{ t('systemInitialization.license.description') }}</p>
        <div class="system-initialization__license-panel">
          <button class="gc-button gc-button--secondary" type="button" :disabled="licenseBusy" @click="createOfflineRequest">{{ t('systemInitialization.license.createRequest') }}</button>
          <div v-if="activationRequest" class="system-initialization__activation-request">
            <pre>{{ JSON.stringify(activationRequest, null, 2) }}</pre>
            <button class="gc-button gc-button--ghost" type="button" :disabled="licenseBusy" @click="copyActivationRequest">{{ activationRequestCopied ? t('systemInitialization.license.requestCopied') : t('systemInitialization.license.copyRequest') }}</button>
          </div>
          <div class="system-initialization__license-import-actions">
            <button class="gc-button gc-button--secondary" type="button" :disabled="licenseBusy || !activationRequest" @click="chooseActivationResponseFile">{{ t('systemInitialization.license.importFile') }}</button>
            <input ref="activationResponseFileInput" hidden type="file" accept="application/json,.json" :aria-label="t('systemInitialization.license.importFile')" @change="handleActivationResponseFileChange">
          </div>
          <label><span>{{ t('systemInitialization.license.activationResponse') }}</span><textarea v-model="activationResponseJson" rows="8" :placeholder="t('systemInitialization.license.activationResponsePlaceholder')"></textarea></label>
          <button class="gc-button gc-button--primary" type="button" :disabled="licenseBusy || !activationRequest" @click="importOfflineResponse">{{ t('systemInitialization.license.importResponse') }}</button>
        </div>
        <p v-if="licenseConfigured" class="system-initialization__success" role="status">{{ t('systemInitialization.license.configured') }}</p>
        <p v-if="licenseError" class="system-initialization__error" role="alert">{{ licenseError }}</p>
        <button class="gc-button gc-button--ghost" type="button" @click="skipLicense">{{ t('systemInitialization.license.skip') }}</button>
      </section>

      <section v-else-if="activeStep === 'confirm'" class="system-initialization__confirm">
        <div class="system-initialization__summary"><span>{{ t('systemInitialization.confirm.username') }}</span><strong>{{ username }}</strong></div>
        <div class="system-initialization__summary"><span>{{ t('systemInitialization.confirm.locale') }}</span><strong>{{ localeLabels[locale] }}</strong></div>
        <div class="system-initialization__summary"><span>{{ t('systemInitialization.confirm.theme') }}</span><strong>{{ t(`preferences.theme${theme === 'light' ? 'Light' : 'Dark'}`) }}</strong></div>
        <aside class="system-initialization__warning" role="note"><strong>{{ t('systemInitialization.confirm.kekTitle') }}</strong><p>{{ t('systemInitialization.confirm.kekWarning') }}</p></aside>
      </section>

      <section v-else class="system-initialization__complete">
        <div class="system-initialization__complete-mark" aria-hidden="true">✓</div>
        <h3>{{ t('systemInitialization.complete.heading') }}</h3>
        <p>{{ licenseConfigured ? t('systemInitialization.complete.licenseConfigured') : t('systemInitialization.complete.licenseSkipped') }}</p>
      </section>
    </GcUserFlowWizard>

    <template #actions>
      <button v-if="canGoPrevious" class="gc-button gc-button--secondary" type="button" :disabled="busy || licenseBusy" @click="goPrevious">{{ t('systemInitialization.actions.previous') }}</button>
      <button v-if="activeStep === 'license'" class="gc-button gc-button--ghost" type="button" :disabled="busy || licenseBusy" @click="skipLicense">{{ t('systemInitialization.license.skip') }}</button>
      <button class="gc-button gc-button--primary" type="button" :disabled="busy || licenseBusy || (activeStep === 'account' && (!username || !displayName || !password || !passwordConfirmation))" @click="runPrimary">{{ primaryLabel }}</button>
    </template>
  </GcModal>
</template>

<style scoped>
.system-initialization__intro-screen {
  position: fixed;
  inset: 0;
  z-index: var(--gc-z-modal);
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  align-items: center;
  padding: var(--gc-space-8) var(--gc-space-8) var(--gc-space-10);
  overflow: hidden;
  color: var(--gc-color-text);
  background: var(--gc-gradient-workspace);
}

.system-initialization__intro-stage {
  position: relative;
  display: grid;
  place-items: center;
  width: min(100%, 70rem);
  height: 100%;
  min-height: 0;
  align-self: stretch;
  margin: 0 auto;
  transform: translateY(calc(var(--gc-space-12) * -2));
}

.system-initialization__intro-lockup {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-12);
}

.system-initialization__intro-mark {
  position: relative;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: calc(var(--gc-space-12) * 6);
  height: calc(var(--gc-space-12) * 6);
  padding: 0;
}

.system-initialization__intro-mark img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
}

.system-initialization__intro-name {
  display: block;
  color: var(--gc-color-text-strong);
  font-size: calc(var(--gc-font-size-xl) * 2 + var(--gc-space-8));
  font-weight: 850;
  letter-spacing: 0;
  line-height: var(--gc-line-height-tight);
  transform: translate3d(var(--gc-space-12), 0, 0) rotate(12deg);
  animation: system-initialization-intro-name 5000ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.system-initialization__intro-name::first-letter {
  color: var(--gc-color-primary);
}

.system-initialization__intro-brand-copy {
  display: grid;
  gap: var(--gc-space-3);
  min-width: 0;
}

.system-initialization__intro-slogan {
  display: block;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-md);
  line-height: var(--gc-line-height-relaxed);
  opacity: 0;
  transform: translate3d(0, var(--gc-space-3), 0);
  animation: system-initialization-intro-slogan 5000ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.system-initialization__intro-mark-fragments {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(var(--intro-grid-columns), minmax(0, 1fr));
  grid-template-rows: repeat(var(--intro-grid-rows), minmax(0, 1fr));
  pointer-events: none;
  overflow: visible;
  transform-origin: center;
  animation: system-initialization-intro-fragments-spin 5000ms linear both;
}

.system-initialization__intro-fragment {
  display: block;
  background-repeat: no-repeat;
  opacity: 1;
  transform-origin: center;
  animation: system-initialization-intro-fragment-flight 5000ms linear both;
  will-change: transform;
}

.system-initialization__intro-controls {
  position: relative;
  z-index: 3;
  display: grid;
  justify-items: center;
  gap: var(--gc-space-3);
  width: min(100%, 28rem);
  min-height: calc(var(--gc-space-10) + var(--gc-space-6));
  margin: 0 auto;
  transform: translateY(calc(var(--gc-space-12) * -2));
}

.system-initialization__intro-start {
  min-width: min(100%, 12rem);
  min-height: var(--gc-space-10);
  padding: 0 var(--gc-space-6);
  font-size: var(--gc-font-size-lg);
  font-weight: 800;
  transform-origin: center;
  animation:
    system-initialization-intro-start-in 500ms cubic-bezier(0.2, 0.8, 0.2, 1) both,
    system-initialization-intro-start-breathe 2200ms ease-in-out 700ms infinite;
}

.system-initialization__intro-progress {
  width: min(100%, 24rem);
  height: var(--gc-space-2);
  overflow: hidden;
  border: var(--gc-border-width-default) solid var(--gc-color-primary-border);
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-surface-soft);
  box-shadow: inset 0 0 0 var(--gc-space-tight) var(--gc-color-primary-weak);
}

.system-initialization__intro-progress span {
  display: block;
  width: 100%;
  height: 100%;
  transform-origin: left;
  background: var(--gc-gradient-brand);
  will-change: transform;
  transition: transform 120ms linear;
}

@keyframes system-initialization-intro-name {
  0%, 88% { opacity: 0; transform: translate3d(var(--gc-space-12), 0, 0) rotate(12deg); }
  96% { opacity: 1; transform: translate3d(var(--gc-space-3), 0, 0) rotate(3deg); }
  100% { opacity: 1; transform: translate3d(0, 0, 0) rotate(0); }
}

@keyframes system-initialization-intro-slogan {
  0%, 90% { opacity: 0; transform: translate3d(0, var(--gc-space-3), 0); }
  98% { opacity: 1; transform: translate3d(0, var(--gc-space-1), 0); }
  100% { opacity: 1; transform: translate3d(0, 0, 0); }
}

@keyframes system-initialization-intro-fragments-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes system-initialization-intro-fragment-flight {
  0% { opacity: 0; transform: translate3d(var(--intro-x), var(--intro-y), 0) scale(0.28); }
  8% { opacity: 1; transform: translate3d(calc(var(--intro-x) * 0.92), calc(var(--intro-y) * 0.92), 0) scale(0.3376); }
  92% { opacity: 1; transform: translate3d(calc(var(--intro-x) * 0.08), calc(var(--intro-y) * 0.08), 0) scale(0.9424); }
  96% { opacity: 1; transform: translate3d(calc(var(--intro-x) * 0.04), calc(var(--intro-y) * 0.04), 0) scale(0.9712); }
  98% { opacity: 1; transform: translate3d(calc(var(--intro-x) * 0.02), calc(var(--intro-y) * 0.02), 0) scale(0.9856); }
  100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
}

@keyframes system-initialization-intro-start-in {
  from { opacity: 0; transform: translateY(var(--gc-space-3)); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes system-initialization-intro-start-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.035); }
}

.system-initialization__form,
.system-initialization__license,
.system-initialization__confirm,
.system-initialization__complete {
  display: grid;
  gap: var(--gc-space-5);
  min-width: 0;
}

.system-initialization__intro h3,
.system-initialization__complete h3 {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-lg);
}

.system-initialization__intro p,
.system-initialization__license > p,
.system-initialization__complete p {
  margin: var(--gc-space-2) 0 0;
  color: var(--gc-color-text-muted);
  line-height: var(--gc-line-height-relaxed);
}

.system-initialization__grid,
.system-initialization__preference-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-4);
}

.system-initialization__form label,
.system-initialization__license-panel label,
.system-initialization__preference-grid label {
  display: grid;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 750;
}

.system-initialization__form input,
.system-initialization__form select,
.system-initialization__license textarea,
.system-initialization__license select {
  width: 100%;
  min-height: var(--gc-space-10);
  padding: var(--gc-space-2) var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-solid);
  font: inherit;
}

.system-initialization__license textarea {
  min-height: calc(var(--gc-space-10) * 4);
  resize: vertical;
  font-family: var(--gc-font-family-mono);
}

.system-initialization__preference-grid fieldset {
  display: grid;
  gap: var(--gc-space-2);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.system-initialization__preference-grid legend {
  margin-bottom: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 750;
}

.system-initialization__segmented {
  display: flex;
  gap: var(--gc-space-2);
  flex-wrap: wrap;
}

.system-initialization__segmented button {
  min-height: var(--gc-space-10);
  padding: 0 var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-soft);
  cursor: pointer;
}

.system-initialization__segmented button.is-active {
  border-color: var(--gc-color-primary-border-strong);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
}

.system-initialization__license-panel {
  display: grid;
  gap: var(--gc-space-4);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-soft);
}

.system-initialization__license-panel pre {
  max-height: 14rem;
  margin: 0;
  padding: var(--gc-space-3);
  overflow: auto;
  border-radius: var(--gc-radius-sm);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-inset);
  font-family: var(--gc-font-family-mono);
  font-size: var(--gc-font-size-xs);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.system-initialization__activation-request {
  display: grid;
  gap: var(--gc-space-3);
}

.system-initialization__license-import-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-3);
}

.system-initialization__summary {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-4);
  padding: var(--gc-space-3) 0;
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  color: var(--gc-color-text-muted);
}

.system-initialization__summary strong { color: var(--gc-color-text-strong); }
.system-initialization__warning { padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-warning-border); border-radius: var(--gc-radius-md); color: var(--gc-color-warning); background: var(--gc-color-warning-bg); }
.system-initialization__warning p { margin: var(--gc-space-2) 0 0; color: var(--gc-color-text); line-height: var(--gc-line-height-relaxed); }
.system-initialization__error { margin: 0; color: var(--gc-color-danger); line-height: var(--gc-line-height-relaxed); }
.system-initialization__success { margin: 0; color: var(--gc-color-success); line-height: var(--gc-line-height-relaxed); }
.system-initialization__complete { place-items: center; text-align: center; padding: var(--gc-space-8) 0; }
.system-initialization__complete-mark { display: grid; place-items: center; width: var(--gc-space-12); height: var(--gc-space-12); border-radius: var(--gc-radius-full); color: var(--gc-color-text-inverse); background: var(--gc-color-success); font-size: var(--gc-font-size-xl); font-weight: 900; }

@media (max-width: 48rem) {
  .system-initialization__intro-screen { padding: var(--gc-space-5) var(--gc-space-4) var(--gc-space-8); }
  .system-initialization__intro-lockup { flex-direction: column; gap: var(--gc-space-6); max-width: 100%; }
  .system-initialization__intro-mark { width: calc(var(--gc-space-12) * 4); height: calc(var(--gc-space-12) * 4); padding: 0; }
  .system-initialization__intro-brand-copy { text-align: center; }
  .system-initialization__intro-name { font-size: calc(var(--gc-font-size-xl) * 2); }
  .system-initialization__grid,
  .system-initialization__preference-grid { grid-template-columns: 1fr; }
  .system-initialization__summary { align-items: flex-start; flex-direction: column; gap: var(--gc-space-1); }
}

@media (prefers-reduced-motion: reduce) {
  .system-initialization__intro-lockup,
  .system-initialization__intro-mark,
  .system-initialization__intro-name,
  .system-initialization__intro-slogan,
  .system-initialization__intro-mark-fragments,
  .system-initialization__intro-fragment,
  .system-initialization__intro-start { animation: none; }
  .system-initialization__intro-lockup,
  .system-initialization__intro-mark,
  .system-initialization__intro-name,
  .system-initialization__intro-slogan { opacity: 1; transform: none; }
  .system-initialization__intro-mark-fragments { opacity: 0; transform: none; }
  .system-initialization__intro-mark img { opacity: 1; animation: none; }
  .system-initialization__intro-fragment { opacity: 0; }
}
</style>

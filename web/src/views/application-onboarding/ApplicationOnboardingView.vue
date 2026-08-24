<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { type LocationQueryRaw, useRoute, useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import {
  cancelOnboardingSession,
  completeOnboardingSession,
  createOnboardingSession,
  discoverOnboardingTargets,
  getOnboardingSession,
  listOnboardingCertificateOptions,
  listOnboardingDevices,
  listOnboardingPlatforms,
  listOnboardingTargets,
  selectOnboardingCertificate,
  selectOnboardingResource,
  selectOnboardingTarget,
  testOnboardingConnection
} from '@/api/modules/application-onboarding.api'
import { sortDeployableCertificateVersions } from '@/views/deployments/certificate-version-selection'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import type { DeviceOnboardingInitialSelection } from '@/views/devices/device-onboarding.model'

interface PlatformBusinessMetadata { capabilityVersion: string; compatibleVersions: string[]; requiredInformation: string[] }
interface Platform { platformKey: string; source: 'PLUGIN' | 'CUSTOM_MANUAL'; displayNameKey: string; displayName?: string; logoUrl?: string; businessMetadata?: PlatformBusinessMetadata; deploymentMode?: string; deviceSelection?: 'EXISTING_OR_NEW' | 'EXISTING_ONLY' | 'NONE'; newDeviceOnboarding?: DeviceOnboardingInitialSelection; supportStatus?: string; acceptedCertificateFormats?: string[] }
interface Session { id: string; platformKey: string; state: string; stateVersion: number; deploymentMode?: string; deviceId?: string | null; targetId?: string | null; certificateId?: string | null; certificateVersionId?: string | null; targets?: Target[]; inputSnapshot?: Record<string, unknown>; lastErrorCode?: string }
interface TargetEndpoint { host?: string; port?: number; protocol?: string }
interface Target { managedTargetId: string; displayName: string; targetType: string; endpoint?: TargetEndpoint; configFingerprint: string; selectable: boolean; reasonCode?: string }
interface DeviceOption { deviceId: string; displayName: string; address?: string; health: string; selectable: boolean }
interface CertificateOption { id: string; label: string }
type OnboardingStep = 1 | 2 | 3 | 4 | 5
/** 与部署计划向导保持一致的“始终使用最新版本”选项标记。 */
const LATEST_VERSION_MARKER = '__LATEST__'

const props = withDefaults(defineProps<{
  embedded?: boolean
}>(), {
  embedded: false,
})
const emit = defineEmits<{
  close: []
  customManual: []
  addDevice: [initialSelection: DeviceOnboardingInitialSelection]
}>()

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const platforms = ref<Platform[]>([])
const selectedPlatform = ref<Platform | null>(null)
const session = ref<Session | null>(null)
const targets = ref<Target[]>([])
const devices = ref<DeviceOption[]>([])
const loading = ref(false)
const deviceListLoading = ref(false)
const deviceListLoaded = ref(false)
const submitInFlight = ref(false)
const error = ref('')
const deviceMode = ref<'EXISTING_DEVICE' | 'NEW_DEVICE'>('EXISTING_DEVICE')
const deviceId = ref('')
const certificateId = ref('')
const certificateVersionId = ref('')
const certificateSelectionMode = ref<'EXPLICIT' | 'LATEST_AUTO'>('EXPLICIT')
const certificateAssets = ref<CertificateOption[]>([])
const certificateVersions = ref<Record<string, unknown>[]>([])
const failedPlatformLogos = ref(new Set<string>())
const currentStepOverride = ref<OnboardingStep | null>(null)
const supportsNewDevice = computed(() => selectedPlatform.value?.deviceSelection === 'EXISTING_OR_NEW' && Boolean(selectedPlatform.value.newDeviceOnboarding))
const supportsExistingDevice = computed(() => selectedPlatform.value?.deviceSelection !== 'NONE')
const canContinueExistingDevice = computed(() => !loading.value && !deviceListLoading.value && !submitInFlight.value && deviceMode.value === 'EXISTING_DEVICE' && Boolean(deviceId.value))
const canOpenNewDevice = computed(() => !loading.value && !deviceListLoading.value && !submitInFlight.value && deviceMode.value === 'NEW_DEVICE' && supportsNewDevice.value)
const backendStep = computed<OnboardingStep>(() => stepForState(session.value?.state))
const step = computed<OnboardingStep>(() => {
  const override = currentStepOverride.value
  if (override && canNavigateToStep(override)) return override
  return selectedPlatform.value ? backendStep.value : 1
})
const canGoPrevious = computed(() => step.value > 1 && step.value < 5 && !loading.value && !deviceListLoading.value)
const stepLabels = computed(() => [
  t('applicationOnboarding.steps.platform'), t('applicationOnboarding.steps.device'), t('applicationOnboarding.steps.target'), t('applicationOnboarding.steps.certificate'), t('applicationOnboarding.steps.complete')
])
// 站点选择步骤只展示实际可用的受管目标；停用或不满足选择条件的目标不显示。
const selectableTargets = computed(() => targets.value.filter((target) => target.selectable))
// 证书版本列表按到期时间倒序，第一项即最新可部署版本。
const latestCertificateVersion = computed(() => certificateVersions.value[0] ?? null)
// 插件配方声明的平台接受格式，作为证书步骤的向导参数展示。
const platformAcceptedFormats = computed(() => selectedPlatform.value?.acceptedCertificateFormats ?? [])
// “始终使用最新版本”选项在提交时解析为当前最新版本 ID，作为 LATEST_AUTO 计划的种子版本。
const resolvedCertificateVersionId = computed(() =>
  certificateVersionId.value === LATEST_VERSION_MARKER
    ? certificateVersionIdOf(latestCertificateVersion.value)
    : certificateVersionId.value,
)
onMounted(restoreSession)
watch(deviceMode, (mode) => {
  if (mode === 'EXISTING_DEVICE' && session.value && step.value === 2) void refreshDevices()
})

async function loadPlatforms(): Promise<void> {
  loading.value = true; error.value = ''
  try { platforms.value = readArray<Platform>((await listOnboardingPlatforms(locale.value)).data) } catch (cause) { error.value = messageFor(cause) } finally { loading.value = false }
}

async function choosePlatform(platform: Platform): Promise<void> {
  if (platform.source === 'CUSTOM_MANUAL') {
    openCustomManual()
    return
  }
  selectedPlatform.value = platform; loading.value = true; error.value = ''
  currentStepOverride.value = null
  resetDeviceSelection()
  try {
    session.value = readObject<Session>((await createOnboardingSession(platform.platformKey)).data)
    await syncSessionRoute()
    await refreshDevices()
  } catch (cause) { error.value = messageFor(cause) } finally { loading.value = false }
}

function openCustomManual(): void {
  if (props.embedded) {
    emit('customManual')
    return
  }
  void router.push({ path: '/assets', query: { ...route.query, create: '1' } })
}

async function submitResource(): Promise<void> {
  if (!session.value || submitInFlight.value) return
  if (deviceMode.value === 'NEW_DEVICE') {
    const initialSelection = selectedPlatform.value?.newDeviceOnboarding
    if (initialSelection) emit('addDevice', initialSelection)
    return
  }
  submitInFlight.value = true
  loading.value = true; error.value = ''
  try {
    await refreshCurrentSession()
    await prepareSessionForConnectionTest()
    await continueCurrentSession()
  } catch (cause) { error.value = messageFor(cause) } finally { submitInFlight.value = false; loading.value = false }
}

async function refreshTargets(): Promise<void> { if (session.value) targets.value = readArray<Target>((await listOnboardingTargets(session.value.id)).data) }
async function refreshDevices(): Promise<void> {
  if (!session.value || !supportsExistingDevice.value) return
  deviceListLoading.value = true
  deviceListLoaded.value = true
  try {
    devices.value = readArray<DeviceOption>((await listOnboardingDevices(session.value.id)).data)
    if (deviceId.value && !devices.value.some((device) => device.deviceId === deviceId.value && device.selectable)) deviceId.value = ''
  } catch (cause) {
    devices.value = []
    error.value = messageFor(cause)
  } finally {
    deviceListLoading.value = false
  }
}
async function chooseTarget(target: Target): Promise<void> {
  if (!session.value || !target.selectable) return
  loading.value = true
  try {
    session.value = readObject<Session>((await selectOnboardingTarget(session.value.id, { expectedStateVersion: session.value.stateVersion, managedTargetId: target.managedTargetId, configFingerprint: target.configFingerprint })).data)
    currentStepOverride.value = null
    await loadCertificateAssets()
  } catch (cause) { error.value = messageFor(cause) } finally { loading.value = false }
}
async function saveCertificate(): Promise<void> {
  if (!session.value) return
  loading.value = true
  try {
    session.value = readObject<Session>((await selectOnboardingCertificate(session.value.id, {
      expectedStateVersion: session.value.stateVersion,
      certificateId: certificateId.value,
      certificateVersionId: resolvedCertificateVersionId.value,
      selectionMode: certificateVersionId.value === LATEST_VERSION_MARKER ? 'LATEST_AUTO' : 'EXPLICIT',
    })).data)
    currentStepOverride.value = null
  } catch (cause) { error.value = messageFor(cause) } finally { loading.value = false }
}
async function complete(): Promise<void> {
  if (!session.value) return
  loading.value = true
  try {
    session.value = readObject<Session>((await completeOnboardingSession(session.value.id, session.value.stateVersion)).data)
    currentStepOverride.value = null
  } catch (cause) { error.value = messageFor(cause) } finally { loading.value = false }
}
async function cancel(): Promise<void> {
  await cancelCurrentSessionBestEffort()
  resetOnboardingState()
  await clearOnboardingRoute()
  if (props.embedded) emit('close')
}
async function restoreSession(): Promise<void> {
  await loadPlatforms()
  const sessionId = typeof route.query.session === 'string' ? route.query.session : ''
  if (!sessionId) return
  loading.value = true; error.value = ''
  try {
    session.value = readObject<Session>((await getOnboardingSession(sessionId)).data)
    selectedPlatform.value = platforms.value.find((item) => item.platformKey === session.value?.platformKey) ?? null
    currentStepOverride.value = null
    deviceId.value = session.value.deviceId ?? deviceId.value
    certificateId.value = session.value.certificateId ?? certificateId.value
    certificateVersionId.value = session.value.certificateVersionId ?? certificateVersionId.value
    certificateSelectionMode.value = session.value.inputSnapshot?.certificateSelectionMode === 'LATEST_AUTO' ? 'LATEST_AUTO' : 'EXPLICIT'
    if (!selectedPlatform.value) { resetOnboardingState(); await clearOnboardingRoute(); return }
    if (isRestartableSessionState(session.value.state)) {
      await restartSessionForSelectedPlatform()
      await refreshDevices()
      return
    }
    if (isDeviceSelectionState(session.value.state)) await refreshDevices()
    if (session.value.state === 'TARGET_SELECTION_REQUIRED') targets.value = session.value.targets ?? await readTargets()
    if (['CERTIFICATE_SELECTION_REQUIRED', 'READY_TO_COMMIT'].includes(session.value.state)) await loadCertificateAssets()
  } catch (cause) { error.value = messageFor(cause) } finally { loading.value = false }
}
async function syncSessionRoute(): Promise<void> {
  if (!session.value) return
  const query: LocationQueryRaw = { ...route.query, session: session.value.id }
  if (props.embedded) query.onboarding = '1'
  await router.replace({ query })
}
async function clearOnboardingRoute(): Promise<void> {
  const query: LocationQueryRaw = { ...route.query }
  delete query.session
  delete query.onboarding
  await router.replace({ query })
}
async function readTargets(): Promise<Target[]> {
  if (!session.value) return []
  return readArray<Target>((await listOnboardingTargets(session.value.id)).data)
}
async function loadCertificateAssets(): Promise<void> {
  if (!session.value) return
  const options = readObject<{ assets: unknown; versions: unknown }>((await listOnboardingCertificateOptions(session.value.id)).data)
  certificateAssets.value = readArray<Record<string, unknown>>(options.assets).map(toCertificateOption).filter((item): item is CertificateOption => item !== null)
  const currentCertificateId = certificateId.value
  if (!currentCertificateId || !certificateAssets.value.some((item) => item.id === currentCertificateId)) {
    certificateId.value = certificateAssets.value[0]?.id ?? ''
  }
  await loadCertificateVersions()
}
async function loadCertificateVersions(): Promise<void> {
  const previousSelection = certificateVersionId.value
  certificateVersions.value = []
  certificateVersionId.value = ''
  if (!session.value || !certificateId.value) return
  // 后端已按插件配方声明的平台格式过滤版本，这里保留可部署性过滤与到期时间排序。
  const options = readObject<{ assets: unknown; versions: unknown }>((await listOnboardingCertificateOptions(session.value.id, certificateId.value)).data)
  certificateVersions.value = sortDeployableCertificateVersions(
    readArray<Record<string, unknown>>(options.versions).filter(isPreferredCertificateVersion),
  )
  const latest = certificateVersions.value[0]
  if (!latest) return
  // 恢复会话时保持用户之前的选择；默认使用“始终使用最新版本”，与部署计划向导一致。
  if (certificateSelectionMode.value === 'LATEST_AUTO') {
    certificateVersionId.value = LATEST_VERSION_MARKER
    return
  }
  const explicitId = previousSelection === LATEST_VERSION_MARKER ? '' : previousSelection
  if (explicitId && certificateVersions.value.some((item) => certificateVersionIdOf(item) === explicitId)) {
    certificateVersionId.value = explicitId
    return
  }
  certificateVersionId.value = LATEST_VERSION_MARKER
}
function onCertificateVersionChange(): void {
  certificateSelectionMode.value = certificateVersionId.value === LATEST_VERSION_MARKER ? 'LATEST_AUTO' : 'EXPLICIT'
}
function certificateVersionIdOf(item: Record<string, unknown> | null | undefined): string {
  return readString(item ?? {}, ['id', 'certificateVersionId'])
}
function certificateVersionOptionLabel(item: Record<string, unknown>): string {
  const name = readString(item, ['primaryDomain', 'commonName', 'name', 'displayName']) || certificateVersionIdOf(item) || t('designSystem.deploymentWizard.fallback.unnamedVersion')
  const notBefore = formatDateOnly(readString(item, ['notBefore', 'validFrom', 'issuedAt']))
  const notAfter = formatDateOnly(readString(item, ['notAfter', 'validTo', 'expiresAt']))
  if (!notBefore && !notAfter) return name
  return t('designSystem.deploymentWizard.version.range', {
    id: name,
    notBefore: notBefore || t('designSystem.deploymentWizard.fallback.unknownStart'),
    notAfter: notAfter || t('designSystem.deploymentWizard.fallback.unknownEnd'),
  })
}
function autoLatestVersionLabel(current: Record<string, unknown> | null): string {
  const currentLabel = current ? certificateVersionOptionLabel(current) : t('designSystem.deploymentWizard.version.noDeployableVersion')
  return t('designSystem.deploymentWizard.version.autoLatest', { current: currentLabel })
}
function formatDateOnly(value: string): string {
  if (!value) return ''
  return formatBrowserLocalTime(value, { includeTime: false }) || value
}
function toCertificateOption(record: Record<string, unknown>): CertificateOption | null {
  const id = readString(record, ['id', 'certificateAssetId', 'certificateVersionId'])
  if (!id) return null
  return { id, label: readString(record, ['primaryDomain', 'commonName', 'name', 'displayName', 'fingerprintSha256']) || id }
}
function isPreferredCertificateVersion(record: Record<string, unknown>): boolean {
  return readString(record, ['status']).toLowerCase() === 'active'
    && record.deployable === true
    && readString(record, ['activationState']).toLowerCase() === 'promoted'
}
function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim()
  return ''
}
function platformLabel(platform: Platform): string {
  return platform.displayName || t(platform.displayNameKey)
}
function platformLogoUrl(platform: Platform): string | undefined {
  const value = platform.logoUrl
  if (!value || failedPlatformLogos.value.has(platform.platformKey) || typeof window === 'undefined') return undefined
  try {
    const url = new URL(value, window.location.origin)
    if (url.origin !== window.location.origin) return undefined
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return undefined
  }
}
function platformInitial(platform: Platform): string {
  return platform.source === 'CUSTOM_MANUAL' ? '+' : platformLabel(platform).trim().slice(0, 1).toLocaleUpperCase()
}
function targetMetadataValue(value?: string | number): string {
  if (typeof value === 'number') return String(value)
  return value?.trim() || t('applicationOnboarding.target.missingValue')
}
function targetReasonLabel(reasonCode?: string): string {
  if (reasonCode === 'MANAGED_TARGET_INACTIVE') return t('applicationOnboarding.target.reasons.managedTargetInactive')
  if (reasonCode === 'WORKFLOW_CAPABILITY_MISSING') return t('applicationOnboarding.target.reasons.workflowCapabilityMissing')
  if (reasonCode === 'TARGET_ENDPOINT_MISSING') return t('applicationOnboarding.target.reasons.targetEndpointMissing')
  return t('applicationOnboarding.target.reasons.unknown')
}
function markPlatformLogoFailed(platformKey: string): void {
  failedPlatformLogos.value = new Set([...failedPlatformLogos.value, platformKey])
}
function resetDeviceSelection(): void {
  deviceMode.value = 'EXISTING_DEVICE'
  deviceId.value = ''
  devices.value = []
  deviceListLoaded.value = false
}
function resetTargetSelection(): void {
  targets.value = []
  certificateId.value = ''
  certificateVersionId.value = ''
  certificateSelectionMode.value = 'EXPLICIT'
  certificateAssets.value = []
  certificateVersions.value = []
}
function resetOnboardingState(): void {
  selectedPlatform.value = null
  session.value = null
  currentStepOverride.value = null
  error.value = ''
  loading.value = false
  deviceListLoading.value = false
  submitInFlight.value = false
  resetDeviceSelection()
  resetTargetSelection()
}
function isDeviceSelectionState(state: string): boolean {
  return ['PLATFORM_SELECTED', 'RESOURCE_SELECTION_REQUIRED', 'DEVICE_INPUT_REQUIRED', 'DEVICE_ONBOARDING', 'CONNECTION_TESTING'].includes(state)
}
function isResourceSelectionState(state: string): boolean {
  return ['PLATFORM_SELECTED', 'RESOURCE_SELECTION_REQUIRED'].includes(state)
}
function stepForState(state?: string): OnboardingStep {
  if (!state) return 1
  if (isDeviceSelectionState(state)) return 2
  if (['DISCOVERING', 'TARGET_SELECTION_REQUIRED'].includes(state)) return 3
  if (['CERTIFICATE_SELECTION_REQUIRED', 'READY_TO_COMMIT', 'COMMITTING'].includes(state)) return 4
  return state === 'PLAN_CREATED' ? 5 : 2
}
function canNavigateToStep(nextStep: number): boolean {
  if (nextStep === 1) return true
  if (!selectedPlatform.value || !session.value || session.value.state === 'PLAN_CREATED') return nextStep === 5 && backendStep.value === 5
  if (nextStep === 2) return true
  if (nextStep === 3) return backendStep.value >= 3
  if (nextStep === 4) return backendStep.value >= 4
  if (nextStep === 5) return backendStep.value === 5
  return false
}
async function navigateToStep(nextStep: number): Promise<void> {
  if (!canNavigateToStep(nextStep) || loading.value || deviceListLoading.value) return
  error.value = ''
  if (nextStep === 1) {
    await cancelCurrentSessionBestEffort()
    resetOnboardingState()
    await clearOnboardingRoute()
    return
  }
  currentStepOverride.value = nextStep as OnboardingStep
  if (nextStep === 2) {
    resetTargetSelection()
    await refreshDevices()
    return
  }
  if (nextStep === 3) {
    certificateId.value = ''
    certificateVersionId.value = ''
    certificateAssets.value = []
    certificateVersions.value = []
    if (targets.value.length === 0) await refreshTargets()
    return
  }
  if (nextStep === 4 && certificateAssets.value.length === 0) await loadCertificateAssets()
}
async function goPrevious(): Promise<void> {
  if (!canGoPrevious.value) return
  await navigateToStep(step.value - 1)
}
async function cancelCurrentSessionBestEffort(): Promise<void> {
  const current = session.value
  if (!current || ['COMMITTING', 'PLAN_CREATED', 'CANCELLED'].includes(current.state)) return
  try {
    await cancelOnboardingSession(current.id, current.stateVersion)
  } catch {
    // 取消接口失败不能阻断本地状态清理和弹窗关闭。
  }
}
async function restartSessionForSelectedPlatform(): Promise<boolean> {
  const platform = selectedPlatform.value
  if (!platform) return false
  if (session.value && !isRestartableSessionState(session.value.state)) await cancelCurrentSessionBestEffort()
  session.value = readObject<Session>((await createOnboardingSession(platform.platformKey)).data)
  await syncSessionRoute()
  return true
}
async function refreshCurrentSession(): Promise<void> {
  if (!session.value) return
  const refreshed = readObject<Session>((await getOnboardingSession(session.value.id)).data)
  if (refreshed.id !== session.value.id) return
  session.value = refreshed
  if (refreshed.deviceId) deviceId.value = refreshed.deviceId
}
async function prepareSessionForConnectionTest(): Promise<void> {
  if (!session.value) return
  if (isRestartableSessionState(session.value.state)) {
    if (await restartSessionForSelectedPlatform()) await selectExistingDeviceForSession()
    return
  }
  if (isResourceSelectionState(session.value.state)) {
    await selectExistingDeviceForSession()
    return
  }
  const selectedDeviceId = deviceId.value || session.value.deviceId || ''
  if (selectedPlatform.value?.deviceSelection === 'NONE') return
  if (session.value.deviceId && session.value.deviceId === selectedDeviceId) {
    deviceId.value = selectedDeviceId
    return
  }
  await restartSessionForSelectedPlatform()
  if (session.value) await selectExistingDeviceForSession()
}
async function selectExistingDeviceForSession(allowRecovery = true): Promise<void> {
  if (!session.value) return
  try {
    session.value = readObject<Session>((await selectOnboardingResource(session.value.id, {
      expectedStateVersion: session.value.stateVersion,
      mode: 'EXISTING_DEVICE',
      deviceId: deviceId.value || undefined,
    })).data)
  } catch (cause) {
    if (allowRecovery && await recoverSelectedResourceConflict(cause)) return
    throw cause
  }
  deviceId.value = session.value.deviceId ?? deviceId.value
}
async function continueCurrentSession(): Promise<void> {
  if (!session.value) return
  if (['CONNECTION_TESTING', 'DEVICE_ONBOARDING'].includes(session.value.state)) {
    session.value = readObject<Session>((await testOnboardingConnection(session.value.id, session.value.stateVersion)).data)
  }
  if (session.value.state === 'DISCOVERING') {
    session.value = readObject<Session>((await discoverOnboardingTargets(session.value.id, session.value.stateVersion)).data)
  }
  if (session.value.state === 'TARGET_SELECTION_REQUIRED') {
    targets.value = session.value.targets?.length ? session.value.targets : await readTargets()
    currentStepOverride.value = null
    return
  }
  if (['CERTIFICATE_SELECTION_REQUIRED', 'READY_TO_COMMIT'].includes(session.value.state)) {
    targets.value = session.value.targets?.length ? session.value.targets : await readTargets()
    currentStepOverride.value = 3
    return
  }
  currentStepOverride.value = null
}
async function recoverSelectedResourceConflict(cause: unknown): Promise<boolean> {
  if (!(cause instanceof ApiClientError) || !session.value) return false
  const refreshed = readObject<Session>((await getOnboardingSession(session.value.id)).data)
  session.value = refreshed
  if (refreshed.deviceId) deviceId.value = refreshed.deviceId
  if (isRestartableSessionState(refreshed.state)) {
    if (!await restartSessionForSelectedPlatform()) return false
    await selectExistingDeviceForSession(false)
    return true
  }
  return hasSelectedResource(refreshed.state)
}
function hasSelectedResource(state: string): boolean {
  return ['DEVICE_ONBOARDING', 'CONNECTION_TESTING', 'DISCOVERING', 'TARGET_SELECTION_REQUIRED', 'CERTIFICATE_SELECTION_REQUIRED', 'READY_TO_COMMIT'].includes(state)
}
function isRestartableSessionState(state: string): boolean {
  return ['FAILED', 'CANCELLED'].includes(state)
}
function readObject<T>(value: unknown): T { const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; return (record.data && typeof record.data === 'object' ? record.data : record) as T }
function readArray<T>(value: unknown): T[] { if (Array.isArray(value)) return value as T[]; const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}; return Array.isArray(record.items) ? record.items as T[] : [] }
function messageFor(cause: unknown): string { return cause instanceof ApiClientError ? cause.message : t('applicationOnboarding.messages.requestFailed') }
</script>

<template>
  <main class="onboarding-page" :class="{ 'onboarding-page--embedded': props.embedded }">
    <header v-if="!props.embedded" class="onboarding-page__header">
      <div><p class="onboarding-page__eyebrow">{{ t('applicationOnboarding.eyebrow') }}</p><h1>{{ t('applicationOnboarding.title') }}</h1><p>{{ t('applicationOnboarding.description') }}</p></div>
      <button class="gc-button gc-button--secondary" type="button" @click="openCustomManual">{{ t('applicationOnboarding.actions.customManual') }}</button>
    </header>
    <ol class="onboarding-steps" :aria-label="t('applicationOnboarding.stepsAria')">
      <li v-for="(label, index) in stepLabels" :key="label" :class="{ active: index + 1 === step, done: index + 1 < step, reachable: canNavigateToStep(index + 1) }">
        <button
          class="onboarding-steps__button"
          type="button"
          :disabled="loading || deviceListLoading || !canNavigateToStep(index + 1)"
          :aria-current="index + 1 === step ? 'step' : undefined"
          @click="navigateToStep(index + 1)"
        >
          <span class="onboarding-steps__marker" aria-hidden="true">{{ index + 1 }}</span>
          <span>{{ label }}</span>
        </button>
      </li>
    </ol>
    <p v-if="error" class="onboarding-error" role="alert">{{ error }}</p>
    <section v-if="!selectedPlatform" class="platform-grid">
      <button
        v-for="platform in platforms"
        :key="platform.platformKey"
        class="platform-card"
        :class="{ 'platform-card--review': platform.supportStatus === 'IN_REVIEW' }"
        type="button"
        :disabled="loading || platform.supportStatus === 'IN_REVIEW'"
        @click="choosePlatform(platform)"
      >
        <span class="platform-card__logo" :class="{ 'platform-card__logo--fallback': !platformLogoUrl(platform) }">
          <img v-if="platformLogoUrl(platform)" :src="platformLogoUrl(platform)" alt="" @error="markPlatformLogoFailed(platform.platformKey)">
          <span v-else aria-hidden="true">{{ platformInitial(platform) }}</span>
        </span>
        <span class="platform-card__copy">
          <strong>{{ platformLabel(platform) }}</strong>
          <small v-if="platform.source === 'CUSTOM_MANUAL'">{{ t('applicationOnboarding.platforms.manualHint') }}</small>
          <span v-else-if="platform.businessMetadata" class="platform-card__metadata">
            <small class="platform-card__metadata-row"><span>{{ t('applicationOnboarding.platforms.capabilityVersion') }}</span><span>{{ platform.businessMetadata.capabilityVersion }}</span></small>
            <small class="platform-card__metadata-row"><span>{{ t('applicationOnboarding.platforms.compatibility') }}</span><span>{{ platform.businessMetadata.compatibleVersions.join(' / ') }}</span></small>
            <small class="platform-card__metadata-row"><span>{{ t('applicationOnboarding.platforms.requiredInformation') }}</span><span>{{ platform.businessMetadata.requiredInformation.join(' / ') }}</span></small>
          </span>
          <small v-if="platform.supportStatus === 'IN_REVIEW'" class="platform-card__status">{{ t('applicationOnboarding.platforms.inReview') }}</small>
        </span>
      </button>
      <p v-if="!loading && platforms.length === 0" class="onboarding-empty">{{ t('applicationOnboarding.messages.noPlatforms') }}</p>
    </section>
    <section v-else class="onboarding-workspace">
      <div v-if="step === 2" class="onboarding-panel">
        <div class="onboarding-panel__header">
          <h2>{{ t('applicationOnboarding.device.title') }}</h2>
          <button
            v-if="deviceMode === 'EXISTING_DEVICE'"
            class="gc-button gc-button--secondary"
            type="button"
            :disabled="loading || deviceListLoading"
            @click="refreshDevices"
          >
            {{ deviceListLoading ? t('common.loading') : t('applicationOnboarding.device.refreshExisting') }}
          </button>
        </div>
        <div class="mode-switch">
          <label v-if="supportsExistingDevice"><input v-model="deviceMode" type="radio" value="EXISTING_DEVICE"> {{ t('applicationOnboarding.device.existing') }}</label>
          <label v-if="supportsNewDevice"><input v-model="deviceMode" type="radio" value="NEW_DEVICE"> {{ t('applicationOnboarding.device.new') }}</label>
        </div>
        <template v-if="deviceMode === 'EXISTING_DEVICE'">
          <label>{{ t('applicationOnboarding.device.existing') }}
            <select v-model="deviceId" :disabled="loading || deviceListLoading || devices.length === 0">
              <option value="">{{ t('applicationOnboarding.device.selectPlaceholder') }}</option>
              <option v-for="device in devices" :key="device.deviceId" :value="device.deviceId" :disabled="!device.selectable">{{ device.displayName }}{{ device.address ? ` (${device.address})` : '' }}</option>
            </select>
          </label>
          <p v-if="deviceListLoading" class="onboarding-empty">{{ t('applicationOnboarding.device.existingLoading') }}</p>
          <p v-else-if="deviceListLoaded && devices.length === 0" class="onboarding-empty">{{ t('applicationOnboarding.device.noExisting') }}</p>
        </template>
        <section v-else class="new-device-panel">
          <strong>{{ t('applicationOnboarding.device.new') }}</strong>
          <p>{{ t('applicationOnboarding.device.newDescription') }}</p>
          <p>{{ t('applicationOnboarding.device.newHint') }}</p>
        </section>
        <div class="onboarding-actions">
          <button v-if="canGoPrevious" class="gc-button gc-button--secondary" type="button" :disabled="loading || deviceListLoading" @click="goPrevious">{{ t('applicationOnboarding.actions.previous') }}</button>
          <button
            class="gc-button gc-button--primary"
            type="button"
            :disabled="deviceMode === 'EXISTING_DEVICE' ? !canContinueExistingDevice : !canOpenNewDevice"
            @click="submitResource"
          >
            {{ deviceMode === 'NEW_DEVICE' ? t('applicationOnboarding.device.newAction') : t('applicationOnboarding.actions.continue') }}
          </button>
        </div>
      </div>
      <div v-else-if="step === 3" class="onboarding-panel">
        <div class="onboarding-panel__header">
          <h2>{{ t('applicationOnboarding.target.title') }}</h2>
          <button class="gc-button gc-button--secondary" type="button" @click="refreshTargets">{{ t('applicationOnboarding.actions.refresh') }}</button>
        </div>
        <div class="target-list">
          <button
            v-for="target in selectableTargets"
            :key="target.managedTargetId"
            class="target-row"
            :class="{ 'target-row--unavailable': !target.selectable }"
            type="button"
            :disabled="!target.selectable"
            @click="chooseTarget(target)"
          >
            <span class="target-row__header">
              <span class="target-row__identity">
                <small>{{ t('applicationOnboarding.target.siteName') }}</small>
                <strong>{{ target.displayName }}</strong>
              </span>
              <span class="target-row__status" :class="target.selectable ? 'target-row__status--selectable' : 'target-row__status--unavailable'">
                {{ target.selectable ? t('applicationOnboarding.target.selectable') : t('applicationOnboarding.target.notSelectable') }}
              </span>
            </span>
            <span class="target-row__metadata">
              <span class="target-row__metadata-item">
                <small>{{ t('applicationOnboarding.target.listenAddress') }}</small>
                <strong>{{ targetMetadataValue(target.endpoint?.host) }}</strong>
              </span>
              <span class="target-row__metadata-item">
                <small>{{ t('applicationOnboarding.target.listenPort') }}</small>
                <strong>{{ targetMetadataValue(target.endpoint?.port) }}</strong>
              </span>
              <span class="target-row__metadata-item">
                <small>{{ t('applicationOnboarding.target.protocol') }}</small>
                <strong>{{ targetMetadataValue(target.endpoint?.protocol) }}</strong>
              </span>
            </span>
            <span v-if="!target.selectable" class="target-row__reason">
              <small>{{ t('applicationOnboarding.target.unavailableReason') }}</small>
              <span>{{ targetReasonLabel(target.reasonCode) }}</span>
            </span>
          </button>
        </div>
        <div class="onboarding-actions">
          <button v-if="canGoPrevious" class="gc-button gc-button--secondary" type="button" :disabled="loading" @click="goPrevious">{{ t('applicationOnboarding.actions.previous') }}</button>
        </div>
      </div>
      <div v-else-if="step === 4" class="onboarding-panel">
        <h2>{{ t('applicationOnboarding.certificate.title') }}</h2>
        <p v-if="platformAcceptedFormats.length" class="onboarding-hint">{{ t('applicationOnboarding.certificate.requiredFormat', { formats: platformAcceptedFormats.join(' / ') }) }}</p>
        <label>{{ t('applicationOnboarding.certificate.asset') }}
          <select v-model="certificateId" :disabled="loading || certificateAssets.length === 0" @change="loadCertificateVersions">
            <option v-for="asset in certificateAssets" :key="asset.id" :value="asset.id">{{ asset.label }}</option>
          </select>
        </label>
        <label>{{ t('applicationOnboarding.certificate.version') }}
          <select v-model="certificateVersionId" :disabled="loading || certificateVersions.length === 0" @change="onCertificateVersionChange">
            <option v-if="latestCertificateVersion" :value="LATEST_VERSION_MARKER">{{ autoLatestVersionLabel(latestCertificateVersion) }}</option>
            <option v-for="version in certificateVersions" :key="certificateVersionIdOf(version)" :value="certificateVersionIdOf(version)">{{ certificateVersionOptionLabel(version) }}</option>
          </select>
        </label>
        <div class="onboarding-actions">
          <button v-if="canGoPrevious" class="gc-button gc-button--secondary" type="button" :disabled="loading" @click="goPrevious">{{ t('applicationOnboarding.actions.previous') }}</button>
          <button class="gc-button gc-button--primary" type="button" :disabled="loading || !certificateId || !certificateVersionId" @click="saveCertificate">{{ t('applicationOnboarding.actions.review') }}</button>
        </div>
      </div>
      <div v-else-if="step === 5" class="onboarding-panel onboarding-panel--success"><h2>{{ t('applicationOnboarding.complete.title') }}</h2><p>{{ t('applicationOnboarding.complete.description') }}</p></div>
      <div v-if="session && step === 4 && session.state === 'READY_TO_COMMIT'" class="onboarding-footer"><button class="gc-button gc-button--primary" type="button" :disabled="loading" @click="complete">{{ t('applicationOnboarding.actions.complete') }}</button></div>
      <button v-if="session && !['PLAN_CREATED', 'CANCELLED'].includes(session.state)" class="gc-button gc-button--ghost" type="button" @click="cancel">{{ t('applicationOnboarding.actions.cancel') }}</button>
    </section>
  </main>
</template>

<style scoped>
.onboarding-page { display: grid; gap: var(--gc-space-6); padding: var(--gc-space-viewport); max-width: var(--gc-size-content-wide); margin: 0 auto; }
.onboarding-page--embedded { padding: 0; max-width: none; }
.onboarding-page__header { display: flex; justify-content: space-between; gap: var(--gc-space-6); align-items: flex-start; }
.onboarding-page__eyebrow { margin: 0; color: var(--gc-color-primary); font-size: var(--gc-font-size-xs); }
h1, h2, p { margin: 0; }
.onboarding-page__header p:last-child { margin-top: var(--gc-space-2); color: var(--gc-color-text-muted); }
.onboarding-steps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--gc-space-2); padding: 0; margin: 0; list-style: none; }
.onboarding-steps li { min-inline-size: 0; }
.onboarding-steps__button { display: flex; align-items: center; gap: var(--gc-space-3); inline-size: 100%; min-inline-size: 0; padding: var(--gc-space-3); color: var(--gc-color-text-muted); text-align: left; cursor: not-allowed; background: var(--gc-color-surface-soft); border: var(--gc-space-hairline) solid transparent; border-radius: var(--gc-radius-sm); }
.onboarding-steps__button:enabled { cursor: pointer; }
.onboarding-steps__button:focus-visible { outline: none; box-shadow: var(--gc-shadow-focus); }
.onboarding-steps li.active .onboarding-steps__button { color: var(--gc-color-text-inverse); background: var(--gc-gradient-primary); border-color: var(--gc-color-primary-border-strong); box-shadow: var(--gc-shadow-primary); }
.onboarding-steps li.done .onboarding-steps__button { color: var(--gc-color-success); background: var(--gc-color-surface); border-color: var(--gc-color-success-border); }
.onboarding-steps__marker { display: grid; flex: 0 0 auto; place-items: center; inline-size: var(--gc-space-6); block-size: var(--gc-space-6); color: inherit; background: var(--gc-color-surface); border-radius: var(--gc-radius-full); }
.onboarding-steps li.active .onboarding-steps__marker { color: var(--gc-color-primary); }
.onboarding-steps li.done .onboarding-steps__marker { color: var(--gc-color-text-inverse); background: var(--gc-color-success); }
.platform-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-content: start; min-block-size: 0; max-block-size: min(54vh, calc(100vh - (var(--gc-space-10) * 5))); gap: var(--gc-space-3); padding-inline-end: var(--gc-space-2); overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.platform-card { display: grid; grid-template-columns: calc(var(--gc-space-4) * 3) minmax(0, 1fr); align-items: start; gap: var(--gc-space-3); min-block-size: var(--gc-size-card-compact); padding: var(--gc-space-3); text-align: left; color: var(--gc-color-text); cursor: pointer; background: var(--gc-color-surface-soft); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-card); box-shadow: var(--gc-shadow-sm); transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease, transform 160ms ease; }
.platform-card:hover:not(:disabled) { background: var(--gc-color-surface); border-color: var(--gc-color-primary-border-strong); box-shadow: var(--gc-shadow-hover); transform: translateY(calc(var(--gc-space-hairline) * -1)); }
.platform-card:focus-visible { outline: none; box-shadow: var(--gc-shadow-focus); }
.platform-card:disabled { cursor: not-allowed; opacity: var(--gc-opacity-disabled); }
.platform-card--review { background: var(--gc-color-surface); }
.platform-card__logo { display: flex; align-items: center; justify-content: center; inline-size: calc(var(--gc-space-4) * 3); block-size: calc(var(--gc-space-4) * 3); overflow: hidden; background: var(--gc-color-surface); border: var(--gc-space-hairline) solid var(--gc-color-border-subtle); border-radius: var(--gc-radius-control); }
.platform-card__logo img { max-inline-size: 100%; max-block-size: 100%; }
.platform-card__logo--fallback { color: var(--gc-color-primary); background: var(--gc-color-primary-soft); font-size: var(--gc-font-size-heading-sm); font-weight: var(--gc-font-weight-semibold); }
.platform-card__copy { display: grid; min-inline-size: 0; gap: var(--gc-space-compact); }
.platform-card__copy strong { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-label); line-height: var(--gc-line-height-tight); overflow-wrap: anywhere; }
.platform-card__copy small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-caption); line-height: var(--gc-line-height-tight); overflow-wrap: anywhere; }
.platform-card__metadata { display: grid; gap: var(--gc-space-compact); }
.platform-card__metadata-row { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: baseline; column-gap: var(--gc-space-compact); }
.platform-card__metadata-row span:first-child { color: var(--gc-color-text-subtle); }
.platform-card__metadata-row span:last-child { color: var(--gc-color-text); }
.platform-card__copy .platform-card__status { color: var(--gc-color-warning); }
.target-row { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-4); color: var(--gc-color-text-strong); text-align: left; cursor: pointer; background: var(--gc-color-surface); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-md); }
.target-row:hover:not(:disabled) { background: var(--gc-color-surface-selected); border-color: var(--gc-color-primary-border); }
.target-row:focus-visible { outline: none; box-shadow: var(--gc-shadow-focus); }
.target-row--unavailable { cursor: not-allowed; background: var(--gc-color-surface-soft); border-color: var(--gc-color-border-subtle); }
.target-row__header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--gc-space-3); }
.target-row__identity { display: grid; min-inline-size: 0; gap: var(--gc-space-1); }
.target-row__identity small, .target-row__metadata-item small, .target-row__reason small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-caption); line-height: var(--gc-line-height-tight); }
.target-row__identity strong { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-body); overflow-wrap: anywhere; }
.target-row__status { flex: 0 0 auto; padding: var(--gc-space-badge-block) var(--gc-space-2); font-size: var(--gc-font-size-xs); font-weight: var(--gc-font-weight-medium); border: var(--gc-space-hairline) solid; border-radius: var(--gc-radius-pill); }
.target-row__status--selectable { color: var(--gc-color-success); background: var(--gc-color-success-soft); border-color: var(--gc-color-success-border); }
.target-row__status--unavailable { color: var(--gc-color-danger); background: var(--gc-color-danger-soft); border-color: var(--gc-color-danger-border); }
.target-row__metadata { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-2); }
.target-row__metadata-item { display: grid; min-inline-size: 0; gap: var(--gc-space-1); padding: var(--gc-space-2) var(--gc-space-3); background: var(--gc-color-surface-soft); border-radius: var(--gc-radius-control); }
.target-row__metadata-item strong { color: var(--gc-color-text); font-size: var(--gc-font-size-sm); font-weight: var(--gc-font-weight-medium); overflow-wrap: anywhere; }
.target-row__reason { display: grid; gap: var(--gc-space-1); padding: var(--gc-space-2) var(--gc-space-3); color: var(--gc-color-danger); background: var(--gc-color-danger-soft); border: var(--gc-space-hairline) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-control); }
.target-row__reason span { color: var(--gc-color-danger); font-size: var(--gc-font-size-xs); line-height: var(--gc-line-height-normal); }
.onboarding-workspace { display: grid; gap: var(--gc-space-4); max-width: var(--gc-size-content-readable); }
.onboarding-panel { display: grid; gap: var(--gc-space-4); padding: var(--gc-space-6); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface); }
.onboarding-panel__header { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); }
.onboarding-panel label { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); }
.onboarding-panel input, .onboarding-panel select { min-height: var(--gc-control-height-md); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); padding: 0 var(--gc-space-3); background: var(--gc-color-surface-field); color: var(--gc-color-text); }
.mode-switch { display: flex; flex-wrap: wrap; gap: var(--gc-space-4); }
.mode-switch label { display: flex; align-items: center; gap: var(--gc-space-2); }
.onboarding-actions { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--gc-space-3); }
.onboarding-actions .gc-button--primary { margin-inline-start: auto; }
.new-device-panel { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-4); color: var(--gc-color-text-muted); background: var(--gc-color-surface-soft); border: var(--gc-space-hairline) solid var(--gc-color-border-subtle); border-radius: var(--gc-radius-sm); }
.new-device-panel strong { color: var(--gc-color-text-strong); }
.target-list { display: grid; gap: var(--gc-space-2); }
.onboarding-error { color: var(--gc-color-danger); background: var(--gc-color-danger-soft); padding: var(--gc-space-3); border-radius: var(--gc-radius-sm); }
.onboarding-empty { color: var(--gc-color-text-muted); }
.onboarding-hint { margin: 0; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.onboarding-footer { display: flex; justify-content: flex-end; }
.onboarding-panel--success { border-color: var(--gc-color-success-border); background: var(--gc-color-success-soft); }
@media (max-width: 64rem) { .onboarding-steps { grid-template-columns: repeat(3, minmax(0, 1fr)); } .platform-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 48rem) { .onboarding-page__header { flex-direction: column; } .onboarding-steps { grid-template-columns: 1fr; } .platform-grid { grid-template-columns: 1fr; max-block-size: none; padding-inline-end: 0; overflow: visible; } .target-row__metadata { grid-template-columns: 1fr; } }
</style>

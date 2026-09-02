<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { type LocationQueryRaw, useRoute, useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import {
  DeploymentInputForm,
  GcPluginLogo,
  GcSelectionCard,
  type DeploymentArtifactOption,
  type DeploymentCredentialOption,
  type DeploymentInputBindingsV1,
  type DeploymentInputProjectionV1,
} from '@/design-system/components'
import {
  cancelOnboardingSession,
  completeOnboardingSession,
  createOnboardingSession,
  discoverOnboardingTargets,
  getOnboardingSession,
  listOnboardingCertificateOptions,
  listOnboardingResources,
  listOnboardingPlatforms,
  listOnboardingTargets,
  selectOnboardingCertificate,
  selectOnboardingResource,
  selectOnboardingTarget,
  testOnboardingConnection
} from '@/api/modules/application-onboarding.api'
import { projectApplicationAssetPluginInputs, type ApplicationAssetDeploymentDefaults } from '@/api/modules/deployment-inputs.api'
import { listCredentials, type CredentialProfileSummary } from '@/api/modules/credentials.api'
import { listCertificateFormats } from '@/api/modules/certificates.api'
import { saveApplicationCertificateSupplyPolicy } from '@/api/modules/assets.api'
import { automationAction, createAutomation, type AutomationConfiguration } from '@/api/modules/automations.api'
import { sortDeployableCertificateVersions } from '@/views/deployments/certificate-version-selection'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { localizeCertificateFormatName } from '@/utils/certificate-format-localization'
import { cloneReactiveValue } from '@/utils/clone-reactive-value'
import type { DeviceOnboardingInitialSelection } from '@/views/devices/device-onboarding.model'
import { createInputBindingsV1, readInputBindingsV1 } from '@/views/assets/asset-input-bindings.model'

interface PlatformBusinessMetadata { capabilityVersion: string; compatibleVersions: string[]; requiredInformation: string[] }
type ProductCategory = 'WEB_SITE' | 'APPLICATION_MIDDLEWARE' | 'NETWORK_GATEWAY' | 'CLOUD_PLATFORM'
interface Platform { platformKey: string; source: 'PLUGIN' | 'CUSTOM_MANUAL'; productCategory?: ProductCategory; pluginVersionId?: string; displayNameKey: string; displayName?: string; description?: string; logoUrl?: string; logoSquareUrl?: string; businessMetadata?: PlatformBusinessMetadata; deploymentMode?: string; deviceSelection?: 'EXISTING_OR_NEW' | 'EXISTING_ONLY' | 'NONE'; newDeviceOnboarding?: DeviceOnboardingInitialSelection; supportStatus?: string; acceptedCertificateFormats?: string[]; deploymentDefaults?: ApplicationAssetDeploymentDefaults }
interface Session { id: string; platformKey: string; state: string; stateVersion: number; deploymentMode?: string; deviceId?: string | null; assetId?: string | null; targetId?: string | null; certificateId?: string | null; certificateVersionId?: string | null; targets?: Target[]; inputSnapshot?: Record<string, unknown>; result?: Record<string, unknown>; lastErrorCode?: string }
interface TargetEndpoint { host?: string; port?: number; protocol?: string }
interface Target { managedTargetId: string; displayName: string; targetType: string; endpoint?: TargetEndpoint; configFingerprint: string; selectable: boolean; reasonCode?: string }
interface ResourceOption { assetRef: { rootType: 'DEVICE' | 'SERVICE_ASSET'; id: string }; resourceType: 'DEVICE' | 'SERVICE_ASSET'; displayName: string; address?: string; health: string; selectable: boolean }
interface CertificateOption { id: string; label: string; domains: string[] }
type OnboardingStep = 1 | 2 | 3 | 4 | 5
type FooterPrimaryAction = 'RESOURCE' | 'TARGET' | 'CERTIFICATE' | 'COMPLETE' | 'CLOSE' | null
interface OnboardingFooterActions {
  visible: boolean
  showCancel: boolean
  showPrevious: boolean
  previousDisabled: boolean
  primaryAction: FooterPrimaryAction
  primaryLabel: string
  primaryDisabled: boolean
}
/** 与部署计划向导保持一致的“始终使用最新版本”选项标记。 */
const LATEST_VERSION_MARKER = '__LATEST__'

const props = withDefaults(defineProps<{
  embedded?: boolean
  platformKeyword?: string
}>(), {
  embedded: false,
})
const emit = defineEmits<{
  close: []
  customManual: []
  addDevice: [initialSelection: DeviceOnboardingInitialSelection]
  'update:platformKeyword': [value: string]
  'platform-selection-change': [active: boolean]
  'footer-actions-change': [actions: OnboardingFooterActions]
}>()

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const platforms = ref<Platform[]>([])
const standalonePlatformKeyword = ref('')
const selectedPlatform = ref<Platform | null>(null)
const session = ref<Session | null>(null)
const targets = ref<Target[]>([])
const resources = ref<ResourceOption[]>([])
// 平台列表首次请求尚未完成前保持明确的加载态，避免模态框出现空白内容区。
const loading = ref(true)
const deviceListLoading = ref(false)
const deviceListLoaded = ref(false)
const submitInFlight = ref(false)
const error = ref('')
const deviceMode = ref<'EXISTING_DEVICE' | 'EXISTING_SERVICE_ASSET' | 'NEW_DEVICE'>('EXISTING_DEVICE')
const deviceId = ref('')
const assetId = ref('')
const pendingTarget = ref<Target | null>(null)
const targetConfigRef = ref<HTMLElement | null>(null)
const accessDomain = ref('')
const verifyUrl = ref('')
const certificateId = ref('')
const certificateVersionId = ref('')
const certificateSelectionMode = ref<'EXPLICIT' | 'LATEST_AUTO' | 'DEDICATED'>('EXPLICIT')
const certificateSupplyMode = ref<'manual' | 'dedicated'>('manual')
const dedicatedProviderType = ref<'internal_ca' | 'acme'>('internal_ca')
const automationTrigger = ref<'none' | 'certificate_version_created' | 'once' | 'schedule'>('none')
const automationRunAt = ref('')
const automationScheduleUnit = ref<'daily' | 'weekly' | 'monthly'>('daily')
const automationScheduleDay = ref('1')
const automationScheduleTime = ref('02:00')
const automationTimeZone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai')
const automationDeploymentMode = ref<'immediate' | 'scheduled'>('immediate')
const automationDeploymentScheduleTime = ref('02:00')
const commitProgress = ref<Array<{ key: string; status: 'pending' | 'running' | 'success' | 'failed' }>>([])
const certificateAssets = ref<CertificateOption[]>([])
const certificateVersions = ref<Record<string, unknown>[]>([])
const deploymentInputProjection = ref<DeploymentInputProjectionV1 | null>(null)
const deploymentInputBindings = ref<DeploymentInputBindingsV1>(createInputBindingsV1())
const deploymentInputLoading = ref(false)
const deploymentInputError = ref('')
const deploymentCredentialItems = ref<CredentialProfileSummary[]>([])
const deploymentCertificateFormats = ref<Record<string, unknown>[]>([])
let deploymentInputRequestSequence = 0
const currentStepOverride = ref<OnboardingStep | null>(null)
const supportsNewDevice = computed(() => selectedPlatform.value?.deviceSelection === 'EXISTING_OR_NEW' && Boolean(selectedPlatform.value.newDeviceOnboarding))
// NONE 仅表示不选择设备；直工作流仍然需要选择其对应的云服务资产。
const supportsResourceSelection = computed(() => selectedPlatform.value?.deviceSelection !== 'NONE' || selectedPlatform.value?.deploymentMode === 'DIRECT_WORKFLOW')
const canContinueExistingDevice = computed(() => !loading.value && !deviceListLoading.value && !submitInFlight.value && deviceMode.value !== 'NEW_DEVICE' && Boolean(deviceId.value || assetId.value))
const canOpenNewDevice = computed(() => !loading.value && !deviceListLoading.value && !submitInFlight.value && deviceMode.value === 'NEW_DEVICE' && supportsNewDevice.value)
const backendStep = computed<OnboardingStep>(() => stepForState(session.value?.state))
const step = computed<OnboardingStep>(() => {
  const override = currentStepOverride.value
  if (override && canNavigateToStep(override)) return override
  return selectedPlatform.value ? backendStep.value : 1
})
const canGoPrevious = computed(() => step.value > 1 && step.value < 5 && !loading.value && !deviceListLoading.value)
const footerActions = computed<OnboardingFooterActions>(() => {
  const activeSession = Boolean(session.value && !['PLAN_CREATED', 'CANCELLED'].includes(session.value.state))
  let primaryAction: FooterPrimaryAction = null
  let primaryLabel = ''
  let primaryDisabled = true

  if (step.value === 2 && session.value) {
    primaryAction = 'RESOURCE'
    primaryLabel = deviceMode.value === 'NEW_DEVICE'
      ? t('applicationOnboarding.device.newAction')
      : t('applicationOnboarding.actions.continue')
    primaryDisabled = deviceMode.value !== 'NEW_DEVICE' ? !canContinueExistingDevice.value : !canOpenNewDevice.value
  } else if (step.value === 4 && session.value) {
    primaryAction = session.value.state === 'READY_TO_COMMIT' ? 'COMPLETE' : 'CERTIFICATE'
    primaryLabel = session.value.state === 'READY_TO_COMMIT'
      ? t('applicationOnboarding.actions.complete')
      : t('applicationOnboarding.actions.review')
    primaryDisabled = session.value.state === 'READY_TO_COMMIT'
      ? loading.value
      : loading.value
        || (certificateSupplyMode.value === 'manual' && (!certificateId.value || !certificateVersionId.value))
        || (automationTrigger.value === 'once' && !automationRunAt.value)
  } else if (step.value === 5) {
    // 如果还没有开始创建（commitProgress为空），显示"确认并创建"按钮
    // 如果已经开始创建了，显示"关闭"按钮
    primaryAction = commitProgress.value.length === 0 ? 'COMPLETE' : 'CLOSE'
    primaryLabel = commitProgress.value.length === 0
      ? t('applicationOnboarding.actions.complete')
      : t('applicationOnboarding.actions.close')
    primaryDisabled = loading.value
  } else if (step.value === 3 && session.value) {
    primaryAction = 'TARGET'
    primaryLabel = t('applicationOnboarding.actions.continue')
    const requiresDeploymentInput = Boolean(selectedPlatform.value?.deploymentDefaults)
    primaryDisabled = loading.value
      || deploymentInputLoading.value
      || Boolean(deploymentInputError.value)
      || !pendingTarget.value
      || !isValidTargetConfiguration(accessDomain.value, verifyUrl.value)
      || (requiresDeploymentInput && !deploymentInputProjection.value?.saveable)
  }

  const showPrevious = canGoPrevious.value
  const showCancel = activeSession && !loading.value
  return {
    visible: showCancel || showPrevious || primaryAction !== null,
    showCancel,
    showPrevious,
    previousDisabled: loading.value || deviceListLoading.value,
    primaryAction,
    primaryLabel,
    primaryDisabled,
  }
})
const platformSearchKeyword = computed({
  get: () => props.platformKeyword ?? standalonePlatformKeyword.value,
  set: (value: string) => {
    if (props.platformKeyword !== undefined) {
      emit('update:platformKeyword', value)
      return
    }
    standalonePlatformKeyword.value = value
  },
})
const platformCategory = ref<'all' | ProductCategory>('all')
const platformCategoryOptions: ReadonlyArray<{ value: 'all' | ProductCategory; labelKey: string }> = [
  { value: 'all', labelKey: 'plugins.categories.all' },
  { value: 'WEB_SITE', labelKey: 'plugins.categories.WEB_SITE' },
  { value: 'APPLICATION_MIDDLEWARE', labelKey: 'plugins.categories.APPLICATION_MIDDLEWARE' },
  { value: 'NETWORK_GATEWAY', labelKey: 'plugins.categories.NETWORK_GATEWAY' },
  { value: 'CLOUD_PLATFORM', labelKey: 'plugins.categories.CLOUD_PLATFORM' },
]
const stepLabels = computed(() => [
  t('applicationOnboarding.steps.platform'), t('applicationOnboarding.steps.device'), t('applicationOnboarding.steps.target'), t('applicationOnboarding.steps.certificate'), t('applicationOnboarding.steps.complete')
])
const hasPlatformKeyword = computed(() => platformSearchKeyword.value.trim().length > 0)
// 平台卡片按当前语言的显示名称升序排列，同名时用平台标识保证顺序稳定。
const sortedPlatforms = computed(() => [...platforms.value].sort(comparePlatformsByName))
const filteredPlatforms = computed(() => {
  const keyword = platformSearchKeyword.value.trim().toLocaleLowerCase(locale.value)
  return sortedPlatforms.value.filter((platform) => {
    // 自定义手动创建不是插件分类，只在“全部”视图保留。
    if (platformCategory.value !== 'all' && (platform.source === 'CUSTOM_MANUAL' || platform.productCategory !== platformCategory.value)) return false
    const metadata = platform.businessMetadata
    const searchableValues = [
      platformLabel(platform),
      platform.platformKey,
      metadata?.capabilityVersion,
      ...(metadata?.compatibleVersions ?? []),
      ...(metadata?.requiredInformation ?? []),
    ]
    return !keyword || searchableValues.some((value) => String(value ?? '').toLocaleLowerCase(locale.value).includes(keyword))
  })
})
// 站点选择步骤只展示实际可用的受管目标；停用或不满足选择条件的目标不显示。
const selectableTargets = computed(() => targets.value.filter((target) => target.selectable))
// 证书版本列表按到期时间倒序，第一项即最新可部署版本。
const latestCertificateVersion = computed(() => certificateVersions.value[0] ?? null)
const selectedCertificateVersion = computed(() => certificateVersions.value.find((item) => certificateVersionIdOf(item) === certificateVersionId.value) ?? latestCertificateVersion.value)
// 插件配方声明的平台接受格式，作为证书步骤的向导参数展示。
const platformAcceptedFormats = computed(() => selectedPlatform.value?.acceptedCertificateFormats ?? [])
// “始终使用最新版本”选项在提交时解析为当前最新版本 ID，作为 LATEST_AUTO 计划的种子版本。
const resolvedCertificateVersionId = computed(() =>
  certificateVersionId.value === LATEST_VERSION_MARKER
    ? certificateVersionIdOf(latestCertificateVersion.value)
    : certificateVersionId.value,
)
const deploymentCredentialOptions = computed<DeploymentCredentialOption[]>(() => {
  const options: DeploymentCredentialOption[] = deploymentCredentialItems.value.map((item) => ({
    id: item.id,
    label: item.name,
    kind: item.kind,
  }))
  const knownIds = new Set(options.map((item) => item.id))
  for (const item of deploymentInputProjection.value?.credentials ?? []) {
    if (!item.selectedCredentialId || knownIds.has(item.selectedCredentialId)) continue
    options.push({
      id: item.selectedCredentialId,
      label: item.selectedCredentialId,
      kind: item.allowedKinds[0],
    })
  }
  return options
})
const deploymentArtifactOptions = computed<Record<string, DeploymentArtifactOption[]>>(() => {
  const projection = deploymentInputProjection.value
  if (!projection) return {}
  const acceptedFormats = new Set((selectedPlatform.value?.acceptedCertificateFormats ?? []).map((format) => format.toLowerCase()))
  return Object.fromEntries(projection.artifacts.map((artifact) => {
    const options = deploymentCertificateFormats.value
    .filter((format) => acceptedFormats.size === 0 || acceptedFormats.has(String(format.format ?? '').toLowerCase()))
    .map((format) => {
      const id = String(format.id ?? '')
      return { id, label: certificateFormatLabel(format), outputs: certificateFormatOutputOptions(id) }
    })
    const selectedId = artifact.binding?.certificateFormatId
    if (selectedId && !options.some((option) => option.id === selectedId)) {
      options.unshift({
        id: selectedId,
        label: defaultCertificateFormatLabel(selectedId),
        outputs: Object.keys(artifact.binding?.outputBindings ?? {}).map((key) => ({ key, label: key })),
      })
    }
    return [artifact.slot, options]
  }))
})
const deploymentInputFormProjection = computed<DeploymentInputProjectionV1 | null>(() => {
  const projection = deploymentInputProjection.value
  const defaults = selectedPlatform.value?.deploymentDefaults
  if (!projection || !defaults) return projection
  const variableSlots = new Set(Object.keys(defaults.variables ?? {}))
  const credentialSlots = new Set(Object.keys(defaults.credentials ?? {}))
  const connections = projection.connections
    .map((connection) => {
      const configured = defaults.connections?.[connection.slot]
      if (!configured) return null
      const fields = Object.fromEntries(Object.entries(connection.fields)
        .filter(([path]) => hasConfiguredDefaultPath(configured, path)))
      return Object.keys(fields).length > 0 ? { ...connection, fields } : null
    })
    .filter((connection): connection is NonNullable<typeof connection> => Boolean(connection))
  return {
    ...projection,
    requiredVariables: projection.requiredVariables.filter((item) => variableSlots.has(item.slot)),
    advancedVariables: projection.advancedVariables.filter((item) => variableSlots.has(item.slot)),
    connections,
    credentials: projection.credentials.filter((item) => credentialSlots.has(item.slot)),
    artifacts: defaults.certificateFormat
      ? projection.artifacts.filter((item) => item.kind === 'certificate')
      : [],
    fixedValues: [],
    runtimeValues: [],
  }
})
onMounted(restoreSession)
watch(selectedPlatform, (platform) => {
  emit('platform-selection-change', !platform)
}, { immediate: true })
watch(deviceMode, (mode) => {
  if (mode !== 'NEW_DEVICE' && session.value && step.value === 2) void refreshResources()
})
watch(footerActions, (actions) => {
  if (props.embedded) emit('footer-actions-change', actions)
}, { immediate: true })

async function loadPlatforms(): Promise<void> {
  loading.value = true; error.value = ''
  try {
    platforms.value = readArray<Platform>((await listOnboardingPlatforms(locale.value)).data)
  } catch (cause) { error.value = messageFor(cause) } finally { loading.value = false }
}

function readBusinessMetadata(value: unknown): PlatformBusinessMetadata | undefined {
  const metadata = readRecord(value) ?? {}
  const capabilityVersion = String(metadata.capabilityVersion ?? '').trim()
  const compatibleVersions = Array.isArray(metadata.compatibleVersions) ? metadata.compatibleVersions.map(String).filter(Boolean) : []
  const requiredInformation = Array.isArray(metadata.requiredInformation) ? metadata.requiredInformation.map(String).filter(Boolean) : []
  return capabilityVersion && compatibleVersions.length > 0 && requiredInformation.length > 0
    ? { capabilityVersion, compatibleVersions, requiredInformation }
    : undefined
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
    await refreshResources()
  } catch (cause) { error.value = messageFor(cause) } finally { loading.value = false }
}

function openCustomManual(): void {
  if (props.embedded) {
    emit('customManual')
    return
  }
  void router.push({ path: '/applications', query: { ...route.query, create: '1' } })
}

function openPluginCenter(): void {
  void router.push('/plugins')
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

async function runFooterPrimary(): Promise<void> {
  if (footerActions.value.primaryAction === 'RESOURCE') {
    await submitResource()
    return
  }
  if (footerActions.value.primaryAction === 'TARGET') {
    await saveTarget()
    return
  }
  if (footerActions.value.primaryAction === 'CERTIFICATE') {
    await saveCertificate()
    return
  }
  if (footerActions.value.primaryAction === 'COMPLETE') await complete()
  if (footerActions.value.primaryAction === 'CLOSE') await closeCompleted()
}

async function refreshTargets(): Promise<void> { if (session.value) targets.value = readArray<Target>((await listOnboardingTargets(session.value.id)).data) }
async function refreshResources(): Promise<void> {
  if (!session.value || !supportsResourceSelection.value) return
  deviceListLoading.value = true
  deviceListLoaded.value = true
  try {
    resources.value = readArray<ResourceOption>((await listOnboardingResources(session.value.id)).data)
    if (deviceId.value && !resources.value.some((item) => item.resourceType === 'DEVICE' && item.assetRef.id === deviceId.value && item.selectable)) deviceId.value = ''
    if (assetId.value && !resources.value.some((item) => item.resourceType === 'SERVICE_ASSET' && item.assetRef.id === assetId.value && item.selectable)) assetId.value = ''
  } catch (cause) {
    resources.value = []
    error.value = messageFor(cause)
  } finally {
    deviceListLoading.value = false
  }
}
function selectExistingResource(resource: ResourceOption): void {
  if (!resource.selectable || loading.value || deviceListLoading.value) return
  deviceMode.value = resource.resourceType === 'SERVICE_ASSET' ? 'EXISTING_SERVICE_ASSET' : 'EXISTING_DEVICE'
  deviceId.value = resource.resourceType === 'DEVICE' ? resource.assetRef.id : ''
  assetId.value = resource.resourceType === 'SERVICE_ASSET' ? resource.assetRef.id : ''
}
function selectNewDevice(): void {
  if (!supportsNewDevice.value || loading.value || deviceListLoading.value) return
  deviceMode.value = 'NEW_DEVICE'
  deviceId.value = ''
  assetId.value = ''
}
async function chooseTarget(target: Target): Promise<void> {
  if (!session.value || !target.selectable || loading.value) return
  pendingTarget.value = target
  accessDomain.value = suggestedAccessDomain(target)
  verifyUrl.value = suggestedVerifyUrl(accessDomain.value, target.endpoint?.port, target.endpoint?.protocol)
  error.value = ''
  void loadDeploymentInputProjection(target)
  await nextTick()
  if (targetConfigRef.value && typeof targetConfigRef.value.scrollIntoView === 'function') {
    targetConfigRef.value.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
  targetConfigRef.value?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
}
async function loadDeploymentInputProjection(target: Target, options: { preserveBindings?: boolean } = {}): Promise<void> {
  const sequence = ++deploymentInputRequestSequence
  const platform = selectedPlatform.value
  const defaults = platform?.deploymentDefaults
  if (!platform?.pluginVersionId || !defaults || !session.value) {
    deploymentInputProjection.value = null
    deploymentInputBindings.value = createInputBindingsV1()
    deploymentInputLoading.value = false
    return
  }
  deploymentInputLoading.value = true
  deploymentInputError.value = ''
  try {
    if (!options.preserveBindings) {
      deploymentInputBindings.value = createInputBindingsV1({
        variables: cloneReactiveValue(defaults.variables ?? {}),
        connections: cloneReactiveValue(defaults.connections ?? {}) as DeploymentInputBindingsV1['connections'],
        credentials: cloneReactiveValue(defaults.credentials ?? {}),
      })
    }
    // 选项列表只负责补充下拉框，不能阻塞通用部署表单的主投影请求。
    void loadDeploymentInputOptions()
    const endpoint = target.endpoint ?? {}
    const result = await projectApplicationAssetPluginInputs(target.managedTargetId, {
      capabilityKey: defaults.capabilityKey,
      pluginVersionId: platform.pluginVersionId,
      deploymentDefaults: defaults,
      applicationAsset: {
        id: 'draft',
        address: accessDomain.value.trim() || endpoint.host || target.displayName,
        sniName: accessDomain.value.trim() || undefined,
        verifyUrl: verifyUrl.value.trim() || undefined,
        port: endpoint.port ?? 443,
        protocol: endpoint.protocol ?? 'HTTPS',
        displayName: target.displayName,
      },
      inputBindings: deploymentInputBindings.value,
    })
    if (sequence !== deploymentInputRequestSequence) return
    deploymentInputProjection.value = result.data ?? null
    if (deploymentInputProjection.value) {
      deploymentInputBindings.value = mergeProjectedInputBindings(
        deploymentInputBindings.value,
        deploymentInputProjection.value,
      )
    }
  } catch (cause) {
    if (sequence !== deploymentInputRequestSequence) return
    deploymentInputProjection.value = null
    deploymentInputError.value = messageFor(cause)
  } finally {
    if (sequence === deploymentInputRequestSequence) deploymentInputLoading.value = false
  }
}

async function loadDeploymentInputOptions(): Promise<void> {
  const [formatResult, credentialResult] = await Promise.allSettled([
    listCertificateFormats({ page: 1, pageSize: 5000, sort: 'createdAt:desc' }),
    listCredentials(),
  ])
  if (formatResult.status === 'fulfilled') {
    deploymentCertificateFormats.value = [...(formatResult.value.data?.items ?? [])]
  }
  if (credentialResult.status === 'fulfilled') {
    deploymentCredentialItems.value = [...(credentialResult.value.data?.items ?? [])]
      .filter((item) => item.status === 'active')
  }
}
async function saveTarget(): Promise<void> {
  if (!session.value || !pendingTarget.value || !isValidTargetConfiguration(accessDomain.value, verifyUrl.value)) {
    error.value = t('applicationOnboarding.target.invalidConfiguration')
    return
  }
  loading.value = true
  error.value = ''
  try {
    const selectedTarget = pendingTarget.value
    if (selectedPlatform.value?.deploymentDefaults) {
      await loadDeploymentInputProjection(selectedTarget, { preserveBindings: true })
      if (deploymentInputError.value) {
        error.value = deploymentInputError.value
        return
      }
      if (!deploymentInputProjection.value?.saveable) {
        const issue = deploymentInputProjection.value?.issues.find((item) => item.severity === 'ERROR')
        error.value = issue
          ? t('deploymentInputs.issues.unknown', { code: issue.code })
          : t('deploymentInputs.issues.unknown', { code: 'DEPLOYMENT_INPUT_REQUIRED' })
        return
      }
    }
    session.value = readObject<Session>((await selectOnboardingTarget(session.value.id, {
      expectedStateVersion: session.value.stateVersion,
      managedTargetId: selectedTarget.managedTargetId,
      configFingerprint: selectedTarget.configFingerprint,
      accessDomain: accessDomain.value.trim().toLowerCase().replace(/\.+$/, ''),
      verifyUrl: verifyUrl.value.trim(),
      ...(deploymentInputProjection.value ? { inputBindings: deploymentInputBindings.value } : {}),
    })).data)
    pendingTarget.value = null
    currentStepOverride.value = null
    await loadCertificateAssets()
  } catch (cause) { error.value = messageFor(cause) } finally { loading.value = false }
}
async function saveCertificate(): Promise<void> {
  if (!session.value) return
  loading.value = true
  error.value = ''
  try {
    if (certificateSupplyMode.value === 'dedicated') {
      session.value = readObject<Session>((await selectOnboardingCertificate(session.value.id, {
        expectedStateVersion: session.value.stateVersion,
        certificateId: '',
        certificateVersionId: '',
        selectionMode: 'DEDICATED',
      })).data)
      currentStepOverride.value = null
      // 跳转到步骤5显示摘要
      await nextTick()
      if (session.value.state === 'READY_TO_COMMIT') {
        currentStepOverride.value = 5
      }
      return
    }
    session.value = readObject<Session>((await selectOnboardingCertificate(session.value.id, {
      expectedStateVersion: session.value.stateVersion,
      certificateId: certificateId.value,
      certificateVersionId: resolvedCertificateVersionId.value,
      selectionMode: certificateVersionId.value === LATEST_VERSION_MARKER ? 'LATEST_AUTO' : 'EXPLICIT',
    })).data)
    currentStepOverride.value = null
    // 跳转到步骤5显示摘要
    await nextTick()
    if (session.value.state === 'READY_TO_COMMIT') {
      currentStepOverride.value = 5
    }
  } catch (cause) { error.value = messageFor(cause) } finally { loading.value = false }
}
async function complete(): Promise<void> {
  if (!session.value) return
  loading.value = true
  currentStepOverride.value = 5
  commitProgress.value = [
    { key: 'application', status: 'running' },
    { key: 'certificate', status: 'pending' },
    { key: 'automation', status: automationTrigger.value === 'none' ? 'success' : 'pending' },
  ]
  try {
    session.value = readObject<Session>((await completeOnboardingSession(session.value.id, session.value.stateVersion)).data)
    commitProgress.value[0].status = 'success'
    const result = readRecord(session.value.result) ?? {}
    const applicationAssetId = readString(result, ['applicationAssetId'])
    if (certificateSupplyMode.value === 'dedicated' && applicationAssetId) {
      commitProgress.value[1].status = 'running'
      await saveApplicationCertificateSupplyPolicy(applicationAssetId, {
        supplyMode: 'dedicated',
        providerType: dedicatedProviderType.value,
        status: 'draft',
      })
      commitProgress.value[1].status = 'success'
    } else {
      commitProgress.value[1].status = 'success'
    }
    if (automationTrigger.value !== 'none' && applicationAssetId) {
      commitProgress.value[2].status = 'running'
      const automation = await createAutomation(buildAutomationConfiguration(applicationAssetId))
      await automationAction(automation.id, 'enable', automation.version)
      commitProgress.value[2].status = 'success'
    }
    currentStepOverride.value = null
  } catch (cause) {
    const failed = commitProgress.value.find((item) => item.status === 'running')
    if (failed) failed.status = 'failed'
    error.value = messageFor(cause)
    // 如果是 ApiClientError，尝试显示更详细的错误信息
    if (cause instanceof ApiClientError && cause.details) {
      const details = cause.details as Record<string, unknown>
      if (details.issues && Array.isArray(details.issues)) {
        const issuesText = details.issues.map((issue) => {
          if (typeof issue === 'string') return issue
          if (typeof issue === 'object' && issue !== null) {
            return JSON.stringify(issue, null, 2)
          }
          return String(issue)
        }).join('\n')
        error.value += '\n\n详细信息：\n' + issuesText
      }
      // 显示插件版本不匹配的详细信息
      if (details.pluginVersionId || details.bindingPluginVersionId) {
        error.value += '\n\n插件版本不匹配：'
        if (details.pluginVersionId) error.value += `\n当前插件版本：${details.pluginVersionId}`
        if (details.bindingPluginVersionId) error.value += `\n应用绑定版本：${details.bindingPluginVersionId}`
        error.value += '\n\n建议：请尝试删除此应用并重新创建，或联系管理员更新应用的插件绑定。'
      }
      // 显示其他可能有用的详细信息
      if (details.sourceType || details.sourceId) {
        error.value += `\n\n来源类型：${details.sourceType || '未知'}`
        if (details.sourceId) error.value += `\n来源ID：${details.sourceId}`
      }
    }
    currentStepOverride.value = 4
  } finally { loading.value = false }
}
function buildAutomationConfiguration(applicationAssetId: string): AutomationConfiguration & { name: string; description: string } {
  const trigger: AutomationConfiguration['trigger'] = automationTrigger.value === 'certificate_version_created'
    ? {
      type: 'certificate_version_created',
      sources: ['manual_import', 'acme_issue'],
      ...(automationDeploymentMode.value === 'scheduled' ? {
        deploymentSchedule: {
          hour: Number(automationDeploymentScheduleTime.value.split(':')[0] ?? 2),
          minute: Number(automationDeploymentScheduleTime.value.split(':')[1] ?? 0),
          timeZone: automationTimeZone.value || Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      } : {}),
    }
    : automationTrigger.value === 'once'
      ? { type: 'once', runAt: new Date(automationRunAt.value).toISOString() }
      : { type: 'schedule', cron: buildAutomationCron(), timeZone: automationTimeZone.value || 'Asia/Shanghai' }
  return {
    name: buildAutomationName(),
    description: t('applicationOnboarding.automation.defaultDescription'),
    trigger,
    targetResolver: { type: 'certificate_version_targets', assetIds: [applicationAssetId] },
    actions: [
      { type: 'create_deployment_plan', position: 1, config: { selectionMode: 'LATEST_AUTO', planType: 'UPDATE' } },
      { type: 'execute_deployment_plan', position: 2, config: { source: 'created_by_previous_action', dryRunFirst: true } },
    ],
    guardrails: { maxTargetsPerRun: 1, concurrencyLimit: 1, requirePreview: true, requireDryRun: true, requireApproval: false },
  }
}
/** 使用当前浏览器本地日期生成自动化名称，避免把 UTC 日期展示给用户。 */
function formatCompactLocalDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${String(date.getFullYear()).padStart(4, '0')}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}
function buildAutomationName(): string {
  return [
    t('applicationOnboarding.automation.defaultName'),
    normalizeDomain(accessDomain.value),
    formatCompactLocalDate(),
  ].join('—')
}
function buildAutomationCron(): string {
  const [hour = '2', minute = '0'] = (automationScheduleTime.value || '02:00').split(':')
  if (automationScheduleUnit.value === 'weekly') return `${Number(minute)} ${Number(hour)} * * ${automationScheduleDay.value}`
  if (automationScheduleUnit.value === 'monthly') return `${Number(minute)} ${Number(hour)} ${Number(automationScheduleDay.value)} * *`
  return `${Number(minute)} ${Number(hour)} * * *`
}
async function closeCompleted(): Promise<void> {
  resetOnboardingState()
  await clearOnboardingRoute()
  if (props.embedded) emit('close')
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
    assetId.value = session.value.assetId ?? assetId.value
    accessDomain.value = readString(session.value.inputSnapshot ?? {}, ['accessDomain'])
    verifyUrl.value = readString(session.value.inputSnapshot ?? {}, ['verifyUrl'])
    certificateId.value = session.value.certificateId ?? certificateId.value
    certificateVersionId.value = session.value.certificateVersionId ?? certificateVersionId.value
    certificateSelectionMode.value = session.value.inputSnapshot?.certificateSelectionMode === 'DEDICATED'
      ? 'DEDICATED'
      : session.value.inputSnapshot?.certificateSelectionMode === 'LATEST_AUTO' ? 'LATEST_AUTO' : 'EXPLICIT'
    certificateSupplyMode.value = certificateSelectionMode.value === 'DEDICATED' ? 'dedicated' : 'manual'
    deploymentInputBindings.value = readInputBindingsV1(session.value.inputSnapshot?.deploymentInputBindings) ?? createInputBindingsV1()
    if (!selectedPlatform.value) { resetOnboardingState(); await clearOnboardingRoute(); return }
    if (isRestartableSessionState(session.value.state)) {
      await restartSessionForSelectedPlatform()
      await refreshResources()
      return
    }
    if (isDeviceSelectionState(session.value.state)) await refreshResources()
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
  const domain = normalizeDomain(accessDomain.value)
  certificateAssets.value = readArray<Record<string, unknown>>(options.assets)
    .map(toCertificateOption)
    .filter((item): item is CertificateOption => item !== null && Boolean(domain) && item.domains.some((candidate) => certificateDomainMatches(candidate, domain)))
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
  const domains = [
    readString(record, ['primaryDomain', 'commonName', 'name', 'displayName']),
    ...readStringArray(record, ['sans', 'san', 'domains', 'subjectAlternativeNames']),
  ].map(normalizeDomain).filter(Boolean)
  return { id, domains, label: readString(record, ['primaryDomain', 'commonName', 'name', 'displayName', 'fingerprintSha256']) || id }
}
function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^\*\./, '*.').replace(/\.$/, '')
}
function certificateDomainMatches(pattern: string, domain: string): boolean {
  const candidate = normalizeDomain(pattern)
  if (!candidate || !domain) return false
  if (candidate === domain) return true
  return candidate.startsWith('*.') && domain.endsWith(candidate.slice(1)) && domain.split('.').length === candidate.split('.').length
}
function certificateFormatLabel(item: Record<string, unknown>): string {
  const parameters = readRecord(item.parameters) ?? {}
  const configName = localizeCertificateFormatName(String(parameters.configName ?? item.name ?? item.displayName ?? item.id ?? ''), t)
  return [
    configName || String(parameters.outputPreset ?? ''),
    String(item.format ?? '').toUpperCase(),
  ].filter(Boolean).join(' / ')
}
function defaultCertificateFormatLabel(certificateFormatId: string): string {
  const selector = selectedPlatform.value?.deploymentDefaults?.certificateFormat
  return selector ? `${selector.format.toUpperCase()} / ${localizeCertificateFormatName(selector.configName, t)}` : certificateFormatId
}
function certificateFormatOutputOptions(certificateFormatId: string): Array<{ key: string; label: string }> {
  const format = deploymentCertificateFormats.value.find((item) => String(item.id ?? '') === certificateFormatId)
  if (!format) return []
  const parameters = readRecord(format.parameters) ?? {}
  const formatName = String(format.format ?? '').toLowerCase()
  const options: Array<{ key: string; label: string }> = [
    { key: 'fingerprintSha256', label: 'fingerprintSha256' },
  ]
  if (formatName === 'pem') {
    if (parameters.includeLeafCertificate !== false) options.unshift({ key: 'public', label: 'public' })
    if (parameters.includeCertificateChain || parameters.generateChainFile) options.unshift({ key: 'chain', label: 'chain' })
    if (format.containsPrivateKey || parameters.includePrivateKey || parameters.generatePrivateKeyFile) options.unshift({ key: 'private', label: 'private' })
    options.unshift({ key: 'bundle', label: 'bundle' })
  } else {
    options.unshift({ key: 'bundle', label: 'bundle' })
  }
  return options
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
function readStringArray(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
    if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return []
}
function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function hasConfiguredDefaultPath(value: Record<string, unknown>, path: string): boolean {
  let current: unknown = value
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)
      || !Object.prototype.hasOwnProperty.call(current, segment)) return false
    current = (current as Record<string, unknown>)[segment]
  }
  return true
}
function mergeProjectedInputBindings(
  bindings: DeploymentInputBindingsV1,
  projection: DeploymentInputProjectionV1,
): DeploymentInputBindingsV1 {
  const merged = cloneReactiveValue(bindings)
  for (const item of [...projection.requiredVariables, ...projection.advancedVariables]) {
    if (!isProjectionEditable(item) || item.value === undefined || Object.prototype.hasOwnProperty.call(merged.variables, item.slot)) continue
    merged.variables[item.slot] = cloneReactiveValue(item.value)
  }
  for (const connection of projection.connections) {
    for (const [path, item] of Object.entries(connection.fields)) {
      if (!isProjectionEditable(item) || item.value === undefined || readPath(merged.connections[connection.slot], path) !== undefined) continue
      const current = cloneReactiveValue(merged.connections[connection.slot] ?? {}) as Record<string, unknown>
      writePath(current, path, cloneReactiveValue(item.value))
      merged.connections[connection.slot] = current as DeploymentInputBindingsV1['connections'][string]
    }
  }
  for (const item of projection.credentials) {
    if (!item.selectedCredentialId || merged.credentials[item.slot]) continue
    merged.credentials[item.slot] = { credentialId: item.selectedCredentialId }
  }
  for (const item of projection.artifacts) {
    if (!item.binding) continue
    const current = merged.artifacts[item.slot]
    if (!current) {
      merged.artifacts[item.slot] = cloneReactiveValue(item.binding)
      continue
    }
    merged.artifacts[item.slot] = {
      certificateFormatId: current.certificateFormatId ?? item.binding.certificateFormatId,
      outputBindings: {
        ...cloneReactiveValue(item.binding.outputBindings),
        ...cloneReactiveValue(current.outputBindings),
      },
    }
  }
  return merged
}
function isProjectionEditable(item: { configurationMode: string; bindingPolicy: string }): boolean {
  return item.configurationMode !== 'runtime' && item.bindingPolicy !== 'fixed'
}
function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => current && typeof current === 'object'
    ? (current as Record<string, unknown>)[segment]
    : undefined, value)
}
function writePath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.')
  const leaf = segments.pop()
  if (!leaf) return
  let current = target
  for (const segment of segments) {
    const child = current[segment]
    current[segment] = child && typeof child === 'object' && !Array.isArray(child) ? child : {}
    current = current[segment] as Record<string, unknown>
  }
  current[leaf] = value
}
function platformLabel(platform: Platform): string {
  return platform.displayName || t(platform.displayNameKey)
}
function comparePlatformsByName(left: Platform, right: Platform): number {
  const leftIsManual = left.source === 'CUSTOM_MANUAL'
  const rightIsManual = right.source === 'CUSTOM_MANUAL'
  if (leftIsManual !== rightIsManual) return leftIsManual ? -1 : 1
  const nameOrder = platformLabel(left).trim().localeCompare(platformLabel(right).trim(), locale.value, { sensitivity: 'base' })
  return nameOrder || left.platformKey.localeCompare(right.platformKey, locale.value, { sensitivity: 'base' })
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
function suggestedAccessDomain(target: Target): string {
  const candidate = target.displayName.trim().toLowerCase().replace(/\.+$/, '')
  return isDnsName(candidate) && !isIpAddress(candidate) ? candidate : ''
}
function suggestedVerifyUrl(domain: string, port?: number, protocol?: string): string {
  if (!domain) return ''
  const scheme = String(protocol ?? 'HTTPS').toLowerCase() === 'http' ? 'http' : 'https'
  const resolvedPort = Number.isInteger(port) && Number(port) > 0 ? Number(port) : 443
  return `${scheme}://${domain}:${resolvedPort}`
}
function isValidTargetConfiguration(domain: string, url: string): boolean {
  const normalizedDomain = domain.trim().toLowerCase().replace(/\.+$/, '')
  if (!isDnsName(normalizedDomain) || isIpAddress(normalizedDomain)) return false
  try {
    const parsed = new URL(url.trim())
    return ['http:', 'https:'].includes(parsed.protocol)
      && !isIpAddress(parsed.hostname)
      && parsed.hostname.toLowerCase().replace(/\.+$/, '') === normalizedDomain
  } catch {
    return false
  }
}
function isIpAddress(value: string): boolean {
  const candidate = value.trim().replace(/^\[|\]$/g, '')
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate)) return candidate.split('.').every((part) => Number(part) <= 255)
  return candidate.includes(':')
}
function isDnsName(value: string): boolean {
  if (!value || value.length > 253 || value.startsWith('.') || value.endsWith('.')) return false
  const labels = value.split('.')
  return labels.length >= 2 && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
}
function resetDeviceSelection(): void {
  deviceMode.value = 'EXISTING_DEVICE'
  deviceId.value = ''
  resources.value = []
  assetId.value = ''
  deviceListLoaded.value = false
}
function resetTargetSelection(): void {
  targets.value = []
  pendingTarget.value = null
  accessDomain.value = ''
  verifyUrl.value = ''
  certificateId.value = ''
  certificateVersionId.value = ''
  certificateSelectionMode.value = 'EXPLICIT'
  certificateAssets.value = []
  certificateVersions.value = []
  deploymentInputProjection.value = null
  deploymentInputBindings.value = createInputBindingsV1()
  deploymentInputLoading.value = false
  deploymentInputError.value = ''
}
function resetOnboardingState(): void {
  selectedPlatform.value = null
  session.value = null
  currentStepOverride.value = null
  error.value = ''
  loading.value = false
  deviceListLoading.value = false
  submitInFlight.value = false
  certificateSupplyMode.value = 'manual'
  dedicatedProviderType.value = 'internal_ca'
  automationTrigger.value = 'none'
  automationRunAt.value = ''
  automationScheduleUnit.value = 'daily'
  automationScheduleDay.value = '1'
  automationScheduleTime.value = '02:00'
  automationTimeZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  automationDeploymentMode.value = 'immediate'
  automationDeploymentScheduleTime.value = '02:00'
  commitProgress.value = []
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
  if (nextStep === 5) return backendStep.value === 5 || commitProgress.value.length > 0 || session.value.state === 'READY_TO_COMMIT'
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
    await refreshResources()
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
    if (await restartSessionForSelectedPlatform()) await selectExistingResourceForSession()
    return
  }
  if (isResourceSelectionState(session.value.state)) {
    await selectExistingResourceForSession()
    return
  }
  if (selectedPlatform.value?.deviceSelection === 'NONE') return
  if ((deviceMode.value === 'EXISTING_DEVICE' && session.value.deviceId && session.value.deviceId === deviceId.value)
    || (deviceMode.value === 'EXISTING_SERVICE_ASSET' && session.value.assetId && session.value.assetId === assetId.value)) {
    return
  }
  await restartSessionForSelectedPlatform()
  if (session.value) await selectExistingResourceForSession()
}
async function selectExistingResourceForSession(allowRecovery = true): Promise<void> {
  if (!session.value) return
  try {
    session.value = readObject<Session>((await selectOnboardingResource(session.value.id, {
      expectedStateVersion: session.value.stateVersion,
      mode: deviceMode.value,
      deviceId: deviceId.value || undefined,
      assetId: assetId.value || undefined,
    })).data)
  } catch (cause) {
    if (allowRecovery && await recoverSelectedResourceConflict(cause)) return
    throw cause
  }
  deviceId.value = session.value.deviceId ?? deviceId.value
  assetId.value = session.value.assetId ?? assetId.value
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
  if (refreshed.assetId) assetId.value = refreshed.assetId
  if (isRestartableSessionState(refreshed.state)) {
    if (!await restartSessionForSelectedPlatform()) return false
    await selectExistingResourceForSession(false)
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

defineExpose({ goPrevious, runFooterPrimary, cancel })
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
    <section v-if="!selectedPlatform" class="platform-selection" :aria-busy="loading && platforms.length === 0">
      <div v-if="!props.embedded" class="platform-selection__toolbar" role="search">
        <label class="platform-selection__search">
          <span class="platform-selection__sr-only">{{ t('applicationOnboarding.platforms.searchLabel') }}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <input
            v-model="platformSearchKeyword"
            type="search"
            autocomplete="off"
            :placeholder="t('applicationOnboarding.platforms.searchPlaceholder')"
            :aria-label="t('applicationOnboarding.platforms.searchLabel')"
          >
        </label>
      </div>
      <div class="platform-category-tabs" role="tablist" :aria-label="t('plugins.categories.label')">
        <button
          v-for="option in platformCategoryOptions"
          :key="option.value"
          class="platform-category-tab"
          :class="{ 'platform-category-tab--active': platformCategory === option.value }"
          type="button"
          role="tab"
          :aria-selected="platformCategory === option.value"
          @click="platformCategory = option.value"
        >
          {{ t(option.labelKey) }}
        </button>
      </div>
      <div class="platform-grid">
        <div
          v-if="loading && platforms.length === 0"
          class="onboarding-platform-loading"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span class="onboarding-platform-loading__spinner" aria-hidden="true" />
          <span>{{ t('common.loading') }}</span>
        </div>
        <button
          v-for="platform in filteredPlatforms"
          :key="platform.platformKey"
          class="platform-card"
          :class="{ 'platform-card--review': platform.supportStatus === 'IN_REVIEW' }"
          type="button"
          :disabled="loading || platform.supportStatus === 'IN_REVIEW'"
          @click="choosePlatform(platform)"
        >
          <GcPluginLogo
            class="platform-card__logo"
            :logo-url="platform.logoUrl"
            :square-logo-url="platform.logoSquareUrl"
            :fallback-text="platformInitial(platform)"
            alt=""
            size="onboarding"
          />
          <span class="platform-card__copy">
            <span class="platform-card__title-row">
              <strong>{{ platformLabel(platform) }}</strong>
              <small v-if="platform.productCategory" class="platform-card__category">{{ t(`plugins.categories.${platform.productCategory}`) }}</small>
            </span>
            <small v-if="platform.source === 'CUSTOM_MANUAL'">{{ t('applicationOnboarding.platforms.manualHint') }}</small>
            <span v-if="platform.businessMetadata" class="platform-card__metadata">
              <small class="platform-card__metadata-row"><span>{{ t('applicationOnboarding.platforms.capabilityVersion') }}</span><span>{{ platform.businessMetadata.capabilityVersion }}</span></small>
              <small class="platform-card__metadata-row"><span>{{ t('applicationOnboarding.platforms.compatibility') }}</span><span>{{ platform.businessMetadata.compatibleVersions.join(' / ') }}</span></small>
              <small class="platform-card__metadata-row"><span>{{ t('applicationOnboarding.platforms.requiredInformation') }}</span><span>{{ platform.businessMetadata.requiredInformation.join(' / ') }}</span></small>
            </span>
            <small v-else-if="platform.description">{{ platform.description }}</small>
            <small v-if="platform.supportStatus === 'IN_REVIEW'" class="platform-card__status">{{ t('applicationOnboarding.platforms.inReview') }}</small>
          </span>
        </button>
      </div>
      <div class="platform-selection__footer">
        <p v-if="!loading && filteredPlatforms.length === 0" class="onboarding-empty">
          {{ hasPlatformKeyword ? t('applicationOnboarding.messages.noSearchResults') : t('applicationOnboarding.messages.noPlatforms') }}
        </p>
        <button class="platform-plugin-link" type="button" @click="openPluginCenter">
          <span>{{ t('applicationOnboarding.platforms.pluginCenterPrompt') }}</span>
          <span>{{ t('applicationOnboarding.platforms.pluginCenterAction') }}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13m-5-5 5 5-5 5" /></svg>
        </button>
      </div>
    </section>
    <section v-else class="onboarding-workspace">
      <section v-if="step === 2" class="onboarding-device-step" aria-labelledby="onboarding-device-title">
        <div class="onboarding-device-step__header">
          <h2 id="onboarding-device-title">{{ t('applicationOnboarding.resource.title') }}</h2>
          <button
            class="gc-button gc-button--secondary"
            type="button"
            :disabled="loading || deviceListLoading"
            @click="refreshResources"
          >
            {{ deviceListLoading ? t('common.loading') : t('applicationOnboarding.resource.refresh') }}
          </button>
        </div>
        <div class="onboarding-device-grid" :aria-label="t('applicationOnboarding.resource.title')">
          <GcSelectionCard
            class="onboarding-device-card onboarding-device-card--new"
            :title="t('applicationOnboarding.device.new')"
            :description="supportsNewDevice ? t('applicationOnboarding.device.newDescription') : undefined"
            :selected="deviceMode === 'NEW_DEVICE'"
            :disabled="loading || deviceListLoading || !supportsNewDevice"
            @select="selectNewDevice"
          >
            <template #icon>
              <span class="onboarding-device-card__glyph onboarding-device-card__glyph--new" aria-hidden="true">+</span>
            </template>
          </GcSelectionCard>
          <GcSelectionCard
            v-for="resource in resources"
            :key="`${resource.resourceType}-${resource.assetRef.id}`"
            class="onboarding-device-card"
            :title="resource.displayName"
            :description="resource.address || t('applicationOnboarding.device.selectPlaceholder')"
            :selected="deviceMode !== 'NEW_DEVICE' && ((resource.resourceType === 'DEVICE' && deviceId === resource.assetRef.id) || (resource.resourceType === 'SERVICE_ASSET' && assetId === resource.assetRef.id))"
            :disabled="loading || deviceListLoading || !resource.selectable"
            @select="selectExistingResource(resource)"
          >
            <template #icon>
              <span class="onboarding-device-card__glyph onboarding-device-card__glyph--device" aria-hidden="true"><span /><span /><span /></span>
            </template>
          </GcSelectionCard>
        </div>
        <p v-if="deviceListLoading" class="onboarding-empty">{{ t('applicationOnboarding.device.existingLoading') }}</p>
        <p v-else-if="deviceListLoaded && resources.length === 0" class="onboarding-empty">{{ t('applicationOnboarding.device.noExisting') }}</p>
      </section>
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
            :class="{ 'target-row--unavailable': !target.selectable, 'target-row--selected': pendingTarget?.managedTargetId === target.managedTargetId }"
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
        <div v-if="pendingTarget" ref="targetConfigRef" class="target-config" aria-live="polite">
          <div class="target-config__header">
            <div>
              <small>{{ t('applicationOnboarding.target.selectedSite') }}</small>
              <strong>{{ pendingTarget.displayName }}</strong>
            </div>
            <span class="target-config__endpoint">{{ targetMetadataValue(pendingTarget.endpoint?.host) }}:{{ targetMetadataValue(pendingTarget.endpoint?.port) }}</span>
          </div>
          <div class="target-config__fields">
            <label>
              <span>{{ t('applicationOnboarding.target.accessDomain') }}</span>
              <input v-model="accessDomain" type="text" :placeholder="t('applicationOnboarding.target.accessDomainPlaceholder')" autocomplete="url">
            </label>
            <label>
              <span>{{ t('applicationOnboarding.target.verifyUrl') }}</span>
              <input v-model="verifyUrl" type="url" :placeholder="t('applicationOnboarding.target.verifyUrlPlaceholder')" autocomplete="url">
            </label>
          </div>
          <p class="onboarding-hint">{{ t('applicationOnboarding.target.domainHint') }}</p>
          <p v-if="deploymentInputError" class="onboarding-error" role="alert">{{ deploymentInputError }}</p>
          <DeploymentInputForm
            v-if="deploymentInputFormProjection"
            v-model="deploymentInputBindings"
            :projection="deploymentInputFormProjection"
            :credential-options="deploymentCredentialOptions"
            :artifact-options="deploymentArtifactOptions"
            :loading="deploymentInputLoading"
            compact
            :show-artifact-outputs="false"
          />
          <p v-else-if="deploymentInputLoading" class="onboarding-empty">{{ t('common.loading') }}</p>
        </div>
      </div>
      <div v-else-if="step === 4" class="onboarding-panel">
        <h2>{{ t('applicationOnboarding.certificate.title') }}</h2>
        <p v-if="platformAcceptedFormats.length" class="onboarding-hint">{{ t('applicationOnboarding.certificate.requiredFormat', { formats: platformAcceptedFormats.join(' / ') }) }}</p>
        <div class="onboarding-choice-grid" role="radiogroup" :aria-label="t('applicationOnboarding.certificate.modeLabel')">
          <label class="onboarding-choice" :class="{ 'onboarding-choice--selected': certificateSupplyMode === 'manual' }">
            <input v-model="certificateSupplyMode" type="radio" value="manual" @change="certificateSelectionMode = 'EXPLICIT'">
            <span><strong>{{ t('applicationOnboarding.certificate.manual') }}</strong><small>{{ t('applicationOnboarding.certificate.manualDescription') }}</small></span>
          </label>
          <label class="onboarding-choice" :class="{ 'onboarding-choice--selected': certificateSupplyMode === 'dedicated' }">
            <input v-model="certificateSupplyMode" type="radio" value="dedicated" @change="certificateSelectionMode = 'DEDICATED'">
            <span><strong>{{ t('applicationOnboarding.certificate.dedicated') }} <em>{{ t('applicationOnboarding.certificate.testPhase') }}</em></strong><small>{{ t('applicationOnboarding.certificate.dedicatedDescription') }}</small></span>
          </label>
        </div>
        <template v-if="certificateSupplyMode === 'manual'">
          <p v-if="certificateAssets.length === 0" class="onboarding-empty">{{ t('applicationOnboarding.certificate.noMatchingAssets', { domain: accessDomain }) }}</p>
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
        </template>
        <template v-else>
          <label>{{ t('applicationOnboarding.certificate.provider') }}
            <select v-model="dedicatedProviderType">
              <option value="internal_ca">{{ t('applicationOnboarding.certificate.internalCa') }}</option>
              <option value="acme">{{ t('applicationOnboarding.certificate.acme') }}</option>
            </select>
          </label>
          <p class="onboarding-hint">{{ t('applicationOnboarding.certificate.dedicatedHint') }}</p>
        </template>
        <section class="onboarding-automation" :aria-label="t('applicationOnboarding.automation.title')">
          <h3>{{ t('applicationOnboarding.automation.title') }}</h3>
          <fieldset class="onboarding-automation__triggers">
            <legend>{{ t('applicationOnboarding.automation.triggerLabel') }}</legend>
            <div class="onboarding-automation__options-row">
              <label v-for="option in [
                { value: 'none', label: t('applicationOnboarding.automation.none'), description: t('applicationOnboarding.automation.noneDescription') },
                { value: 'certificate_version_created', label: t('applicationOnboarding.automation.certificateVersionCreated'), description: t('applicationOnboarding.automation.certificateVersionCreatedDescription') },
                { value: 'once', label: t('applicationOnboarding.automation.once'), description: t('applicationOnboarding.automation.onceDescription') },
                { value: 'schedule', label: t('applicationOnboarding.automation.schedule'), description: t('applicationOnboarding.automation.scheduleDescription') },
              ]" :key="option.value" class="onboarding-automation__option" :class="{ 'onboarding-automation__option--selected': automationTrigger === option.value }">
                <input v-model="automationTrigger" type="radio" :value="option.value">
                <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
              </label>
            </div>
          </fieldset>
          <div v-if="automationTrigger === 'certificate_version_created'" class="onboarding-automation__detail">
            <fieldset class="onboarding-automation__triggers">
              <legend>{{ t('applicationOnboarding.automation.schedule') }}</legend>
              <div class="onboarding-automation__options-row">
                <label class="onboarding-automation__option onboarding-automation__deployment-option" :class="{ 'onboarding-automation__option--selected': automationDeploymentMode === 'immediate' }">
                  <input v-model="automationDeploymentMode" type="radio" value="immediate">
                  <span><strong>{{ t('automations.deploymentSchedule.immediate') }}</strong></span>
                </label>
                <label class="onboarding-automation__option onboarding-automation__deployment-option" :class="{ 'onboarding-automation__option--selected': automationDeploymentMode === 'scheduled' }">
                  <input v-model="automationDeploymentMode" type="radio" value="scheduled">
                  <span><strong>{{ t('automations.deploymentSchedule.scheduled') }}</strong></span>
                </label>
              </div>
            </fieldset>
            <label v-if="automationDeploymentMode === 'scheduled'">
              {{ t('applicationOnboarding.automation.scheduleTime') }}
              <input v-model="automationDeploymentScheduleTime" type="time">
            </label>
            <p v-if="automationDeploymentMode === 'scheduled'" class="onboarding-hint">{{ t('automations.deploymentSchedule.help') }}</p>
          </div>
          <div v-if="automationTrigger === 'once'" class="onboarding-automation__detail">
            <label>{{ t('applicationOnboarding.automation.runAt') }}<input v-model="automationRunAt" type="datetime-local"></label>
            <p class="onboarding-hint">{{ t('applicationOnboarding.automation.onceHint') }}</p>
          </div>
          <div v-if="automationTrigger === 'schedule'" class="onboarding-automation__detail">
            <div class="onboarding-automation__schedule-fields">
              <label>{{ t('applicationOnboarding.automation.frequency') }}
                <select v-model="automationScheduleUnit">
                  <option value="daily">{{ t('applicationOnboarding.automation.daily') }}</option>
                  <option value="weekly">{{ t('applicationOnboarding.automation.weekly') }}</option>
                  <option value="monthly">{{ t('applicationOnboarding.automation.monthly') }}</option>
                </select>
              </label>
              <label v-if="automationScheduleUnit !== 'daily'">{{ t('applicationOnboarding.automation.scheduleDay') }}
                <select v-model="automationScheduleDay">
                  <template v-if="automationScheduleUnit === 'weekly'">
                    <option value="1">{{ t('applicationOnboarding.automation.monday') }}</option><option value="2">{{ t('applicationOnboarding.automation.tuesday') }}</option><option value="3">{{ t('applicationOnboarding.automation.wednesday') }}</option><option value="4">{{ t('applicationOnboarding.automation.thursday') }}</option><option value="5">{{ t('applicationOnboarding.automation.friday') }}</option><option value="6">{{ t('applicationOnboarding.automation.saturday') }}</option><option value="0">{{ t('applicationOnboarding.automation.sunday') }}</option>
                  </template>
                  <template v-else><option v-for="day in 28" :key="day" :value="String(day)">{{ day }}</option></template>
                </select>
              </label>
              <label>{{ t('applicationOnboarding.automation.scheduleTime') }}<input v-model="automationScheduleTime" type="time"></label>
            </div>
            <p class="onboarding-hint">{{ t('applicationOnboarding.automation.scheduleHint') }}</p>
          </div>
        </section>
      </div>
      <div v-else-if="step === 5" class="onboarding-panel onboarding-panel--success">
        <div class="onboarding-complete-header">
          <div class="onboarding-complete-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <div>
            <h2>{{ t('applicationOnboarding.complete.title') }}</h2>
            <p>{{ t('applicationOnboarding.complete.description') }}</p>
          </div>
        </div>
        <div v-if="commitProgress.length === 0" class="onboarding-summary-section">
          <h3 class="onboarding-summary-title">{{ t('applicationOnboarding.complete.viewSummary') }}</h3>
          <dl class="onboarding-summary">
            <div><dt>{{ t('applicationOnboarding.steps.platform') }}</dt><dd>{{ selectedPlatform ? platformLabel(selectedPlatform) : t('applicationOnboarding.target.missingValue') }}</dd></div>
            <div><dt>{{ t('applicationOnboarding.steps.device') }}</dt><dd>{{ deviceId || assetId || t('applicationOnboarding.target.missingValue') }}</dd></div>
            <div><dt>{{ t('applicationOnboarding.steps.target') }}</dt><dd>{{ pendingTarget?.displayName || readString(session?.inputSnapshot ?? {}, ['displayName']) || t('applicationOnboarding.target.missingValue') }}</dd></div>
            <div><dt>{{ t('applicationOnboarding.steps.certificate') }}</dt><dd>{{ certificateSupplyMode === 'dedicated' ? t('applicationOnboarding.certificate.dedicated') : (certificateVersionId === LATEST_VERSION_MARKER ? t('applicationOnboarding.certificate.latest') : certificateVersionOptionLabel(selectedCertificateVersion)) }}</dd></div>
          </dl>
        </div>
        <ol v-if="commitProgress.length" class="onboarding-progress" :aria-label="t('applicationOnboarding.complete.progressAria')">
          <li v-for="item in commitProgress" :key="item.key" :class="`onboarding-progress__item--${item.status}`">
            <span class="onboarding-progress__icon">
              <svg v-if="item.status === 'success'" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <svg v-else-if="item.status === 'failed'" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
              <span v-else-if="item.status === 'running'" class="onboarding-progress__spinner" aria-hidden="true" />
              <span v-else class="onboarding-progress__pending" aria-hidden="true" />
            </span>
            <span class="onboarding-progress__label">{{ t(`applicationOnboarding.complete.stages.${item.key}`) }}</span>
            <strong class="onboarding-progress__status">{{ t(`applicationOnboarding.complete.status.${item.status}`) }}</strong>
          </li>
        </ol>
      </div>
      <div v-if="!props.embedded && footerActions.visible" class="onboarding-actions">
        <button v-if="footerActions.showCancel" class="gc-button gc-button--ghost" type="button" @click="cancel">{{ t('applicationOnboarding.actions.cancel') }}</button>
        <span class="onboarding-actions__spacer" aria-hidden="true" />
        <button v-if="footerActions.showPrevious" class="gc-button gc-button--secondary" type="button" :disabled="footerActions.previousDisabled" @click="goPrevious">{{ t('applicationOnboarding.actions.previous') }}</button>
        <button v-if="footerActions.primaryAction" class="gc-button gc-button--primary" type="button" :disabled="footerActions.primaryDisabled" @click="runFooterPrimary">{{ footerActions.primaryLabel }}</button>
      </div>
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
.platform-selection { display: grid; gap: var(--gc-space-3); min-inline-size: 0; }
.platform-selection__toolbar { display: flex; justify-content: flex-end; }
.platform-selection__search { position: relative; display: flex; align-items: center; inline-size: min(100%, var(--gc-size-menu-max)); }
.platform-selection__search svg { position: absolute; inset-inline-start: var(--gc-space-3); inline-size: var(--gc-size-icon-md); block-size: var(--gc-size-icon-md); color: var(--gc-color-text-soft); fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: var(--gc-border-width-thick); pointer-events: none; }
.platform-selection__search input { inline-size: 100%; min-block-size: var(--gc-control-height-md); padding: 0 var(--gc-space-3) 0 calc(var(--gc-space-3) + var(--gc-size-icon-md) + var(--gc-space-2)); color: var(--gc-color-text); background: var(--gc-color-surface-field); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-control); }
.platform-selection__search input:focus { outline: none; border-color: var(--gc-color-primary-border-strong); box-shadow: var(--gc-shadow-focus); }
.platform-selection__footer { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--gc-space-3); text-align: center; }
.platform-selection__footer .onboarding-empty { text-align: center; }
.platform-plugin-link { display: inline-flex; align-items: center; gap: var(--gc-space-1); padding: 0; color: var(--gc-color-primary); font-size: var(--gc-font-size-sm); font-weight: var(--gc-font-weight-semibold); text-align: left; cursor: pointer; background: transparent; border: 0; }
.platform-plugin-link:hover { color: var(--gc-color-primary-hover); text-decoration: underline; }
.platform-plugin-link:focus-visible { outline: none; border-radius: var(--gc-radius-control); box-shadow: var(--gc-shadow-focus); }
.platform-plugin-link svg { inline-size: var(--gc-size-icon-sm); block-size: var(--gc-size-icon-sm); fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: var(--gc-border-width-thick); }
.platform-selection__sr-only { position: absolute; inline-size: var(--gc-space-hairline); block-size: var(--gc-space-hairline); padding: 0; margin: calc(var(--gc-space-hairline) * -1); overflow: hidden; white-space: nowrap; clip-path: inset(50%); border: 0; }
.platform-category-tabs { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); padding-block-end: var(--gc-space-1); overflow-x: auto; }
.platform-category-tab { min-block-size: var(--gc-control-height-sm); padding: 0 var(--gc-space-4); color: var(--gc-color-text-muted); cursor: pointer; background: var(--gc-color-surface); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-control); font-size: var(--gc-font-size-sm); font-weight: var(--gc-font-weight-semibold); white-space: nowrap; }
.platform-category-tab:hover { color: var(--gc-color-primary); border-color: var(--gc-color-primary-border); }
.platform-category-tab--active { color: var(--gc-color-primary); background: var(--gc-color-primary-soft); border-color: var(--gc-color-primary-border-strong); }
.platform-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: var(--gc-size-application-onboarding-card); align-content: start; min-block-size: 0; max-block-size: min(54vh, calc(100vh - (var(--gc-space-10) * 5))); gap: var(--gc-space-3); padding-inline-end: var(--gc-space-2); overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.onboarding-platform-loading { display: flex; align-items: center; justify-content: center; min-block-size: var(--gc-size-card-min); gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: var(--gc-font-weight-semibold); }
.onboarding-platform-loading__spinner { inline-size: var(--gc-space-5); aspect-ratio: 1; border: var(--gc-border-width-thick) solid var(--gc-color-primary-border); border-top-color: var(--gc-color-primary); border-radius: var(--gc-radius-full); animation: application-onboarding-platform-spin 700ms linear infinite; }
@keyframes application-onboarding-platform-spin { to { transform: rotate(1turn); } }
.platform-card { display: grid; grid-template-columns: calc(var(--gc-space-4) * 3) minmax(0, 1fr); align-items: start; gap: var(--gc-space-3); block-size: var(--gc-size-application-onboarding-card); min-block-size: 0; padding: var(--gc-space-3); text-align: left; color: var(--gc-color-text); cursor: pointer; background: var(--gc-color-surface-soft); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-card); box-shadow: var(--gc-shadow-sm); transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease, transform 160ms ease; }
.platform-card:hover:not(:disabled) { background: var(--gc-color-surface); border-color: var(--gc-color-primary-border-strong); box-shadow: var(--gc-shadow-hover); }
.platform-card:focus-visible { outline: none; box-shadow: var(--gc-shadow-focus); }
.platform-card:disabled { cursor: not-allowed; opacity: var(--gc-opacity-disabled); }
.platform-card--review { background: var(--gc-color-surface); }
.platform-card__copy { display: grid; min-inline-size: 0; gap: var(--gc-space-compact); }
.platform-card__title-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--gc-space-2); min-inline-size: 0; }
.platform-card__copy strong { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-label); line-height: var(--gc-line-height-tight); overflow-wrap: anywhere; }
.platform-card__category { display: inline-flex; align-items: center; min-block-size: var(--gc-space-5); padding-inline: var(--gc-space-2); color: var(--gc-color-primary); background: var(--gc-color-primary-soft); border: var(--gc-border-width) solid var(--gc-color-primary-border); border-radius: var(--gc-radius-sm); font-size: var(--gc-font-size-xs); line-height: var(--gc-line-height-tight); white-space: nowrap; }
.platform-card__copy small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-caption); line-height: var(--gc-line-height-tight); overflow-wrap: anywhere; }
.platform-card__metadata { display: grid; gap: var(--gc-space-compact); }
.platform-card__metadata-row { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: baseline; column-gap: var(--gc-space-compact); }
.platform-card__metadata-row span:first-child { color: var(--gc-color-text-subtle); }
.platform-card__metadata-row span:last-child { color: var(--gc-color-text); }
.platform-card__copy .platform-card__status { color: var(--gc-color-warning); }
.target-row { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-4); color: var(--gc-color-text-strong); text-align: left; cursor: pointer; background: var(--gc-color-surface); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-md); }
.target-row:hover:not(:disabled) { background: var(--gc-color-surface-selected); border-color: var(--gc-color-primary-border); }
.target-row:focus-visible { outline: none; box-shadow: var(--gc-shadow-focus); }
.target-row--selected { background: var(--gc-color-primary-soft); border-color: var(--gc-color-primary-border-strong); box-shadow: var(--gc-shadow-focus); }
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
.target-config { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-4); border: var(--gc-border-width) solid var(--gc-color-primary-border); border-radius: var(--gc-radius-md); background: var(--gc-color-primary-soft); }
.target-config__header { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); }
.target-config__header > div { display: grid; gap: var(--gc-space-1); min-inline-size: 0; }
.target-config__header small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-caption); }
.target-config__header strong { color: var(--gc-color-text-strong); overflow-wrap: anywhere; }
.target-config__endpoint { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-caption); overflow-wrap: anywhere; }
.target-config__fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.target-config label { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); }
.target-config input { min-height: var(--gc-control-height-md); padding: 0 var(--gc-space-3); color: var(--gc-color-text); background: var(--gc-color-surface-field); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); }
.onboarding-workspace { display: grid; gap: var(--gc-space-4); max-width: var(--gc-size-content-readable); }
.onboarding-panel { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-4); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface); }
.onboarding-choice-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.onboarding-choice { display: flex; align-items: flex-start; gap: var(--gc-space-2); min-block-size: 50px; padding: var(--gc-space-3); color: var(--gc-color-text); cursor: pointer; border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-soft); }
.onboarding-choice--selected { border-color: var(--gc-color-primary-border-strong); background: var(--gc-color-primary-soft); box-shadow: var(--gc-shadow-focus); }
.onboarding-choice input { position: absolute; opacity: 0; pointer-events: none; }
.onboarding-automation__option input { position: absolute; opacity: 0; pointer-events: none; }
.onboarding-choice span { display: grid; gap: var(--gc-space-1); }
.onboarding-choice strong { color: var(--gc-color-text-strong); }
.onboarding-choice small { color: var(--gc-color-text-muted); line-height: var(--gc-line-height-normal); }
.onboarding-choice em { padding: var(--gc-space-badge-block) var(--gc-space-2); color: var(--gc-color-warning); font-size: var(--gc-font-size-xs); font-style: normal; border: var(--gc-border-width) solid var(--gc-color-warning-border); border-radius: var(--gc-radius-pill); }
.onboarding-automation { display: grid; gap: var(--gc-space-2); padding-block-start: var(--gc-space-2); border-block-start: var(--gc-border-width) solid var(--gc-color-border-subtle); }
.onboarding-automation h3 { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-body); }
.onboarding-automation__triggers { display: grid; gap: var(--gc-space-2); padding: 0; margin: 0; border: 0; }
.onboarding-automation__triggers legend { padding: 0; margin-block-end: var(--gc-space-2); color: var(--gc-color-text-muted); }
.onboarding-automation__options-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--gc-space-2); }
.onboarding-automation__option { display: flex; flex-direction: column; align-items: flex-start; gap: var(--gc-space-1); padding: var(--gc-space-2); color: var(--gc-color-text); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface-soft); cursor: pointer; min-block-size: 0; }
.onboarding-automation__option--selected { border-color: var(--gc-color-primary-border-strong); background: var(--gc-color-primary-soft); }
.onboarding-automation__deployment-option { min-block-size: auto; padding: 0; border: 0; border-radius: 0; background: transparent; }
.onboarding-automation__deployment-option.onboarding-automation__option--selected { border-color: transparent; background: transparent; }
.onboarding-automation__option input { flex: 0 0 auto; inline-size: auto; min-height: auto; margin: 0; }
.onboarding-automation__option span { display: grid; gap: var(--gc-space-compact); }
.onboarding-automation__option strong { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-xs); font-weight: var(--gc-font-weight-semibold); line-height: var(--gc-line-height-tight); }
.onboarding-automation__option small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-caption); line-height: var(--gc-line-height-tight); }
.onboarding-automation__detail { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-3); border-inline-start: var(--gc-space-1) solid var(--gc-color-primary-border); background: var(--gc-color-surface-soft); }
.onboarding-automation__schedule-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-2); }
.onboarding-summary-section { display: grid; gap: var(--gc-space-3); }
.onboarding-summary-title { margin: 0; padding-block-end: var(--gc-space-2); color: var(--gc-color-text-strong); font-size: var(--gc-font-size-body); font-weight: var(--gc-font-weight-semibold); border-block-end: var(--gc-border-width) solid var(--gc-color-border-subtle); }
.onboarding-summary { display: grid; gap: var(--gc-space-3); margin: 0; }
.onboarding-summary > div { display: grid; grid-template-columns: minmax(8rem, max-content) minmax(0, 1fr); gap: var(--gc-space-4); padding: var(--gc-space-3) var(--gc-space-4); background: var(--gc-color-surface); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-md); transition: all 200ms ease; }
.onboarding-summary > div:hover { border-color: var(--gc-color-primary-border); box-shadow: var(--gc-shadow-sm); }
.onboarding-summary dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: var(--gc-font-weight-medium); }
.onboarding-summary dd { margin: 0; color: var(--gc-color-text-strong); font-size: var(--gc-font-size-body); font-weight: var(--gc-font-weight-semibold); overflow-wrap: anywhere; }
.onboarding-complete-header { display: flex; align-items: flex-start; gap: var(--gc-space-4); margin-block-end: var(--gc-space-4); }
.onboarding-complete-icon { flex: 0 0 auto; display: grid; place-items: center; inline-size: calc(var(--gc-space-6) * 2); block-size: calc(var(--gc-space-6) * 2); color: var(--gc-color-success); background: var(--gc-color-success-soft); border: var(--gc-border-width-thick) solid var(--gc-color-success-border); border-radius: var(--gc-radius-full); animation: onboarding-complete-icon-pop 400ms cubic-bezier(0.68, -0.55, 0.265, 1.55); }
.onboarding-complete-icon svg { inline-size: var(--gc-space-7); block-size: var(--gc-space-7); fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: calc(var(--gc-border-width-thick) * 1.5); }
@keyframes onboarding-complete-icon-pop { 0% { transform: scale(0); opacity: 0; } 50% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
.onboarding-complete-header > div { flex: 1 1 auto; min-inline-size: 0; }
.onboarding-complete-header h2 { margin-block-end: var(--gc-space-1); }
.onboarding-complete-header p { margin: 0; color: var(--gc-color-text-muted); }
.onboarding-progress { display: grid; gap: var(--gc-space-2); padding: 0; margin: 0; list-style: none; }
.onboarding-progress li { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--gc-space-3); padding: var(--gc-space-3); background: var(--gc-color-surface); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); transition: all 200ms ease; }
.onboarding-progress__icon { display: grid; place-items: center; inline-size: var(--gc-space-6); block-size: var(--gc-space-6); }
.onboarding-progress__icon svg { inline-size: var(--gc-size-icon-md); block-size: var(--gc-size-icon-md); fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: var(--gc-border-width-thick); }
.onboarding-progress__spinner { display: block; inline-size: var(--gc-size-icon-md); block-size: var(--gc-size-icon-md); border: var(--gc-border-width-thick) solid var(--gc-color-primary-border); border-top-color: var(--gc-color-primary); border-radius: var(--gc-radius-full); animation: onboarding-progress-spin 800ms linear infinite; }
@keyframes onboarding-progress-spin { to { transform: rotate(1turn); } }
.onboarding-progress__pending { display: block; inline-size: calc(var(--gc-space-2) * 1.5); block-size: calc(var(--gc-space-2) * 1.5); background: var(--gc-color-border); border-radius: var(--gc-radius-full); }
.onboarding-progress__label { color: var(--gc-color-text); font-size: var(--gc-font-size-body); }
.onboarding-progress__status { font-weight: var(--gc-font-weight-semibold); font-size: var(--gc-font-size-sm); }
.onboarding-progress__item--pending { opacity: 0.6; }
.onboarding-progress__item--pending .onboarding-progress__status { color: var(--gc-color-text-muted); }
.onboarding-progress__item--running { border-color: var(--gc-color-primary-border); background: var(--gc-color-primary-soft); }
.onboarding-progress__item--running .onboarding-progress__icon { color: var(--gc-color-primary); }
.onboarding-progress__item--running .onboarding-progress__status { color: var(--gc-color-primary); }
.onboarding-progress__item--success { border-color: var(--gc-color-success-border); background: var(--gc-color-success-soft); animation: onboarding-progress-success 300ms ease; }
.onboarding-progress__item--success .onboarding-progress__icon { color: var(--gc-color-success); }
.onboarding-progress__item--success .onboarding-progress__status { color: var(--gc-color-success); }
@keyframes onboarding-progress-success { 0% { transform: scale(0.98); } 50% { transform: scale(1.02); } 100% { transform: scale(1); } }
.onboarding-progress__item--failed { border-color: var(--gc-color-danger-border); background: var(--gc-color-danger-soft); }
.onboarding-progress__item--failed .onboarding-progress__icon { color: var(--gc-color-danger); }
.onboarding-progress__item--failed .onboarding-progress__status { color: var(--gc-color-danger); }
.onboarding-panel__header, .onboarding-device-step__header { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); }
.onboarding-panel label { display: grid; gap: var(--gc-space-1); color: var(--gc-color-text-muted); }
.onboarding-panel input:not([type="radio"]), .onboarding-panel select { min-height: var(--gc-control-height-sm); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); padding: 0 var(--gc-space-2); background: var(--gc-color-surface-field); color: var(--gc-color-text); }
.onboarding-device-step { display: grid; gap: var(--gc-space-5); }
.onboarding-device-step__header h2 { color: var(--gc-color-text-strong); }
.onboarding-device-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-2); }
.onboarding-device-card.gc-selection-card { min-block-size: calc(var(--gc-size-card-compact) - var(--gc-space-4)); padding: var(--gc-space-3); gap: var(--gc-space-2); }
.onboarding-device-card :deep(.gc-selection-card__icon) { inline-size: var(--gc-space-7); block-size: var(--gc-space-7); border-radius: var(--gc-radius-control); }
.onboarding-device-card :deep(.gc-selection-card__description) { font-size: var(--gc-font-size-xs); line-height: var(--gc-line-height-tight); }
.onboarding-device-card--new { border-color: var(--gc-color-primary-border); background: var(--gc-color-primary-soft); }
.onboarding-device-card--new:disabled { border-color: var(--gc-color-border); background: var(--gc-color-surface-soft); }
.onboarding-device-card__glyph { display: inline-grid; place-items: center; color: var(--gc-color-primary-strong); }
.onboarding-device-card__glyph--new { font-size: var(--gc-font-size-heading-sm); font-weight: var(--gc-font-weight-semibold); line-height: 1; }
.onboarding-device-card__glyph--device { gap: var(--gc-space-1); }
.onboarding-device-card__glyph--device span { display: block; inline-size: var(--gc-space-4); block-size: var(--gc-space-hairline); background: currentColor; border-radius: var(--gc-radius-pill); }
.onboarding-device-card--new :deep(.gc-selection-card__icon) { color: var(--gc-color-primary-strong); background: var(--gc-color-primary-soft); }
.onboarding-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gc-space-3); }
.onboarding-actions__spacer { flex: 1 1 auto; }
.target-list { display: grid; gap: var(--gc-space-2); }
.onboarding-error { color: var(--gc-color-danger); background: var(--gc-color-danger-soft); padding: var(--gc-space-3); border-radius: var(--gc-radius-sm); }
.onboarding-empty { color: var(--gc-color-text-muted); }
.onboarding-hint { margin: 0; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.onboarding-panel--success { border-color: var(--gc-color-border); background: var(--gc-color-surface); }
@media (max-width: 64rem) { .onboarding-steps { grid-template-columns: repeat(3, minmax(0, 1fr)); } .platform-grid, .onboarding-device-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 48rem) { .onboarding-page__header { flex-direction: column; } .onboarding-steps { grid-template-columns: 1fr; } .platform-grid, .onboarding-device-grid, .onboarding-choice-grid { grid-template-columns: 1fr; max-block-size: none; padding-inline-end: 0; overflow: visible; } .target-row__metadata, .target-config__fields, .onboarding-automation__schedule-fields { grid-template-columns: 1fr; } .target-config__header { align-items: flex-start; flex-direction: column; } .onboarding-automation__options-row { grid-template-columns: 1fr; } }
</style>

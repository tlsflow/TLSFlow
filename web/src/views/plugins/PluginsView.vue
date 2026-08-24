<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginRuntimeMetric, PluginVersionRecord } from '@/api/generated/schemas'
import { disableUnifiedPluginVersion, enableUnifiedPluginVersion, getUnifiedPluginUiResources, listPluginCatalog, listPluginRuntimeMetrics, listUnifiedPluginVersions, refreshBuiltinPluginCatalog } from '@/api/modules/plugins.api'
import { GcDevicePresentation, GcEmptyState, GcModal, GcPluginForm, type DevicePresentationSchema, type PluginFormSchema } from '@/design-system/components'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { aggregateRunnerStatus, toCatalogPluginRecord, type PluginRecord } from './plugin-record'

type SourceFilter = 'all' | PluginSource
type ValidityFilter = 'all' | 'valid' | 'invalid'
type PluginSource = 'builtin' | 'user'

interface PluginChip {
  key: string
  label: string
  kind: 'capability' | 'permission' | 'more'
  hiddenItems?: Array<Pick<PluginChip, 'key' | 'label' | 'kind'>>
}

const { t, locale } = useI18n()
const loading = ref(false)
const loadError = ref('')
const plugins = ref<PluginRecord[]>([])
const keyword = ref('')
const sourceFilter = ref<SourceFilter>('all')
const validityFilter = ref<ValidityFilter>('all')
const pluginPage = ref(1)
const pluginPageSize = 12
const selectedPlugin = ref<PluginRecord | null>(null)
const detailOpen = ref(false)
const changingPluginId = ref('')
const createError = ref('')
const failedLogos = ref(new Set<string>())
const agentActionError = ref('')
const pluginUiLoading = ref(false)
const pluginUiError = ref('')
const pluginForms = ref<Record<string, PluginFormSchema>>({})
const pluginPresentations = ref<Record<string, DevicePresentationSchema>>({})
const pluginMessages = ref<Record<string, string>>({})
const pluginFormValues = ref<Record<string, unknown>>({})
const activePresentationTab = ref('')

const previewForm = computed(() => Object.values(pluginForms.value)[0])
const previewPresentation = computed(() => Object.values(pluginPresentations.value)[0])

const sourceOptions = computed(() => [
  { value: 'all' as const, label: t('plugins.filters.allSources') },
  { value: 'builtin' as const, label: t('plugins.sources.builtin') },
  { value: 'user' as const, label: t('plugins.sources.user') },
])

const validityOptions = computed(() => [
  { value: 'all' as const, label: t('plugins.filters.allStatuses') },
  { value: 'valid' as const, label: t('plugins.statuses.valid') },
  { value: 'invalid' as const, label: t('plugins.statuses.invalid') },
])

const filteredPlugins = computed(() => {
  const normalizedKeyword = keyword.value.trim().toLocaleLowerCase()
  return plugins.value.filter((plugin) => {
    if (sourceFilter.value !== 'all' && plugin.source !== sourceFilter.value) return false
    if (validityFilter.value === 'valid' && !plugin.valid) return false
    if (validityFilter.value === 'invalid' && plugin.valid) return false
    if (!normalizedKeyword) return true
    const searchable = [
      plugin.metadata.displayName,
      plugin.metadata.name,
      plugin.metadata.description,
      plugin.pluginId,
      plugin.version,
      ...plugin.metadata.tags,
      ...plugin.capabilities,
      ...plugin.capabilities.map(pluginCapabilityLabel),
      ...plugin.permissions,
      ...plugin.permissions.map(pluginPermissionLabel),
      pluginRunnerStatusLabel(plugin),
    ].filter(Boolean).join(' ').toLocaleLowerCase()
    return searchable.includes(normalizedKeyword)
  })
})

const pluginPageCount = computed(() => Math.max(1, Math.ceil(filteredPlugins.value.length / pluginPageSize)))
const pagedPlugins = computed(() => {
  const start = (pluginPage.value - 1) * pluginPageSize
  return filteredPlugins.value.slice(start, start + pluginPageSize)
})

const builtinCount = computed(() => plugins.value.filter((plugin) => plugin.source === 'builtin').length)
const userCount = computed(() => plugins.value.filter((plugin) => plugin.source === 'user').length)

onMounted(() => {
  void loadPlugins()
})

watch(locale, () => {
  void loadPlugins()
})

watch([keyword, sourceFilter, validityFilter], () => {
  pluginPage.value = 1
})

watch(pluginPageCount, (count) => {
  if (pluginPage.value > count) pluginPage.value = count
})

async function loadPlugins(refreshBuiltins = false): Promise<void> {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    if (refreshBuiltins) await refreshBuiltinPluginCatalog()
    const query = {
      page: 1,
      pageSize: 500,
      sort: 'updatedAt:desc',
      filters: { locale: locale.value },
    } as const
    const catalogResult = await listPluginCatalog(query)
    const [versionResult, metricsResult] = await Promise.all([
      listUnifiedPluginVersions(query).catch(() => undefined),
      listPluginRuntimeMetrics(query).catch(() => undefined),
    ])
    const versionsById = new Map(readPageItems<PluginVersionRecord>(versionResult).map((record) => [record.id, record]))
    const metricsByVersionId = new Map<string, PluginRuntimeMetric[]>()
    for (const metric of readPageItems<PluginRuntimeMetric>(metricsResult)) {
      const metrics = metricsByVersionId.get(metric.pluginVersionId) ?? []
      metrics.push(metric)
      metricsByVersionId.set(metric.pluginVersionId, metrics)
    }
    plugins.value = (catalogResult.data?.items ?? [])
      .map((record) => toCatalogPluginRecord(record, versionsById.get(record.pluginVersionId)))
      .filter((plugin): plugin is PluginRecord => Boolean(plugin))
      .map((plugin) => ({ ...plugin, runnerStatus: aggregateRunnerStatus(metricsByVersionId.get(plugin.pluginVersionId) ?? []) }))
  } catch (cause) {
    plugins.value = []
    loadError.value = cause instanceof Error ? cause.message : t('plugins.errors.loadFailed')
  } finally {
    loading.value = false
  }
}


async function refreshPlugins(): Promise<void> {
  await loadPlugins(true)
}

function readPageItems<T>(result: { data?: { items: readonly T[] } } | undefined): T[] {
  return result?.data?.items ? [...result.data.items] : []
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function catalogTranslationToken(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function translateCatalogValue(namespace: string, value?: string): string {
  const rawValue = value?.trim() ?? ''
  if (!rawValue) return t('common.notAvailable')
  const key = `${namespace}.${catalogTranslationToken(rawValue)}`
  const label = t(key)
  return label === key ? rawValue : label
}

function pluginCapabilityLabel(capability: string): string {
  return translateCatalogValue('plugins.capabilityKeys', capability)
}

function pluginPermissionLabel(permission: string): string {
  return translateCatalogValue('plugins.permissionKeys', permission)
}

function pluginRuntimeLabel(runtime?: string): string {
  return translateCatalogValue('plugins.runtimeTypes', runtime)
}

function pluginExecutionSummary(plugin: PluginRecord): string {
  return t('plugins.card.stepCount', { count: plugin.stepCount })
}

function pluginRunnerStatusLabel(plugin: PluginRecord): string {
  return t(`plugins.runnerStatuses.${plugin.runnerStatus}`)
}

function pluginHashEntries(plugin: PluginRecord): string[] {
  return [
    `packageSha256=${plugin.packageSha256}`,
    `manifestSha256=${plugin.manifestSha256}`,
    ...Object.entries(plugin.resourceSha256).sort(([left], [right]) => left.localeCompare(right)).map(([path, digest]) => `resourceSha256[${path}]=${digest}`),
  ]
}

function compactPluginChips(plugin: PluginRecord): PluginChip[] {
  const visibleCapabilities = plugin.capabilities.slice(0, 2)
  const visiblePermissions = plugin.permissions.slice(0, 2)
  const capabilityChips = visibleCapabilities.map((capability) => ({
    key: `capability:${capability}`,
    label: pluginCapabilityLabel(capability),
    kind: 'capability' as const,
  }))
  const permissionChips = visiblePermissions.map((permission) => ({
    key: `permission:${permission}`,
    label: pluginPermissionLabel(permission),
    kind: 'permission' as const,
  }))
  const hiddenItems: PluginChip['hiddenItems'] = [
    ...plugin.capabilities.slice(visibleCapabilities.length).map((capability) => ({
      key: `capability:${capability}`,
      label: pluginCapabilityLabel(capability),
      kind: 'capability' as const,
    })),
    ...plugin.permissions.slice(visiblePermissions.length).map((permission) => ({
      key: `permission:${permission}`,
      label: pluginPermissionLabel(permission),
      kind: 'permission' as const,
    })),
  ]
  const chips: PluginChip[] = [...capabilityChips, ...permissionChips]
  if (hiddenItems.length > 0) {
    chips.push({
      key: 'more',
      label: t('plugins.card.moreTags', { count: hiddenItems.length }),
      kind: 'more',
      hiddenItems,
    })
  }
  return chips
}

function pluginTitle(plugin: PluginRecord): string {
  return plugin.metadata.displayName ?? plugin.metadata.name
}

function pluginDescription(plugin: PluginRecord): string {
  return plugin.metadata.description ?? t('plugins.card.defaultDescription')
}

function pluginVersion(plugin: PluginRecord): string {
  return plugin.version || t('plugins.card.unversioned')
}

function pluginInitial(plugin: PluginRecord): string {
  return pluginTitle(plugin).trim().slice(0, 1).toLocaleUpperCase() || 'D'
}

function resolvedLogoUrl(plugin: PluginRecord): string | undefined {
  const value = plugin.metadata.logoUrl?.trim()
  if (!value || failedLogos.value.has(plugin.id)) return undefined
  if (typeof window === 'undefined') return undefined
  try {
    const url = new URL(value, window.location.origin)
    if (url.origin !== window.location.origin) return undefined
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return undefined
  }
}

function markLogoFailed(pluginId: string): void {
  failedLogos.value = new Set([...failedLogos.value, pluginId])
}

async function openDetail(plugin: PluginRecord): Promise<void> {
  selectedPlugin.value = plugin
  createError.value = ''
  agentActionError.value = ''
  detailOpen.value = true
  pluginForms.value = {}
  pluginPresentations.value = {}
  pluginMessages.value = {}
  pluginFormValues.value = {}
  activePresentationTab.value = ''
  pluginUiError.value = ''
  pluginUiLoading.value = true
  try {
    const result = await getUnifiedPluginUiResources(plugin.id, locale.value)
    const payload = readRecord(result.data)
    pluginForms.value = readRecord(payload.forms) as Record<string, PluginFormSchema>
    pluginPresentations.value = readRecord(payload.presentations) as Record<string, DevicePresentationSchema>
    pluginMessages.value = readRecord(readRecord(payload.locale).messages) as Record<string, string>
    activePresentationTab.value = Object.values(pluginPresentations.value)[0]?.tabs[0]?.id ?? ''
  } catch (cause) {
    pluginUiError.value = cause instanceof Error ? cause.message : t('plugins.forms.loadFailed')
  } finally {
    pluginUiLoading.value = false
  }
}

async function enableCatalogPlugin(plugin: PluginRecord): Promise<void> {
  if (!plugin.valid || plugin.status.toLowerCase() === 'enabled' || changingPluginId.value) return
  changingPluginId.value = plugin.id
  agentActionError.value = ''
  try {
    await enableUnifiedPluginVersion(plugin.id)
    detailOpen.value = false
    await loadPlugins()
  } catch (cause) {
    agentActionError.value = cause instanceof Error ? cause.message : t('plugins.agentDeployment.activateFailed')
  } finally {
    changingPluginId.value = ''
  }
}

async function disableCatalogPlugin(plugin: PluginRecord): Promise<void> {
  if (plugin.status.toLowerCase() !== 'enabled' || changingPluginId.value) return
  changingPluginId.value = plugin.id
  agentActionError.value = ''
  try {
    await disableUnifiedPluginVersion(plugin.id)
    detailOpen.value = false
    await loadPlugins()
  } catch (cause) {
    agentActionError.value = cause instanceof Error ? cause.message : t('plugins.agentDeployment.disableFailed')
  } finally {
    changingPluginId.value = ''
  }
}

function pluginStatusLabel(plugin: PluginRecord): string {
  if (!plugin.valid) return t('plugins.statuses.invalid')
  if (plugin.status.toLowerCase() === 'pending_approval') return t('plugins.statuses.pendingApproval')
  if (plugin.status.toLowerCase() !== 'enabled') return t('plugins.statuses.disabled')
  return t('plugins.statuses.enabled')
}

function pluginStatusClass(plugin: PluginRecord): string {
  if (!plugin.valid) return 'plugin-state--invalid'
  if (plugin.status.toLowerCase() !== 'enabled') return 'plugin-state--disabled'
  return 'plugin-state--available'
}

</script>

<template>
  <section class="plugins-page">
    <dl class="market-stats">
      <div><dt>{{ t('plugins.metrics.total.title') }}</dt><dd>{{ plugins.length }}</dd></div>
      <div><dt>{{ t('plugins.metrics.builtin.title') }}</dt><dd>{{ builtinCount }}</dd></div>
      <div><dt>{{ t('plugins.metrics.user.title') }}</dt><dd>{{ userCount }}</dd></div>
    </dl>

    <section class="market-toolbar" :aria-label="t('plugins.aria.filters')">
      <label class="market-search">
        <span>{{ t('plugins.filters.searchLabel') }}</span>
        <input v-model="keyword" type="search" :placeholder="t('plugins.filters.searchPlaceholder')">
      </label>
      <div class="market-filter-group">
        <button
          v-for="option in sourceOptions"
          :key="option.value"
          class="market-filter"
          :class="{ 'market-filter--active': sourceFilter === option.value }"
          type="button"
          @click="sourceFilter = option.value"
        >
          {{ option.label }}
        </button>
      </div>
      <select v-model="validityFilter" class="market-select" :aria-label="t('plugins.filters.statusLabel')">
        <option v-for="option in validityOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <button class="gc-button market-refresh" type="button" :disabled="loading" @click="refreshPlugins">
        {{ loading ? t('plugins.actions.refreshing') : t('plugins.actions.refresh') }}
      </button>
    </section>

    <div v-if="loadError" class="market-error">
      <span>{{ loadError }}</span>
      <button class="gc-button" type="button" :disabled="loading" @click="refreshPlugins">
        {{ loading ? t('plugins.actions.refreshing') : t('businessPage.retry') }}
      </button>
    </div>

    <section v-if="filteredPlugins.length" class="plugin-grid" :aria-label="t('plugins.aria.list')">
      <article v-for="plugin in pagedPlugins" :key="plugin.id" class="plugin-card">
        <header class="plugin-card__header">
          <div class="plugin-logo" :class="{ 'plugin-logo--fallback': !resolvedLogoUrl(plugin), 'plugin-logo--wide': resolvedLogoUrl(plugin) }">
            <img
              v-if="resolvedLogoUrl(plugin)"
              :src="resolvedLogoUrl(plugin)"
              :alt="t('plugins.aria.logo', { name: pluginTitle(plugin) })"
              @error="markLogoFailed(plugin.id)"
            >
            <span v-else aria-hidden="true">{{ pluginInitial(plugin) }}</span>
          </div>
          <div class="plugin-card__badges">
            <span class="plugin-source" :class="`plugin-source--${plugin.source}`">{{ t(`plugins.sources.${plugin.source}`) }}</span>
            <span class="plugin-state" :class="pluginStatusClass(plugin)">
              {{ pluginStatusLabel(plugin) }}
            </span>
            <span class="plugin-state" :class="`plugin-runner-state--${plugin.runnerStatus}`">
              {{ pluginRunnerStatusLabel(plugin) }}
            </span>
          </div>
        </header>

        <div class="plugin-card__body">
          <div class="plugin-card__title-row">
            <h3>{{ pluginTitle(plugin) }}</h3>
            <span class="plugin-version">{{ pluginVersion(plugin) }}</span>
          </div>
          <p class="plugin-card__id">{{ plugin.pluginId }}</p>
          <p>{{ pluginDescription(plugin) }}</p>
          <div v-if="plugin.metadata.tags.length" class="plugin-tags">
            <span v-for="tag in plugin.metadata.tags.slice(0, 3)" :key="tag">{{ tag }}</span>
          </div>
          <div v-if="compactPluginChips(plugin).length" class="plugin-card__chips">
            <span
              v-for="chip in compactPluginChips(plugin)"
              :key="chip.key"
              class="plugin-chip"
              :data-kind="chip.kind"
              :tabindex="chip.kind === 'more' ? 0 : undefined"
            >
              {{ chip.label }}
              <span v-if="chip.hiddenItems?.length" class="plugin-chip__popover" role="tooltip">
                <span
                  v-for="hiddenItem in chip.hiddenItems"
                  :key="hiddenItem.key"
                  class="plugin-chip plugin-chip--popover-item"
                  :data-kind="hiddenItem.kind"
                >
                  {{ hiddenItem.label }}
                </span>
              </span>
            </span>
          </div>
        </div>

        <footer class="plugin-card__footer">
          <span>{{ pluginExecutionSummary(plugin) }}</span>
          <div class="plugin-card__actions">
            <button class="gc-button" type="button" @click="openDetail(plugin)">{{ t('plugins.actions.detail') }}</button>
            <button
              v-if="plugin.status.toLowerCase() !== 'enabled'"
              class="gc-button gc-button--primary"
              type="button"
              :disabled="!plugin.valid || Boolean(changingPluginId)"
              @click="enableCatalogPlugin(plugin)"
            >
              {{ changingPluginId === plugin.id ? t('plugins.agentDeployment.activating') : t('plugins.actions.enable') }}
            </button>
            <button
              v-if="plugin.status.toLowerCase() === 'enabled'"
              class="gc-button"
              type="button"
              :disabled="Boolean(changingPluginId)"
              @click="disableCatalogPlugin(plugin)"
            >
              {{ changingPluginId === plugin.id ? t('plugins.actions.disabling') : t('plugins.actions.disable') }}
            </button>
          </div>
        </footer>
      </article>
    </section>

    <GcEmptyState
      v-else-if="!loading && !loadError"
      :title="t('plugins.empty.title')"
      :description="t('plugins.empty.description')"
    />

    <nav v-if="filteredPlugins.length > pluginPageSize" class="plugin-pagination" :aria-label="t('businessPage.pagination', { page: pluginPage, pageSize: pluginPageSize })">
      <button class="gc-button" type="button" :disabled="pluginPage <= 1" @click="pluginPage -= 1">
        {{ t('tasks.actions.previousPage') }}
      </button>
      <span>{{ t('businessPage.pagination', { page: pluginPage, pageSize: pluginPageSize }) }}</span>
      <button class="gc-button" type="button" :disabled="pluginPage >= pluginPageCount" @click="pluginPage += 1">
        {{ t('tasks.actions.nextPage') }}
      </button>
    </nav>

    <GcModal
      v-model:open="detailOpen"
      :title="selectedPlugin ? pluginTitle(selectedPlugin) : t('plugins.detail.title')"
      :description="t('plugins.detail.description')"
      size="lg"
      width="82vw"
    >
      <section v-if="selectedPlugin" class="plugin-detail">
        <div class="plugin-detail__identity">
          <div class="plugin-detail__identity-main">
            <div class="plugin-logo plugin-logo--large" :class="{ 'plugin-logo--fallback': !resolvedLogoUrl(selectedPlugin), 'plugin-logo--wide': resolvedLogoUrl(selectedPlugin) }">
              <img
                v-if="resolvedLogoUrl(selectedPlugin)"
                :src="resolvedLogoUrl(selectedPlugin)"
                :alt="t('plugins.aria.logo', { name: pluginTitle(selectedPlugin) })"
                @error="markLogoFailed(selectedPlugin.id)"
              >
              <span v-else aria-hidden="true">{{ pluginInitial(selectedPlugin) }}</span>
            </div>
            <div class="plugin-detail__identity-copy">
              <span class="market-hero__eyebrow">{{ t(`plugins.sources.${selectedPlugin.source}`) }}</span>
              <h3>{{ pluginTitle(selectedPlugin) }}</h3>
              <p>{{ pluginDescription(selectedPlugin) }}</p>
            </div>
          </div>
          <div class="plugin-detail__identity-side">
            <span class="plugin-state" :class="pluginStatusClass(selectedPlugin)">{{ pluginStatusLabel(selectedPlugin) }}</span>
            <span class="plugin-state" :class="`plugin-runner-state--${selectedPlugin.runnerStatus}`">{{ pluginRunnerStatusLabel(selectedPlugin) }}</span>
            <span class="plugin-version">{{ pluginVersion(selectedPlugin) }}</span>
          </div>
        </div>

        <dl class="plugin-detail__facts">
          <div><dt>{{ t('plugins.fields.pluginId') }}</dt><dd>{{ selectedPlugin.pluginId }}</dd></div>
          <div><dt>{{ t('plugins.agentDeployment.type') }}</dt><dd>{{ t(`plugins.agentDeployment.types.${selectedPlugin.catalogType}`) }}</dd></div>
          <div><dt>{{ t('plugins.fields.version') }}</dt><dd>{{ pluginVersion(selectedPlugin) }}</dd></div>
          <div><dt>{{ t('plugins.fields.source') }}</dt><dd>{{ t(`plugins.sources.${selectedPlugin.source}`) }}</dd></div>
          <div><dt>{{ t('plugins.fields.steps') }}</dt><dd>{{ selectedPlugin.stepCount }}</dd></div>
          <div><dt>{{ t('plugins.fields.rollbackSteps') }}</dt><dd>{{ selectedPlugin.rollbackCount }}</dd></div>
          <div><dt>{{ t('plugins.fields.currentStatus') }}</dt><dd>{{ pluginStatusLabel(selectedPlugin) }}</dd></div>
          <div><dt>{{ t('plugins.fields.runtime') }}</dt><dd>{{ pluginRuntimeLabel(selectedPlugin.runtime) }}</dd></div>
          <div class="plugin-detail__fact-wide">
            <dt>{{ t('plugins.fields.capabilities') }}</dt>
            <dd class="plugin-detail__chip-list">
              <span v-for="capability in selectedPlugin.capabilities" :key="capability" class="plugin-chip" data-kind="capability" :title="capability">
                {{ pluginCapabilityLabel(capability) }}
              </span>
              <span v-if="!selectedPlugin.capabilities.length">{{ t('common.notAvailable') }}</span>
            </dd>
          </div>
          <div class="plugin-detail__fact-wide">
            <dt>{{ t('plugins.labels.permissions') }}</dt>
            <dd class="plugin-detail__chip-list">
              <span v-for="permission in selectedPlugin.permissions" :key="permission" class="plugin-chip" data-kind="permission" :title="permission">
                {{ pluginPermissionLabel(permission) }}
              </span>
              <span v-if="!selectedPlugin.permissions.length">{{ t('common.notAvailable') }}</span>
            </dd>
          </div>
          <div><dt>{{ t('plugins.labels.runnerStatus') }}</dt><dd>{{ pluginRunnerStatusLabel(selectedPlugin) }}</dd></div>
          <div><dt>{{ t('plugins.fields.updatedAt') }}</dt><dd>{{ formatBrowserLocalTime(selectedPlugin.updatedAt) }}</dd></div>
          <div class="plugin-detail__fact-wide">
            <dt>{{ t('plugins.fields.signatureStatus') }}</dt>
            <dd class="plugin-detail__hash-list">
              <code v-for="hash in pluginHashEntries(selectedPlugin)" :key="hash">{{ hash }}</code>
            </dd>
          </div>
        </dl>
        <section v-if="selectedPlugin.catalogType === 'UNIFIED_PLUGIN'" class="plugin-detail__resource-preview">
          <h3>{{ t('plugins.forms.previewTitle') }}</h3>
          <p v-if="pluginUiLoading">{{ t('plugins.forms.loading') }}</p>
          <p v-else-if="pluginUiError" class="market-error">{{ pluginUiError }}</p>
          <GcPluginForm
            v-else-if="previewForm"
            v-model="pluginFormValues"
            :schema="previewForm"
            :plugin-messages="pluginMessages"
          />
          <p v-else>{{ t('plugins.forms.empty') }}</p>

          <h3 v-if="previewPresentation">{{ t('plugins.presentation.previewTitle') }}</h3>
          <GcDevicePresentation
            v-if="previewPresentation"
            v-model:active-tab="activePresentationTab"
            :schema="previewPresentation"
            :data="selectedPlugin as unknown as Record<string, unknown>"
            :plugin-messages="pluginMessages"
          />
        </section>
        <p v-if="createError" class="market-error">{{ createError }}</p>
        <p v-if="agentActionError" class="market-error">{{ agentActionError }}</p>
      </section>

      <template #actions>
        <button
          v-if="selectedPlugin && selectedPlugin.status.toLowerCase() !== 'enabled'"
          class="gc-button gc-button--primary"
          type="button"
          :disabled="!selectedPlugin.valid || Boolean(changingPluginId)"
          @click="enableCatalogPlugin(selectedPlugin)"
        >
          {{ changingPluginId === selectedPlugin.id ? t('plugins.agentDeployment.activating') : t('plugins.actions.enable') }}
        </button>
        <button
          v-if="selectedPlugin && selectedPlugin.status.toLowerCase() === 'enabled'"
          class="gc-button"
          type="button"
          :disabled="Boolean(changingPluginId)"
          @click="disableCatalogPlugin(selectedPlugin)"
        >
          {{ changingPluginId === selectedPlugin.id ? t('plugins.actions.disabling') : t('plugins.actions.disable') }}
        </button>
        <button class="gc-button" type="button" @click="detailOpen = false">{{ t('designSystem.dryRunResult.close') }}</button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.plugins-page {
  display: grid;
  gap: var(--gc-space-5);
}

.market-hero__eyebrow {
  color: var(--gc-color-primary);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.plugin-detail h3 {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-lg);
  line-height: 1.1;
  overflow-wrap: anywhere;
}

.plugin-detail p {
  margin: 0;
  color: var(--gc-color-text-muted);
  line-height: 1.45;
  font-size: var(--gc-font-size-xs);
}

.plugin-card__id {
  color: var(--gc-color-text-secondary);
  font-size: var(--gc-font-size-xs);
  font-weight: 600;
}

.market-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}

.market-stats div {
  display: grid;
  gap: var(--gc-space-1);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-glass);
}

.market-stats dt,
.plugin-detail__facts dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
}

.market-stats dd {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-2xl);
  font-weight: 800;
}

.market-toolbar {
  display: flex;
  align-items: end;
  gap: var(--gc-space-3);
  flex-wrap: wrap;
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-panel);
}

.market-refresh {
  margin-left: auto;
}

.market-search {
  display: grid;
  flex: 1 1 var(--gc-size-card-min);
  gap: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
}

.market-search input,
.market-select {
  min-height: var(--gc-control-height-md);
  padding: 0 var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-field);
  font: inherit;
}

.market-search input:focus,
.market-select:focus {
  border-color: var(--gc-color-focus);
  outline: none;
  box-shadow: var(--gc-shadow-focus);
}

.market-filter-group {
  display: flex;
  gap: var(--gc-space-1);
  flex-wrap: wrap;
}

.market-filter {
  min-height: var(--gc-control-height-md);
  padding: 0 var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-md);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-solid);
  cursor: pointer;
}

.market-filter--active {
  border-color: var(--gc-color-primary-border-strong);
  color: var(--gc-color-primary-strong);
  background: var(--gc-color-primary-soft);
}

.market-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  margin: 0;
  padding: var(--gc-space-3) var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  border-radius: var(--gc-radius-md);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
}

.plugin-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--gc-space-3);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.plugin-grid {
  display: grid;
  grid-template-columns: repeat(
    auto-fill,
    minmax(
      min(100%, calc(var(--gc-size-card-min) + var(--gc-space-10) + var(--gc-space-10) + var(--gc-space-10))),
      1fr
    )
  );
  gap: var(--gc-space-3);
}

.plugin-card {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: var(--gc-space-2);
  min-width: 0;
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-gradient-surface);
  box-shadow: var(--gc-shadow-sm);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.plugin-card:hover {
  transform: translateY(calc(var(--gc-space-1) * -1));
  border-color: var(--gc-color-primary-border);
  box-shadow: var(--gc-shadow-hover);
}

.plugin-card__header,
.plugin-card__footer,
.plugin-card__title-row,
.plugin-detail__identity {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-2);
}

.plugin-card__badges,
.plugin-tags {
  display: flex;
  gap: var(--gc-space-1);
  flex-wrap: wrap;
  justify-content: flex-end;
}

.plugin-logo {
  display: grid;
  place-items: center;
  width: calc(var(--gc-space-10) + var(--gc-space-8));
  height: calc(var(--gc-space-8) + var(--gc-space-3));
  overflow: hidden;
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-solid);
  box-shadow: var(--gc-shadow-sm);
}

.plugin-logo--large {
  flex: 0 0 auto;
  width: calc(var(--gc-space-10) + var(--gc-space-6));
  height: calc(var(--gc-space-10) + var(--gc-space-6));
}

.plugin-logo--wide {
  width: calc(var(--gc-space-10) + var(--gc-space-10) + var(--gc-space-6));
  height: calc(var(--gc-space-8) + var(--gc-space-5));
}

.plugin-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: var(--gc-space-1);
}

.plugin-logo--wide img {
  height: auto;
  max-height: 100%;
  padding: var(--gc-space-2);
}

.plugin-logo--fallback {
  color: var(--gc-color-text-inverse);
  background: var(--gc-gradient-primary);
  font-size: var(--gc-font-size-xl);
  font-weight: 800;
}

.plugin-source,
.plugin-state,
.plugin-version,
.plugin-chip,
.plugin-tags span,
.plugin-methods span {
  display: inline-flex;
  align-items: center;
  min-height: var(--gc-space-4);
  padding: 0 var(--gc-space-1);
  border-radius: var(--gc-radius-sm);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
}

.plugin-source--builtin {
  color: var(--gc-color-info);
  background: var(--gc-color-info-bg);
}

.plugin-source--user {
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
}

.plugin-state--using {
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
}

.plugin-state--available {
  color: var(--gc-color-info);
  background: var(--gc-color-info-bg);
}

.plugin-state--disabled {
  color: var(--gc-color-muted);
  background: var(--gc-color-muted-bg);
}

.plugin-state--invalid {
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
}

.plugin-card__body {
  display: grid;
  align-content: start;
  gap: var(--gc-space-2);
}

.plugin-card__body h3 {
  min-width: 0;
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
  line-height: 1.35;
  overflow-wrap: anywhere;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.plugin-version {
  flex: 0 0 auto;
  color: var(--gc-color-primary-strong);
  background: var(--gc-color-primary-soft);
}

.plugin-card__body p {
  margin: 0;
  color: var(--gc-color-text-muted);
  line-height: 1.5;
  font-size: var(--gc-font-size-xs);
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.plugin-tags,
.plugin-methods {
  display: flex;
  gap: var(--gc-space-1);
  flex-wrap: wrap;
  justify-content: flex-start;
}

.plugin-tags span {
  color: var(--gc-color-text-soft);
  background: var(--gc-color-surface-hover);
}

.plugin-methods span {
  color: var(--gc-color-primary-strong);
  background: var(--gc-color-primary-soft);
}

.plugin-chip[data-kind='capability'] {
  border: var(--gc-border-width-default) solid var(--gc-color-info-border);
  color: var(--gc-color-info);
  background: var(--gc-color-info-soft);
}

.plugin-chip[data-kind='permission'] {
  border: var(--gc-border-width-default) solid var(--gc-color-success-border);
  color: var(--gc-color-success);
  background: var(--gc-color-success-soft);
}

.plugin-runner-state--ready {
  border-color: var(--gc-color-success-border);
  color: var(--gc-color-success);
  background: var(--gc-color-success-soft);
}

.plugin-runner-state--busy {
  border-color: var(--gc-color-info-border);
  color: var(--gc-color-info);
  background: var(--gc-color-info-soft);
}

.plugin-runner-state--unavailable {
  border-color: var(--gc-color-danger-border);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
}

.plugin-runner-state--notObserved {
  border-color: var(--gc-color-border-muted);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-hover);
}

.plugin-chip[data-kind='more'] {
  position: relative;
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-hover);
  cursor: default;
}

.plugin-chip[data-kind='more']:focus-visible {
  outline: none;
  box-shadow: var(--gc-shadow-focus);
}

.plugin-chip__popover {
  position: absolute;
  left: 0;
  top: calc(100% + var(--gc-space-1));
  z-index: 5;
  display: none;
  flex-wrap: wrap;
  gap: var(--gc-space-1);
  width: max-content;
  max-width: min(70vw, calc(var(--gc-size-card-min) + var(--gc-space-10)));
  padding: var(--gc-space-2);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-overlay);
  box-shadow: var(--gc-shadow-overlay);
}

.plugin-chip[data-kind='more']:hover .plugin-chip__popover,
.plugin-chip[data-kind='more']:focus .plugin-chip__popover,
.plugin-chip[data-kind='more']:focus-within .plugin-chip__popover {
  display: flex;
}

.plugin-chip--popover-item {
  white-space: nowrap;
}

.plugin-card__footer {
  padding-top: var(--gc-space-2);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.plugin-card__footer .gc-button {
  min-height: var(--gc-space-8);
  padding: 0 var(--gc-space-2);
  font-size: var(--gc-font-size-xs);
}

.plugin-card__actions {
  display: flex;
  align-items: center;
  gap: var(--gc-space-1);
}

.plugin-detail {
  display: grid;
  gap: var(--gc-space-2);
}

.plugin-detail__identity {
  justify-content: flex-start;
  align-items: center;
  padding: var(--gc-space-2) var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-info-border);
  border-radius: var(--gc-radius-md);
  background: radial-gradient(circle at top right, var(--gc-color-primary-soft), transparent 26%), linear-gradient(140deg, var(--gc-color-surface-hover) 0%, var(--gc-color-surface-solid) 54%, var(--gc-color-surface-subtle) 100%);
}

.plugin-detail__identity-main {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: var(--gc-space-2);
}

.plugin-detail__identity-copy,
.plugin-detail__identity-side {
  display: grid;
  min-width: 0;
  gap: var(--gc-space-1);
}

.plugin-detail__identity-side {
  justify-items: end;
  margin-left: auto;
}

.plugin-detail__facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(var(--gc-space-10) * 4)), 1fr));
  gap: var(--gc-space-2);
  margin: 0;
}

.plugin-detail__facts div {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
  padding: var(--gc-space-2);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-hover);
}

.plugin-detail__facts dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
  overflow-wrap: anywhere;
}

.plugin-card__chips,
.plugin-detail__chip-list {
  display: flex;
  gap: var(--gc-space-1);
  flex-wrap: wrap;
}

.plugin-detail__hash-list {
  display: grid;
  gap: var(--gc-space-1);
}

.plugin-detail__hash-list code {
  overflow-wrap: anywhere;
  color: var(--gc-color-text-secondary);
  font-family: var(--gc-font-family-mono);
  font-size: var(--gc-font-size-xs);
  font-weight: 600;
}

.plugin-detail__fact-wide {
  grid-column: 1 / -1;
}

.plugin-detail__error {
  border-color: var(--gc-color-danger-border) !important;
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg) !important;
}

.plugin-detail__resource-preview { display: grid; gap: var(--gc-space-2); margin-top: var(--gc-space-1); }
.plugin-detail__resource-preview h3, .plugin-detail__resource-preview p { margin: 0; }

.plugin-detail__resource-preview h3 {
  font-size: var(--gc-font-size-sm);
}

@media (max-width: 56.25rem) {
  .market-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 40rem) {
  .market-stats {
    grid-template-columns: 1fr;
  }

  .market-refresh {
    width: 100%;
    margin-left: 0;
  }

  .market-error,
  .plugin-pagination {
    align-items: stretch;
    flex-direction: column;
  }

  .plugin-detail__identity {
    align-items: stretch;
    flex-direction: column;
  }

  .plugin-detail__identity-main {
    align-items: flex-start;
  }

  .plugin-detail__identity-side {
    justify-items: start;
    margin-left: 0;
  }
}
</style>

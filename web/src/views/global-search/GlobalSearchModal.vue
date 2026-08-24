<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { searchGlobal } from '@/api/modules/global-search.api'
import { GcEmptyState, GcModal } from '@/design-system/components'
import { usePermissionStore } from '@/stores/permission.store'
import type { MenuItem } from '@/types/router'

interface SearchResult {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly subtitle: string
  readonly category: SearchCategory
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
  readonly keywords: readonly string[]
}

type SearchCategory = 'certificates' | 'assets' | 'settings' | 'plugins'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { t, locale } = useI18n()
const router = useRouter()
const permissionStore = usePermissionStore()

const keyword = ref('')
const loading = ref(false)
const error = ref('')
const results = ref<SearchResult[]>([])
const searchInput = ref<HTMLInputElement | null>(null)
let requestSequence = 0

const categoryOrder: readonly SearchCategory[] = ['certificates', 'assets', 'settings', 'plugins']
const categoryLabels = computed<Record<SearchCategory, string>>(() => ({
  certificates: t('globalSearch.categories.certificates'),
  assets: t('globalSearch.categories.assets'),
  settings: t('globalSearch.categories.settings'),
  plugins: t('globalSearch.categories.plugins'),
}))
const groupedResults = computed(() => categoryOrder
  .map((category) => ({
    category,
    label: categoryLabels.value[category],
    items: results.value.filter((item) => item.category === category),
  }))
  .filter((group) => group.items.length > 0))
const hasQuery = computed(() => keyword.value.trim().length > 0)

watch(() => props.open, (open) => {
  if (open) {
    keyword.value = ''
    error.value = ''
    results.value = []
    void nextTick(() => searchInput.value?.focus())
    return
  }
  requestSequence += 1
}, { immediate: true })

watch(keyword, (value) => {
  if (!value.trim()) {
    results.value = []
    error.value = ''
    loading.value = false
    requestSequence += 1
    return
  }
  void search(value)
})

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase(locale.value)
}

function matchesSearch(result: SearchResult, query: string): boolean {
  const needle = normalize(query)
  return [result.title, result.summary, result.subtitle, ...result.keywords].some((value) => normalize(value).includes(needle))
}

function flattenMenuItems(items: readonly MenuItem[]): MenuItem[] {
  return items.flatMap((item) => [item, ...(item.children ? flattenMenuItems(item.children) : [])])
}

function settingsResults(query: string): SearchResult[] {
  return flattenMenuItems(permissionStore.visibleMenuItems)
    .filter((item) => item.module === 'settings')
    .map((item) => ({
      id: `settings:${item.path}`,
      title: item.titleKey ? t(item.titleKey) : (item.title ?? item.path),
      summary: item.descriptionKey ? t(item.descriptionKey) : item.path,
      subtitle: t('globalSearch.types.systemSetting'),
      category: 'settings' as const,
      path: item.path,
      keywords: [
        item.path,
        item.descriptionKey ? t(item.descriptionKey) : '',
        item.title ?? '',
      ],
    }))
    .filter((item) => matchesSearch(item, query))
}

async function search(query: string): Promise<void> {
  const requestId = requestSequence + 1
  requestSequence = requestId
  loading.value = true
  error.value = ''
  const requestQuery = query.trim()

  try {
    const response = await searchGlobal(requestQuery, locale.value)
    if (requestId !== requestSequence || !props.open) return
    const remoteResults = (response.data?.items ?? []) as Array<Record<string, unknown>>
    const allResults: SearchResult[] = [
      ...remoteResults.map((item) => ({
        id: String(item.id ?? ''),
        title: String(item.title ?? item.id ?? ''),
        summary: String(item.summary ?? ''),
        subtitle: t(`globalSearch.types.${String(item.type ?? '')}`),
        category: item.category as SearchCategory,
        path: String(item.path ?? ''),
        query: item.query as Readonly<Record<string, string>> | undefined,
        keywords: Array.isArray(item.keywords) ? item.keywords.map(String) : [],
      })),
      ...settingsResults(requestQuery),
    ]
    const deduplicated = new Map(allResults.map((item) => [item.id, item]))
    results.value = [...deduplicated.values()]
      .filter((item) => matchesSearch(item, requestQuery))
      .slice(0, 100)
  } catch (cause) {
    if (requestId !== requestSequence || !props.open) return
    error.value = cause instanceof Error ? cause.message : t('globalSearch.messages.loadFailed')
    results.value = []
  } finally {
    if (requestId === requestSequence) loading.value = false
  }
}

async function openResult(result: SearchResult): Promise<void> {
  emit('close')
  await router.push({ path: result.path, query: result.query })
}
</script>

<template>
  <GcModal
    :open="props.open"
    size="md"
    :title="t('globalSearch.title')"
    :description="t('globalSearch.description')"
    @update:open="(value) => { if (!value) emit('close') }"
  >
    <div class="global-search">
      <form class="global-search__form" role="search" @submit.prevent="search(keyword)">
        <label class="global-search__input">
          <span class="global-search__sr-only">{{ t('globalSearch.inputLabel') }}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <input
            ref="searchInput"
            v-model="keyword"
            type="search"
            autocomplete="off"
            :placeholder="t('globalSearch.inputPlaceholder')"
            :aria-label="t('globalSearch.inputLabel')"
          >
        </label>
      </form>

      <div v-if="loading" class="global-search__state">{{ t('common.loading') }}</div>
      <p v-else-if="error" class="global-search__error" role="alert">{{ error }}</p>
      <GcEmptyState
        v-else-if="hasQuery && results.length === 0"
        class="global-search__empty"
        :title="t('globalSearch.empty.title')"
        :description="t('globalSearch.empty.description')"
      />
      <div v-else-if="!hasQuery" class="global-search__hint">
        {{ t('globalSearch.hint') }}
      </div>
      <div v-else class="global-search__groups">
        <section v-for="group in groupedResults" :key="group.category" class="global-search__group">
          <h3>{{ group.label }}</h3>
          <button
            v-for="result in group.items"
            :key="result.id"
            class="global-search__result"
            type="button"
            @click="openResult(result)"
          >
            <span class="global-search__result-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18.5v-13Z" /><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" /></svg>
            </span>
            <span class="global-search__result-copy">
              <strong>{{ result.title }}</strong>
              <small>{{ result.subtitle }}</small>
              <small v-if="result.summary" class="global-search__result-summary">{{ result.summary }}</small>
            </span>
            <span class="global-search__result-arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
            </span>
          </button>
        </section>
      </div>
    </div>
  </GcModal>
</template>

<style scoped>
.global-search {
  display: grid;
  gap: var(--gc-space-6);
  min-height: 20rem;
}

.global-search__form {
  margin: 0;
}

.global-search__input {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
  min-height: var(--gc-control-height-lg);
  border: var(--gc-border-width-default) solid var(--gc-color-border-strong);
  border-radius: var(--gc-radius-card);
  padding: 0 var(--gc-space-3);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-field);
}

.global-search__input:focus-within {
  border-color: var(--gc-color-primary-border);
  box-shadow: var(--gc-shadow-focus);
}

.global-search__input svg {
  flex: 0 0 auto;
  width: var(--gc-size-icon-md);
  height: var(--gc-size-icon-md);
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.global-search__input input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  color: var(--gc-color-text-strong);
  background: transparent;
  font: inherit;
}

.global-search__groups {
  display: grid;
  gap: var(--gc-space-6);
  max-height: 48vh;
  overflow: auto;
}

.global-search__group {
  display: grid;
  gap: var(--gc-space-2);
}

.global-search__group h3 {
  margin: 0 0 var(--gc-space-1);
  color: var(--gc-color-text-soft);
  font-size: var(--gc-font-size-overline);
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.global-search__result {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--gc-space-4);
  width: 100%;
  min-height: var(--gc-space-12);
  border: var(--gc-border-width-thick) solid var(--gc-color-border-subtle);
  border-radius: var(--gc-radius-card);
  padding: var(--gc-space-4) var(--gc-space-5);
  text-align: left;
  color: var(--gc-color-text);
  background: var(--gc-color-surface-solid);
  cursor: pointer;
  box-shadow: none;
  transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
}

.global-search__result:hover {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-surface-hover);
  box-shadow: var(--gc-shadow-hover);
}

.global-search__result:focus-visible {
  border-color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
  box-shadow: var(--gc-shadow-focus);
  outline: 0;
}

.global-search__result-icon {
  display: inline-grid;
  place-items: center;
  width: var(--gc-space-12);
  height: var(--gc-space-12);
  border-radius: var(--gc-radius-md);
  color: var(--gc-color-primary-strong);
  background: var(--gc-color-primary-soft);
  box-shadow: var(--gc-shadow-sm);
  transition: transform 180ms ease, color 180ms ease, background 180ms ease;
}

.global-search__result:hover .global-search__result-icon,
.global-search__result:focus-visible .global-search__result-icon {
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-bg);
  transform: scale(1.05);
}

.global-search__result-icon svg {
  width: 100%;
  height: 100%;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}

.global-search__result-copy {
  display: grid;
  min-width: 0;
  gap: var(--gc-space-tight);
}

.global-search__result-copy strong,
.global-search__result-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.global-search__result-copy strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-md);
  font-weight: 700;
}

.global-search__result-copy small {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.global-search__result-copy .global-search__result-summary {
  color: var(--gc-color-text-soft);
  font-size: var(--gc-font-size-caption);
}

.global-search__result-arrow {
  color: var(--gc-color-text-soft);
  transition: color 180ms ease, transform 180ms ease;
}

.global-search__result-arrow svg {
  width: var(--gc-size-icon-md);
  height: var(--gc-size-icon-md);
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.global-search__result:hover .global-search__result-arrow,
.global-search__result:focus-visible .global-search__result-arrow {
  color: var(--gc-color-primary);
  transform: translateX(var(--gc-space-tight));
}

.global-search__state,
.global-search__hint {
  display: grid;
  place-items: center;
  min-height: 14rem;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  text-align: center;
}

.global-search__error {
  margin: 0;
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  border-radius: var(--gc-radius-md);
  padding: var(--gc-space-3);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-soft);
  font-size: var(--gc-font-size-sm);
}

.global-search__empty {
  min-height: 14rem;
}

.global-search__sr-only {
  position: absolute;
  inline-size: var(--gc-space-hairline);
  block-size: var(--gc-space-hairline);
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 42rem) {
  .global-search {
    min-height: 16rem;
  }

  .global-search__groups {
    max-height: 56vh;
  }

  .global-search__result {
    gap: var(--gc-space-3);
    padding: var(--gc-space-3);
  }

  .global-search__result-icon {
    width: var(--gc-space-10);
    height: var(--gc-space-10);
  }
}
</style>

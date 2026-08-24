<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { listCompatibilityCatalog, type CompatibilityCatalogItem } from '@/api/modules/compatibility.api'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'

const { t } = useI18n()
const items = ref<CompatibilityCatalogItem[]>([])
const loading = ref(true)
const error = ref(false)
const generatedAt = ref('')

const rows = computed(() => items.value.map((item) => ({
  ...item,
  statusLabel: t(`compatibility.status.${item.effectiveStatus}`),
  evidenceLabel: t(`compatibility.evidence.${item.evidenceStatus}`),
  verifiedLabel: formatMaybeLocalTime(item.lastVerifiedAt),
})))

onMounted(async () => {
  try {
    const response = await listCompatibilityCatalog()
    items.value = response.data?.items ?? []
    generatedAt.value = response.data?.generatedAt ?? ''
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section>
    <h1>{{ t('compatibility.title') }}</h1>
    <p>{{ t('compatibility.description') }}</p>
    <p v-if="generatedAt">{{ t('compatibility.generatedAt', { time: formatMaybeLocalTime(generatedAt) }) }}</p>
    <p v-if="loading">{{ t('compatibility.loading') }}</p>
    <p v-else-if="error">{{ t('compatibility.loadFailed') }}</p>
    <table v-else>
      <thead>
        <tr>
          <th>{{ t('compatibility.columns.profile') }}</th>
          <th>{{ t('compatibility.columns.version') }}</th>
          <th>{{ t('compatibility.columns.status') }}</th>
          <th>{{ t('compatibility.columns.automation') }}</th>
          <th>{{ t('compatibility.columns.evidence') }}</th>
          <th>{{ t('compatibility.columns.verifiedAt') }}</th>
          <th>{{ t('compatibility.columns.limitations') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="`${row.profileId}@${row.version}`">
          <td>{{ row.profileId }}</td>
          <td>{{ row.version }}</td>
          <td>{{ row.statusLabel }}</td>
          <td>{{ row.automation }}</td>
          <td>{{ row.evidenceLabel }}</td>
          <td>{{ row.verifiedLabel }}</td>
          <td>{{ row.limitations.join('；') || t('compatibility.none') }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

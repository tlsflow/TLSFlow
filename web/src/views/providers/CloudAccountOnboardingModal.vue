<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { createCloudAccountAsset, discoverCloudAccountResources, listCloudAccountOnboardingRecipes, testCloudAccountConnection } from '@/api/modules/providers.api'
import type { ApiRecord } from '@/api/modules/common'
import type { CredentialKind } from '@/api/modules/credentials.api'
import { GcCredentialSelect, GcModal } from '@/design-system/components'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; completed: [] }>()
const { t, te, locale } = useI18n()
const loading = ref(false)
const error = ref('')
const recipes = ref<ApiRecord[]>([])
const draft = reactive({ displayName: '', accountId: '', credentialRef: '', scopeText: '{}' })
const selectedPluginId = ref('')
const selectedRecipe = computed(() => recipes.value.find((item) => String(item.pluginId ?? '') === selectedPluginId.value) ?? recipes.value[0])
const formFields = computed(() => {
  const form = selectedRecipe.value?.form as ApiRecord | undefined
  return Array.isArray(form?.sections) ? (form.sections as ApiRecord[]).flatMap((section) => Array.isArray(section.fields) ? section.fields as ApiRecord[] : []) : []
})
const credentialKinds: CredentialKind[] = ['CLOUD_PROVIDER']

function label(key: unknown, fallback: string): string {
  const value = String(key ?? '')
  return value && te(value) ? t(value) : fallback
}
function reset(): void {
  draft.displayName = ''
  draft.accountId = ''
  draft.credentialRef = ''
  draft.scopeText = '{}'
  selectedPluginId.value = ''
  error.value = ''
}
async function loadRecipes(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const result = await listCloudAccountOnboardingRecipes(locale.value)
    recipes.value = Array.isArray(result.data?.items) ? result.data.items as ApiRecord[] : []
    selectedPluginId.value = String(recipes.value[0]?.pluginId ?? '')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('providers.messages.loadFailed')
  } finally {
    loading.value = false
  }
}
async function submit(): Promise<void> {
  if (!selectedRecipe.value || !draft.displayName.trim() || !draft.credentialRef.trim()) return
  loading.value = true
  error.value = ''
  try {
    let scope: Record<string, unknown> = {}
    try { scope = JSON.parse(draft.scopeText || '{}') as Record<string, unknown> } catch { throw new Error(t('providers.messages.scopeInvalid')) }
    const defaultRequest = ((selectedRecipe.value.recipe as ApiRecord | undefined)?.defaults as ApiRecord | undefined)?.request
    const created = await createCloudAccountAsset({
      displayName: draft.displayName.trim(),
      providerKey: selectedRecipe.value.pluginId,
      accountId: draft.accountId.trim() || undefined,
      credentialRef: draft.credentialRef.trim().startsWith('credential://') ? draft.credentialRef.trim() : `credential://${draft.credentialRef.trim()}`,
      scope: { ...scope, ...(defaultRequest && typeof defaultRequest === 'object' ? { metadata: { ...(scope.metadata as Record<string, unknown> ?? {}), request: defaultRequest } } : {}) },
    })
    const assetId = String(created.data?.id ?? '')
    if (!assetId) throw new Error(t('providers.messages.createFailed'))
    await testCloudAccountConnection(assetId)
    await discoverCloudAccountResources(assetId)
    emit('completed')
    emit('update:open', false)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('providers.messages.createFailed')
  } finally {
    loading.value = false
  }
}
watch(() => props.open, (open) => { if (open) { reset(); void loadRecipes() } })
onMounted(() => { if (props.open) void loadRecipes() })
</script>

<template>
  <GcModal :open="open" :title="t('providers.wizard.panels.assetTitle')" :description="t('providers.wizard.panels.assetDescription')" size="lg" :busy="loading" @update:open="emit('update:open', $event)">
    <div class="cloud-account-onboarding">
      <p v-if="error" class="cloud-account-onboarding__error">{{ error }}</p>
      <p v-if="!loading && recipes.length === 0" class="cloud-account-onboarding__empty">{{ t('providers.messages.providerUnavailable') }}</p>
      <label v-if="recipes.length > 1" class="cloud-account-onboarding__field"><span>{{ t('providers.fields.provider') }}</span><select v-model="selectedPluginId"><option v-for="recipe in recipes" :key="String(recipe.pluginId)" :value="String(recipe.pluginId)">{{ label((recipe.recipe as ApiRecord)?.display && ((recipe.recipe as ApiRecord).display as ApiRecord).nameKey, String(recipe.pluginId)) }}</option></select></label>
      <label class="cloud-account-onboarding__field"><span>{{ t('providers.fields.displayName') }}</span><input v-model="draft.displayName" required /></label>
      <template v-for="field in formFields" :key="String(field.key)">
        <label v-if="field.type === 'text' && field.key === 'accountId'" class="cloud-account-onboarding__field"><span>{{ label(field.labelKey, String(field.key)) }}</span><input v-model="draft.accountId" /></label>
        <label v-else-if="field.type === 'key_value'" class="cloud-account-onboarding__field"><span>{{ label(field.labelKey, String(field.key)) }}</span><textarea v-model="draft.scopeText" rows="3" /></label>
        <GcCredentialSelect v-else-if="field.type === 'credential_ref'" v-model="draft.credentialRef" :label="label(field.labelKey, String(field.key))" :accepted-kinds="credentialKinds" :required="true" />
      </template>
    </div>
    <template #actions><button class="gc-button" type="button" :disabled="loading" @click="emit('update:open', false)">{{ t('providers.actions.cancel') }}</button><button class="gc-button gc-button--primary" type="button" :disabled="loading || !draft.displayName.trim() || !draft.credentialRef.trim()" @click="submit">{{ t('providers.actions.save') }}</button></template>
  </GcModal>
</template>

<style scoped>
.cloud-account-onboarding { display: grid; gap: var(--gc-space-4); }
.cloud-account-onboarding__field { display: grid; gap: var(--gc-space-2); }
.cloud-account-onboarding__field input, .cloud-account-onboarding__field textarea, .cloud-account-onboarding__field select { width: 100%; }
.cloud-account-onboarding__error { color: var(--gc-color-danger); }
.cloud-account-onboarding__empty { color: var(--gc-color-text-muted); }
</style>

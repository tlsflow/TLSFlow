<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import { createCredential, type CredentialKind, type CredentialProfileDetail, type CredentialSecretValueInput } from '@/api/modules/credentials.api'
import GcButton from './GcButton.vue'
import GcModal from './GcModal.vue'

const props = withDefaults(defineProps<{
  open: boolean
  kinds?: CredentialKind[]
  metadata?: Record<string, unknown>
  namePrefix?: string
  secretTemplate?: string
}>(), {
  kinds: () => [],
  metadata: () => ({}),
  namePrefix: '',
  secretTemplate: '',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  created: [credential: CredentialProfileDetail]
}>()

const { t } = useI18n()
const saving = ref(false)
const error = ref('')
const form = reactive({ name: '', kind: 'USERNAME_PASSWORD' as CredentialKind, username: '', deliveryLocation: 'header' as 'header' | 'query', deliveryName: 'X-API-Key', primarySecret: '', secondarySecret: '' })
const availableKinds = computed(() => props.kinds.length > 0 ? props.kinds : ['USERNAME_PASSWORD' as CredentialKind])
const requiresUsername = computed(() => form.kind === 'USERNAME_PASSWORD' || form.kind === 'SSH_KEY')
const requiresSecondary = computed(() => form.kind === 'CLIENT_CERTIFICATE')
const secretSlot = computed(() => {
  if (form.kind === 'PASSWORD' || form.kind === 'USERNAME_PASSWORD') return 'password'
  if (form.kind === 'SSH_KEY') return 'privateKey'
  if (form.kind === 'CLIENT_CERTIFICATE') return 'certificate'
  if (form.kind === 'DNS_PROVIDER') return 'config'
  return 'token'
})
const canSubmit = computed(() => Boolean(form.name.trim() && form.primarySecret.trim() && (!requiresUsername.value || form.username.trim()) && (!requiresSecondary.value || form.secondarySecret.trim()) && (form.kind !== 'API_KEY' || (form.deliveryName.trim() && form.deliveryLocation)) && !saving.value))

watch(() => props.open, (open) => {
  if (!open) return
  form.name = props.namePrefix.trim()
  form.kind = availableKinds.value[0] ?? 'USERNAME_PASSWORD'
  form.username = ''
  form.deliveryLocation = 'header'
  form.deliveryName = 'X-API-Key'
  form.primarySecret = form.kind === 'DNS_PROVIDER' ? props.secretTemplate.trim() : ''
  form.secondarySecret = ''
  error.value = ''
}, { immediate: true })

function close(): void {
  if (!saving.value) emit('update:open', false)
}

function secretValues(): Record<string, CredentialSecretValueInput> {
  const values: Record<string, CredentialSecretValueInput> = { [secretSlot.value]: { plainText: form.primarySecret.trim() } }
  if (form.kind === 'CLIENT_CERTIFICATE' && form.secondarySecret.trim()) values.privateKey = { plainText: form.secondarySecret.trim() }
  return values
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  saving.value = true
  error.value = ''
  try {
    const result = await createCredential({
      name: form.name.trim(),
      kind: form.kind,
      scopeType: 'global',
      username: requiresUsername.value ? form.username.trim() : undefined,
      delivery: form.kind === 'API_KEY' ? { location: form.deliveryLocation, name: form.deliveryName.trim() } : undefined,
      metadata: Object.keys(props.metadata).length > 0 ? props.metadata : undefined,
      secretValues: secretValues(),
    })
    if (!result.data?.id) throw new Error(t('credentials.errors.save'))
    emit('created', result.data)
    emit('update:open', false)
  } catch (caught) {
    error.value = caught instanceof ApiClientError ? caught.message : caught instanceof Error ? caught.message : t('credentials.errors.save')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <GcModal :open="open" :title="t('credentials.create.title')" :description="t('credentials.create.description')" size="md" :busy="saving" @update:open="emit('update:open', $event)">
    <form class="gc-credential-create-modal" @submit.prevent="submit">
      <p v-if="error" class="gc-credential-create-modal__error" role="alert">{{ error }}</p>
      <label class="gc-form-field"><span>{{ t('credentials.fields.name') }}</span><input v-model="form.name" required autocomplete="off"></label>
      <label v-if="availableKinds.length > 1" class="gc-form-field"><span>{{ t('credentials.fields.kind') }}</span><select v-model="form.kind"><option v-for="kind in availableKinds" :key="kind" :value="kind">{{ t(`credentials.kinds.${kind}`) }}</option></select></label>
      <label v-if="requiresUsername" class="gc-form-field"><span>{{ t('credentials.fields.username') }}</span><input v-model="form.username" required autocomplete="off"></label>
      <template v-if="form.kind === 'API_KEY'">
        <label class="gc-form-field"><span>{{ t('credentials.fields.deliveryName') }}</span><input v-model="form.deliveryName" required autocomplete="off"></label>
      </template>
      <label class="gc-form-field"><span>{{ t(`credentials.secretLabels.${form.kind}`) }}</span><textarea v-model="form.primarySecret" required autocomplete="off" spellcheck="false"></textarea></label>
      <label v-if="requiresSecondary" class="gc-form-field"><span>{{ t('credentials.fields.secondarySecret') }}</span><textarea v-model="form.secondarySecret" required autocomplete="off" spellcheck="false"></textarea></label>
    </form>
    <template #actions>
      <GcButton variant="secondary" :disabled="saving" @click="close">{{ t('credentials.actions.close') }}</GcButton>
      <GcButton variant="primary" :loading="saving" :disabled="!canSubmit" @click="submit">{{ t('credentials.actions.create') }}</GcButton>
    </template>
  </GcModal>
</template>

<style scoped>
.gc-credential-create-modal { display: grid; gap: var(--gc-space-3); }
.gc-credential-create-modal textarea { min-height: var(--gc-control-height-xl); resize: vertical; }
.gc-credential-create-modal__error { margin: 0; color: var(--gc-color-danger); }
</style>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcButton, GcModal, GcSelectionCard, GcStatusTag } from '@/design-system/components'
import AcmeCertificateRequestModal from '@/views/acme/AcmeCertificateRequestModal.vue'
import CertificateImportModal from './CertificateImportModal.vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  imported: [id: string]
}>()

const { t } = useI18n()
const importOpen = ref(false)
const acmeOpen = ref(false)

function closeSource(): void {
  emit('update:open', false)
}

function openManualImport(): void {
  closeSource()
  importOpen.value = true
}

function openAcmeRequest(): void {
  closeSource()
  acmeOpen.value = true
}

function handleImported(id: string): void {
  emit('imported', id)
}
</script>

<template>
  <GcModal
    :open="props.open"
    size="lg"
    :title="t('certificates.importForm.source.title')"
    :description="t('certificates.importForm.source.description')"
    @update:open="emit('update:open', $event)"
  >
    <div class="certificate-add-modal__source">
      <GcSelectionCard
        :title="t('certificates.importForm.source.manual.title')"
        :description="t('certificates.importForm.source.manual.description')"
        selected
        @select="openManualImport"
      >
        <GcStatusTag
          status="RECOMMENDED"
          :label="t('certificates.importForm.source.manual.recommended')"
          tone="info"
        />
      </GcSelectionCard>
      <GcSelectionCard
        :title="t('certificates.importForm.source.acme.title')"
        :description="t('certificates.importForm.source.acme.description')"
        @select="openAcmeRequest"
      />
    </div>
    <template #actions>
      <GcButton variant="secondary" @click="closeSource">{{ t('common.cancel') }}</GcButton>
    </template>
  </GcModal>

  <CertificateImportModal v-if="importOpen" v-model:open="importOpen" @imported="handleImported" />
  <AcmeCertificateRequestModal v-if="acmeOpen" v-model:open="acmeOpen" />
</template>

<style scoped>
.certificate-add-modal__source {
  display: grid;
  gap: var(--gc-space-4);
}
</style>

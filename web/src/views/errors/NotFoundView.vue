<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { GcEmptyState } from '@/design-system/components'
const { t } = useI18n()
</script>

<template>
  <section class="gc-error-page" role="alert">
    <GcEmptyState :title="t('errors.notFoundTitle')" :description="t('errors.notFoundMessage')">
      <div class="gc-error-page__actions">
        <RouterLink class="gc-button gc-button--primary" to="/dashboard">{{ t('errors.backDashboard') }}</RouterLink>
      </div>
    </GcEmptyState>
  </section>
</template>

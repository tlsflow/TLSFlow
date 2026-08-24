<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
const { t } = useI18n()
</script>

<template>
  <section class="gc-error-page">
    <h1>{{ t('errors.notFoundTitle') }}</h1>
    <p>{{ t('errors.notFoundMessage') }}</p>
    <RouterLink to="/dashboard">{{ t('errors.backDashboard') }}</RouterLink>
  </section>
</template>

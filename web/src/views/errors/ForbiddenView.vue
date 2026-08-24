<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, RouterLink } from 'vue-router'
const route = useRoute()
const { t } = useI18n()
const missingPermission = computed(() => typeof route.query.permission === 'string' ? route.query.permission : '')
</script>

<template>
  <section class="gc-error-page">
    <h1>{{ t('errors.forbiddenTitle') }}</h1>
    <p>{{ t('errors.forbiddenMessage') }}</p>
    <p v-if="missingPermission" class="gc-error-page__meta">{{ t('errors.missingPermission', { permission: missingPermission }) }}</p>
    <RouterLink to="/dashboard">{{ t('errors.backDashboard') }}</RouterLink>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const { t } = useI18n()
const missingPermission = computed(() => typeof route.query.permission === 'string' ? route.query.permission : '')

function goBack(): void {
  if (window.history.state?.back) {
    router.back()
    return
  }
  void router.replace('/dashboard')
}

async function logout(): Promise<void> {
  try {
    await authStore.logout()
  } catch {
    // 中文说明：注销请求失败时仍应清理本地会话并回到登录页。
  } finally {
    await router.replace({ name: 'login' })
  }
}
</script>

<template>
  <section class="gc-error-page">
    <h1>{{ t('errors.forbiddenTitle') }}</h1>
    <p>{{ t('errors.forbiddenMessage') }}</p>
    <p v-if="missingPermission" class="gc-error-page__meta">{{ t('errors.missingPermission', { permission: missingPermission }) }}</p>
    <div class="gc-error-page__actions">
      <button class="gc-button" type="button" @click="goBack">{{ t('errors.back') }}</button>
      <RouterLink class="gc-button" to="/dashboard">{{ t('errors.backDashboard') }}</RouterLink>
      <button class="gc-button gc-button--danger" type="button" @click="logout">{{ t('errors.logout') }}</button>
    </div>
  </section>
</template>

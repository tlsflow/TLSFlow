<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { productBrand } from '@/brand/product-brand'
import { GcLocaleSelect, GcThemeToggle } from '@/design-system/components'
import { normalizeInternalRedirectPath } from '@/router/redirect'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'
import { gcacVersion } from '@/version'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const permissionStore = usePermissionStore()
const { t } = useI18n()

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

const redirectPath = computed(() => normalizeInternalRedirectPath(route.query.redirect, '/dashboard'))

async function submit(): Promise<void> {
  if (loading.value) return
  error.value = ''
  loading.value = true
  try {
    await authStore.login({ username: username.value.trim(), password: password.value })
    await permissionStore.loadPermissions()
    await router.push(redirectPath.value)
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      error.value = `${cause.message}（${cause.errorCode}）`
    } else {
      error.value = cause instanceof Error ? cause.message : t('login.failed')
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <header class="login-page__topbar">
      <div class="login-page__brand">
        <span class="login-page__mark" aria-hidden="true"><img :src="productBrand.markAssetUrl" alt=""></span>
        <span class="login-page__brand-text">
          <strong>{{ t('app.brand') }}</strong>
          <small>{{ t('login.brandSecondary') }}</small>
        </span>
      </div>
      <div class="login-page__preferences" :aria-label="t('preferences.languageSelect')">
        <GcThemeToggle />
        <GcLocaleSelect />
      </div>
    </header>

    <div class="login-page__content">
      <section class="login-page__intro" :aria-label="t('login.visualLabel')">
        <span class="login-page__eyebrow">{{ t('shell.currentLocation') }}</span>
        <h1>{{ t('login.headlinePrefix') }}<span>{{ t('login.headlineHighlight') }}</span>{{ t('login.headlineSuffix') }}</h1>
        <p>{{ t('login.intro') }}</p>
        <div class="login-page__features" :aria-label="t('login.capabilitiesLabel')">
          <article>
            <span class="login-page__feature-icon" aria-hidden="true">✓</span>
            <span><strong>{{ t('login.featureLifecycle') }}</strong><small>{{ t('login.featureLifecycleDesc') }}</small></span>
          </article>
          <article>
            <span class="login-page__feature-icon" aria-hidden="true">⌁</span>
            <span><strong>{{ t('login.featureAutomation') }}</strong><small>{{ t('login.featureAutomationDesc') }}</small></span>
          </article>
          <article>
            <span class="login-page__feature-icon" aria-hidden="true">◆</span>
            <span><strong>{{ t('login.featureRollback') }}</strong><small>{{ t('login.featureRollbackDesc') }}</small></span>
          </article>
        </div>
      </section>

      <section class="login-page__panel" :aria-label="t('login.formLabel')">
        <form class="login-card" @submit.prevent="submit">
          <div class="login-card__status"><span aria-hidden="true" />{{ t('login.secure') }}</div>
          <header class="login-card__header">
            <h2>{{ t('login.welcome') }}</h2>
            <p>{{ t('login.hint') }}</p>
          </header>

          <label class="login-card__field">
            <span>{{ t('login.username') }}</span>
            <input v-model="username" autocomplete="username" required :placeholder="t('login.usernamePlaceholder')">
          </label>
          <label class="login-card__field">
            <span>{{ t('login.password') }}</span>
            <input v-model="password" autocomplete="current-password" required type="password" :placeholder="t('login.passwordPlaceholder')">
          </label>
          <p v-if="error" class="login-card__error" role="alert">{{ error }}</p>
          <button class="login-card__submit" type="submit" :disabled="loading">
            {{ loading ? t('login.submitting') : t('login.submit') }}
          </button>
          <footer class="login-card__footer">
            <span>{{ t('login.policy') }}</span>
            <span>{{ t('login.audit') }}</span>
            <span>{{ t('app.versionLabel', { version: gcacVersion }) }}</span>
          </footer>
        </form>
      </section>
    </div>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  padding: var(--gc-space-6) var(--gc-space-8) var(--gc-space-10);
  color: var(--gc-color-text);
  background: transparent;
}

.login-page__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-4);
  max-width: 74rem;
  margin: 0 auto;
}

.login-page__brand {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-3);
  min-width: 0;
}

.login-page__mark {
  display: grid;
  place-items: center;
  width: var(--gc-size-icon-button);
  height: var(--gc-size-icon-button);
  border-radius: var(--gc-radius-control);
  color: var(--gc-color-text-inverse);
  background: var(--gc-color-primary);
  box-shadow: var(--gc-shadow-primary);
  font-weight: 900;
}

.login-page__mark img {
  width: var(--gc-space-5);
  height: var(--gc-space-5);
}

.login-page__brand-text {
  display: grid;
  min-width: 0;
  gap: var(--gc-space-1);
}

.login-page__brand-text strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
}

.login-page__brand-text small,
.login-page__eyebrow {
  color: var(--gc-color-text-soft);
  font-size: var(--gc-font-size-xs);
}

.login-page__preferences {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
}

.login-page__content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(20rem, 27.5rem);
  align-items: center;
  gap: var(--gc-space-12);
  max-width: 74rem;
  min-height: calc(100vh - var(--gc-space-12));
  margin: 0 auto;
}

.login-page__intro {
  max-width: 42.5rem;
}

.login-page__eyebrow {
  display: block;
  margin-bottom: var(--gc-space-3);
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.login-page__intro h1 {
  max-width: 41.25rem;
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-2xl);
  line-height: var(--gc-line-height-tight);
}

.login-page__intro h1 span {
  color: var(--gc-color-primary);
}

.login-page__intro > p {
  max-width: 38.75rem;
  margin: var(--gc-space-5) 0 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-md);
  line-height: var(--gc-line-height-relaxed);
}

.login-page__features {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin-top: var(--gc-space-8);
}

.login-page__features article {
  display: flex;
  gap: var(--gc-space-3);
  min-width: 0;
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-card);
  background: var(--gc-color-surface-glass);
  box-shadow: var(--gc-shadow-sm);
}

.login-page__features article > span:last-child {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.login-page__features strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
}

.login-page__features small {
  color: var(--gc-color-text-muted);
  line-height: var(--gc-line-height-relaxed);
}

.login-page__feature-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: var(--gc-size-icon-button);
  height: var(--gc-size-icon-button);
  border-radius: var(--gc-radius-control);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
  font-weight: 900;
}

.login-page__panel {
  display: grid;
  place-items: center;
}

.login-card {
  display: grid;
  gap: var(--gc-space-4);
  width: 100%;
  padding: var(--gc-space-8);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-modal);
  background: var(--gc-color-surface-glass);
  box-shadow: var(--gc-shadow-lg);
}

.login-card__status {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: var(--gc-space-2);
  color: var(--gc-color-success);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.login-card__status span {
  width: var(--gc-space-2);
  height: var(--gc-space-2);
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-success);
}

.login-card__header h2,
.login-card__header p {
  margin: 0;
}

.login-card__header h2 {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-xl);
}

.login-card__header p {
  margin-top: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  line-height: var(--gc-line-height-relaxed);
}

.login-card__field {
  display: grid;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
}

.login-card__field input {
  width: 100%;
  min-height: var(--gc-control-height-md);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  padding: 0 var(--gc-space-3);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-field);
}

.login-card__field input:focus {
  border-color: var(--gc-color-focus);
  outline: 0;
  box-shadow: var(--gc-shadow-focus);
}

.login-card__error {
  margin: 0;
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  border-radius: var(--gc-radius-control);
  padding: var(--gc-space-3);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  line-height: var(--gc-line-height-relaxed);
}

.login-card__submit {
  min-height: var(--gc-control-height-lg);
  border: var(--gc-border-width-default) solid var(--gc-color-primary);
  border-radius: var(--gc-radius-control);
  color: var(--gc-color-text-inverse);
  background: var(--gc-color-primary);
  box-shadow: var(--gc-shadow-button-primary);
  font-weight: 800;
  cursor: pointer;
}

.login-card__submit:hover:not(:disabled) {
  background: var(--gc-color-primary-hover);
}

.login-card__submit:disabled {
  opacity: var(--gc-opacity-disabled);
  cursor: wait;
}

.login-card__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-soft);
  font-size: var(--gc-font-size-xs);
}

@media (max-width: 60rem) {
  .login-page {
    padding-inline: var(--gc-space-4);
  }

  .login-page__content {
    grid-template-columns: 1fr;
    gap: var(--gc-space-8);
    min-height: auto;
    padding: var(--gc-space-12) 0;
  }

  .login-page__intro {
    max-width: none;
  }

  .login-page__intro h1 {
    font-size: var(--gc-font-size-xl);
  }
}

@media (max-width: 42rem) {
  .login-page__topbar {
    align-items: flex-start;
  }

  .login-page__brand-text small {
    display: none;
  }

  .login-page__features {
    grid-template-columns: 1fr;
  }

  .login-card {
    padding: var(--gc-space-6) var(--gc-space-4);
  }
}
</style>

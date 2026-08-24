<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { GcLocaleSelect, GcThemeToggle } from '@/design-system/components'
import { useAppStore } from '@/stores/app.store'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const authStore = useAuthStore()
const permissionStore = usePermissionStore()
const { t } = useI18n()

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

const redirectPath = computed(() => {
  const value = route.query.redirect
  return typeof value === 'string' && value.startsWith('/') ? value : '/dashboard'
})

async function submit() {
  if (loading.value) return
  error.value = ''
  loading.value = true
  try {
    const session = await authStore.login({ username: username.value.trim(), password: password.value })
    permissionStore.setPermissions(session.permissions ?? [])
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
  <main class="login-page" :class="`login-page--${appStore.theme}`">
    <div class="login-page__grid" aria-hidden="true"></div>

    <header class="login-page__topbar">
      <div class="login-page__brand">
        <span class="login-page__mark">G</span>
        <span class="login-page__brand-text">
          <span class="login-page__brand-primary">Glorinfo Certificate Admin Center</span>
          <span class="login-page__brand-secondary">{{ t('login.brandSecondary') }}</span>
        </span>
      </div>

      <div class="login-page__preferences">
        <GcThemeToggle />
        <GcLocaleSelect />
      </div>
    </header>

    <section class="login-page__visual" :aria-label="t('login.visualLabel')">
      <div class="login-page__headline">
        <h1>{{ t('login.headlinePrefix') }}<span class="login-page__highlight">{{ t('login.headlineHighlight') }}</span>{{ t('login.headlineSuffix') }}</h1>
        <p>{{ t('login.intro') }}</p>
      </div>

      <div class="login-page__features" :aria-label="t('login.capabilitiesLabel')">
        <article>
          <div class="login-page__features-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/><circle cx="12" cy="16" r="1"/></svg>
          </div>
          <strong>{{ t('login.featureLifecycle') }}</strong>
          <p>{{ t('login.featureLifecycleDesc') }}</p>
        </article>
        <article>
          <div class="login-page__features-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/><path d="M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>
          </div>
          <strong>{{ t('login.featureAutomation') }}</strong>
          <p>{{ t('login.featureAutomationDesc') }}</p>
        </article>
        <article>
          <div class="login-page__features-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
          </div>
          <strong>{{ t('login.featureRollback') }}</strong>
          <p>{{ t('login.featureRollbackDesc') }}</p>
        </article>
      </div>
    </section>

    <section class="login-page__panel" :aria-label="t('login.formLabel')">
      <form class="login-card" @submit.prevent="submit">
        <div class="login-card__status" aria-hidden="true">
          <span></span>
          <span>{{ t('login.secure') }}</span>
        </div>

        <header class="login-card__header">
          <h2>{{ t('login.welcome') }}</h2>
          <p>{{ t('login.hint') }}</p>
        </header>

        <label class="login-card__field">
          <span>{{ t('login.username') }}</span>
          <input v-model="username" autocomplete="username" required :placeholder="t('login.usernamePlaceholder')" />
        </label>

        <label class="login-card__field">
          <span>{{ t('login.password') }}</span>
          <input v-model="password" autocomplete="current-password" required type="password" :placeholder="t('login.passwordPlaceholder')" />
        </label>

        <p v-if="error" class="login-card__error" role="alert">{{ error }}</p>

        <button class="login-card__submit" type="submit" :disabled="loading">
          {{ loading ? t('login.submitting') : t('login.submit') }}
        </button>

        <footer class="login-card__footer">
          <span>{{ t('login.policy') }}</span>
          <span>{{ t('login.audit') }}</span>
        </footer>
      </form>
    </section>
  </main>
</template>

<style scoped>
/* ===== 页面根布局 ===== */
.login-page {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(380px, .92fr);
  min-height: 100vh;
  min-height: 100dvh;
  overflow: hidden;
  isolation: isolate;
  background:
    radial-gradient(ellipse 62% 54% at 22% 18%, var(--gc-color-legacy-rgb-14-116-144-a34p), transparent 62%),
    linear-gradient(135deg, var(--gc-color-legacy-081427) 0%, var(--gc-color-legacy-0d2440) 46%, var(--gc-color-legacy-071427) 100%);
  color: var(--gc-color-legacy-e7f5ff);
  --login-headline-text: var(--gc-color-legacy-f0f8ff);
  --login-visual-text: var(--gc-color-legacy-f0f8ff);
  --login-visual-text-muted: var(--gc-color-text-inverse-muted);
  --login-card-text: var(--gc-color-legacy-f0f8ff);
  --login-card-text-muted: var(--gc-color-text-inverse-muted);
  --login-control-bg: var(--gc-color-legacy-rgb-8-20-39-a58p);
  --login-control-border: var(--gc-color-legacy-rgb-125-211-252-a22p);
  --login-panel-bg: var(--gc-color-legacy-rgb-12-34-62-a70p);
  --login-panel-border: var(--gc-color-legacy-rgb-125-211-252-a28p);
  --login-input-label: var(--gc-color-legacy-67e8f9);
  --login-input-bg: var(--gc-color-legacy-rgb-8-20-39-a58p);
  --login-input-border: var(--gc-color-legacy-rgb-125-211-252-a22p);
  --login-input-focus-bg: var(--gc-color-legacy-rgb-12-34-62-a70p);
  --login-card-shadow-inset: var(--gc-color-surface-muted);
  --login-card-outline-opacity: .54;
  --login-control-text: var(--login-visual-text);
  --login-control-label: var(--login-visual-text-muted);
  --login-feature-bg: var(--gc-color-legacy-rgb-8-20-39-a58p);
  --login-feature-bg-hover: var(--gc-color-legacy-rgb-12-34-62-a70p);
  --login-feature-border: var(--gc-color-legacy-rgb-125-211-252-a16p);
  --login-feature-border-hover: var(--gc-color-legacy-rgb-125-211-252-a34p);
  --login-feature-title: var(--gc-color-legacy-f0f8ff);
  --login-feature-text: var(--gc-color-text-soft);
  --login-feature-icon-bg: var(--gc-color-legacy-rgb-20-184-166-a12p);
  --login-feature-icon-border: var(--gc-color-legacy-rgb-45-212-191-a18p);
  --login-feature-shadow: 0 18px 42px var(--gc-color-legacy-rgb-2-6-23-a18p), inset 0 1px 0 var(--gc-color-surface-muted);
  --login-grid-display: block;
  --login-grid-opacity: .72;
  --login-grid-blend: screen;
}

.login-page--light {
  background:
    radial-gradient(ellipse 62% 54% at 22% 18%, var(--gc-color-legacy-rgb-14-116-144-a34p), transparent 62%),
    linear-gradient(135deg, var(--gc-color-legacy-081427) 0%, var(--gc-color-legacy-0d2440) 46%, var(--gc-color-legacy-071427) 100%);
  color: var(--gc-color-legacy-e7f5ff);
  --login-headline-text: var(--gc-color-surface-hover);
  --login-visual-text: var(--gc-color-legacy-f0f8ff);
  --login-visual-text-muted: rgb(183 204 224);
  --login-card-text: var(--gc-color-text);
  --login-card-text-muted: var(--gc-color-text-muted);
  --login-control-bg: var(--gc-color-legacy-rgb-8-20-39-a58p);
  --login-control-border: var(--gc-color-legacy-rgb-125-211-252-a22p);
  --login-panel-bg: var(--gc-color-legacy-rgb-239-249-255-a88p);
  --login-panel-border: var(--gc-color-legacy-rgb-125-211-252-a22p);
  --login-input-label: var(--gc-color-legacy-2f4d68);
  --login-input-bg: var(--gc-color-surface);
  --login-input-border: var(--gc-color-legacy-rgb-14-116-144-a18p);
  --login-input-focus-bg: var(--gc-color-surface-overlay);
  --login-card-shadow-inset: var(--gc-color-surface-field);
  --login-card-outline-opacity: .8;
  --login-control-text: var(--login-visual-text);
  --login-control-label: var(--login-visual-text-muted);
  --login-feature-bg: var(--gc-color-legacy-rgb-8-20-39-a58p);
  --login-feature-bg-hover: var(--gc-color-legacy-rgb-12-34-62-a70p);
  --login-feature-border: var(--gc-color-legacy-rgb-125-211-252-a16p);
  --login-feature-border-hover: var(--gc-color-legacy-rgb-125-211-252-a34p);
  --login-feature-title: var(--gc-color-legacy-f0f8ff);
  --login-feature-text: var(--gc-color-text-inverse-muted);
  --login-feature-icon-bg: var(--gc-color-legacy-rgb-20-184-166-a12p);
  --login-feature-icon-border: var(--gc-color-legacy-rgb-45-212-191-a18p);
  --login-feature-shadow: 0 18px 42px var(--gc-color-legacy-rgb-2-6-23-a18p), inset 0 1px 0 var(--gc-color-surface-muted);
  --login-grid-display: block;
  --login-grid-opacity: .72;
  --login-grid-blend: screen;
}

/* ===== 全屏深蓝科技背景 ===== */
.login-page::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(ellipse 48% 44% at 18% 20%, var(--gc-color-info-bg), transparent 62%),
    radial-gradient(ellipse 38% 34% at 78% 22%, var(--gc-color-primary-weak), transparent 60%),
    radial-gradient(ellipse 54% 42% at 64% 86%, var(--gc-color-legacy-rgb-20-184-166-a16p), transparent 64%);
  pointer-events: none;
}

.login-page--light::before {
  content: none;
  display: none;
}

.login-page::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  background:
    linear-gradient(120deg, transparent 0 34%, var(--gc-color-legacy-rgb-125-211-252-a10p) 48%, transparent 62% 100%),
    linear-gradient(180deg, var(--gc-color-surface-muted), transparent 45%, var(--gc-color-legacy-rgb-2-6-23-a18p));
  pointer-events: none;
}

.login-page--light::after {
  content: none;
  display: none;
}

/* ===== 斜菱形网格装饰 ===== */
.login-page__grid {
  position: fixed;
  display: var(--login-grid-display);
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background-image:
    repeating-linear-gradient(45deg, var(--gc-color-legacy-rgb-125-211-252-a7p) 0 1px, transparent 1px 82px),
    repeating-linear-gradient(-45deg, var(--gc-color-legacy-rgb-45-212-191-a6p) 0 1px, transparent 1px 82px);
  background-size: 164px 164px;
  mask-image: radial-gradient(ellipse 82% 70% at 50% 50%, var(--gc-color-legacy-rgb-0-0-0-a72p) 0%, var(--gc-color-legacy-rgb-0-0-0-a42p) 66%, transparent 100%);
  opacity: var(--login-grid-opacity);
  mix-blend-mode: var(--login-grid-blend);
}

/* ===== 内容层级 ===== */
.login-page__visual,
.login-page__panel {
  position: relative;
  z-index: 2;
}

.login-page__topbar {
  position: absolute;
  top: 34px;
  left: clamp(20px, 3.6vw, 72px);
  right: clamp(20px, 3.6vw, 72px);
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

/* ===== 左侧品牌区域 ===== */
.login-page__visual {
  display: grid;
  align-content: space-between;
  gap: 44px;
  padding: 188px 72px 64px;
}

.login-page__preferences {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  --gc-color-text: var(--login-control-text);
  --gc-color-text-muted: var(--login-control-label);
  --gc-color-surface-soft: var(--login-control-bg);
  --gc-color-border: var(--login-control-border);
  --gc-color-border-strong: var(--gc-color-legacy-rgb-125-211-252-a34p);
  --gc-color-primary-soft: var(--gc-color-legacy-rgb-20-184-166-a12p);
  --gc-color-primary-weak: var(--gc-color-legacy-rgb-125-211-252-a16p);
}

.login-page__brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  width: fit-content;
  color: var(--login-visual-text);
}

.login-page__brand-text {
  display: grid;
  gap: 2px;
  line-height: 1.12;
}

.login-page__brand-primary {
  color: var(--login-visual-text);
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0;
  white-space: nowrap;
}

.login-page__brand-secondary {
  color: var(--login-visual-text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .08em;
  white-space: nowrap;
}

.login-page__mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--gc-color-legacy-rgb-125-211-252-a28p);
  border-radius: 10px;
  color: var(--gc-color-legacy-ecfeff);
  font-weight: 800;
  background: linear-gradient(135deg, var(--gc-color-info), var(--gc-color-primary-strong));
  box-shadow: 0 14px 34px var(--gc-color-legacy-rgb-14-165-233-a30p);
}

/* ===== 标题区域 ===== */
.login-page__headline {
  display: grid;
  gap: 20px;
  max-width: 680px;
}

.login-page__headline h1 {
  margin: 0;
  color: var(--login-headline-text);
  font-size: 52px;
  font-weight: 800;
  line-height: 1.12;
  letter-spacing: 0;
}

.login-page__highlight {
  background: linear-gradient(135deg, var(--gc-color-legacy-67e8f9), var(--gc-color-legacy-5eead4));
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.login-page__headline p {
  margin: 0;
  max-width: 590px;
  color: var(--login-visual-text-muted);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.78;
}

/* ===== 特性卡片 ===== */
.login-page__features {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  max-width: 780px;
}

.login-page__features article {
  position: relative;
  padding: 22px 20px;
  border: 1px solid var(--login-feature-border);
  border-radius: 12px;
  background: var(--login-feature-bg);
  box-shadow: var(--login-feature-shadow);
  backdrop-filter: blur(16px);
  transition: border-color .35s ease, background .35s ease, transform .35s ease;
}

.login-page__features article:hover {
  border-color: var(--login-feature-border-hover);
  background: var(--login-feature-bg-hover);
  transform: translateY(-2px);
}

.login-page__features-icon {
  width: 36px;
  height: 36px;
  margin-bottom: 14px;
  color: var(--gc-color-legacy-67e8f9);
  padding: 7px;
  border: 1px solid var(--login-feature-icon-border);
  border-radius: 8px;
  background: var(--login-feature-icon-bg);
}

.login-page__features-icon svg {
  width: 100%;
  height: 100%;
}

.login-page__features strong {
  display: block;
  margin-bottom: 6px;
  color: var(--login-feature-title);
  font-size: 15px;
  font-weight: 750;
  line-height: 1.35;
}

.login-page__features p {
  margin: 0;
  color: var(--login-feature-text);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.65;
}

/* ===== 右侧登录面板 ===== */
.login-page__panel {
  display: grid;
  place-items: center;
  padding: 120px 42px 42px;
}

.login-card {
  position: relative;
  display: grid;
  gap: 18px;
  width: min(100%, 430px);
  padding: 34px 32px;
  border: 1px solid var(--login-panel-border);
  border-radius: 16px;
  background: var(--login-panel-bg);
  box-shadow:
    0 28px 80px var(--gc-color-legacy-rgb-2-6-23-a26p),
    0 1px 0 var(--login-card-shadow-inset) inset;
  backdrop-filter: blur(24px) saturate(140%);
}

.login-card::before {
  content: '';
  position: absolute;
  inset: -1px;
  z-index: -1;
  border-radius: 16px;
  background: linear-gradient(160deg, var(--gc-color-legacy-rgb-125-211-252-a30p), var(--gc-color-surface-soft), var(--gc-color-legacy-rgb-20-184-166-a20p));
  opacity: var(--login-card-outline-opacity);
}

/* ===== 状态指示 ===== */
.login-card__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid var(--gc-color-legacy-rgb-20-184-166-a18p);
  border-radius: 999px;
  color: var(--gc-color-success);
  background: var(--gc-color-success-soft);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .04em;
}

.login-card__status span:first-child {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--gc-color-success);
  box-shadow: 0 0 0 0 var(--gc-color-legacy-rgb-20-184-166-a36p);
  animation: login-pulse 2.2s ease-out infinite;
}

/* ===== 表单头部 ===== */
.login-card__header h2 {
  margin: 0;
  color: var(--login-card-text);
  font-size: 26px;
  font-weight: 750;
  line-height: 1.25;
}

.login-card__header p {
  margin: 6px 0 0;
  color: var(--login-card-text-muted);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}

/* ===== 表单字段 ===== */
.login-card__field {
  display: grid;
  gap: 6px;
}

.login-card__field span {
  color: var(--login-input-label);
  font-size: 13px;
  font-weight: 750;
}

.login-card__field input {
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid var(--login-input-border);
  border-radius: 10px;
  background: var(--login-input-bg);
  color: var(--login-card-text);
  font-size: 14px;
  outline: none;
  transition: border-color .2s ease, box-shadow .2s ease, background .2s ease;
}

.login-card__field input::placeholder {
  color: var(--login-card-text-muted);
}

.login-card__field input:focus {
  border-color: var(--gc-color-legacy-rgb-125-211-252-a34p);
  background: var(--login-input-focus-bg);
  box-shadow: 0 0 0 3px var(--gc-color-legacy-rgb-14-165-233-a15p);
}

/* ===== 错误提示 ===== */
.login-card__error {
  margin: 0;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--gc-color-danger-soft);
  color: var(--gc-color-danger);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
}

/* ===== 提交按钮 ===== */
.login-card__submit {
  min-height: 46px;
  border: 0;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--gc-color-info), var(--gc-color-primary-strong));
  color: var(--gc-color-text-inverse);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: .06em;
  cursor: pointer;
  transition: transform .2s ease, box-shadow .2s ease, opacity .2s ease;
}

.login-card__submit:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 30px var(--gc-color-primary-weak);
}

.login-card__submit:active {
  transform: translateY(0);
}

.login-card__submit:disabled {
  cursor: wait;
  opacity: .68;
}

/* ===== 底部信息 ===== */
.login-card__footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 2px;
  color: var(--login-card-text-muted);
  font-size: 12px;
  font-weight: 600;
}

/* ===== 响应式布局 ===== */
@media (max-width: 1100px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .login-page__topbar {
    top: 24px;
    left: 32px;
    right: 32px;
  }

  .login-page__visual {
    gap: 32px;
    padding: 132px 32px 16px;
  }

  .login-page__headline h1 {
    font-size: 40px;
  }

  .login-page__features {
    grid-template-columns: 1fr;
  }

  .login-page__panel {
    padding: 0 28px 40px;
  }
}

@media (max-width: 620px) {
  .login-page__topbar {
    position: relative;
    top: auto;
    left: auto;
    right: auto;
    display: grid;
    padding: 22px 18px 0;
  }

  .login-page__preferences {
    justify-content: flex-start;
  }

  .login-page__visual {
    padding: 44px 18px 12px;
  }

  .login-page__brand {
    gap: 10px;
  }

  .login-page__brand-primary {
    font-size: 13px;
  }

  .login-page__brand-secondary {
    font-size: 11px;
  }

  .login-page__headline {
    gap: 14px;
  }

  .login-page__headline h1 {
    font-size: 30px;
  }

  .login-page__headline p {
    font-size: 14px;
    line-height: 1.7;
  }

  .login-page__panel {
    padding: 0 16px 32px;
  }

  .login-card {
    padding: 28px 22px;
  }

  .login-card__footer {
    display: grid;
  }
}

@keyframes login-pulse {
  0% { box-shadow: 0 0 0 0 var(--gc-color-legacy-rgb-20-184-166-a36p); }
  70%, 100% { box-shadow: 0 0 0 6px var(--gc-color-legacy-rgb-20-184-166-a0p); }
}

/* ===== 减少动效偏好 ===== */
@media (prefers-reduced-motion: reduce) {
  .login-card__status span:first-child {
    animation: none;
  }
}
</style>

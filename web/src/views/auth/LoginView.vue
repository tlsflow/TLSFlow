<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const permissionStore = usePermissionStore()

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
      error.value = cause instanceof Error ? cause.message : '登录失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <div class="login-page__grid" aria-hidden="true"></div>

    <section class="login-page__visual" aria-label="产品说明">
      <div class="login-page__brand">
        <span class="login-page__mark">G</span>
        <span>GCAC 智能证书平台</span>
      </div>

      <div class="login-page__headline">
        <h1>让证书管理<span class="login-page__highlight">更智能</span>、更安全</h1>
        <p>一站式管理证书资产，自动化部署编排，全链路审计追踪——将证书运维从繁琐的人工操作转变为可验证、可回溯的标准化流程，为企业数字基础设施保驾护航。</p>
      </div>

      <div class="login-page__features" aria-label="平台能力">
        <article>
          <div class="login-page__features-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/><circle cx="12" cy="16" r="1"/></svg>
          </div>
          <strong>全生命周期管理</strong>
          <p>从导入、续签、版本追踪到到期预警，覆盖证书资产的每一个环节。</p>
        </article>
        <article>
          <div class="login-page__features-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/><path d="M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>
          </div>
          <strong>自动化部署编排</strong>
          <p>面向 Nginx、Tomcat、IIS 等主流环境，一键生成可审计的部署计划。</p>
        </article>
        <article>
          <div class="login-page__features-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
          </div>
          <strong>安全执行与回滚</strong>
          <p>部署前自动校验，执行全程留痕，失败即回滚，确保生产环境稳定无忧。</p>
        </article>
      </div>
    </section>

    <section class="login-page__panel" aria-label="登录表单">
      <form class="login-card" @submit.prevent="submit">
        <div class="login-card__status" aria-hidden="true">
          <span></span>
          <span>安全连接</span>
        </div>

        <header class="login-card__header">
          <h2>欢迎回来</h2>
          <p>请输入您的账号信息，进入管理控制台</p>
        </header>

        <label class="login-card__field">
          <span>用户名</span>
          <input v-model="username" autocomplete="username" required placeholder="请输入用户名" />
        </label>

        <label class="login-card__field">
          <span>密码</span>
          <input v-model="password" autocomplete="current-password" required type="password" placeholder="请输入密码" />
        </label>

        <p v-if="error" class="login-card__error" role="alert">{{ error }}</p>

        <button class="login-card__submit" type="submit" :disabled="loading">
          {{ loading ? '正在验证身份…' : '登 录' }}
        </button>

        <footer class="login-card__footer">
          <span>受企业级权限策略保护</span>
          <span>全链路操作审计</span>
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
    radial-gradient(ellipse 62% 54% at 22% 18%, rgb(14 116 144 / 34%), transparent 62%),
    linear-gradient(135deg, #081427 0%, #0d2440 46%, #071427 100%);
  color: #e7f5ff;
}

/* ===== 全屏深蓝科技背景 ===== */
.login-page::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(ellipse 48% 44% at 18% 20%, rgb(56 189 248 / 22%), transparent 62%),
    radial-gradient(ellipse 38% 34% at 78% 22%, rgb(37 99 235 / 18%), transparent 60%),
    radial-gradient(ellipse 54% 42% at 64% 86%, rgb(20 184 166 / 16%), transparent 64%);
  pointer-events: none;
  animation: login-glow 10s ease-in-out infinite alternate;
}

.login-page::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  background:
    linear-gradient(120deg, transparent 0 34%, rgb(125 211 252 / 10%) 48%, transparent 62% 100%),
    linear-gradient(180deg, rgb(255 255 255 / 5%), transparent 45%, rgb(2 6 23 / 18%));
  pointer-events: none;
  animation: login-light-sweep 14s ease-in-out infinite alternate;
}

/* ===== 斜菱形网格装饰 ===== */
.login-page__grid {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background-image:
    repeating-linear-gradient(45deg, rgb(125 211 252 / 7%) 0 1px, transparent 1px 82px),
    repeating-linear-gradient(-45deg, rgb(45 212 191 / 6%) 0 1px, transparent 1px 82px);
  background-size: 164px 164px;
  mask-image: radial-gradient(ellipse 82% 70% at 50% 50%, rgb(0 0 0 / 72%) 0%, rgb(0 0 0 / 42%) 66%, transparent 100%);
  opacity: .72;
  mix-blend-mode: screen;
  animation: login-diamond-grid 42s linear infinite;
}

/* ===== 内容层级 ===== */
.login-page__visual,
.login-page__panel {
  position: relative;
  z-index: 2;
}

/* ===== 左侧品牌区域 ===== */
.login-page__visual {
  display: grid;
  align-content: space-between;
  gap: 44px;
  padding: 64px 72px;
}

.login-page__brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  width: fit-content;
  color: #f0f8ff;
  font-size: 16px;
  font-weight: 750;
  letter-spacing: .02em;
}

.login-page__mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid rgb(125 211 252 / 28%);
  border-radius: 10px;
  color: #ecfeff;
  font-weight: 800;
  background: linear-gradient(135deg, #0ea5e9, #2563eb);
  box-shadow: 0 14px 34px rgb(14 165 233 / 30%);
}

/* ===== 标题区域 ===== */
.login-page__headline {
  display: grid;
  gap: 20px;
  max-width: 680px;
}

.login-page__headline h1 {
  margin: 0;
  color: #f8fbff;
  font-size: 52px;
  font-weight: 800;
  line-height: 1.12;
  letter-spacing: 0;
}

.login-page__highlight {
  background: linear-gradient(135deg, #67e8f9, #5eead4);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.login-page__headline p {
  margin: 0;
  max-width: 590px;
  color: #b7cce0;
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
  border: 1px solid rgb(125 211 252 / 16%);
  border-radius: 12px;
  background: rgb(8 20 39 / 58%);
  box-shadow: 0 18px 42px rgb(2 6 23 / 18%), inset 0 1px 0 rgb(255 255 255 / 10%);
  backdrop-filter: blur(16px);
  transition: border-color .35s ease, background .35s ease, transform .35s ease;
}

.login-page__features article:hover {
  border-color: rgb(125 211 252 / 34%);
  background: rgb(12 34 62 / 70%);
  transform: translateY(-2px);
}

.login-page__features-icon {
  width: 36px;
  height: 36px;
  margin-bottom: 14px;
  color: #67e8f9;
  padding: 7px;
  border: 1px solid rgb(45 212 191 / 18%);
  border-radius: 8px;
  background: rgb(20 184 166 / 12%);
}

.login-page__features-icon svg {
  width: 100%;
  height: 100%;
}

.login-page__features strong {
  display: block;
  margin-bottom: 6px;
  color: #f0f8ff;
  font-size: 15px;
  font-weight: 750;
  line-height: 1.35;
}

.login-page__features p {
  margin: 0;
  color: #9eb6cf;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.65;
}

/* ===== 右侧登录面板 ===== */
.login-page__panel {
  display: grid;
  place-items: center;
  padding: 42px;
}

.login-card {
  position: relative;
  display: grid;
  gap: 18px;
  width: min(100%, 420px);
  padding: 34px 32px;
  border: 1px solid rgb(125 211 252 / 22%);
  border-radius: 14px;
  background: rgb(239 249 255 / 88%);
  box-shadow:
    0 28px 80px rgb(2 6 23 / 26%),
    0 1px 0 rgb(255 255 255 / 72%) inset;
  backdrop-filter: blur(24px) saturate(140%);
}

.login-card::before {
  content: '';
  position: absolute;
  inset: -1px;
  z-index: -1;
  border-radius: 14px;
  background: linear-gradient(160deg, rgb(125 211 252 / 30%), rgb(255 255 255 / 28%), rgb(20 184 166 / 20%));
  opacity: .8;
}

/* ===== 状态指示 ===== */
.login-card__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid rgb(20 184 166 / 18%);
  border-radius: 999px;
  color: #0f766e;
  background: rgb(240 253 250 / 74%);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .04em;
}

.login-card__status span:first-child {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #14b8a6;
  box-shadow: 0 0 0 0 rgb(20 184 166 / 36%);
  animation: login-pulse 2.2s ease-out infinite;
}

/* ===== 表单头部 ===== */
.login-card__header h2 {
  margin: 0;
  color: #102a43;
  font-size: 26px;
  font-weight: 750;
  line-height: 1.25;
}

.login-card__header p {
  margin: 6px 0 0;
  color: #55708a;
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
  color: #2f4d68;
  font-size: 13px;
  font-weight: 650;
}

.login-card__field input {
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid rgb(14 116 144 / 18%);
  border-radius: 10px;
  background: rgb(255 255 255 / 78%);
  color: #0f172a;
  font-size: 14px;
  outline: none;
  transition: border-color .2s ease, box-shadow .2s ease, background .2s ease;
}

.login-card__field input::placeholder {
  color: #8ca3b6;
}

.login-card__field input:focus {
  border-color: #0ea5e9;
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 0 0 3px rgb(14 165 233 / 15%);
}

/* ===== 错误提示 ===== */
.login-card__error {
  margin: 0;
  padding: 10px 14px;
  border-radius: 8px;
  background: rgb(254 242 242 / 86%);
  color: #dc2626;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
}

/* ===== 提交按钮 ===== */
.login-card__submit {
  min-height: 46px;
  border: 0;
  border-radius: 10px;
  background: linear-gradient(135deg, #0ea5e9, #2563eb);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: .06em;
  cursor: pointer;
  transition: transform .2s ease, box-shadow .2s ease, opacity .2s ease;
}

.login-card__submit:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 30px rgb(37 99 235 / 24%);
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
  color: #6f879c;
  font-size: 12px;
  font-weight: 600;
}

/* ===== 响应式布局 ===== */
@media (max-width: 1100px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .login-page__visual {
    gap: 32px;
    padding: 44px 32px 16px;
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
  .login-page__visual {
    padding: 32px 18px 12px;
  }

  .login-page__brand {
    font-size: 14px;
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

/* ===== 动画 ===== */
@keyframes login-diamond-grid {
  from { background-position: 0 0, 0 0; }
  to { background-position: 164px 164px, -164px 164px; }
}

@keyframes login-glow {
  from { opacity: .72; transform: scale(1); }
  to { opacity: 1; transform: scale(1.03); }
}

@keyframes login-light-sweep {
  from { transform: translateX(-5%); opacity: .72; }
  to { transform: translateX(5%); opacity: 1; }
}

@keyframes login-pulse {
  0% { box-shadow: 0 0 0 0 rgb(20 184 166 / 36%); }
  70%, 100% { box-shadow: 0 0 0 6px rgb(20 184 166 / 0%); }
}

/* ===== 减少动效偏好 ===== */
@media (prefers-reduced-motion: reduce) {
  .login-page::before,
  .login-page::after,
  .login-page__grid,
  .login-card__status span:first-child {
    animation: none;
  }
}
</style>

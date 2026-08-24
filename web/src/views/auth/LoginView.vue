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

const username = ref('admin')
const password = ref('admin12345')
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
    <section class="login-page__visual" aria-label="产品说明">
      <div class="login-page__brand">
        <span class="login-page__mark">G</span>
        <span>GCAC 控制台</span>
      </div>
      <div class="login-page__headline">
        <p>ENTERPRISE SSL LIFECYCLE</p>
        <h1>以最小权限进入证书自动化控制面。</h1>
        <span>登录态、角色、权限策略和审计事件会贯穿每一次证书、资产、部署与插件操作。</span>
      </div>
      <div class="login-page__signals" aria-label="安全信号">
        <article><strong>RBAC</strong><span>角色与资源作用域</span></article>
        <article><strong>Audit</strong><span>登录和权限变更留痕</span></article>
        <article><strong>Zero Secret</strong><span>控制台不暴露敏感明文</span></article>
      </div>
    </section>

    <section class="login-page__panel" aria-label="登录表单">
      <form class="login-card" @submit.prevent="submit">
        <header>
          <p>安全入口</p>
          <h2>登录 GCAC</h2>
          <span>使用控制台账号进入。开发默认账号已预填，生产环境必须替换。</span>
        </header>

        <label>
          <span>用户名</span>
          <input v-model="username" autocomplete="username" required placeholder="请输入用户名" />
        </label>

        <label>
          <span>密码</span>
          <input v-model="password" autocomplete="current-password" required type="password" placeholder="请输入密码" />
        </label>

        <p v-if="error" class="login-card__error" role="alert">{{ error }}</p>

        <button class="login-card__submit" type="submit" :disabled="loading">
          {{ loading ? '正在校验身份…' : '登录控制台' }}
        </button>

        <footer>
          <span>开发默认：admin / admin12345</span>
          <span>真实授权以后端 RBAC 为准</span>
        </footer>
      </form>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(420px, .9fr);
  min-height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(circle at 18% 18%, rgb(96 165 250 / 28%), transparent 24rem),
    radial-gradient(circle at 82% 20%, rgb(14 165 233 / 20%), transparent 22rem),
    linear-gradient(135deg, #f8fbff 0%, #eef5ff 42%, #ffffff 100%);
}
.login-page::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgb(37 99 235 / 7%) 1px, transparent 1px),
    linear-gradient(90deg, rgb(37 99 235 / 7%) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: linear-gradient(90deg, #000 0%, rgb(0 0 0 / 68%) 48%, transparent 100%);
  pointer-events: none;
}
.login-page__visual,
.login-page__panel { position: relative; z-index: 1; }
.login-page__visual { display: grid; align-content: space-between; padding: clamp(44px, 7vw, 92px); }
.login-page__brand { display: inline-flex; align-items: center; gap: 12px; color: #0f172a; font-weight: 950; letter-spacing: -0.03em; }
.login-page__mark { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 14px; color: #fff; background: linear-gradient(135deg, #2563eb, #0ea5e9); box-shadow: 0 18px 36px rgb(37 99 235 / 25%); }
.login-page__headline { max-width: 720px; display: grid; gap: 18px; }
.login-page__headline p { margin: 0; color: var(--gc-color-primary); font-size: 12px; font-weight: 950; letter-spacing: .24em; }
.login-page__headline h1 { margin: 0; max-width: 760px; font-size: clamp(42px, 6vw, 76px); line-height: .96; letter-spacing: -0.075em; }
.login-page__headline span { max-width: 620px; color: var(--gc-color-text-muted); font-size: 18px; line-height: 1.7; font-weight: 650; }
.login-page__signals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; max-width: 760px; }
.login-page__signals article { padding: 18px; border: 1px solid rgb(191 219 254 / 72%); border-radius: 20px; background: rgb(255 255 255 / 68%); backdrop-filter: blur(14px); box-shadow: var(--gc-shadow-sm); }
.login-page__signals strong { display: block; margin-bottom: 6px; color: #0f172a; }
.login-page__signals span { color: var(--gc-color-text-muted); font-size: 13px; font-weight: 700; }
.login-page__panel { display: grid; place-items: center; padding: 42px; }
.login-card { width: min(100%, 460px); display: grid; gap: 20px; padding: 34px; border: 1px solid rgb(226 232 240 / 86%); border-radius: 28px; background: rgb(255 255 255 / 82%); backdrop-filter: blur(22px); box-shadow: 0 28px 80px rgb(15 23 42 / 14%); }
.login-card header { display: grid; gap: 8px; margin-bottom: 4px; }
.login-card header p { margin: 0; color: var(--gc-color-primary); font-size: 12px; font-weight: 950; letter-spacing: .18em; }
.login-card h2 { margin: 0; font-size: 32px; letter-spacing: -0.055em; }
.login-card header span, .login-card footer { color: var(--gc-color-text-muted); font-size: 13px; line-height: 1.6; font-weight: 650; }
.login-card label { display: grid; gap: 8px; color: var(--gc-color-text-muted); font-size: 13px; font-weight: 850; }
.login-card input, .login-card select { width: 100%; border: 1px solid var(--gc-color-border); border-radius: 16px; padding: 14px 15px; color: var(--gc-color-text); background: rgb(248 250 252 / 82%); outline: none; transition: border-color .16s ease, box-shadow .16s ease, background .16s ease; }
.login-card input:focus, .login-card select:focus { border-color: #60a5fa; background: #fff; box-shadow: 0 0 0 4px rgb(96 165 250 / 16%); }
.login-card__error { margin: 0; border: 1px solid #fecaca; border-radius: 14px; padding: 11px 13px; color: var(--gc-color-danger); background: var(--gc-color-danger-bg); font-size: 13px; font-weight: 750; }
.login-card__submit { border: 0; border-radius: 16px; min-height: 50px; color: #fff; background: linear-gradient(135deg, #2563eb, #0284c7); box-shadow: 0 18px 32px rgb(37 99 235 / 24%); cursor: pointer; font-weight: 950; }
.login-card__submit:disabled { cursor: wait; opacity: .72; }
.login-card footer { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-top: 4px; }
@media (max-width: 1100px) {
  .login-page { grid-template-columns: 1fr; }
  .login-page__visual { gap: 42px; padding-bottom: 24px; }
  .login-page__signals { grid-template-columns: 1fr; }
  .login-page__panel { padding-top: 0; }
}
</style>

<script setup lang="ts">
import { RouterLink } from 'vue-router'

const cards = [
  { title: '用户管理', path: '/settings/users', permission: 'security.user.read', description: '创建控制台用户、查看状态和角色。' },
  { title: '角色管理', path: '/settings/roles', permission: 'security.role.read', description: '维护角色编码、名称和权限数量。' },
  { title: '权限策略', path: '/settings/permissions', permission: 'security.permission.read', description: '维护 RBAC allow/deny 策略。' },
  { title: '身份源', path: '/settings/identity-sources', permission: 'security.identity_source.read', description: '配置 Microsoft AD 和标准 LDAP 服务器。' },
  { title: '组角色映射', path: '/settings/group-role-mappings', permission: 'security.identity_source.read', description: '把外部目录组映射成本地角色。' }
]
</script>

<template>
  <section class="gc-page settings-overview">
    <header class="settings-overview__header">
      <p>SECURITY SETTINGS</p>
      <h1>系统设置</h1>
      <span>这里是安全控制台入口。用户、角色、权限策略必须走统一 RBAC，不允许各业务模块自己发明授权。</span>
    </header>

    <section class="settings-overview__cards" aria-label="安全设置入口">
      <RouterLink v-for="card in cards" :key="card.path" class="gc-card settings-overview__card" :to="card.path">
        <p>{{ card.permission }}</p>
        <h2>{{ card.title }}</h2>
        <span>{{ card.description }}</span>
      </RouterLink>
    </section>
  </section>
</template>

<style scoped>
.settings-overview { display: grid; gap: var(--gc-space-5); }
.settings-overview__header p { margin: 0 0 8px; color: var(--gc-color-primary); font-size: 12px; font-weight: 950; letter-spacing: .18em; }
.settings-overview__header h1 { margin: 0; font-size: 34px; letter-spacing: -0.055em; }
.settings-overview__header span { display: block; max-width: 780px; margin-top: 10px; color: var(--gc-color-text-muted); line-height: 1.65; font-weight: 650; }
.settings-overview__cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--gc-space-4); }
.settings-overview__card { display: grid; gap: 10px; padding: 24px; transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease; }
.settings-overview__card:hover { transform: translateY(-2px); border-color: #bfdbfe; box-shadow: var(--gc-shadow-md); }
.settings-overview__card p { margin: 0; color: var(--gc-color-primary); font-size: 12px; font-weight: 950; }
.settings-overview__card h2 { margin: 0; font-size: 22px; letter-spacing: -0.035em; }
.settings-overview__card span { color: var(--gc-color-text-muted); line-height: 1.6; font-weight: 650; }
</style>

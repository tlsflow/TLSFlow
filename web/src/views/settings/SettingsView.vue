<script setup lang="ts">
import { RouterLink } from 'vue-router'

const cards = [
  { title: '用户管理', path: '/settings/users', description: '维护控制台用户、状态和基础角色。' },
  { title: '权限管理', path: '/settings/roles', description: '维护角色、授权对象范围，并把用户或组分配到角色。' },
  { title: '身份源', path: '/settings/identity-sources', description: '配置 Microsoft AD 和标准 LDAP 服务器。' }
]
</script>

<template>
  <section class="gc-page settings-overview">
    <section class="settings-overview__cards" aria-label="安全设置入口">
      <RouterLink v-for="card in cards" :key="card.path" class="gc-card settings-overview__card" :to="card.path">
        <h2>{{ card.title }}</h2>
        <span>{{ card.description }}</span>
        <strong>进入</strong>
      </RouterLink>
    </section>
  </section>
</template>

<style scoped>
.settings-overview { display: grid; gap: var(--gc-space-5); }
.settings-overview__cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--gc-space-4); }
.settings-overview__card {
  position: relative;
  display: grid;
  gap: 12px;
  min-height: 170px;
  padding: 24px;
  overflow: hidden;
  color: inherit;
  text-decoration: none;
  border-color: #dbeafe;
  background: linear-gradient(180deg, #fff 0%, #f8fafc 100%);
  transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
}
.settings-overview__card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 4px;
  background: linear-gradient(90deg, #2563eb, #14b8a6);
}
.settings-overview__card:hover { transform: translateY(-2px); border-color: #93c5fd; box-shadow: var(--gc-shadow-md); }
.settings-overview__card:focus-visible { outline: 3px solid rgb(37 99 235 / 24%); outline-offset: 3px; }
.settings-overview__card h2 { margin: 0; font-size: 22px; letter-spacing: -0.035em; }
.settings-overview__card span { color: var(--gc-color-text-muted); line-height: 1.6; font-weight: 650; }
.settings-overview__card strong {
  align-self: end;
  justify-self: start;
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 16px;
  border-radius: 999px;
  color: #fff;
  background: #2563eb;
  box-shadow: 0 10px 18px rgb(37 99 235 / 18%);
  font-size: var(--gc-font-size-sm);
  font-weight: 850;
}
.settings-overview__card:hover strong { background: #1d4ed8; }
</style>

<script setup lang="ts">
import { useRoute, RouterLink } from 'vue-router'
const route = useRoute()
</script>

<template>
  <section class="gc-error-page">
    <h1>403 无权限</h1>
    <p>你没有访问该页面所需的权限。</p>
    <p v-if="route.query.permission" class="gc-error-page__meta">缺失权限：{{ route.query.permission }}</p>
    <RouterLink to="/dashboard">返回仪表盘</RouterLink>
  </section>
</template>

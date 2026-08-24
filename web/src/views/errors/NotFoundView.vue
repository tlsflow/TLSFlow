<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="gc-error-page">
    <h1>404 页面不存在</h1>
    <p>这个路由没有注册。别在页面里硬跳未定义路径。</p>
    <RouterLink to="/dashboard">返回仪表盘</RouterLink>
  </section>
</template>

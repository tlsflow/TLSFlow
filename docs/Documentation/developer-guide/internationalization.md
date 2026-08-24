---
title: 国际化开发
description: GCAC 前端文案、语言资源和本地时间规则
docStatus: implemented
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001.3-前端设计系统、主题与国际化治理
codeRefs:
  - web/src/i18n
  - web/src/i18n/locales.ts
  - web/src/i18n/index.ts
testRefs: []
lastVerified: 2026-08-02
---

# 国际化开发

- 所有用户可见文案和 ARIA 标签都通过 `vue-i18n`。
- 新 key 先加入 `zh-CN`，再同步到其他语言资源。
- TypeScript 文件使用 `i18n.global.t(key)`，Vue 组件使用 `useI18n()`。
- 不使用硬编码 fallback，不使用 `$tc` 或 `@:linked`。
- API 时间进入展示层后使用浏览器本地时间，不直接显示 UTC/GMT/ISO `Z` 字符串。

当前应用已有 8 种语言资源；文档站使用同一语言集合，但翻译状态独立维护。

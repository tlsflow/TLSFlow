---
title: 主题变量与设计系统
description: GCAC 设计令牌、主题和可复用组件约束
docStatus: implemented
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001.3-前端设计系统、主题与国际化治理
codeRefs:
  - web/src/design-system/tokens/index.css
  - web/src/design-system/components
testRefs: []
lastVerified: 2026-08-02
---

# 主题变量与设计系统

- 设计令牌唯一来源是 `web/src/design-system/tokens/index.css`。
- 颜色、间距、阴影、圆角、字号和字体族必须使用 `--gc-*` 语义变量。
- 新颜色要同时提供 light 和 dark 两套值。
- 主题切换由 `<html data-theme="...">` 驱动。
- 可复用 UI 组件放在 `web/src/design-system/components/`。
- 状态组件复用 `StatusTone` 和既有语义色映射。

新组件不能在页面目录里复制一套视觉基础，也不能用 Tailwind 或硬编码颜色替代设计系统。

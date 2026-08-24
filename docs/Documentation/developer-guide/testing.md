---
title: 测试与验证
description: GCAC 文档、后端和前端变更的验证策略
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001-平台基础与工程治理
  - specs/010-官方文档库与多语言文档治理
codeRefs:
  - backend
  - web
  - docs/Documentation/scripts
testRefs: []
lastVerified: 2026-08-02
---

# 测试与验证

## 代码变更

根据风险选择单元、集成、组件、端到端和真实环境验收。涉及迁移、插件、工作流、部署计划或跨模块合同时，不能只跑一个局部单元测试。

## 文档变更

文档变更至少执行：

```text
npm run docs:check
npm run docs:build
```

还要检查来源路径、语言状态、敏感信息和页面是否把 `in_review`/`todo` 写成完成。

真实协议、生产迁移、外部厂商部署和浏览器视觉回归没有证据时，保持 `TODO`。

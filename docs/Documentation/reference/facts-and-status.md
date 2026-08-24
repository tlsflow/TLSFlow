---
title: 事实来源与状态
description: 官方文档如何区分当前能力和未完成缺口
docStatus: implemented
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/010-官方文档库与多语言文档治理
codeRefs:
  - specs/010-官方文档库与多语言文档治理/docs/20260802-事实来源与页面映射.md
testRefs: []
lastVerified: 2026-08-02
---

# 事实来源与状态

## 页面状态

| 状态 | 含义 |
| --- | --- |
| `implemented` | 当前代码、Spec 和验证证据足够支持页面结论 |
| `in_review` | 有实现或草稿，但仍缺关键复核 |
| `todo` | 尚未实现、尚未编写或缺少事实 |

## 事实优先级

1. 当前代码和测试证据。
2. 现行 `specs/001` 至 `specs/009`。
3. 当前项目规范。
4. 归档 Spec 仅用于历史追溯。

工作区未提交改动不会自动成为发布事实。页面必须使用绝对日期记录最后核对时间。

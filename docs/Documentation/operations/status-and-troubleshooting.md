---
title: 状态与排障
description: GCAC 常见状态、证据和排障顺序
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001-平台基础与工程治理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - backend/src/modules/deployment-plans
  - backend/src/modules/executions
testRefs: []
lastVerified: 2026-08-02
---

# 状态与排障

## 排障顺序

1. 先确认租户、操作者和请求 ID。
2. 再确认目标、插件版本、工作流版本和执行位置。
3. 检查预检是否通过、输入快照是否过期、`configFingerprint` 是否变化。
4. 检查凭据和 Artifact Grant，不从日志猜测 Secret 内容。
5. 查看步骤状态、最近错误和审计记录。
6. 只有有明确回滚步骤时才执行回滚。

## 不能忽略的状态

- `in_review`：已有实现或文档，但仍缺环境、协议或外部系统证据。
- `todo`：尚未实现或没有足够事实。
- `RUNNING`：不能因为重试逻辑把未声明的状态转换当作正常行为。
- `DRAFT`：只能删除草稿，不能删除已发布或已执行计划。

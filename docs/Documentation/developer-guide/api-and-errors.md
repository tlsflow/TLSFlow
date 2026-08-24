---
title: API 与错误合同
description: GCAC API、请求上下文和错误处理约束
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001-平台基础与工程治理
  - specs/002-统一安全管理与访问控制
codeRefs:
  - backend/src/common/http
  - backend/src/app.module.ts
testRefs: []
lastVerified: 2026-08-02
---

# API 与错误合同

## 请求要求

- 使用 `/api/v1` 版本化路径。
- 通过请求上下文传递 tenant、actor 和 request ID。
- Controller 做输入边界校验，Application Service 负责用例编排，Domain Service 负责业务规则。
- Repository 查询必须带租户过滤。

## 错误要求

错误响应至少包含稳定错误码、用户可理解的消息、请求 ID 和时间戳。Secret、Token、Cookie、私钥和堆栈必须脱敏。

输入错误、权限错误、资源不存在、冲突和外部依赖错误必须可区分。未知错误失败关闭，不返回内部对象结构。

修改已发布 API 的 v1 字段或路径前，先判断调用者是否依赖旧行为；破坏性变化必须版本化或提供兼容窗口。004.5 未发布插件重构属于明确例外：插件、Agent、Provider 和 Workflow 直接切换到最新合同，旧合同删除或拒绝，运行期不得保留兼容窗口、双路径或静默转换。

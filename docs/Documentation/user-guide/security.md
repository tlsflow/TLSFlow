---
title: 安全、Secret 与审批
description: GCAC 身份、权限、Secret、审批和审计操作
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/002-统一安全管理与访问控制
codeRefs:
  - backend/src/modules/security
  - backend/src/modules/secrets
  - backend/src/modules/approvals
  - backend/src/modules/audits
testRefs: []
lastVerified: 2026-08-02
---

# 安全、Secret 与审批

## 日常操作

1. 为用户分配完成任务所需的最小角色。
2. 将密码、Token、SSH Key 和私钥保存为 Secret/Credential。
3. 让插件权限、高风险执行和不安全 TLS 选项经过独立审批。
4. 在审计记录中核对操作者、租户、对象、请求 ID 和结果。

## 安全边界

- 读取证书元数据不等于读取私钥。
- 用户能配置工作流不代表能直接执行工作流。
- 插件包导入、启用、绑定和执行是不同门禁。
- Secret 只能通过引用和受控 Grant 进入运行时。

发现权限错误时，先检查租户和对象授权，再检查资源是否已通过审批。不要把 Secret 明文写入工单、截图或部署快照。

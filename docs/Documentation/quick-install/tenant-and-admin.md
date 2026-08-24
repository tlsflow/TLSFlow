---
title: 租户与管理员初始化
description: GCAC 首次使用时的身份和权限准备
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/002-统一安全管理与访问控制
codeRefs:
  - backend/src/modules/security
  - backend/src/modules/rbac
  - backend/src/modules/audits
testRefs: []
lastVerified: 2026-08-02
---

# 租户与管理员初始化

## 初始化顺序

1. 建立租户边界和管理员身份。
2. 为管理员授予最小必要角色。
3. 配置 Secret、审批和审计策略。
4. 再开放插件、设备、证书和部署操作权限。

## 权限检查

- 查看和修改设备不是同一权限。
- 导入、启用插件和执行插件是不同的安全动作。
- 读取证书元数据不等于读取私钥。
- 创建部署计划不等于批准或执行部署。

所有权限失败都应使用请求 ID 和审计记录排查，不能要求用户把 Secret 复制到工单中。

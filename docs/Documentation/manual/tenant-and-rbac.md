---
title: 租户与 RBAC
description: 初始化租户、用户和基于角色的访问控制
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/002-统一安全管理与访问控制
codeRefs:
  - backend/src/modules/security
  - backend/src/modules/rbac
  - backend/src/persistence/entities/tenant.entity.ts
testRefs: []
lastVerified: 2026-08-22
---

# 租户与 RBAC

租户是资源和权限的隔离边界；RBAC（基于角色的访问控制）把读取、管理、审批和执行权限授予角色。

首次启动会创建默认租户和 `admin` 用户。登录后确认当前租户，再按以下顺序准备：

1. 在“系统设置 → 用户”创建日常操作用户和审计用户。
2. 在“系统设置 → 角色”按最小权限创建角色。
3. 把角色分配给用户，分别验证证书读取、设备发现、插件管理、部署审批和回滚权限。
4. 让不同租户使用不同账号和凭据，不要通过共享 `admin` 账号绕过范围限制。

后端每次请求都会检查租户和动作权限；菜单隐藏不是安全边界。租户切换、角色修改或禁用用户后，重新登录验证新会话。

权限按资源和动作拆分：证书、设备、应用资产、插件、工作流、部署计划和执行记录分别授予读取、修改、审批、执行或回滚能力。建议把 Secret 读取、插件启用、CA 高风险操作和部署执行交给不同角色；菜单隐藏不构成安全边界。

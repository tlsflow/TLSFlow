---
title: 角色
description: 为 TLSFlow 用户配置最小权限角色
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/002-统一安全管理与访问控制
codeRefs:
  - web/src/views/settings/RolesView.vue
  - backend/src/modules/rbac
testRefs: []
lastVerified: 2026-08-22
---

# 角色

RBAC（基于角色的访问控制）通过角色把操作权限授予用户。进入“系统设置 → 角色”后：

1. 点击“新建角色”，填写名称和说明。
2. 按资源和动作选择读取、创建、修改、执行或管理权限。
3. 保存后在“用户”页分配角色，并用一个非管理员账号验证可见菜单。

授予 `execute`、CA 操作、许可证或凭据管理权限前先确认业务责任。角色修改会立即影响新请求；已经创建的执行记录不会因此改变所属租户。

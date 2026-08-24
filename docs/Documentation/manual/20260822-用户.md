---
title: 用户
description: 创建和维护 TLSFlow 租户用户
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/002-统一安全管理与访问控制
codeRefs:
  - web/src/views/settings/UsersView.vue
  - backend/src/modules/security
testRefs: []
lastVerified: 2026-08-22
---

# 用户

进入“系统设置 → 用户”，点击“新增用户”，填写用户名、显示名称和初始密码，再选择角色和租户成员关系。保存后用户才能登录当前租户。

编辑用户可修改状态、角色和基本资料；禁用用户会阻止新会话，但不会删除其历史审计记录。删除前确认没有待审批任务或责任人关系。管理员账号应只用于管理，不用于日常部署。

用户可以拥有多个角色，但后端会同时检查用户的租户成员关系、对象范围和动作权限。离职或职责变化时先撤销角色和租户成员关系，再禁用账号，并在日志审计中核对结果。

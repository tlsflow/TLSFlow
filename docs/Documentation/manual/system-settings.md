---
title: 系统设置
description: 系统设置一级菜单和二级页面的操作地图
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/002-统一安全管理与访问控制
  - specs/009-运营自动化、监控与系统配置管理
codeRefs:
  - web/src/router/menu.ts
  - web/src/edition/licensing.ts
testRefs: []
lastVerified: 2026-08-22
---

# 系统设置

系统设置当前包含：系统设置、用户、角色、凭据、通知和许可证。租户架构、身份源等高级路由存在于代码中，但不在当前主菜单中；除非管理员明确开放入口，不把它们当成标准用户流程。

先配置角色和凭据，再配置通知和部署任务参数，最后在许可证页确认额度。每个页面的权限由当前账号角色决定。

系统设置页面负责当前租户的通用和部署任务护栏；用户、角色、凭据、通知和许可证页面分别管理身份、授权、敏感材料、投递渠道和授权状态。租户架构、身份源等路由虽存在于代码中，但不是当前主菜单的标准操作页，不能据此承诺已启用外部身份同步。

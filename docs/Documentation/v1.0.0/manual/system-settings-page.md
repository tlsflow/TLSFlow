---
title: 系统设置页面
description: 配置当前租户的部署安全和系统参数
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - web/src/views/settings/SettingsView.vue
  - web/src/views/settings/DeploymentTaskSettingsView.vue
testRefs: []
lastVerified: 2026-08-22
---

# 系统设置页面

“系统设置”是管理员调整当前租户工作方式的入口。本页只介绍会直接影响日常操作的设置；用户、角色、凭据和通知的具体操作请分别查看对应手册。

## 部署任务参数

部署时不需要单独点击检查按钮。系统会在提交和执行过程中自动校验输入、权限、连接和目标状态；用户只需按页面提示补齐信息，并在执行记录中确认最终结果。

已经创建的计划或正在运行的任务不会因为系统设置页面的其他修改而改变。是否需要审批由具体部署计划和组织流程决定。

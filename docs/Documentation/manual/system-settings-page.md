---
title: 系统设置页面
description: 配置当前租户的部署安全和系统参数
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/009-运营自动化、监控与系统配置管理
codeRefs:
  - web/src/views/settings/SettingsView.vue
  - web/src/views/settings/DeploymentTaskSettingsView.vue
testRefs: []
lastVerified: 2026-08-22
---

# 系统设置页面

进入“系统设置 → 系统设置”，查看当前租户的通用设置和部署任务设置。可配置是否启用 Dry Run（只读预检）和是否要求审批；这些设置同时影响手工提交和自动化运行。

修改后点击保存，再用一次测试应用资产验证效果。关闭 Dry Run 不会绕过输入解析、权限、审批或快照校验；开启审批也不会自动批准自己的任务，除非租户明确允许自批。

部署任务设置还会影响自动化运行。调整并发或失败阈值前先在测试租户观察执行记录；修改只影响后续新建运行，已创建的计划仍使用自己的输入快照。

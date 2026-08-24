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

进入“系统设置 → 部署任务参数”，可为当前租户设置证书部署的默认护栏。页面有两个开关：

- **启用 Dry-run**：正式部署前先执行只读预检，帮助提前发现输入和连接问题。预检结果供确认使用，不会替代正式部署。
- **启用审批流程**：当应用没有单独指定审批要求时，决定部署是否先进入审批。

## 修改设置

1. 查看当前两个开关的状态，先和运维负责人确认本租户的审批要求。
2. 按需要打开或关闭开关，点击“保存设置”。
3. 页面提示“部署任务参数已保存”后，使用一项低风险的测试部署核对后续任务是否按预期执行。

没有“设置写入”权限时页面为只读，不能保存。关闭 Dry-run 也不会跳过权限检查、审批要求或部署输入校验；打开审批后，任务仍需由有权限的人员实际批准。设置变更主要影响之后创建的运行，已经建立的计划按自身保存的配置执行。

> [截图占位符：部署任务参数页，标出 Dry-run、审批流程两个开关和“保存设置”按钮]

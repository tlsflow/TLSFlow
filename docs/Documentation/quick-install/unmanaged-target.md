---
title: 无 Agent 目标接入
description: 非受管目标和无代理执行通道的准备
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/005-受管与非受管设备管理
  - specs/006-应用资产、绑定与受管目标管理
codeRefs:
  - backend/src/modules/device-assets
  - backend/src/modules/executors/ssh
  - backend/src/modules/executors/curl
testRefs: []
lastVerified: 2026-08-02
---

# 无 Agent 目标接入

无 Agent 目标可以通过标准发现、SSH、Windows 远程或 CURL 等通道接入。无 Agent 不等于没有执行位置，也不等于可以创建一个新的插件绑定模型。

## 准备步骤

1. 创建或导入目标地址和连接方式。
2. 将用户名、密码、SSH Key 或 API Token 保存为 Credential。
3. 明确 Gateway 或控制面网络出口。
4. 运行只读发现并确认目标键稳定。
5. 在应用资产中创建 `Standalone + Workflow` 或受管目标工作流覆盖。

新的 Standalone 目标不得新建 Standalone PluginBinding；应使用 `ApplicationAsset + WorkflowExecutionBinding`。

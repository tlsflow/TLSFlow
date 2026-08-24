---
title: 应用资产
description: 创建应用资产、选择证书并绑定受管目标
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/006-应用资产、绑定与受管目标管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - web/src/views/assets/AssetsView.vue
  - backend/src/modules/assets
  - backend/src/modules/application-onboarding
testRefs: []
lastVerified: 2026-08-22
---

# 应用资产

应用资产是用户要保护和部署的应用入口，通常包含域名/IP、环境、负责人、证书绑定和一个或多个受管目标。

## 创建

1. 进入“资产中心 → 应用资产”，点击“新增”或“应用接入”。
2. 填写名称、域名或地址、环境和负责人。
3. 选择已有设备与发现到的站点；如果选择安装 Agent，完成注册和健康检查后再刷新列表。
4. 选择证书资产、格式和部署能力，检查输入投影（根据目标自动生成的配置表单）。
5. 保存应用资产，打开详情确认目标、证书和部署绑定都处于可用状态。

“保存”不会写入目标主机。进入“证书部署”并通过预检、审批（如果启用）后才会执行。

## 修改和删除

修改连接或凭据后重新运行发现和预检；历史部署计划仍保留创建时的输入快照。删除应用资产前先清理自动化和活动绑定，平台会拒绝仍被引用的对象。

## 选择执行来源

保存前确认应用资产只有一个明确的执行来源：受管目标默认使用已分配的插件能力；选择 Workflow Override 时，应用资产的活动插件 Assignment 不再作为本次工作流来源；Standalone 目标使用 `WorkflowExecutionBinding`，不新建独立插件绑定。执行位置（Agent、Gateway、SSH 或 HTTP）只说明在哪里执行，不能用来推断厂商插件。

---
title: TLSFlow 官方文档
description: TLSFlow 证书生命周期管理平台官方文档入口
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001-平台基础与工程治理
  - specs/002-统一安全管理与访问控制
  - specs/003-证书资产与CA生命周期管理
  - specs/004-统一插件平台与厂商扩展治理
  - specs/005-受管与非受管设备管理
  - specs/006-应用资产、绑定与受管目标管理
  - specs/007-工作流DSL与模板运行管理
  - specs/008-证书部署输入与执行编排管理
  - specs/009-运营自动化、监控与系统配置管理
codeRefs:
  - backend/src/app.module.ts
  - backend/src/modules/plugins
  - backend/src/modules/workflow-templates
testRefs: []
lastVerified: 2026-08-22
---

# TLSFlow v1.0.0 官方用户文档

TLSFlow（证书生命周期管理平台）把证书资产、CA（证书颁发机构）、目标设备、应用资产、插件、工作流、部署执行和运营监控放在同一租户边界内管理。本套文档只描述 v1.0.0 当前代码和 Docker 发布说明已经支持的行为。

## 从哪里开始

- 安装部署：进入[安装部署](/installation/)，按需选择[标准部署](/installation/standard-deployment)或[单机部署](/installation/single-node-deployment)。
- 首次使用：阅读[首次登录](/installation/first-login)，再从[用户手册](/manual/)的仪表盘开始。
- 日常管理：按控制台菜单阅读[用户手册](/manual/)，每个一级、二级菜单都有独立页面。
- 开发扩展：阅读[开发文档](/developer/)；开发文档不是对所有外部厂商环境的兼容承诺。

## 版本和事实边界

版本统一为 **v1.0.0**。文档中的“支持”表示当前代码存在对应控制台/API路径和必要的状态校验；外部厂商网络、证书签发机构、反向代理和灾备演练仍需在你的环境中单独验收。没有平台 API 的能力会明确写为外部运维步骤，不会以页面存在代替产品能力。

## TLSFlow 解决什么问题

TLSFlow 将证书资产、设备发现、应用资产、部署执行和运营监控放在同一租户边界中，重点解决证书材料分散、目标位置不清、部署过程不可审计和失败难恢复的问题。它不是任意远程 Shell（远程命令行）平台，也不是开放脚本沙箱；代码型插件只能在受控的独立 Runner 中调用登记的宿主接口。

核心对象的关系是：`PluginVersion → PluginBinding → CapabilityAssignment → ApplicationAsset → ManagedTarget → WorkflowVersion/Agent Plan → DeploymentPlan → ExecutionRun`。执行位置描述“在哪里执行”，不能决定“使用哪个插件”；证书私钥和凭据只能通过受控制品与 Secret 引用进入执行。

页面状态只用于文档治理：`implemented` 表示有代码和验证证据，`in_review` 表示仍需环境或协议复核，`todo` 表示未实现或无充分事实。它们不是控制台任务状态。

## 核心主链

```mermaid
flowchart LR
  A[身份与权限] --> B[插件与能力]
  B --> C[Agent或无代理目标]
  C --> D[应用资产与受管目标]
  D --> E[工作流或原子计划]
  E --> F[证书部署计划]
  F --> G[验证与回滚]
  G --> H[监控与运营]
```

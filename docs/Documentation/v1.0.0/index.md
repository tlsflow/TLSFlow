---
title: TLSFlow 官方文档
description: TLSFlow 证书生命周期管理平台官方文档入口
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - backend/src/app.module.ts
  - backend/src/modules/plugins
  - backend/src/modules/workflow-templates
testRefs: []
lastVerified: 2026-08-22
---

# TLSFlow v1.0.0 官方用户文档

TLSFlow 是一个证书生命周期管理平台，帮助你在同一个平台内统一管理证书资产、CA（证书颁发机构）、目标设备、应用资产、部署执行和运营监控，让证书的申请、下发、部署、巡检和回收都有迹可循。

## 从哪里开始

- 当前版本：进入 [TLSFlow v1.0.0 文档](/v1.0.0/)，按需选择[标准部署](/v1.0.0/installation/standard-deployment)或[单机部署](/v1.0.0/installation/single-node-deployment)。
- English：进入 [TLSFlow v1.0.0 English documentation](/v1.0.0/en/)。
- 首次使用：阅读[首次登录](/v1.0.0/installation/first-login)，再从[用户手册](/v1.0.0/manual/)的仪表盘开始。
- 日常管理：按控制台菜单阅读[用户手册](/v1.0.0/manual/)，每个一级、二级菜单都有独立页面。
- 开发扩展：阅读[开发文档](/v1.0.0/developer/)。

## 版本说明

当前发布版本为 **TLSFlow v1.0.0**。顶部“版本”列表可以切换到对应软件版本的完整文档；根路径页面保留为历史兼容入口，新版本文档应通过版本路径访问。文档描述的功能以所选发布版本为准。涉及外部厂商网络、证书签发机构、反向代理和灾备演练等外部环境的能力，请在实际使用环境中单独验收。

## TLSFlow 解决什么问题

TLSFlow 把证书资产、设备、应用资产、部署执行和运营监控放在一起管理，重点解决证书材料分散、目标位置不清、部署过程不可审计、失败难恢复等问题。它不是一个通用的远程命令行工具，也不提供开放脚本执行环境；插件能力由平台统一管控，证书私钥和凭据以受控方式进入执行，不会被随意读取。

<LocalizedImage name="quick-start.svg" alt="TLSFlow 核心流程" width="960" height="360" />

## 核心使用流程

```mermaid
flowchart LR
  A[接入设备与目标] --> B[导入或申请证书]
  B --> C[绑定应用与目标]
  C --> D[配置部署方案]
  D --> E[执行部署]
  E --> F[验证与回滚]
  F --> G[监控与审计]
```

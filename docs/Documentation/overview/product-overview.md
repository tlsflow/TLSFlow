---
title: 产品概览
description: GCAC 解决的问题和适用边界
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001-平台基础与工程治理
  - specs/003-证书资产与CA生命周期管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - backend/src/app.module.ts
  - backend/src/modules/certificates
  - backend/src/modules/deployment-plans
testRefs: []
lastVerified: 2026-08-06
---

# 产品概览

GCAC 解决的是证书资产分散、设备目标不清、部署过程不可审计和失败后难以恢复的问题。

## 适用场景

- 管理多个 CA、证书版本和证书制品。
- 通过 Agent、Gateway 或无代理通道管理不同网络区域的目标。
- 将应用资产、证书绑定和受管目标关联起来。
- 使用 Agent 原子计划或工作流完成部署、验证和回滚。
- 通过监控、通知、自动化和报表持续运营证书生命周期。

## 不解决的问题

GCAC 不是任意远程 Shell 平台，也不是对外开放的任意脚本执行沙箱。代码型插件只能在同 Docker 独立 Plugin Runner 中执行，并受签名、PluginVersion、Capability Token、Policy Authority、Host API、执行锁、审计和恢复控制；宿主始终掌握权限、凭据、制品和调度控制权。

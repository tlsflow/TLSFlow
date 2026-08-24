---
title: Agent
description: 接入、检查和升级 TLSFlow Agent 受管主机
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/005-受管与非受管设备管理
codeRefs:
  - web/src/views/devices/DevicesView.vue
  - backend/src/modules/agents
  - backend/src/modules/devices
testRefs: []
lastVerified: 2026-08-22
---

# Agent

Agent 是安装在目标主机上的执行程序，负责注册、心跳、能力上报和受控任务执行。

1. 在“资产中心 → 设备”选择 Agent 管理方式，按页面提供的安装材料在目标主机注册。
2. 等待 Agent 状态为在线并出现最近心跳，再刷新设备列表。
3. 执行只读发现，确认运行框架、站点、证书位置和能力版本。
4. 在应用资产向导选择兼容目标，先做预检再部署。

设备详情若显示升级建议，可先执行升级计划检查，确认当前版本和目标版本后再发送升级事务。升级包必须来自已发布 Release 并通过版本/签名校验；平台不会因为显示建议就自动升级。

Agent 离线时，控制面不能证明远端任务已执行。不要把“计划已发送”当作“目标已更新”。

安装材料请使用设备页面提供的正式版本。注册信息和升级材料属于安全信息；如有泄露，立即禁用旧 Agent 并重新注册。Gateway 是独立的网络转发角色，不能把 Gateway 信息填入 Agent。

## 本页截图占位符

> 【截图占位：设备页面中的 Agent 注册入口和安装材料提示】
>
> 【截图占位：Agent 设备详情，显示在线状态、最近心跳和发现按钮】

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

当前安装包由安装会话和 Release Bundle 提供，不要从测试目录复制二进制。注册令牌、mTLS（双向 TLS）证书和升级签名材料均属于安全凭据；泄露后立即禁用旧 Agent 并重新注册。Gateway Agent 是独立角色，不能把 Gateway 参数填入 Full Agent。

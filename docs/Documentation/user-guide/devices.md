---
title: 设备与执行通道
description: Agent、无 Agent 目标、Gateway 和标准发现操作
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/005-受管与非受管设备管理
codeRefs:
  - backend/src/modules/agents
  - backend/src/modules/devices
  - backend/src/modules/device-assets
  - backend/src/modules/gateway-agents
  - backend/src/modules/executors
testRefs: []
lastVerified: 2026-08-02
---

# 设备与执行通道

## 目标类型

- Agent 受管设备：由 Agent 上报能力和标准发现结果。
- 无 Agent 目标：通过标准发现或无代理通道获得目标事实。
- Gateway 隔离区目标：通过受控转发访问隔离网络。

## 操作顺序

1. 创建或注册设备/目标。
2. 配置网络出口、Gateway 或 SSH/Windows/CURL 连接。
3. 保存 Credential，不把凭据写入设备名称或普通变量。
4. 执行只读发现。
5. 检查稳定目标键、Framework、Site、ManagedTarget 和证书绑定。

发现是只读投影。发现失败的单个对象不应污染其他对象，但部署、变更和回滚不能使用发现阶段的宽松容错。

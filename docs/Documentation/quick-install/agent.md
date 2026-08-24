---
title: Agent 接入
description: GCAC Agent 受管设备的接入准备和核验
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/005-受管与非受管设备管理
  - specs/004-统一插件平台与厂商扩展治理
codeRefs:
  - backend/src/modules/agents
  - backend/src/modules/devices
  - backend/src/modules/liveness
  - backend/src/modules/plugins/builtin-agent-plugins
testRefs: []
lastVerified: 2026-08-02
---

# Agent 接入

## 接入前

- 确认 Agent 运行平台、网络出口和控制面地址。
- 只为 Agent 授予它实际需要的动作和路径权限。
- 确认 Agent 上报的 Capability 和 Schema 版本，而不是让控制面根据操作系统名称猜测。

## 接入后

1. 查看注册状态和最近存活信号。
2. 执行只读设备发现。
3. 确认产品详情由插件资源映射到标准 Framework、Site、ManagedTarget 和 Certificate。
4. 确认部署插件和工作流来源已经启用并通过权限审批。
5. 先运行预检，再生成签名 Atomic Plan 或部署计划。

未知 Agent Action 必须在入队前失败关闭。

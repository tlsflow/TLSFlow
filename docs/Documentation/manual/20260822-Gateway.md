---
title: Gateway
description: 管理 Gateway 网络转发节点并查看其状态
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/005-受管与非受管设备管理
codeRefs:
  - web/src/views/gateways/GatewaysView.vue
  - backend/src/modules/gateways
testRefs: []
lastVerified: 2026-08-22
---

# Gateway

Gateway 是独立的网络转发节点，用于让控制面访问隔离网络中的目标。它不是 Full Agent 的隐含功能，也不会自动替代 Agent。

1. 进入“资产中心 → Gateway”，创建 Gateway 记录并填写名称、地址和认证材料。
2. 保存后查看注册状态和最近心跳，确认状态为可用。
3. 在工作流执行绑定中选择 Gateway 运行器，并把目标连接配置为通过该 Gateway。
4. 运行连接测试和发现，确认目标实际可达后再创建应用资产。

Gateway 离线时，依赖它的发现和部署会失败或等待；先恢复 Gateway 状态，再重试任务。当前页面不提供自动故障转移或 Gateway 集群承诺。

Gateway 与 Full Agent 的网络职责分离：不要把 `gatewayEnabled`、中继参数或 Gateway 角色材料填入 Linux/Windows Full Agent。需要跨隔离区访问时，在目标连接和工作流执行绑定中选择已注册 Gateway，并确认控制面到 Gateway、Gateway 到目标的两个方向都可达。

---
title: 设备
description: 接入设备、运行发现并确认可部署目标
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/005-受管与非受管设备管理
  - specs/006-应用资产、绑定与受管目标管理
codeRefs:
  - web/src/views/devices/DevicesView.vue
  - backend/src/modules/devices
  - backend/src/modules/agents
testRefs: []
lastVerified: 2026-08-22
---

# 设备

设备可以是 Agent 受管主机，也可以是无 Agent 的网络目标。连接测试证明网络可达，发现成功才会产生 Framework（运行框架）、Site（站点）和 ManagedTarget（可部署目标）事实。

## 接入和发现

1. 进入“资产中心 → 设备”，点击“新增设备”。
2. 选择已有 Agent、无 Agent 连接方式或插件管理方式，填写地址、端口、TLS 和凭据引用。
3. 保存后先执行连接测试，再执行标准发现。
4. 在发现结果中检查目标类型、站点、证书位置、服务名和能力状态。
5. 只有兼容且可用的 ManagedTarget 才能在应用资产向导中选择。

发现中的警告允许查看事实，但部署、变更和回滚会在关键事实缺失时失败关闭。不要把“发现到设备”当成“证书已经部署”。

## 设备类型和排障

- Agent 受管设备由 Linux Go Agent、Windows Go Agent 或 Windows Compatibility Agent 上报心跳、能力和发现结果；独立 Gateway Agent 只负责网络转发，不能当作 Full Agent 使用。
- 无 Agent 目标可以使用 SSH、Windows Remote 或 CURL 等连接方式，但凭据必须保存为 Credential，执行位置和目标地址必须在绑定中明确。
- Framework、Site、ManagedTarget 是发现投影：缺少稳定目标键、服务名或证书位置时，先修复发现事实，不要在应用资产里手填猜测路径。

发现成功只证明读取到目标事实；部署仍要独立通过输入解析、预检、执行和回读验证。发现失败的一个子对象不应污染其他对象，但部署阶段不能沿用发现阶段的宽松容错。

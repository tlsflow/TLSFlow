---
title: 插件开发
description: GCAC 统一插件和 Agent 插件开发入口
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/004-统一插件平台与厂商扩展治理
  - specs/005-受管与非受管设备管理
  - specs/006-应用资产、绑定与受管目标管理
codeRefs:
  - backend/src/modules/plugins
testRefs: []
lastVerified: 2026-08-06
---

# 插件开发

插件开发必须以现行的 `20260802` 统一规范、对应 Spec 和代码证据为准。当前手册已经覆盖包契约、设备与目标模式、标准发现、Agent 运行时、安全门禁和能力成熟度；没有外部厂商、真实部署或密码学验签证据的能力会保留为 `in_review` 或 `todo`。

推荐阅读顺序：

1. [插件包契约](./package-contract.md)
2. [设备与目标模式](./target-modes.md)
3. [发现、资产字段与证书位置](./discovery-and-assets.md)
4. [Agent 插件运行时](./agent-runtime.md)
5. [插件安全与能力成熟度](./security-and-maturity.md)

核心边界：

- 插件身份由 `CapabilityAssignment -> PluginBinding -> PluginVersion` 解析，不按厂商字符串选择实现。
- `AGENT_ATOMIC`、`WORKFLOW_DSL` 与 `TRUSTED_JS` 是三种独立运行时；普通插件默认不允许执行代码，Trusted JS 代码执行还必须单独通过未知代码执行授权。Agent 原子插件和 Trusted JS 插件都不能伪装成普通工作流 Step。
- 无 Agent `DeviceAsset`、`ManagedTarget + Plugin`、`ManagedTarget + Workflow Override` 和 `Standalone + Workflow` 必须分开建模。
- 发现得到的证书路径等事实使用 `source.kind=asset`，精确发现优先于插件默认值。
- Secret、Artifact、权限、审计、快照、验证和回滚由宿主统一治理；`TRUSTED_JS` 插件也只能在获得未知代码执行授权后消费受控 Grant 和受限 Host API。

---
title: 插件开发
description: GCAC 统一插件和 Agent 插件开发入口
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/004-统一插件平台与厂商扩展治理
  - specs/004.5-插件进程隔离与宿主能力边界重构治理
  - specs/005-受管与非受管设备管理
  - specs/006-应用资产、绑定与受管目标管理
codeRefs:
  - backend/src/modules/plugins
testRefs: []
lastVerified: 2026-08-06
---

# 插件开发

插件开发必须以现行的 `20260802` 统一规范、004.5 插件边界、对应 Spec 和代码证据为准。当前手册已经覆盖包契约、设备与目标模式、标准发现、Agent 运行时、安全门禁和能力成熟度；没有外部厂商、真实部署或密码学验签证据的能力会保留为 `in_review` 或 `todo`。

推荐阅读顺序：

1. [插件包契约](./package-contract.md)
2. [设备与目标模式](./target-modes.md)
3. [发现、资产字段与证书位置](./discovery-and-assets.md)
4. [Agent 插件运行时](./agent-runtime.md)
5. [插件安全与能力成熟度](./security-and-maturity.md)

核心边界：

- 插件身份由 `CapabilityAssignment -> PluginBinding -> PluginVersion` 解析，不按厂商字符串选择实现。
- 插件执行位置只有 `agent_plan`、`declarative` 和 `isolated_process`；`isolated_process` 只供 DSL 明确声明的 `plugin.action` 调用同一 Docker 内独立 Plugin Runner。普通 DSL Workflow 仍由 DSL 执行器运行，Runner 不接管整份工作流，宿主不得使用动态 `import()` 执行插件。
- 无 Agent `DeviceAsset`、`ManagedTarget + Plugin`、`ManagedTarget + Workflow Override` 和 `Standalone + Workflow` 必须分开建模。
- 发现得到的证书路径等事实使用 `source.kind=asset`，精确发现优先于插件默认值。
- Secret、Artifact、权限、审计、快照、验证和回滚由宿主统一治理；独立 Runner 只能消费已签发 Grant 和登记 Host API，不能直连数据库、Repository、宿主文件或环境变量。

---
title: 插件包契约
description: GCAC 统一插件 Manifest、资源和版本约束
docStatus: implemented
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/004-统一插件平台与厂商扩展治理
codeRefs:
  - backend/src/modules/plugins/schema/unified-plugins.schema.ts
  - backend/src/modules/plugins/repository
testRefs: []
lastVerified: 2026-08-06
---

# 插件包契约

Manifest 使用 `gcac.plugin-manifest/v1`。必须声明 Runtime、Source、Scope、Trust、Support、Capability、Permission、Compatibility 和资源映射。

同一 `pluginId + version` 内容不可变。资源路径不能越界。插件执行位置只有 `declarative`、`agent_plan` 和 `isolated_process`：声明式插件必须提供受校验的 Workflow/Manifest 资源，Agent 插件必须生成 Agent v2 类型化计划，代码型插件必须声明独立 Plugin Runner 入口、IPC 版本和资源摘要。任何代码都不得通过宿主进程动态加载，插件不得直接访问数据库、Repository、宿主文件或环境变量。

## 内置包版本事实源

每个内置包的 `manifest.json.version` 是插件版本的唯一事实源。后端启动和热刷新扫描包后，Registry、数据库 `PluginVersion` 和 Workflow Binding 都是不可变派生状态，不能反向定义或覆盖 Manifest。相同 `pluginId@version` 且摘要相同必须幂等注册；摘要不同必须拒绝启动或热刷新；更高 Manifest 版本创建新记录并保留旧记录。

`scripts/architecture/p2-plugin-release-manifest.json` 是发布 Catalog，只保存发布策略、包摘要、Host API 授权和所有权元数据。它不保存插件版本、Capability 或 Workflow 版本镜像。Workflow `metadata.version` 属于 Workflow 自身，不是插件版本副本。

插件导入、审批、启用、绑定和执行是独立阶段。未通过任何一个阶段都必须失败关闭。

## 应用资产接入的新建设备入口

应用资产接入配方必须由 Manifest `resources.onboarding.applicationAsset` 引用，通常位于 `onboarding/application-asset.json`。`deviceSelection` 为 `EXISTING_OR_NEW` 时，可以通过 `newDeviceOnboarding` 声明统一设备向导的预选入口。宿主不得按应用平台名、厂商名或产品名推断设备接入流程。

```json
{ "kind": "AGENT_INSTALL", "platformKey": "linux" }
```

该入口用于需要先安装受管 Agent 的业务平台；`platformKey` 必须是设备平台注册表中的键。向导生成安装命令不代表设备已经可用，只有 Agent 实际注册、健康检查和能力筛选完成后，刷新列表才可能出现该设备。需要由设备插件收集连接信息时，使用：

```json
{ "kind": "PLUGIN_MANAGED", "pluginId": "device.citrix.netscaler-adc" }
```

`pluginId` 必须是目标设备插件的稳定标识。向导加载该插件版本在 Manifest `resources.forms` 中声明的真实 `forms.device` 资源；逻辑别名、内嵌表单和宿主专属字段都会被拒绝。`EXISTING_ONLY` 和 `NONE` 配方不得声明该字段。未声明该字段的历史插件仍可选择已有设备，但不会在应用向导中展示新增设备选项。

设备插件完成创建后，宿主恢复原接入会话并刷新兼容设备列表。修改接入配方、表单或 Manifest onboarding 资源属于包内容变更，必须递进 Manifest 版本并更新发布 Catalog 摘要；不得直接修改运行数据库或在宿主增加厂商特判。

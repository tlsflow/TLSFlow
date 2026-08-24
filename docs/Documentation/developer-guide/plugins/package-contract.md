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
lastVerified: 2026-08-19
---

# 插件包契约

本页只维护插件包 Manifest、资源和版本事实。DSL 编排、`plugin.action` 和 Runner 边界以 `specs/004.5-插件进程隔离与宿主能力边界重构治理/` 及 `docs/项目规范/20260723-工作流模板管理及编写规范.md` 为准。

Manifest 使用 `gcac.plugin-manifest/v1`。必须声明 Runtime、Source、Scope、Trust、Support、Capability、Permission、Compatibility 和资源映射。

同一 `pluginId + version` 内容不可变。资源路径不能越界。插件执行位置只有 `declarative`、`agent_plan` 和 `isolated_process`：声明式插件必须提供受校验的普通 DSL Workflow/Manifest 资源，Agent 插件必须生成 Agent v2 类型化计划，代码型插件必须声明供 `plugin.action` 使用的独立 Runner 入口、Action 合同和资源摘要。任何代码都不得通过宿主进程动态加载，插件不得直接访问数据库、Repository、宿主文件或环境变量；Runner 不接收完整 Workflow。

## 内置包版本事实源

每个内置包的 `manifest.json.version` 是插件版本的唯一事实源。后端启动和热刷新扫描包后，Registry、数据库 `PluginVersion` 和 Workflow Binding 都是不可变派生状态，不能反向定义或覆盖 Manifest。相同 `pluginId@version` 且摘要相同必须幂等注册；摘要不同的插件只单独跳过并记录警告，不能阻塞其他插件或后端启动；更高 Manifest 版本创建新记录并保留旧记录。

历史 P2 发布 Catalog 已退休并从仓库删除。当前只使用包内 Manifest、Registry 派生摘要以及 Policy/Execution Grant 授权边界；Workflow `metadata.version` 属于 Workflow 自身，不是插件版本副本。

插件导入、审批、启用、绑定和执行是独立阶段。单个插件未通过某个阶段时只禁用该插件，其他插件和后端继续运行。

## 测试与包边界

测试文件按责任归属组织，不改变插件包的运行资源边界：

- 内置插件的 Manifest、资源、Runtime、Action 和产品协议测试可以放在 `backend/src/modules/plugins/builtin-plugins/<pluginId>/tests/`，对应 Fixture 放在插件包内；现有 `runtime/index.test.mjs` 等相邻测试可以保留。
- Registry、Loader、Policy、权限、租户隔离、Host API 和 Plugin Runner 测试属于宿主，放在 `backend/src/modules/plugins` 的对应模块目录。多插件共享的 Compatibility 测试放在独立 Fixture/批次目录。
- 测试文件不是 Manifest 声明资源，也不是插件运行入口；Loader 只读取 Manifest 引用的资源和固定 Runtime 入口。测试用例不得借助宿主动态加载绕过插件边界。
- 用户插件由外部插件仓库维护自身产品测试。GCAC 导入链只执行受控的包契约和运行边界测试，禁止扫描或执行用户包中任意测试代码。
- 测试结果必须绑定 `pluginId`、版本及 `packageHash`、`manifestHash`、`resourceHash`；不可变版本的任何摘要变化都要求重新验证。

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

设备插件完成创建后，宿主恢复原接入会话并刷新兼容设备列表。修改接入配方、表单或 Manifest onboarding 资源属于包内容变更，必须递进 Manifest 版本；Registry 在加载时重新计算摘要，不得直接修改运行数据库或在宿主增加厂商特判。

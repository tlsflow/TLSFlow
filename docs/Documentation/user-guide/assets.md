---
title: 应用资产与受管目标
description: ApplicationAsset、证书绑定和 ManagedTarget 操作
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/006-应用资产、绑定与受管目标管理
  - specs/005-受管与非受管设备管理
codeRefs:
  - backend/src/modules/assets
  - backend/src/modules/bindings
testRefs: []
lastVerified: 2026-08-02
---

# 应用资产与受管目标

## 配置顺序

1. 选择已发现的设备、Framework、Site 或稳定目标。
2. 创建 `ApplicationAsset`，确认租户和目标关系。
3. 绑定证书资产和部署能力。
4. 检查最终 `ManagedTargetContext`、管理连接和执行位置。
5. 根据目标选择插件执行或工作流覆盖。

## 四种模式

| 模式 | 用户动作 |
| --- | --- |
| 无 Agent DeviceAsset | 维护发现事实，不虚构 Agent |
| ManagedTarget + Plugin | 使用能力解析得到的插件和固定版本 |
| ManagedTarget + Workflow Override | 明确选择工作流并停用应用资产的活动插件 Assignment |
| Standalone + Workflow | 通过工作流绑定独立目标，不创建新的 Standalone PluginBinding |

资产页面不应要求用户重复填写已经由标准目标上下文提供的地址、端口、证书路径和 Framework。

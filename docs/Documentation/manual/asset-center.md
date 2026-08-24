---
title: 资产中心
description: 资产中心一级菜单及应用资产、云账号、设备和 Gateway 操作地图
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/005-受管与非受管设备管理
  - specs/006-应用资产、绑定与受管目标管理
codeRefs:
  - web/src/router/menu.ts
  - web/src/router/modules/business.ts
testRefs: []
lastVerified: 2026-08-22
---

# 资产中心

资产中心把“要部署的应用”和“能够执行的设备”分开管理：应用资产保存域名、证书和部署目标关系；设备保存 Agent、连接和发现事实；云账号保存云服务连接；Gateway 是独立的网络转发入口。

开始部署前，按“云账号（如需要）→ 设备 → 发现 → 应用资产”的顺序准备对象。

应用资产和设备不是同一对象：设备保存连接和发现事实，应用资产保存业务负责人、域名、证书及部署关系。以下四种目标模式必须按实际事实选择：

| 模式 | 适用情况 |
| --- | --- |
| 无 Agent `DeviceAsset` | 只有标准发现或无代理通道事实，不虚构 Agent |
| `ManagedTarget + Plugin` | 由设备能力解析出固定插件版本 |
| `ManagedTarget + Workflow Override` | 明确用工作流覆盖活动插件 Assignment |
| `Standalone + Workflow` | 独立目标绑定工作流，不创建新的 Standalone PluginBinding |

不要重复填写标准发现已经提供的地址、端口、服务名和证书路径；发现事实优先于插件默认值。

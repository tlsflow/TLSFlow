---
title: 设备、证书与部署主流程
description: 从设备接入到证书部署验证的主操作路径
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/005-受管与非受管设备管理
  - specs/006-应用资产、绑定与受管目标管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - backend/src/modules/device-assets
  - backend/src/modules/assets
  - backend/src/modules/deployment-inputs
  - backend/src/modules/deployment-plans
testRefs: []
lastVerified: 2026-08-02
---

# 设备、证书与部署主流程

## 主流程

1. 选择 Agent 受管设备或无 Agent 目标。
2. 运行标准发现并确认目标键、执行位置、证书位置和兼容能力。
3. 创建或选择 `ApplicationAsset`。
4. 绑定证书资产和最终部署能力。
5. 配置工作流输入或选择 Agent 原子计划。
6. 执行预检，确认权限、凭据、制品和目标配置未变化。
7. 创建部署计划并固定输入快照。
8. 执行计划，查看每个步骤的结果。
9. 通过 TLS/服务检查验证结果；失败时使用计划支持的回滚路径。

## 四种目标模式

| 模式 | 说明 |
| --- | --- |
| 无 Agent DeviceAsset | 只有标准发现或无代理通道事实，不代表存在 Agent |
| ManagedTarget + Plugin | 受管目标使用能力解析得到的插件 |
| ManagedTarget + Workflow Override | 用户明确选择工作流覆盖受管插件能力 |
| Standalone + Workflow | 非受管目标通过独立工作流执行，不新建 Standalone PluginBinding |

页面状态：`in_review`。真实厂商执行结果必须在对应环境验收后更新。

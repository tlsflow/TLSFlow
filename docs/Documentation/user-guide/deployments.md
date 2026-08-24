---
title: 部署计划与回滚
description: 证书部署输入、计划、执行、验证和回滚操作
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/008-证书部署输入与执行编排管理
  - specs/007-工作流DSL与模板运行管理
codeRefs:
  - backend/src/modules/deployment-inputs
  - backend/src/modules/deployment-plans
  - backend/src/modules/executions
testRefs: []
lastVerified: 2026-08-02
---

# 部署计划与回滚

## 标准流程

1. 解析资产、绑定、插件/工作流、凭据和证书制品。
2. 执行预检，确认权限、目标、版本和输入完整。
3. 创建快照和部署计划。
4. 执行计划并记录步骤状态。
5. 通过服务检查、TLS 检查或插件验证能力确认结果。
6. 失败时只执行计划声明的回滚步骤。

部署计划固定 `DeploymentInputSnapshotV1` 和凭据版本。执行时不能重新读取当前资产配置来改变已批准计划。

## 回滚注意事项

- 只有幂等步骤可以自动恢复。
- 非幂等运行中步骤应进入人工处理或显式补偿。
- 回滚失败必须保留原始失败和回滚失败两组证据。
- 不要删除历史执行记录来“清理失败”。

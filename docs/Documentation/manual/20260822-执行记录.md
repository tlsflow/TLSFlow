---
title: 执行记录
description: 查看证书部署执行状态、预检、审批、验证和回滚结果
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - web/src/views/executions/ExecutionsView.vue
  - backend/src/modules/executions
  - backend/src/modules/deployment-plans
testRefs: []
lastVerified: 2026-08-22
---

# 执行记录

1. 进入“证书部署 → 执行记录”，按状态、应用资产、计划 ID 或时间筛选。
2. 打开记录查看预检结果、审批状态、每个步骤的输出摘要和目标验证结果。
3. `待审批` 记录先完成审批；`失败` 记录查看首个失败步骤和结构化错误。
4. 目标支持回滚时，确认恢复快照和当前目标状态后执行回滚；回滚结果仍需回读验证。
5. 任务卡住时使用取消或强制取消（若页面提供且账号有权限），不要直接删除记录。

执行记录里的 Secret、私钥和证书材料只显示脱敏引用。历史记录不能编辑，重试会生成新的执行上下文。

记录状态应按“预检 → 待审批 → 执行中 → 验证 → 成功/失败/UNKNOWN”理解。`UNKNOWN` 表示外部写请求的最终状态无法确认，不等同于失败；先登录目标系统或查看目标服务，再决定补偿或回滚。回滚必须使用原计划固定的 WorkflowVersion、输入快照和恢复清单，回滚成功后仍需执行服务/TLS 验证。

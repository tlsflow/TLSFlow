---
title: Deployments and rollback
description: Deployment input, plan, execution, verification, and rollback operations
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
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

# Deployments and rollback

## Standard flow

1. Resolve assets, bindings, plugin/workflow, credentials, and certificate artifacts.
2. Run preflight to confirm permissions, target, version, and complete inputs.
3. Create a snapshot and deployment plan.
4. Execute the plan and record each step state.
5. Verify the result through service checks, TLS checks, or plugin verification capabilities.
6. On failure, execute only the rollback steps declared by the plan.

The plan fixes `DeploymentInputSnapshotV1` and credential versions. Execution cannot re-read current asset configuration and change an approved plan.

## Rollback notes

- Only idempotent steps may recover automatically.
- A running non-idempotent step requires manual handling or explicit compensation.
- A rollback failure must preserve both the original failure and rollback failure evidence.
- Do not delete historical execution records to hide a failure.

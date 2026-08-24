---
title: 工作流开发
description: GCAC 工作流 DSL 和证书部署工作流开发入口
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/004.5-插件进程隔离与宿主能力边界重构治理
  - specs/007-工作流DSL与模板运行管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - backend/src/modules/workflow-templates
  - backend/src/modules/executors
testRefs: []
lastVerified: 2026-08-02
---

# 工作流开发

工作流 DSL（领域专用语言）是 GCAC 的私有领域协议，不是脚本容器，也是证书部署的唯一编排权威。开发新模板时，先阅读 DSL 与模板来源，再阅读输入契约和执行器，最后按证书部署主链完成预检、快照、执行、验证和回滚设计；厂商专属代码只能作为 DSL 的 `plugin.action` 步骤接入。

推荐阅读顺序：

1. [工作流 DSL 与模板来源](./20260802-工作流DSL与模板来源.md)
2. [部署输入契约与快照](./20260802-部署输入契约与快照.md)
3. [工作流执行器、恢复与回滚](./20260802-工作流执行器与恢复回滚.md)
4. [证书部署工作流开发主链](../certificate-deployment/20260802-证书部署工作流开发主链.md)

开发时必须遵守：

- 新 DSL 只能使用 `gcac.workflow/v1` 和 `CurlSshWorkflow`。
- 模板文件来源只有内置模板目录和用户导入目录；运行时选择必须经过已发布的 PluginVersion。
- 连接、Credential、Artifact 和变量必须声明在 `DeploymentInputContractV1` 中。
- 执行器只能消费 `ResolvedDeploymentInputV1` 和受控 Grant，不能从模板根作用域或宿主对象猜测秘密。
- 部署、变更和回滚默认失败关闭；只读发现才可以按契约使用 `foreach.continueOnError`。
- `plugin.action` 只返回当前步骤的结构化输出，不能接收或接管完整 Workflow、checkpoint 或 rollback。

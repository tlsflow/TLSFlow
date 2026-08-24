---
title: 工作流开发
description: GCAC 工作流 DSL 和证书部署工作流开发入口
docStatus: todo
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/007-工作流DSL与模板运行管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - backend/src/modules/workflow-templates
  - backend/src/modules/executors
testRefs: []
lastVerified: 2026-08-02
---

# 工作流开发

工作流开发正文将在阶段 3.5 编写。当前入口固定 DSL、模板来源和证书部署文档的边界。

重点主题：

- `backend/src/modules/workflow-templates/builtin-workflows` 和 `data/workflows` 两类模板来源。
- 输入契约、连接槽位、Credential、Artifact 和变量生命周期。
- SSH/SFTP/SCP/CURL、stage、foreach、checkpoint、assert 和 rollback。

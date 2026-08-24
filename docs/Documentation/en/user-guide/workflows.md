---
title: Workflow templates
description: Workflow template selection, input configuration, and execution binding
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/004.5-插件进程隔离与宿主能力边界重构治理
  - specs/007-工作流DSL与模板运行管理
  - specs/007.1-工作流DSL、模板版本与来源治理
  - specs/006-应用资产、绑定与受管目标管理
codeRefs:
  - backend/src/modules/workflow-templates
  - web/src/views/workflows
testRefs: []
lastVerified: 2026-08-02
---

# Workflow templates

## Template sources

- Built-in templates: `backend/src/modules/workflow-templates/builtin-workflows`.
- User-imported templates: `data/workflows`.

Do not select or restore templates from a third sample directory. A workflow file existing on disk does not mean that its tenant has enabled it; the backend must still validate enabled state during creation and application.

## Configuration order

1. Select an enabled template version.
2. Configure required variables, connection slots, Credentials, and Artifacts.
3. Review advanced defaults and asset-source fields.
4. Run validation and preflight.
5. Bind the workflow to an application asset or Standalone target.

Plugin-internal workflows use the read-only `plugin_internal` source. User workflows are submitted directly as DSL and remain user-owned; historical `plugin_derived` records are cleanup evidence only and cannot be copied, converted, or selected at runtime.

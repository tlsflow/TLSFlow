---
title: 工作流模板
description: 查看、导入和选择 TLSFlow 证书部署工作流模板
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/007-工作流DSL与模板运行管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - web/src/views/workflows/WorkflowTemplatesView.vue
  - backend/src/modules/workflow-templates
testRefs: []
lastVerified: 2026-08-22
---

# 工作流模板

工作流模板是平台私有 DSL（领域专用语言）定义的步骤集合。内置模板随版本发布，用户导入模板保存在 `data/workflows`；页面只展示当前租户可见且已发布的版本。

1. 进入“证书部署 → 工作流模板”，按名称、插件或状态筛选。
2. 打开模板详情，确认版本、输入字段、执行位置和回滚支持。
3. 需要导入时使用页面提供的导入入口，先校验 DSL 和输入合同，再发布版本。
4. 在应用资产或部署计划中选择固定模板版本，不要依赖“当前最高版本”自动漂移。

模板校验失败会显示结构化错误。模板变更不会修改已经创建的部署计划。

## 来源和工作流类型

内置模板目录是 `backend/src/modules/workflow-templates/builtin-workflows`，随代码发布并受 Git 跟踪；用户导入模板只保存到 `data/workflows`。页面运行期不读取 `docs/工作流样例` 或其他第三套目录。插件内部工作流标记为 `plugin_internal`，由固定 PluginVersion 生成且只读；用户工作流标记为 `user`，由当前租户维护。历史 `plugin_derived` 或 `legacy` 来源只能作废或删除并保留审计，不能再创建新绑定。

模板版本是不可变选择。应用资产、自动化和计划都必须固定具体 WorkflowVersion；刷新模板市场或发布新插件不会改变已有计划。

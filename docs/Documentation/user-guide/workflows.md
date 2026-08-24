---
title: 工作流模板
description: 工作流模板选择、输入配置和执行绑定
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/007-工作流DSL与模板运行管理
  - specs/006-应用资产、绑定与受管目标管理
codeRefs:
  - backend/src/modules/workflow-templates
  - web/src/views/workflows
testRefs: []
lastVerified: 2026-08-02
---

# 工作流模板

## 模板来源

- 内置模板：`backend/src/modules/workflow-templates/builtin-workflows`。
- 用户导入模板：`data/workflows`。

禁止从第三个样例目录选择或恢复模板。工作流文件存在不代表租户已经启用，后端创建和应用时仍必须校验启用状态。

## 配置顺序

1. 选择启用的模板版本。
2. 配置必填变量、连接槽位、Credential 和 Artifact。
3. 检查高级默认值和资产来源字段。
4. 运行校验和预检。
5. 把工作流绑定到应用资产或 Standalone 目标。

插件内部工作流是只读的 `plugin_internal`；复制后直接形成归用户所有的 `user` 版本，必须保留完整 Provenance。历史 `plugin_derived` 只允许进入删除或作废审计，运行期不读取。

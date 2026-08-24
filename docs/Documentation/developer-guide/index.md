---
title: 开发者手册
description: GCAC 平台、插件、工作流和证书部署开发入口
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001-平台基础与工程治理
  - specs/004-统一插件平台与厂商扩展治理
  - specs/007-工作流DSL与模板运行管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - backend/src/app.module.ts
  - backend/src/modules/plugins
  - backend/src/modules/workflow-templates
  - backend/src/modules/deployment-inputs
testRefs: []
lastVerified: 2026-08-07
---

# 开发者手册

GCAC 扩展优先使用现有平台合同。新增厂商不能通过宿主增加产品分支、专用页面、任意脚本或旧 Provider Alias 来解决。

## 开发顺序

1. 先确定对象、能力和事实所有者。
2. 复用统一输入、Secret、Artifact、权限和审计合同。
3. 根据能力选择 `agent_plan`、`declarative` 或 `isolated_process`；代码型插件必须进入同 Docker 独立 Plugin Runner，不能在宿主进程动态加载。
4. 为发现、部署、验证和回滚补齐资源和测试。
5. 记录实现状态，不能把模拟测试当成真实外部验收。

继续阅读：[平台扩展基础](/developer-guide/platform)、[自动化平台扩展与证书事件接入](/developer-guide/20260807-%E8%87%AA%E5%8A%A8%E5%8C%96%E5%B9%B3%E5%8F%B0%E6%89%A9%E5%B1%95%E4%B8%8E%E8%AF%81%E4%B9%A6%E4%BA%8B%E4%BB%B6%E6%8E%A5%E5%85%A5)、[插件开发](/developer-guide/plugins/)、[工作流开发](/developer-guide/workflows/)。

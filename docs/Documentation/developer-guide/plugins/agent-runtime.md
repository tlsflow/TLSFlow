---
title: Agent 插件运行时
description: Agent v2 通用执行、权限和签名计划
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/004.2-Agent扩展运行时与宿主厂商中立门禁治理
  - specs/005.3-Agent控制面协议、任务传输与Full Agent发布治理
codeRefs:
  - backend/src/modules/plugins/runtime
testRefs: []
lastVerified: 2026-08-06
---

# Agent 插件运行时

控制面 Plugin 使用 `gcac.agent-plan/v2` 和受控通用原语生成 Agent 计划；产品识别、配置解析和部署语义属于控制面 Plugin，不属于 Agent Core。代码型控制面能力统一使用 `isolated_process`，但只能由 DSL 的 `plugin.action` 步骤调用同一 Docker 内独立 Plugin Runner 执行单个 Action，不能通过宿主进程动态加载或接管 Workflow。Agent-side Plugin 仅在必须调用本机专有 API 时使用独立进程窄接口。

未知 Action、未审批权限、目标不匹配、计划过期、签名无效或路径越界必须在入队前失败关闭。Agent 不根据操作系统名称猜测能力。

Agent 必须只接受四个 v2 方法、类型化原语、Capability Token、Policy Authority 决策和本地策略允许的计划；旧 `agent.atomic_plan.execute`、自由命令和脚本入口运行期拒绝。用户插件发布者密码学验签当前尚未完成，不能把 `USER_SIGNED` 当作可信发布者证明。

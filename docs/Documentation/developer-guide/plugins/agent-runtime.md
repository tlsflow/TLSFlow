---
title: Agent 插件运行时
description: Agent Atomic Runtime、权限和签名计划
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/004.2-Agent扩展运行时与宿主厂商中立门禁治理
  - specs/005.3-Agent控制面协议、任务传输与Full Agent发布治理
codeRefs:
  - backend/src/modules/plugins/runtime
  - backend/src/modules/plugins/builtin-agent-plugins
testRefs: []
lastVerified: 2026-08-02
---

# Agent 插件运行时

Agent 插件使用 `gcac.agent-plan/v1` 和受控原子操作。插件只声明动作、变量、权限、Artifact、回滚和兼容条件，不能携带脚本、解释器或二进制。

未知 Action、未审批权限、目标不匹配、计划过期、签名无效或路径越界必须在入队前失败关闭。Agent 不根据操作系统名称猜测能力。

用户插件发布者密码学验签当前尚未完成，不能把 `USER_SIGNED` 当作可信发布者证明。

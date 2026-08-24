---
title: Agent runtime
description: Agent Atomic Runtime, permissions, and signed plans
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/004.2-Agent扩展运行时与宿主厂商中立门禁治理
  - specs/005.3-Agent控制面协议、任务传输与Full Agent发布治理
codeRefs:
  - backend/src/modules/plugins/runtime
  - backend/src/modules/plugins/builtin-agent-plugins
testRefs: []
lastVerified: 2026-08-02
---

# Agent runtime

Agent plugins use `gcac.agent-plan/v1` and controlled atomic operations. A plugin declares actions, variables, permissions, Artifacts, rollback, and compatibility conditions; it cannot carry scripts, interpreters, or binaries.

Unknown Actions, unapproved permissions, target mismatches, expired plans, invalid signatures, and path traversal must fail closed before queueing. The Agent must not infer capabilities from an operating-system name.

Cryptographic verification of user-plugin publishers is not complete. `USER_SIGNED` must not be treated as proof of a trusted publisher.

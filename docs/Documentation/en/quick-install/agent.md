---
title: Agent onboarding
description: Preparation and checks for Agent-managed devices
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/005-受管与非受管设备管理
  - specs/004-统一插件平台与厂商扩展治理
codeRefs:
  - backend/src/modules/agents
  - backend/src/modules/devices
  - backend/src/modules/liveness
  - backend/src/modules/plugins/builtin-agent-plugins
testRefs: []
lastVerified: 2026-08-02
---

# Agent onboarding

## Before onboarding

- Confirm the Agent platform, network egress, and control-plane address.
- Grant only the actions and paths the Agent actually needs.
- Check the reported Capability and Schema versions; do not infer capabilities from an operating-system name.

## After onboarding

1. Review registration status and the latest liveness signal.
2. Run read-only device discovery.
3. Confirm that plugin resources project product details to the standard Framework, Site, ManagedTarget, and Certificate objects.
4. Confirm that the deployment plugin and workflow sources are enabled and approved.
5. Run preflight before creating a signed Atomic Plan or deployment plan.

An unknown Agent Action must fail closed before it is queued.

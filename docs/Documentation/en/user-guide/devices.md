---
title: Devices and execution channels
description: Agent, agentless targets, Gateway, and standard discovery operations
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/005-受管与非受管设备管理
codeRefs:
  - backend/src/modules/agents
  - backend/src/modules/devices
  - backend/src/modules/device-assets
  - backend/src/modules/gateway-agents
  - backend/src/modules/executors
testRefs: []
lastVerified: 2026-08-02
---

# Devices and execution channels

## Target types

- Agent-managed device: the Agent reports capabilities and standard discovery results.
- Agentless target: target facts come from standard discovery or an agentless channel.
- Gateway-isolated target: a controlled relay reaches a target in an isolated network.

## Operation order

1. Create or register the device or target.
2. Configure the network egress, Gateway, or SSH/Windows/CURL connection.
3. Store a Credential; do not put credentials in a device name or ordinary variable.
4. Run read-only discovery.
5. Review the stable target key, Framework, Site, ManagedTarget, and certificate binding.

Discovery is a read-only projection. A failed child object should not contaminate unrelated objects, but deployment, change, and rollback must fail closed.

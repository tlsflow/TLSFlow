---
title: Agent
description: Onboard, check, and upgrade TLSFlow Agent managed hosts
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/assets/AssetsView.vue
  - backend/src/modules/agents
  - backend/src/modules/devices
testRefs: []
lastVerified: 2026-09-02
---

# Agent

Agent is the management program installed on target hosts. It maintains online status, reports host capabilities, and executes discovery and certificate operations according to tasks issued by the platform.

## Onboard Host

1. Open "Asset Center → Assets" and click "Add".
2. Select the operating system and Agent onboarding method for the target host.
3. Generate installation or registration materials following the wizard, and complete the installation on the target host.
4. Return to the device page and wait for the status to show "Online", confirming that the last heartbeat time is continuously updating.
5. Click "Discover" to check the runtime framework, sites, certificate locations, and capability versions.
6. In the application asset wizard, select compatible targets, complete pre-check before deployment.

> [Placeholder screenshot: Agent platform selection and installation material steps in the device add wizard]
>
> [Placeholder screenshot: Agent device details, highlighting online status, last heartbeat, discovery, and version information]

## Upgrade Agent

1. Find the Agent with an upgrade prompt in the device list and click "Upgrade".
2. Review the current version and target version, confirm that the upgrade time will not affect business operations.
3. Submit the upgrade and wait for the status to return to online; do not repeatedly click or delete the device during the upgrade.
4. After the upgrade is complete, re-run discovery to confirm that the framework and certificate locations are still readable.

The platform only provides released and verified upgrade versions and will not automatically upgrade just because a prompt appears.

## When Offline or Materials Are Compromised

- When the Agent is offline, the platform cannot confirm whether remote tasks have been executed. First check the service status and network on the host, then check the device details.
- If registration information or upgrade materials are compromised, immediately disable the old Agent, regenerate materials, and re-register.
- Gateway is an independent forwarding role; do not use Gateway installation information as an Agent.

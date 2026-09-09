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

An Agent is the management program installed on a target host. After onboarding, the platform can read host capabilities, discover sites and certificate locations, and run certificate tasks within the authorized scope. The Agent does not change business configuration by itself; changes are created and executed from the platform.

## Onboard a host

1. Open **Asset Center** and select **Add Asset**.
2. Select the operating system and Agent onboarding method for the target host.
3. Generate the installation or registration materials, then install and start the Agent service on the target host.
4. Return to Asset Center and wait for the status to show **Online**. Confirm that the last heartbeat keeps updating.
5. Select **Discover** and review the systems, sites, certificate locations and capability versions found by the platform.
6. In the application asset wizard, select compatible targets, review the page messages, and submit the deployment.

## Upgrade Agent

1. Find the Agent with an upgrade prompt in the asset list and select **Upgrade Agent**.
2. Review the current version and target version, confirm that the upgrade time will not affect business operations.
3. Submit the upgrade and wait for the status to return to online; do not repeatedly click or delete the device during the upgrade.
4. After the upgrade is complete, re-run discovery to confirm that the framework and certificate locations are still readable.

The platform only provides released and verified upgrade versions and will not automatically upgrade just because a prompt appears.

## When Offline or Materials Are Compromised

- When the Agent is offline, the platform cannot confirm whether a remote task finished. Check the Agent service and network on the host, then review the asset details.
- If registration information or upgrade materials are compromised, disable the old Agent immediately, generate new materials and register it again.
- A Gateway is a separate forwarding node. Do not use Gateway installation materials to register an Agent.

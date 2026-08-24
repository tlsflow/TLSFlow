---
title: Unmanaged target onboarding
description: Preparation for agentless targets and agentless execution channels
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/005-受管与非受管设备管理
  - specs/006-应用资产、绑定与受管目标管理
codeRefs:
  - backend/src/modules/device-assets
  - backend/src/modules/executors/ssh
  - backend/src/modules/executors/curl
testRefs: []
lastVerified: 2026-08-02
---

# Unmanaged target onboarding

An unmanaged target can use standard discovery, SSH, Windows Remote, or CURL. Agentless does not mean that there is no execution location, and it does not justify a new plugin-binding model.

## Preparation

1. Create or import the target address and connection method.
2. Store the username, password, SSH key, or API credential as a Credential.
3. Identify the Gateway or control-plane network egress.
4. Run read-only discovery and confirm that the target key is stable.
5. Create an `Standalone + Workflow` binding or a managed-target workflow override from the application asset.

New Standalone targets must not create a Standalone PluginBinding. Use `ApplicationAsset + WorkflowExecutionBinding`.

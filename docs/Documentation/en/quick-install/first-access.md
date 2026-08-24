---
title: First access
description: The check order for the first login and target onboarding
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/002-统一安全管理与访问控制
  - specs/005-受管与非受管设备管理
codeRefs:
  - backend/src/modules/security
  - backend/src/modules/agents
  - backend/src/modules/device-assets
testRefs: []
lastVerified: 2026-08-02
---

# First access

## Before onboarding

- A usable tenant and administrator identity exist.
- The administrator has permissions for devices, plugins, certificates, and deployments.
- The network egress for the Agent or agentless channel is known.
- Credentials are stored in Secret/Credential management rather than ordinary variables.

## After onboarding

1. Confirm that the device or target can be queried.
2. Run read-only discovery and review the Framework, Site, ManagedTarget, and certificate-binding projection.
3. Check that discovered certificate locations come from asset facts rather than plugin defaults.
4. Create a deployment plan only after preflight succeeds.

Page status: `in_review`. Real installation and external-system integration are not publishing evidence for this page yet.

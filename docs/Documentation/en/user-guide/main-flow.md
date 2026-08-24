---
title: Device-to-deployment flow
description: The operational path from target onboarding to certificate deployment verification
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/005-受管与非受管设备管理
  - specs/006-应用资产、绑定与受管目标管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - backend/src/modules/device-assets
  - backend/src/modules/assets
  - backend/src/modules/deployment-inputs
  - backend/src/modules/deployment-plans
testRefs: []
lastVerified: 2026-08-02
---

# Device-to-deployment flow

## Main flow

1. Select an Agent-managed device or an agentless target.
2. Run standard discovery and confirm the target key, execution location, certificate location, and compatibility.
3. Create or select an `ApplicationAsset`.
4. Bind the certificate asset and final deployment capability.
5. Configure workflow inputs or select an Agent atomic plan.
6. Run preflight to confirm permissions, credentials, artifacts, and complete inputs. The configuration fingerprint is written to the snapshot, but execution-time re-read comparison is still `TODO`.
7. Create the deployment plan with a fixed input snapshot.
8. Execute the plan and review each step result.
9. Verify with a TLS or service check; use the supported rollback path on failure.

## Four target modes

| Mode | Meaning |
| --- | --- |
| Agentless `DeviceAsset` | Standard discovery or agentless-channel facts; it does not imply an Agent |
| `ManagedTarget + Plugin` | A managed target uses the capability-resolved plugin |
| `ManagedTarget + Workflow Override` | The user explicitly selects a workflow instead of the managed plugin path |
| `Standalone + Workflow` | An unmanaged target uses an independent workflow and does not create a Standalone PluginBinding |

Page status: `in_review`. Real vendor execution results must be accepted in the target environment before this page is promoted.

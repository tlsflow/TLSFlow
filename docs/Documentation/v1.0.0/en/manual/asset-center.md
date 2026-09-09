---
title: Asset Center
description: Asset Center top-level menu and operation map for application assets, devices, cloud service assets, and Gateway
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/router/menu.ts
  - web/src/router/modules/business.ts
  - web/src/views/assets/AssetsView.vue
  - backend/src/modules/assets/controller/assets.controller.ts
testRefs: []
lastVerified: 2026-09-02
---

# Asset Center

The Asset Center manages unified assets and Gateways (network forwarding entries). `/applications` is the application entry, and `/assets` is the unified asset entry for devices, Agent-associated assets, and cloud service instances; the historical route `/devices` is no longer provided. Cloud service assets themselves are `ServiceAsset(assetKind=CLOUD_SERVICE)`, and their executable resources are uniformly abstracted as `ManagedTarget`, not devices or Hosts.

> [Screenshot placeholder: Asset Center homepage showing application assets, devices, Gateway, and "Add Asset" action]

Alibaba Cloud CDN enters through "Add Asset" in the Asset Center, reusing `DeviceOnboardingWizard.vue` and `POST /api/v1/devices/onboarding`; the backend creates `ServiceAsset(CLOUD_SERVICE)` after recognizing cloud service capabilities, then executes connection tests and discovery. It does not use the five-step session of application assets, does not select certificates, and does not create deployment plans. `/providers` is no longer a second-level menu, but the old CloudAccount API still retains compatible implementation.

When cloud resource discovery is needed, first complete cloud service onboarding at the "Add Asset" entry in `/assets`; certificate deployment preparation targets specific `ManagedTarget` for applications.

## How to Distinguish Four Types of Resources

| Resource | Saved Content | When to Use |
| --- | --- | --- |
| Application asset | Business name, domain, environment, certificate, and deployment targets | Create deployment plans and view business status |
| Device | Host/network target, connection method, health status, and discovery results | Provide actual execution location |
| Cloud service asset | Cloud service provider, scope, and access credential reference | Connect to cloud platforms and discover cloud resources |
| Gateway | Network forwarding address and availability status | Relay when targets cannot be directly accessed |

## Recommended Preparation Order

1. Select enabled cloud service plugin.
2. Fill in display name and credential fields declared by the plugin; credentials only save CredentialRef.
3. Submit to compatible device onboarding API, which routes to cloud service onboarding service to create `ServiceAsset(CLOUD_SERVICE)`.
4. Execute read-only connection test and resource discovery, writing to Framework/Site owned by that ServiceAsset.
5. Return to Asset Center to view assets; currently Alibaba Cloud CDN does not create certificate deployment plans.

## Target Selection Decision

| Mode | Applicable Situation |
| --- | --- |
| Device without Agent | Only network connection or standard discovery results, no Agent installed |
| Device default capability | Device has discovered available systems/sites, execute by default method |
| Workflow override | Business explicitly requires custom workflow steps |
| Independent target + workflow | Target does not belong to any managed device, can only connect with separate workflow |

After discovery is complete, prioritize using discovered addresses, ports, service names, and certificate locations; only manually modify when business actually changes. Successful discovery only means target information was read; pre-check and target validation are still required before deployment.

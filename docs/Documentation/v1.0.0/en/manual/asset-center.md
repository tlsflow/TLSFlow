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

Asset Center is the entry point for managed resources. Use it to add devices, view Agent-managed hosts, connect cloud services, and manage Gateways. Application assets are listed under **Asset Center → Applications** and connect a certificate to a specific business endpoint.


## Four resource types

| Resource | Saved Content | When to Use |
| --- | --- | --- |
| Application asset | Business name, address, certificate and deployment target | Update certificates on a website or application |
| Device | Host or appliance, connection method, health and discovery results | Provide an execution location and usable targets |
| Cloud service asset | Cloud platform, service scope and credential reference | Connect to a cloud platform and discover resources |
| Gateway | Network forwarding node and availability | Relay traffic when the platform cannot reach a target directly |

## Recommended preparation order

1. Add a device or cloud service asset and complete its connection test.
2. Run discovery and confirm that the platform can read the available frameworks, sites or cloud resources.
3. When you need to deploy a certificate, create an application asset and select a discovered target.
4. For an isolated network, install and connect a Gateway before selecting it in the device or application connection settings.

### Add an asset

1. Open **Asset Center** and select **Add Asset**.
2. Choose the category and platform, then enter a name, address and the credential reference requested by the page.
3. Wait for the connection test. If it fails, correct the address, network path or credential before continuing.
4. Select **Discover** and review the systems, sites, cloud resources and available capabilities.

Cloud service onboarding is different from application onboarding: it reads cloud resources and does not select certificates or create deployment tasks. Alibaba Cloud CDN is the currently validated cloud service; availability of other providers depends on the support shown in the product.

## Choose a deployment target

| Mode | Applicable Situation |
| --- | --- |
| Device without Agent | The target supports remote connection but has no Agent installed |
| Device default capability | Discovery found a usable system or site; this is usually the preferred choice |
| Workflow override | The business requires custom steps or a special order |
| Independent target and workflow | The target does not belong to a device and needs a separate workflow connection |

Prefer the addresses, ports, service names and certificate locations returned by discovery. Edit them manually only when the business configuration has changed. Successful discovery means only that the platform read the target information; review the page validation before submitting a deployment and complete target validation afterwards.

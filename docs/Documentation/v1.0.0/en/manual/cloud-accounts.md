---
title: Cloud Service Assets
description: Connect cloud services, discover resources, and maintain the connection
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/assets/AssetsView.vue
  - web/src/views/devices/DeviceOnboardingWizard.vue
  - web/src/views/devices/details/ManagedDeviceDetailModal.vue
  - backend/src/modules/providers
  - backend/src/modules/assets
testRefs: []
lastVerified: 2026-09-04
---

# Cloud Service Assets

Cloud service assets connect a cloud provider account or service to TLSFlow and read resources that TLSFlow can manage. They appear alongside servers and network appliances under **Asset Center → Assets**, but they do not represent a host and do not create certificate deployment plans automatically.

Alibaba Cloud CDN is the first cloud service formally accepted for this release. Other providers or products should be treated as unsupported until real connection, discovery, and audit acceptance is complete; an entry in the plugin catalog alone is not production support.


## Before You Start

- Under **System Settings → Credentials**, create an enabled **Cloud provider** credential that matches the provider.
- Confirm that the TLSFlow environment can reach the provider API and that the account has the minimum permissions needed to read the target resources.
- Choose a clear display name, such as `Alibaba Cloud CDN · Production`. The display name identifies the asset; it is not a substitute for the provider account name.

## Add a Cloud Service Asset

1. Open **Asset Center → Assets** and click **Add asset**.
2. Select the cloud service provider. The wizard lists only enabled providers with a complete credential contract.
3. Enter a display name and select or enter the credential reference and other fields required by the provider.
4. Submit and wait for connection testing and resource discovery to finish. Connection testing is read-only and does not modify the cloud platform.
5. Return to the inventory and open the details to confirm the provider, product, region or scope, site count, and latest discovery time.


This onboarding flow does not select a certificate, create an application asset, or deploy a certificate. To use a discovered resource for certificate work, return to **Asset Center → Applications** and follow the application onboarding flow.

## View and Rediscover Resources

Open **View details** for a cloud service asset to review:

- provider and product family;
- account or service region and coverage scope;
- discovered frameworks, sites, and available target counts;
- plugin version, discovery status, and latest discovery time.

Click **Rediscover** in the details window to refresh cloud resources. Rediscovery does not replace the credential or change the cloud platform. After it finishes, treat the latest details as the source of truth.


Alibaba Cloud CDN results are grouped by **China Mainland** and **International** coverage. These labels describe resource coverage, not two separate accounts; the actual sites come from the provider response.

## Edit and Delete

- You can edit the display name, credential reference, and connection fields allowed by the page. An existing asset cannot switch providers; create a new asset when the provider changes and complete connection testing and discovery again.
- After changing a credential, confirm that it is enabled and review its health result under **System Settings → Credentials** before rediscovering.
- Before deletion, confirm that no application asset, automation, or other business flow depends on the cloud service asset. Enter the confirmation text requested by the page. Deleted asset records cannot be restored.

## Troubleshooting

**The provider is missing from the list**
Ask an administrator to enable the required plugin version and confirm that its credential fields load successfully. A catalog or test fixture does not prove production support.

**Connection testing fails**
Check API network access, credential type and status, provider matching, and account permissions. Correct the issue and edit the asset, or run Rediscover from its details.

**Connection succeeds but no resources are found**
Check the account scope, region, and product permissions. TLSFlow displays only resources returned by the provider API and passing resource validation; it does not infer resources from an account name.

**Discovery is stale**
Run **Rediscover** from the details window. If it still fails, review the error and credential health result before contacting the cloud administrator.

Cloud service plugins handle connection testing and resource discovery only. Use Certificate Management, Applications, and Certificate Deployment for certificate issuance, deployment, verification, and rollback.

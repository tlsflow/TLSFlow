---
title: Devices
description: Onboard devices, run discovery, and confirm deployable targets
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/assets/AssetsView.vue
  - backend/src/modules/devices
  - backend/src/modules/agents
testRefs: []
lastVerified: 2026-09-02
---

# Device Assets

Device assets are a category of unified assets, representing hosts or network devices that certificates will ultimately access; Agent is the management channel for devices, cloud service instances are also displayed on the unified asset page but are not disguised as devices. The page entry is fixed at `/assets`.

> [Placeholder screenshot: Device list, highlighting device name, management method, address, health status, version, and action buttons]

## Add and Discover Devices

1. Go to "Asset Center → Assets" and click "Add".
2. In the wizard, select the access platform and management method: install Agent or use the direct connection method provided on the page.
3. Fill in the device name, management address, port, TLS settings, and saved credentials according to the page prompts.
4. Submit the wizard and wait for the device record to be created; Agent access methods will display installation or registration materials.
5. Return to the device list and confirm the health status is normal or the Agent is online.
6. Open the device action menu, run "Connection Test" first, then run "Discovery" after success.
7. Open the discovery results and confirm the system, sites, services, certificate locations, and available capabilities item by item.
8. In the application asset wizard, only select targets with normal status and matching application types.

Connection test only verifies that the current address and login information are usable; discovery actually reads sites, services, and certificate locations. Successful discovery does not mean certificates have been deployed.

## View and Maintain

- Use category, management method, and health status filters to quickly locate abnormal devices.
- Click the device name to view overview, framework, sites, certificates, and operation records.
- Before deleting a device, confirm that no application assets or deployment plans continue to use it.
- When an "Upgradeable" prompt appears, first check the current version and target version, confirm the maintenance window, then execute the upgrade.

## Common Issues

- **Connection test fails**: Check address, port, TLS verification, and credentials, correct and retest.
- **Discovery has warnings**: Complete site or certificate location information according to the warning content, then re-discover.
- **Device online but not deployable**: Check target compatibility and capability status; do not rely solely on "online" status.
- **Gateway devices**: Gateway only handles cross-network forwarding; you still need target devices that can execute certificate operations.

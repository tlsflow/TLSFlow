---
title: Devices
description: Onboard devices, review discovery results, and confirm usable targets
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/assets/AssetsView.vue
  - web/src/views/devices/DeviceOnboardingWizard.vue
  - web/src/views/devices/details/ManagedDeviceDetailModal.vue
  - backend/src/modules/devices
  - backend/src/modules/agents
testRefs: []
lastVerified: 2026-09-04
---

# Devices

Devices are the entry point for connecting TLSFlow to servers, network appliances, and security appliances. After a device is onboarded, TLSFlow can read its system information, sites, services, and certificate locations for use by application assets and deployment tasks.

Open **Asset Center → Assets** to manage devices. Devices and cloud service assets share the same inventory. Filter by device category and management method; an online status alone does not mean that a target is ready for deployment.


## Before You Start

Confirm the following:

- The management address and port are reachable from the TLSFlow network.
- A matching credential exists under **System Settings → Credentials**. Passwords, private keys, and tokens are never shown in the device list.
- You know the target product and the planned maintenance window. Use a test device for the first connection when possible.
- For Agent onboarding, the target host can reach the TLSFlow Agent endpoint and you have permission to install services.

## Add a Device

1. Open **Asset Center → Assets** and click **Add asset**.
2. Select the target platform or an enabled device plugin. The wizard shows the support status; only supported platforms can be submitted.
3. Enter the device name, management address, port, connection protocol, TLS verification settings, and credential reference. Plugin platforms may show additional fields.
4. Review the values and submit.

### Onboard with an Agent

When you select an Agent platform, the wizard generates a one-time installation command and an expiry time. Copy the command and run it on the target host with an account that can install the Agent. Do not post the command or registration material in tickets, screenshots, or chat channels. Return to the inventory after installation and wait for the Agent to come online.


### Use a Direct Connection or Plugin

After you enter the requested connection details, TLSFlow verifies the address, credentials, and product identity during submission. The result page shows whether the connection succeeded and, when applicable, an error code. Connection testing is read-only and does not change the target.


## Run Discovery

After the device is online or the connection test succeeds, open the device actions menu, choose **View details**, and click **Rediscover**. Discovery reads the frameworks, sites, services, certificates, and capabilities that actually exist on the target.

Review these sections in the details window:

- **Overview**: product, operating system, management method, and last contact;
- **Frameworks and sites**: addresses, ports, protocols, and associated products;
- **Certificates**: certificates detected on the target, validity, and fingerprints;
- **Logs**: connection, discovery, and other device operation results.


A successful discovery means that TLSFlow read the target information; it does not mean a certificate was deployed. When creating an application asset, choose a discovered target that is available and matches the application type. Deployment still requires the page validation and result verification.

## Maintain Devices

- Filter by category, management method, and health status. Address devices marked unreachable, degraded, or unknown first.
- If the address, port, or credential changes, edit the device and run connection testing and discovery again before starting deployment.
- **Rediscover** refreshes asset facts only. It does not replace certificates or change the target configuration.
- When an upgrade action is available, confirm the current version, target version, and maintenance window. Afterward, verify that the Agent is online and discovery is current.
- Before deleting a device, confirm that no application asset, workflow, or automation references it. Deletion affects future target selection and cannot be recovered from the inventory.

## Troubleshooting

**Connection test fails**
Check the management address, port, TLS verification, and credential status. For private networks, make sure TLSFlow or a Gateway can reach the target network.

**The Agent is installed but remains offline**
Check that the installation command has not expired, the host can reach the Agent endpoint, and the Agent service is running. Generate a new command when it expires; do not reuse old registration material.

**Discovery is empty or contains warnings**
Resolve the connection error and run discovery again. The details page only shows resources the target plugin can actually read; entering guessed paths does not create discovery facts.

**The device is online but cannot be selected for deployment**
Online means only that recent communication succeeded. Check compatibility, discovery results, and the required capabilities before selecting the target in the application wizard.

**How should a Gateway be used?**
A Gateway forwards traffic across networks; it is not the certificate deployment target. You still need a target device that can perform the certificate operation.

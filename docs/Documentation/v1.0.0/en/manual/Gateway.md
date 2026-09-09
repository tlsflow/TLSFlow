---
title: Gateway
description: Manage Gateway network forwarding nodes and view their status
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/gateways/GatewaysView.vue
  - backend/src/modules/gateways
testRefs: []
lastVerified: 2026-09-02
---

# Gateway

A Gateway is a forwarding node deployed in an isolated network. It relays connections when the control plane cannot reach a target directly. It does not install certificates and cannot replace the Agent on the target host.

## Install a Gateway

1. Go to **Asset Center → Gateway** and select **Add Gateway Agent**.
2. Select the runtime platform (Linux or Windows).
3. Enter the service region. To restrict forwarding, also enter the allowed target addresses and ports.
4. Click "Generate Installation Materials" and complete the installation on the target host according to the instructions in the popup.
5. After installation, return to the list and wait for the status to become **Online**. Confirm that the last heartbeat is updating normally.


## View Status and Use for Connection

1. Click the Gateway name to open details, viewing connection status, region, current task count, available capacity, success rate, and last contact time.
2. In device or application connection configuration, select this Gateway as the forwarding node.
3. Run a connection test first, then perform discovery; confirm the target is reachable before creating application assets or submitting deployment.
4. You can quickly access associated application assets and execution records from the details.

When a Gateway is offline, dependent connections, discoveries and deployments may fail or remain pending. Restore the Gateway first, confirm the target device status, and retry. The current version does not provide automatic failover or clustering.

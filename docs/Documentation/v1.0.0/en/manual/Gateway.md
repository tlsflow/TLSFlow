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

Gateway is a forwarding node deployed in isolated networks. It helps the platform access devices that cannot be directly connected, but it does not install certificates and cannot replace the Agent on the target host.

## Install Gateway

1. Go to "Asset Center → Gateway" and click "Add Gateway Agent".
2. Select the runtime platform (Linux or Windows).
3. Fill in the service region; if you need to restrict the forwarding scope, also fill in the allowed target addresses and ports.
4. Click "Generate Installation Materials" and complete the installation on the target host according to the instructions in the popup.
5. After installation, return to the list and wait for the status to become online, confirming that the last heartbeat time is normal.

> [Placeholder screenshot: Gateway installation material popup, highlighting platform, region, allowed targets/ports, and generate button]

## View Status and Use for Connection

1. Click the Gateway name to open details, viewing connection status, region, current task count, available capacity, success rate, and last contact time.
2. In device or application connection configuration, select this Gateway as the forwarding node.
3. Run a connection test first, then perform discovery; confirm the target is reachable before creating application assets or submitting deployment.
4. You can quickly access associated application assets and execution records from the details.

When the Gateway is offline, connections, discoveries, and deployments that depend on it may fail or wait. Restore the Gateway first, then confirm the target device status and retry. The current version does not provide automatic failover or cluster capabilities.

> [Placeholder screenshot: Gateway detail popup, highlighting online status, region, load, capacity, success rate, and last heartbeat]

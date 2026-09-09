---
title: "Dashboard"
description: "Review TLSFlow v1.0.0 certificates, assets, execution, and audit status"
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs: []
testRefs: []
lastVerified: 2026-09-02
---

# Dashboard

The dashboard is the daily starting point. It brings certificates, application assets, connection status, Gateways, system resources, execution results and audit activity into one view so you can find what needs attention before opening a detail page.

## How to read the page

- **Core metrics**: Counts valid and expiring certificates, applications, online Agents and online Gateways. Select a metric to open the related list.
- **System resources**: Shows CPU and memory usage for the dashboard host. A missing value means that no sample is available yet; it does not by itself indicate a host failure.
- **Run trends**: Shows audit success rate, managed-object health and certificates requiring attention, helping you spot changes over time.
- **Asset status**: Groups certificates, assets, Gateways and application assets by normal, attention, error or unknown. Hover over a color block to see the object name and status details.
- **Recent audit logs**: Prioritizes failures, rejections, high-risk actions and important changes. Open the related execution record or object details to investigate.


## Recommended daily review

1. Resolve **Error** and **Attention** states before handling certificates that are nearing expiration.
2. Select the metric or status block to open the object details and read the reason.
3. For a change to an application, open **Certificate Deployment**, review the page messages, and submit it. A submitted request is not proof that the target was updated.
4. Confirm completion, target readback and verification in the recent audit log and execution record.
5. Select **Refresh** when finished to confirm the data changed. Refresh only reads data; it does not execute a deployment.

## Empty or unknown states

- **No objects**: The current tenant has no corresponding certificates, assets or applications yet. Complete asset onboarding first.
- **Metrics do not change**: Refresh the page and check filters. Counts update after background operations finish.
- **Status remains unknown**: Open the object details and check the last heartbeat, connection test and discovery time.
- **Entry unavailable**: The usual causes are permissions or missing prerequisites. Ask an administrator to check tenant permissions and plugin status.

The dashboard helps you find work; it does not replace execution records, target verification or audit logs. For certificate changes, use those pages to confirm the final result.

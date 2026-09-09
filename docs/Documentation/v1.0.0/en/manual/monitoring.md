---
title: Monitoring
description: View certificates, targets, TLS, deployment risks, and notification delivery
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/monitoring/MonitorsView.vue
  - backend/src/modules/monitors
  - backend/src/modules/notifications
  - backend/src/modules/reports
testRefs: []
lastVerified: 2026-08-22
---

# Monitoring

Monitoring continuously observes application accessibility, the certificate currently served by a site, access latency, certificate changes and risk events. It collects and displays facts only; it does not automatically change certificates or target configuration.

## Adding Monitor Targets

1. Navigate to "Monitoring" and click "Add Monitor".
2. In the application asset dropdown, select the target to observe. The list displays both asset name and access address to avoid selecting the wrong environment.
3. Set "Detection Frequency". Unit is seconds, minimum value is 10 seconds; for production sites, it's recommended to configure based on traffic volume and maintenance requirements without setting too frequent for real-time pursuit.
4. Read the default monitoring scope (accessibility, access latency, certificate information, and certificate history), and click "Add".
5. After successful addition, the target will appear in the "Monitor Targets" list on the left.


## Finding and Detecting Targets

1. Use the "Application Asset" search box to enter name or keyword to quickly narrow down the target list.
2. Use the status dropdown to filter by normal, warning, error, pending, or removed; click "Clear Filters" to restore all targets.
3. Click "Detect Site" to immediately detect the current monitor target. Do not close the page or repeatedly click during detection.
4. Click "Refresh Data" to reload results and update risk information. When there are many targets, continue scrolling the left list to load more.


## Reading Target Details

After clicking a target on the left, the right side displays the current target and the following information:

- "Accessibility" and "Access Latency": Determine whether the site is currently accessible and response speed.
- "Current Site Actual Certificate": View fingerprint, subject, issuer, serial number, validity period, chain verification result, and collection time.
- "Bound Certificate Versions": Retain history based on actual certificate changes to help confirm whether the site has switched to the target version.
- "Risk Events": View certificate chain, domain, fingerprint, or execution status-related warnings, along with occurrence and closure times.
- "Detection History": View the last 20 detections' time, source, status, latency, and results, and observe fluctuations through trend charts.

If the current target needs frequency adjustment, modify the seconds at the top of details; click "Remove" when no longer needed. Removal only stops monitoring for this target and does not delete application assets or certificates.


## Viewing TLS Deep Scan Results

In target details, click "View Details" next to the TLS score to open TLS deep scan. View according to page tabs:

1. Certificate Authentication Path: Confirm whether site certificate, chain certificates, and trust path are complete.
2. Protocol Support: Check whether TLS versions meet business client requirements.
3. Cipher Suites: View available cipher suites under different protocols.
4. Client Compatibility Simulation: Understand handshake results under common client profiles.
5. Protocol Details: View detected handshake and protocol parameters.
6. Click "Re-detect" to get latest results; after detection completes, assess risk based on new score.


When the page displays "Partial Results" or "Not Supported", first check the specific description and detection snapshot for that item. It may indicate current detection scope is limited, missing corresponding trust root, or client profile cannot be simulated; it cannot be directly treated as certificate untrusted.

## Handling Risks and Notification Integration

Risk status discovered by monitoring, notification delivery, and certificate deployment results are three independent pieces of information. Notification delivery failure does not change completed deployments, and deployment failure does not automatically mark risks as resolved. When handling risks, first confirm site actual certificate and deployment execution results, then close or continue tracking risks according to organizational procedures; to view notification reasons, go to "System Settings → Notifications" delivery records.


## Considerations When Evaluating Results

- Monitoring results are observations at a specific moment; a single timeout should be evaluated in conjunction with detection history to determine if it occurs continuously.
- "Certificate status normal" only means the certificate and chain verification detected this time are normal; it does not represent compatibility with all clients.
- When discovering the site still uses an old certificate, first check deployment execution records, then re-detect; do not directly modify certificates on the monitoring page.

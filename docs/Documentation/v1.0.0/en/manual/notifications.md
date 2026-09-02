---
title: Notifications
description: Configure notification channels, routing, templates, silencing, and delivery retry
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/settings/NotificationsView.vue
  - backend/src/modules/notifications
testRefs: []
lastVerified: 2026-08-22
---

# Notifications

Notification management is used to configure message delivery channels, determine which events are sent where, unify message styles, and temporarily silence during maintenance windows. After entering "System Settings → Notifications", you can switch between three tabs: "Notification Channels", "Delivery Records", and "Rules & Templates".

## Configuring Private Deployment Platform Addresses

When using private deployments of WeCom, Feishu, or DingTalk, first fill in the allowed access addresses in the corresponding private deployment Origin text boxes at the top of the page, one per line, such as `https://notify.example.internal`, then click "Save Settings". Only fill in protocol, host, and optional port here; do not include paths, query parameters, account information, or complete bot URLs. Without first adding to the whitelist, subsequent testing and delivery will be rejected.

Screenshot placeholder: "Private Deployment Platform Addresses" settings section at top of notification management page, showing three Origin input boxes and "Save Settings" button.

## Creating and Testing Notification Channels

1. In the "Notification Channels" tab, click "Create Notification Channel", fill in the channel name and select type: Email, WeCom, Feishu, DingTalk, Slack, Telegram, or Generic Webhook.
2. Fill in required information according to channel type:
   - **Email**: SMTP host, port, sender address, connection encryption method; username and password must be filled in together.
   - **WeCom/Feishu/DingTalk/Slack**: Paste the corresponding bot webhook; for Feishu and DingTalk, if signature verification is enabled, also fill in the signing secret; if using private deployment, complete Origin whitelist first.
   - **Telegram**: Fill in Bot Token, Chat ID, optionally fill in Topic ID.
   - **Generic Webhook**: Fill in complete URL, HTTP method (POST, PUT, or PATCH), enter valid JSON for fixed request headers if needed, optionally fill in signing secret.
3. Click "Confirm Create". Tokens, passwords, and signing secrets in secret input boxes will be encrypted and saved; they will not be displayed in plaintext again after creation, so confirm accuracy before submission.
4. In the channel card, click "Test". Email tests require filling in recipient address; other channels use configured targets. Enable business routing after confirming test message is received.
5. To temporarily disable a channel, click "Disable"; click "Enable" before resuming delivery.

Screenshot placeholder: Create notification channel dialog showing type selection, fields that change by type, secret input prompts, and "Confirm Create".

## Creating Notification Routes

1. Switch to "Rules & Templates" and click "Create Notification Route".
2. Fill in route name and select a successfully tested notification channel.
3. Fill in event source to determine which events to receive; set route priority—numbers more aligned with organizational conventions should be processed first.
4. Set deduplication window (seconds) to avoid repeated delivery of the same event in a short time.
5. Click "Confirm Create", then check status and associated channel in the route list.

Screenshot placeholder: Create notification route dialog showing name, channel, event source, priority, and deduplication window.

## Customizing Templates and Silence Rules

### Notification Templates

Click "Create Notification Template", fill in template key, title template, and body template. Template keys should remain stable for subsequent route reuse; before saving, verify that title and body are understandable on mobile devices.

### Silence Rules

1. Click "Create Silence Rule", fill in name and silence reason.
2. Fill in event source along with start time and end time, using browser local time.
3. After saving, confirm rule status and effective period in the list. After the maintenance window ends, notifications will resume normal delivery.

Screenshot placeholder: Rules & Templates tab showing notification template list and silence rule effective time.

## Viewing Delivery and Handling Failures

1. Switch to "Delivery Records" and view recent delivery status, request ID, latency, and failure classification by channel.
2. For failed records, first check request ID, response status, and retry count to determine whether it's address unreachable, credential expiration, or target service rejection.
3. After fixing network, bot configuration, or secrets, click "Retry Delivery". Do not repeatedly create certificate deployment tasks due to notification failures; certificate deployment results need separate verification in execution records.
4. Successful notification delivery only means the message has been handed to the target channel; it does not mean recipients have read it. Important changes should still be documented in business tickets.

Screenshot placeholder: Delivery records list showing success/failure status, request ID, failure classification, and "Retry Delivery" button.

## Security Notice

Webhook URLs, Bot Tokens, SMTP passwords, and signing secrets are all sensitive information; only paste them into corresponding secret input boxes, and do not write them into notification templates or screenshots. Private deployment addresses must be trusted HTTPS Origins; enable routing after successful testing to avoid sending test content to real users with incorrect configurations.

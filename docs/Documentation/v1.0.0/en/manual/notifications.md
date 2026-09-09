---
title: Notifications
description: Configure notification events, message templates, delivery channels and delivery status
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/settings/NotificationsView.vue
  - backend/src/modules/notifications
testRefs: []
lastVerified: 2026-09-04
---

# Notifications

Notifications send certificate status, renewal results, reports and binding-drift events to the people who need to act. Open **System Settings → Notifications** to switch between **Events**, **Templates**, **Channels** and **Delivery Records**.

## Recommended setup order

1. Create and test a delivery channel in **Channels**.
2. Review the message title, body and variables in **Templates**; create or edit a template only when needed.
3. Return to **Events**, choose a template and channel for the events you need, and enable the route.
4. Check actual delivery in **Delivery Records**. A successful notification only means that the channel accepted the message; verify deployment outcomes in Execution Records.


## Configure a delivery channel

1. Open **Channels**, select **Create Notification Channel**, and enter a name and type: Email, WeCom, Feishu, DingTalk, Slack, Telegram or Generic Webhook.
2. Enter the connection details for the selected type:
   - **Email**: SMTP host, port, sender address and STARTTLS or SSL/TLS. Username and password must be provided together or both left empty.
   - **WeCom, Feishu, DingTalk, Slack**: Bot webhook; Feishu and DingTalk may also use a signing secret.
   - **Telegram**: Bot Token and Chat ID, with an optional message Topic ID.
   - **Generic Webhook**: Full URL, POST/PUT/PATCH method, and optional JSON request headers and signing secret.
3. For private WeCom, Feishu or DingTalk deployments, enter a trusted HTTPS Origin in the corresponding field, for example `https://notify.example.internal`. Enter only the scheme, host and optional port; do not paste a complete bot URL.
4. Select **Confirm Create**. Passwords, tokens, webhook URLs and signing secrets are stored as encrypted Secrets and are not shown in plaintext again.
5. Select **Test** on the channel card. Email tests require a recipient address; other channels use their saved target. Enable event routes only after the test message is received.


## Configure event routes

1. Open **Events** and choose a certificate event, such as renewal result, certificate status, report, expiry warning, expired, revoked, binding drift or report failure.
2. Select **Configure** or **Edit**, then enter a route name, a tested channel, a template and a priority. Priority determines the order when more than one route matches; follow your organization's convention.
3. Select **Confirm Create**. Return to the event list and verify the template, channel and status.
4. During maintenance or a temporary incident, select **Disable**. Select **Enable** when delivery should resume. The current page has no separate silence-rule editor; disabling the route or channel is the supported control.


## Edit and preview templates

In **Templates**, select **Create Notification Template** or **Edit**. Keep the template key stable and enter the title and body. Variables use <span v-pre><code>{{variable}}</code></span> format. Review the required variables shown by the page, then select **Preview** to confirm that the message is readable on a phone. A disabled template is not sent by routes that reference it.


## Review delivery and handle failures

1. Open **Delivery Records** and filter by All, Failed, Retrying, Queued or Delivered.
2. Review event type, channel, template, attempt count, failure category and next attempt time. Times are shown in your browser's local time.
3. Open **Details** to inspect each attempt and the outbox record. Determine whether the cause is an unreachable endpoint, an expired Secret or a rejection by the target service.
4. After correcting the configuration, select **Retry** on the failed record. Do not create another certificate deployment task just because notification delivery failed; verify the deployment separately in Execution Records.


## Security notice

Webhook URLs, Bot Tokens, SMTP passwords and signing secrets are sensitive. Enter them only in the matching Secret fields; never put them in templates, notes, tickets or screenshots. Private deployment addresses must be trusted HTTPS Origins. Enable production routes only after a successful test.

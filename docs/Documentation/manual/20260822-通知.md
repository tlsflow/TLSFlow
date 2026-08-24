---
title: 通知
description: 配置通知渠道、路由、模板、静默和投递重试
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/009-运营自动化、监控与系统配置管理
codeRefs:
  - web/src/views/settings/NotificationsView.vue
  - backend/src/modules/notifications
testRefs: []
lastVerified: 2026-08-22
---

# 通知

进入“系统设置 → 通知”，按“渠道 → 路由 → 模板 → 静默”配置。

1. 新建 Email、Webhook、企业微信、飞书、钉钉、Slack 或 Telegram 渠道，保存 Secret 引用。
2. 使用“测试”验证渠道，再创建按事件、风险或租户范围匹配的路由。
3. 需要自定义内容时保存通知模板；维护窗口可创建静默规则。
4. 在投递列表查看状态、请求 ID 和失败原因，失败投递可执行重试。

私有部署渠道需要先配置允许的来源地址。通知发送失败不会回滚已经完成的证书部署，必须在执行记录中单独处理。

投递失败时先查看请求 ID、响应状态和重试次数；外部 Webhook 或机器人地址不可达时，修复网络或凭据后再重试投递，不要重复创建证书部署任务。

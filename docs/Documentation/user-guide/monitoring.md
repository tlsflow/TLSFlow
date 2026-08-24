---
title: 监控、通知与报表
description: GCAC 证书风险、通知投递和报表操作
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/009-运营自动化、监控与系统配置管理
codeRefs:
  - backend/src/modules/monitors
  - backend/src/modules/notifications
  - backend/src/modules/reports
testRefs: []
lastVerified: 2026-08-02
---

# 监控、通知与报表

## 运营顺序

1. 选择证书、目标或应用资产作为监控对象。
2. 配置到期、连接、TLS 或部署结果风险规则。
3. 设置通知渠道和投递策略。
4. 查看最近探测、风险状态、通知结果和报表。

监控页面展示的是运营结果，不替代部署执行日志。通知失败要从投递记录和审计信息排查。

## 当前限制

监控目标调度尚无跨实例租约证据，不能在文档中承诺多实例不会重复探测。

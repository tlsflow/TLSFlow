---
title: 插件安全与能力成熟度
description: 插件发布、权限、外部验收和缺口状态
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/004-统一插件平台与厂商扩展治理
  - specs/006.2-受管目标上下文与应用执行配置管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - backend/src/modules/plugins/promotion/plugin-promotion.service.ts
  - backend/src/modules/plugins/application/plugin-workflow-publisher.service.ts
testRefs: []
lastVerified: 2026-08-06
---

# 插件安全与能力成熟度

## 发布门禁

- Manifest、资源、包哈希和版本不可变。
- 权限、网络、Secret、Artifact 和设备写入必须审批。
- 日志、审计、快照和错误必须脱敏。
- 不允许宿主按厂商字符串增加 Driver、Executor、Projector 或页面分支。
- 普通插件默认不执行代码；携带代码的 `TRUSTED_JS` 插件在进入运行时之前，还必须单独通过“未知代码执行”授权。
- `TRUSTED_JS` 只允许受信任签名插件进入装配候选；插件代码只能通过宿主显式开放的 Host API 访问凭据、制品、锁、审计和检查点，不得直接访问数据库或宿主文件系统。

## 成熟度标记

| 能力 | 当前状态 |
| --- | --- |
| Manifest Schema 和资源校验 | `implemented` |
| Workflow 发布规范化内容哈希 | `implemented` |
| 未知代码执行授权门禁 | `in_review` |
| Trusted JS Runtime 门禁与 Host API 白名单 | `in_review` |
| 用户插件可信发布者密码学验签 | `todo` |
| Promotion 显式双模式归集 | `todo` |
| 执行前 `configFingerprint` 复核 | `todo` |
| 真实厂商部署和回滚 | `in_review` |
| Gateway、产品版本和执行位置外部验收 | `in_review` |
| Citrix `allowInsecure: true` 的审批/审计门禁 | `in_review` |

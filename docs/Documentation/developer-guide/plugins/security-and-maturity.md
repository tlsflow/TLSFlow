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
- 声明式插件和 Agent Plan 插件不执行任意代码；代码型插件只能以 `isolated_process` 模式由同一 Docker 内独立 Plugin Runner 执行，并且必须通过代码执行授权、签名、Policy Authority、Grant 和 Host API 门禁。
- Plugin Runner 不是 OS 沙箱。插件代码不得直接访问数据库、Repository、宿主文件、环境变量或 Agent；所有对象、凭据、制品、锁、审计、网络和 Agent 能力都必须通过登记的 Host API 请求。

## 成熟度标记

| 能力 | 当前状态 |
| --- | --- |
| Manifest Schema 和资源校验 | `implemented` |
| Workflow 发布规范化内容哈希 | `implemented` |
| 代码型插件执行授权门禁 | `in_review` |
| Plugin Runner 生命周期与 Host API 白名单 | `in_review` |
| 用户插件可信发布者密码学验签 | `todo` |
| Promotion 显式双模式归集 | `todo` |
| 执行前 `configFingerprint` 复核 | `todo` |
| 真实厂商部署和回滚 | `in_review` |
| Gateway、产品版本和执行位置外部验收 | `in_review` |
| Citrix `allowInsecure: true` 的审批/审计门禁 | `in_review` |

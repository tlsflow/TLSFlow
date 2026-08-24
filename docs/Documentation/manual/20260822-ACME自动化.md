---
title: ACME 自动化
description: 配置 ACME 提供商、账户和证书申请任务
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/003-证书资产与CA生命周期管理
codeRefs:
  - web/src/views/acme/AcmeOperationsView.vue
  - backend/src/modules/internal-ca
testRefs: []
lastVerified: 2026-08-22
---

# ACME 自动化

ACME（自动化证书管理环境）用于向公有或私有 ACME CA 申请和续签证书。

## 配置提供商

1. 进入“证书管理 → ACME 自动化”，打开“提供商设置”。
2. 选择内置提供商或自定义 CA，填写目录地址和联系邮箱。
3. 如果页面要求外部账户绑定（EAB），先执行目录探测，再在账户区域保存 EAB 标识和密钥。
4. 保存后确认提供商状态为可用。

## 申请和续签

点击“新增”，填写域名、挑战方式、提供商和账户，提交后在任务列表查看 `scheduled`、`issuing`、`failed` 等状态。成功后证书资产会出现新的证书版本；失败时先查看任务详情中的 CA 响应和凭据引用。

页面支持编辑、查看详情和删除。正在运行的任务不能删除；不要通过删除资产来中止续签。

## 凭据和事件

DNS Provider（DNS 服务商）凭据、EAB（外部账户绑定）密钥和账户密钥必须从“系统设置 → 凭据”引用。ACME 成功生成新版本后会产生证书新版本事件；“证书部署 → 自动化”可以按该事件创建部署计划。运行详情会固定这次事件的 `certificateVersionId`，不会在审批等待期间改用后来产生的版本。

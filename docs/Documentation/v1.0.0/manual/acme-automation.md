---
title: ACME 自动化
description: 配置 ACME 提供商，申请并自动续签证书
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - web/src/views/acme/AcmeOperationsView.vue
  - web/src/views/acme/AcmeCertificateRequestModal.vue
  - backend/src/modules/internal-ca
testRefs: []
lastVerified: 2026-09-04
---

# ACME 自动化

ACME（Automatic Certificate Management Environment）用于自动申请和续签公开或企业 CA 证书。页面顶部会显示托管证书、运行中任务、失败任务和当前提供商状态。


## 配置提供商

1. 打开“证书管理 → ACME 自动化”，选择“提供商设置”。
2. 选择内置 Profile 或自定义 CA，填写显示名称；需要时填写 Directory URL。
3. 根据页面提示选择信任链凭据，并点击“探测 Directory”。探测结果会告诉你是否需要 EAB（External Account Binding，外部账户绑定）。
4. 如需 EAB，先在凭据区域创建或选择 EAB 密钥，再保存提供商；填写联系邮箱后，平台会为 ACME Account 关联该邮箱。
5. 回到提供商列表，运行“测试连接”，确认状态可用后再创建申请。


## 申请证书

1. 点击“新增申请”，填写证书名称、主域名和其他域名。
2. 选择提供商、密钥类型和验证方式：`HTTP-01`、`DNS-01` 或 `TLS-ALPN-01`（以当前提供商支持项为准）。
3. 使用 `DNS-01` 时，选择 DNS Provider、凭据和传播等待时间。
4. 设置自动续签开关和提前续签天数，提交申请。
5. 在订单和任务区域查看排队、验证、签发、部署或失败状态。签发成功后，证书资产会新增一个版本。


## 续签、重试和取消

- 在证书列表中可以手动续签，或修改续签策略的启用状态和提前天数。
- 在续签任务中点击“扫描”可立即发现进入续签窗口的证书。
- 失败任务先打开详情查看原因，修正提供商、DNS 或凭据后再点击“重试”。
- 运行中的任务可以取消，但不能通过删除证书资产来中止任务；删除 ACME 配置前先确认没有运行中任务。

续签任务会固定使用创建时的提供商和域名配置。新版本产生后，后续部署是否自动执行取决于关联的部署自动化规则。

## 常见问题

- Directory 探测失败：检查地址、网络和信任链凭据。
- EAB 校验失败：确认 Key ID、HMAC 密钥和提供商要求一致。
- DNS 验证失败：检查 DNS Provider、凭据权限和传播等待时间。
- 任务长时间停留：先看订单当前阶段和最近错误，再决定等待、重试或取消；不要重复创建同一域名申请。

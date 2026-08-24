---
title: 证书资产
description: 在证书管理中导入、查看和维护证书版本
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/003-证书资产与CA生命周期管理
codeRefs:
  - web/src/views/certificates/CertificatesView.vue
  - backend/src/modules/certificates
testRefs: []
lastVerified: 2026-08-22
---

# 证书资产

## 导入证书

1. 进入“证书管理 → 证书资产”，点击“导入证书”。
2. 选择证书来源并填写证书、私钥和可选中间证书链；私钥只在受控表单中提交。
3. 提交后等待解析完成，确认域名、签发者、生效时间、到期时间和状态。
4. 回到列表检查新版本。导入生成新版本，不会覆盖历史版本。

## 查看和清理

点击证书资产可查看版本、应用使用关系和部署状态。删除版本前先确认没有应用资产或部署计划引用；页面会在删除前提示风险。删除证书版本不会删除已写入目标的历史文件。

ACME 或外部 CA 产生的新版本也会回到此列表。自动化部署应在执行记录中确认具体版本，不要只看“当前最新”。

## 版本和制品检查

打开版本详情时，至少核对以下字段：`notBefore`（生效时间）、`notAfter`（到期时间）、Subject（证书主体）、SAN（主题备用名称）、签发者、证书链和 SHA-256 指纹。名称相同不代表材料相同，更新前应以指纹和域名集合确认版本。

平台宿主可以根据证书版本生成 PEM、PFX/P12、JKS、P7B/P7C/SPC 制品。PFX/P12 和 JKS 包含匹配私钥，P7B/P7C/SPC 只包含叶子证书和证书链、不包含私钥；插件只消费已授权制品，不负责生成或加密容器。导入 P7B 类证书时，必须另提供与叶子证书匹配的私钥。

---
title: 证书资产与 CA
description: GCAC 证书资产、版本、格式、制品和 CA 操作
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/003-证书资产与CA生命周期管理
codeRefs:
  - backend/src/modules/certificates
  - backend/src/modules/internal-ca
testRefs: []
lastVerified: 2026-08-02
---

# 证书资产与 CA

## 证书资产操作

1. 创建证书资产并确认租户归属。
2. 导入或签发一个不可变的证书版本。
3. 检查 `notBefore`、`notAfter`、Subject、SAN 和 SHA-256 指纹。
4. 根据部署目标生成统一 Artifact，不在应用资产中复制私钥内容。
5. 将证书版本绑定到应用资产或部署输入。

## CA 操作

CA、信任域和签发节点有独立生命周期。禁用或退休 CA 前，先查找仍在使用的证书版本和绑定。

## 常见错误

- 只看名称判断证书是否相同：应优先使用真实 SHA-256 指纹。
- 把到期时间当作生效时间：两个时间都必须保存和展示。
- 把 PFX 密码写入普通变量或日志：应使用 Credential/Secret 引用。

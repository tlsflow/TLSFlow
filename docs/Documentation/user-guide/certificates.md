---
title: 证书资产与 CA
description: GCAC 证书资产、版本、格式、制品和 CA 操作
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/003-证书资产与CA生命周期管理
  - specs/003.1-证书资产、格式与制品租户隔离治理
codeRefs:
  - backend/src/modules/certificates
  - backend/src/modules/internal-ca
testRefs: []
lastVerified: 2026-08-15
---

# 证书资产与 CA

## 证书资产操作

1. 创建证书资产并确认租户归属。
2. 导入或签发一个不可变的证书版本。
3. 检查 `notBefore`、`notAfter`、Subject、SAN 和 SHA-256 指纹。
4. 根据部署目标生成统一 Artifact，不在应用资产中复制私钥内容。
5. 将证书版本绑定到应用资产或部署输入。

## 宿主证书容器

PFX/P12 和 JKS 由 GCAC 宿主直接生成。每个容器都包含叶子证书、完整证书链和匹配私钥；密码只通过 Secret 引用保存和解析。系统在生成后用同一密码回读容器，错误密码无法解包。

P7B/P7C/SPC 也由宿主直接生成，包含叶子证书和完整证书链，但不包含私钥、密码或 alias。需要将 P7B 导入为可部署版本时，必须同时提供与叶子证书匹配的私钥。

部署插件只使用已授权的制品，不负责生成、加密或替换任何证书容器。

## CA 操作

CA、信任域和签发节点有独立生命周期。禁用或退休 CA 前，先查找仍在使用的证书版本和绑定。

## 常见错误

- 只看名称判断证书是否相同：应优先使用真实 SHA-256 指纹。
- 把到期时间当作生效时间：两个时间都必须保存和展示。
- 把 PFX 密码写入普通变量或日志：应使用 Credential/Secret 引用。

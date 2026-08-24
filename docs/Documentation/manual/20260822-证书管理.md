---
title: 证书管理
description: 证书管理一级菜单及其二级菜单的操作地图
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/003-证书资产与CA生命周期管理
codeRefs:
  - web/src/router/menu.ts
  - web/src/router/modules/business.ts
testRefs: []
lastVerified: 2026-08-22
---

# 证书管理

“证书管理”下有四个页面：证书资产、ACME 自动化、CA 操作、证书格式配置。证书版本（同一证书的某次材料快照）与证书资产（域名和版本的容器）分开显示。

| 页面 | 用途 |
| --- | --- |
| 证书资产 | 导入、查看、删除证书版本，查看使用关系 |
| ACME 自动化 | 配置 ACME 提供商、账户和申请/续签任务 |
| CA 操作 | 查看 CA 层级、同步对象和内部 CA |
| 证书格式配置 | 定义 PEM、PFX/P12、JKS 等部署输出格式 |

先完成证书资产，再在资产中心绑定应用；证书格式配置只定义输出，不会自动部署证书。

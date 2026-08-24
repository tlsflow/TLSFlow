---
title: 快速开始
description: GCAC 安装和首次接入入口
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001-平台基础与工程治理
  - specs/002-统一安全管理与访问控制
  - specs/005-受管与非受管设备管理
codeRefs:
  - backend/src/app.module.ts
  - backend/src/modules/agents
testRefs: []
lastVerified: 2026-08-02
---

# 快速开始

快速开始覆盖应用初始化、管理员登录、Agent 注册、非 Agent 目标准备和首次证书资产配置。

## 推荐顺序

1. 准备数据库、Secret 存储和网络出口。
2. 初始化租户和管理员身份。
3. 根据目标类型注册 Agent 或准备无代理执行通道。
4. 导入或签发证书资产。
5. 创建应用资产和证书绑定。
6. 先执行预检，再创建部署计划。

真实生产参数、凭据和外部厂商地址不得写入文档。

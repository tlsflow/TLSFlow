---
title: 安装部署
description: TLSFlow v1.0.0 的安装、配置和首次登录入口
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - docker/compose.yml
  - docker/Dockerfile.small
  - docker/Dockerfile.backend
testRefs: []
lastVerified: 2026-08-22
---

# 安装部署

本组文档只介绍 TLSFlow v1.0.0 当前公开仓库支持的 Docker 部署方式。Docker Compose（用一个配置文件编排多个容器的工具）是正式入口；公开仓库负责本地构建，不负责保存 Docker Hub 凭据或自动推送镜像。

## 选择部署方式

| 方式 | 适用场景 | 服务组成 | 数据存储 |
| --- | --- | --- | --- |
| 标准部署 | 生产环境、需要 PostgreSQL 和浏览器运行时 | `db`、`backend`、`web`、`browser-runtime` | PostgreSQL 卷、工作流卷 |
| 单机部署 | 评估、小规模或无法单独运行 PostgreSQL 的环境 | `small` | PGlite 卷、工作流卷 |

按[快速开始](./quick-start.md)准备源码和密钥，再选择[标准部署](./standard-deployment.md)或[单机部署](./single-node-deployment.md)。所有变量的含义和必填条件见[部署参数](./deployment-parameters.md)，容器启动后按[首次登录](./first-login.md)操作。

安装完成后，建议依次完成：创建日常账号、导入许可证（如有）、录入凭据、接入一个测试设备、导入一张测试证书并执行一次 Dry Run（只读演练）。这条顺序能把基础设施、权限和目标连通性问题分开定位。

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
  - docker/build-tools/Dockerfile.small
  - docker/build-tools/Dockerfile.backend
testRefs: []
lastVerified: 2026-08-26
---

# 安装部署

本组文档介绍 TLSFlow v1.0.0 的 Docker 部署方式。标准版使用 Docker Compose；small
使用单个容器的 `docker run`。两种方式都直接使用 Docker Hub 镜像，不要求宿主机安装
Node.js，也不要求部署源码。

## 选择部署方式

| 方式 | 适用场景 | 服务组成 | 数据存储 |
| --- | --- | --- | --- |
| 标准部署 | 生产环境、多企业和持续后台任务；Browser Runtime 按需启用 | `db`、`backend`、`web`（可选 `browser-runtime`） | `docker/data/postgres/`、`docker/data/workflows/`、`docker/data/runtime/` |
| small 单容器 | 50 个应用资产以下、家用 NAS 或无法使用 Compose 的环境 | `gcac-small` | `data/pglite/`、`data/workflows/`、`data/runtime/`、`data/tls-inspector/`、`data/plugins/` |

按[快速开始](./quick-start.md)准备镜像、目录和密钥，再选择[标准部署](./standard-deployment.md)
或[单机部署](./single-node-deployment.md)。两种架构不能同时运行。所有变量的含义和必填条件见
[部署参数](./deployment-parameters.md)，容器启动后按[首次登录](./first-login.md)操作。

安装完成后，建议依次完成：创建日常账号、导入许可证（如有）、录入凭据、接入一个测试设备、导入一张测试证书并执行一次 Dry Run（只读演练）。按这个顺序操作，可以逐步排除基础设施、权限和目标连通性方面的问题。

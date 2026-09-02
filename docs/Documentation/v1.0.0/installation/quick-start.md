---
title: 快速开始
description: 使用 Docker Hub 镜像完成 TLSFlow v1.0.0 最小可用安装
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - docker/docker-compose.yml
  - docker/.env.example
  - docker/build-tools/Dockerfile.small
testRefs: []
lastVerified: 2026-08-26
---

# 快速开始

## 前置条件

准备 Linux、macOS 或 NAS 主机，并安装 Docker CLI。标准版还需要 Docker Compose v2；
small 只需要 Docker CLI。部署预构建镜像不需要 Node.js、Go、Buildx 或源码。
主机需要能访问目标设备、证书服务以及计划对接的外部厂商 API。

## 准备部署文件

从公开仓库或发行包取得 `docker/docker-compose.yml` 和 `docker/.env.example`。标准版在
`docker/.env` 中填写镜像标签、数据库密码和两个 GCAC 密钥。用户版 Compose 已固定
使用 Docker Hub `tlsflow` 命名空间；
small 不需要 `.env` 文件，只需按[单机部署](./single-node-deployment.md)准备数据目录。

## 选择一种拓扑

- 标准版：按[标准部署](./standard-deployment.md)使用 Compose。
- small：按[单机部署](./single-node-deployment.md)使用单个 `docker run` 容器。
- 源码开发：使用仓库内的 `docker/dev-compose.yml` 构建并启动，不用于生产部署。

small 和 standard 不允许同时运行。切换架构前必须先停止原架构，并确认没有容器继续占用
`8085` 端口或挂载同一组数据目录。

启动后看到容器为 `running`，且日志出现 Backend 已监听端口和迁移完成后，再打开对应
Web 地址。启动失败时先检查镜像标签、数据目录权限和必填密钥，不要把开发测试变量带入生产环境。

<LocalizedImage name="quick-start.svg" alt="快速开始部署流程" width="960" height="360" />

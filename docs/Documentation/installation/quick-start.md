---
title: 快速开始
description: 从源码构建 TLSFlow v1.0.0 并完成最小可用安装
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - docker/build-tools/build-local.mjs
  - docker/compose.yml
  - version
testRefs: []
lastVerified: 2026-08-22
---

# 快速开始

## 前置条件

准备 Linux 或 macOS 主机，并安装 Docker、Docker Compose v2 和 Buildx。Docker 构建会在独立的 builder 容器中自动拉取并配置 Go 1.23 Full Agent 和 Go 1.20 Compatibility Agent 工具链，宿主机不需要安装 Go。主机需要能访问目标设备、证书服务以及你计划对接的外部厂商 API。

直接执行 Agent Bundle 脚本时，如果宿主机 Go 不可用或 Compatibility 产物不完整，脚本也会自动转交 Docker builder；只有明确使用已有本地产物时，才需要宿主机自行提供 Go 1.23.x 或更高版本。

## 取得 v1.0.0 源码

```bash
git clone --branch v1.0.0 <公开仓库地址> tlsflow
cd tlsflow
```

## 构建并启动

先按[部署参数](./deployment-parameters.md)把必填变量准备好，再按部署规模执行。标准版和单机版都需要 Agent Release Bundle（Agent 发布包）；`build-local` 会在构建镜像前自动启动 Agent builder 容器生成该发布包。选择一种拓扑：

```bash
node docker/build-tools/build-local.mjs --architecture small
GCAC_RELEASE_VERSION="$(tr -d '\r\n' < version)" docker compose --env-file docker/versions.env --profile small -f docker/compose.yml up -d
```

标准部署命令见[标准部署](./standard-deployment.md)，单机部署命令见[单机部署](./single-node-deployment.md)。如果使用本地文件保存变量，请先将变量安全导出到当前 Shell，再执行上述命令；不要把密钥提交到仓库。

## 判断是否启动成功

```bash
docker compose --profile small -f docker/compose.yml ps
docker compose --profile small -f docker/compose.yml logs small
```

看到容器为 `running`，且日志出现 Backend 已监听端口和迁移完成后，打开对应 Web 地址。标准版还要确认 Browser Runtime 健康；启动失败时先查看是否缺少必填变量，不要把开发测试变量带入生产环境。

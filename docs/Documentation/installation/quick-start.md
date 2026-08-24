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

准备 Linux 或 macOS 主机，并安装 Docker、Docker Compose v2 和 Buildx。主机需要能访问目标设备和证书服务；本页不承诺任何外部厂商 API 已经可达。

## 取得 v1.0.0 源码

```bash
git clone --branch v1.0.0 <公开仓库地址> tlsflow
cd tlsflow
```

镜像标签以仓库根目录 `version` 文件为唯一版本来源。不要在 Compose 文件中手工写另一份版本号。

## 构建并启动

先按[部署参数](./deployment-parameters.md)准备当前 Shell 或 CI Secret 中的必填变量，再按部署规模执行。标准版和单机版都需要 Agent Release Bundle（Agent 发布包）；它包含 Linux/Windows Agent、Windows Compatibility Agent 安装资源及 SHA-256 清单。先在仓库根目录执行：

```bash
node docker/build-tools/build-agent-release-bundle.mjs
```

然后选择一种拓扑。`docker/versions.env` 只保存镜像和依赖版本，不保存业务密钥：

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

看到容器为 `running`，且日志出现 Backend 已监听端口和迁移完成后，打开对应 Web 地址。标准版还要确认 Browser Runtime 健康；启动失败时先查看缺失变量，不要把开发测试变量带入生产环境。

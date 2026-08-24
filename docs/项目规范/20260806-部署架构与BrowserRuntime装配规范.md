# GCAC 部署架构与 Browser Runtime 装配规范

状态：生效

## 1. 目的

本文规定 GCAC 小型架构和标准架构的代码装配、容器边界与 Browser Runtime（浏览器运行时）支持范围，避免通过环境变量缺失、运行时探测或动态 Docker 权限隐式决定产品能力。

## 2. 部署架构

GCAC 只允许以下两种部署架构：

| 架构 | 配置值 | 目标场景 | 打包边界 | Browser Runtime |
| --- | --- | --- | --- | --- |
| 小型架构 | `small` | 个人、家庭、轻量自用 | 前端、后端和数据库打包为一个单容器 | 不支持 |
| 标准架构 | `standard` | 企业、团队和生产环境 | 数据库、后端、前端、Browser Runtime 分别部署 | 支持 |

部署架构通过后端环境变量 `GCAC_DEPLOYMENT_ARCHITECTURE` 显式选择。为兼容现有部署，未配置时暂时按 `standard` 处理；正式小型架构镜像必须固定写入 `small`，不得依赖默认值。

## 3. 小型架构

小型架构必须满足：

1. 后端不创建 `BrowserRuntimeClient`、`BrowserCredentialSessionService` 或相关运行时资源。
2. 后端不注册 `/api/v1/credentials/browser-sessions/**` 路由。
3. OpenAPI 运行时文档不声明浏览器凭据会话接口。
4. 健康检查明确返回 `deploymentArchitecture=small` 和 `features.browserRuntime=false`。
5. 前端隐藏浏览器凭据入口，并拒绝进入浏览器凭据路由。
6. 插件 Manifest 和历史数据仍可被读取，不删除 `credential.acquire` 合同事实；但小型架构不得执行该能力。
7. 小型架构容器不得安装 Chromium、Xvfb、VNC、Playwright 浏览器依赖，也不得挂载 Docker Socket。

“不支持”必须由模块装配和路由事实表达，不能等用户创建会话后再以连接失败代替能力门禁。

## 4. 标准架构

标准架构固定包含以下独立部署单元：

```text
Database
GCAC Backend
GCAC Web
Browser Runtime
```

Browser Runtime 是长期运行的专用容器。GCAC Backend 只调用受限 Runtime API，不启动 Chromium 子进程、不访问 Docker Engine，也不挂载 Docker Socket。

## 5. Browser Runtime 进程模型

Browser Runtime 不得为每个会话动态创建 OCI 容器。每个 `BrowserCredentialSession` 必须在专用 Runtime 容器内启动独立进程组：

```text
Browser Runtime Container
  Runtime API / Session Supervisor
  Session Process Group
    Xvfb
    Fluxbox
    Chromium
    x11vnc
    websockify / noVNC
```

每个会话必须独立分配：

- 会话目录和 Chromium `user-data-dir`；
- X11 `DISPLAY`；
- CDP、RFB 和 noVNC 内部端口；
- Chromium 进程和进程组；
- Playwright `Browser`、`BrowserContext` 和 `Page` 服务端引用；
- 上下文随机标识、进程启动时间、TTL 和状态。

Runtime 只能从服务端固定配置选择可执行文件、参数、端口池和目录。客户端不得提交镜像、命令、挂载、特权、宿主路径或任意启动参数。

## 6. 同一浏览器上下文

VNC 和 Playwright/CDP 必须连接同一个 Chromium 进程：

1. Session Supervisor 启动会话进程组并记录 Chromium 进程身份。
2. Playwright 连接该进程的唯一 CDP 地址。
3. Runtime 保存默认 `BrowserContext` 和页面引用。
4. VNC 连接该进程使用的同一个 X11 `DISPLAY`。
5. 获取凭据前重新校验进程存活、CDP 连接、会话状态和上下文标识。
6. 任一引用断开后会话失败，禁止透明重启 Chromium 或创建新 BrowserContext 继续执行。

同一上下文由不可替换的进程和服务端引用保证，与“是否为每个会话创建容器”无关。

## 7. 隔离与资源限制

Browser Runtime 容器必须：

- 使用非 root 用户；
- 使用只读根文件系统；
- 将会话根目录挂载为 `tmpfs`；
- 使用 `cap-drop=ALL` 和 `no-new-privileges`；
- 不挂载后端目录、数据库配置、Secret 目录或 Docker Socket；
- 配置容器级 CPU、内存和进程数限制；
- 配置最大并发会话数；
- 仅通过 Runtime 的 VNC 反向代理暴露会话，不直接暴露会话内部端口；
- 在成功、失败、取消和过期后终止完整进程组并删除会话目录。

同一 Runtime 容器内的进程隔离不是 OCI 容器级强隔离。需要更高隔离等级时，应通过增加独立 Runtime 实例或调度到不同节点实现，不得恢复“由业务请求动态创建任意容器”的旁路。

## 8. 功能发现

后端健康检查必须返回：

```json
{
  "deploymentArchitecture": "standard",
  "features": {
    "browserRuntime": true
  }
}
```

前端以该服务端事实控制入口和路由，禁止根据浏览器环境、URL、插件名称或请求失败结果猜测部署架构。

## 9. 兼容性

1. 未配置 `GCAC_DEPLOYMENT_ARCHITECTURE` 时暂按 `standard` 处理，避免现有标准部署升级后丢失能力。
2. 小型架构不删除数据库中的浏览器会话、插件合同或 `BROWSER_SESSION` 历史记录。
3. 从小型架构升级为标准架构后，可重新装配 Browser Runtime；历史不可变插件版本不需要重写。
4. 从标准架构降级为小型架构前，必须停止活动浏览器会话；降级后历史记录可读，但不能新建或继续执行会话。

## 10. 测试门禁

每次修改部署架构或 Browser Runtime 装配必须验证：

1. `small` 不注册浏览器会话路由，也不创建 Browser Runtime 资源。
2. `standard` 注册完整接口并返回 `features.browserRuntime=true`。
3. Runtime 镜像不包含 Docker CLI，也不需要 Docker Socket。
4. 每个会话使用独立目录、端口、进程组和 BrowserContext。
5. 会话结束后进程组和目录均被清理。
6. Runtime 容量耗尽、进程退出、CDP 断开和非白名单访问均失败关闭。
7. 前端在 `small` 架构隐藏入口并拒绝浏览器凭据路由。


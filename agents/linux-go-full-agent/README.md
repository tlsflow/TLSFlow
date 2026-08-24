# Linux Go Full Agent 最小实现

这是一个放在 `agents/` 目录下的 **Linux Agent 实体最小闭环**，目标不是伪装成完整控制面，而是先把最基础、最容易跨发行版实现的能力落地出来。

当前包含：

- Go 单二进制入口
- Linux 系统/环境信息采集
- 命令执行
- `systemd` 安装/卸载骨架
- 统一服务控制脚本
- 本地构建脚本
- 安装元数据
- 配置模板
- 中文运维说明

当前明确 **不包含**：

- 真实控制面注册、心跳、拉任务
- Provider Runtime
- 证书部署逻辑
- 自动升级与回滚

## 目录

- `main.go`
- `go.mod`
- `config/agent.config.template.json`
- `build.sh`
- `service-control.sh`
- `linux/gcac-linux-agent.service`
- `linux/install-systemd.sh`
- `linux/uninstall-systemd.sh`

## 命令

- 查看系统信息：`./gcac-linux-agent inspect`
- 执行结构化命令：`./gcac-linux-agent exec -- uname -a`
- 执行 shell 命令：`./gcac-linux-agent exec --shell -- "uname -a && id"`
- 自检：`./gcac-linux-agent self-check --config=/etc/gcac/linux-agent/agent.config.json`
- 健康检查：`./gcac-linux-agent health --config=/etc/gcac/linux-agent/agent.config.json`
- 本地证书密钥动作：`certificate.key.create_csr`、`certificate.install_issued`、`certificate.key.retire`。当前文件密钥权限为 `0600`，并明确标记为可导出、软件受控。
- CA 信任动作：`certificate.trust.install` 原子安装并验证 CA 证书，`certificate.trust.rollback` 恢复原信任文件或删除本次新增文件。
- 查看服务信息：`./gcac-linux-agent service-info --config=/etc/gcac/linux-agent/agent.config.json`
- 前台运行：`./gcac-linux-agent run --config=/etc/gcac/linux-agent/agent.config.json`

## 编译

本机需要安装 Go。

```bash
./build.sh
```

如需交叉编译 Linux：

```bash
GOOS=linux GOARCH=amd64 ./build.sh
```

正式双架构发布：

```bash
./release/build-release.sh
./release/verify-reproducible.sh
```

发布目录包含 amd64/arm64 二进制、`SHA256SUMS`、构建环境记录和 SPDX SBOM。

## 安装 `systemd` 服务

安装脚本只负责注册和 `enable`，**默认不自动启动**。

```bash
sudo bash ./linux/install-systemd.sh
sudo systemctl start gcac-linux-agent.service
```

能力驱动安装预检与安装：

```bash
sudo ./linux/install.sh --preflight-only
sudo ./linux/install.sh
```

安装器根据实际能力选择 systemd、OpenRC 或 SysV，不读取发行版名称。升级和手工回滚入口为 `linux/upgrade.sh`、`linux/rollback.sh`。

卸载：

```bash
sudo bash ./linux/uninstall-systemd.sh
```

统一运维入口：

```bash
./service-control.sh status
./service-control.sh selfcheck
./service-control.sh healthcheck
./service-control.sh service-info
```

安装脚本会额外自动完成两件事：

- 安装 root 拥有的 NGINX helper：`/usr/local/libexec/gcac-nginx-helper`
- 写入 sudoers：`/etc/sudoers.d/gcac-nginx`

这不是装饰。它是 Linux NGINX 在“不改业务证书目录”的前提下完成以下动作的正式权限通道：

- `nginx -t`
- `systemctl reload nginx`
- 受控读取现有证书/私钥
- 受控原子写入证书/私钥
- 受控删除回滚目标
- 受控检查目标文件是否存在

## 直连监听默认值

- Linux Go Agent 默认直连监听端口：`18931`
- 默认监听地址：`0.0.0.0`
- 默认 `directControlAdvertiseHost` 留空，Agent 启动时会优先按 `controlPlaneUrl` 的实际出站源地址选择主 IP 对外声明；如果探测失败，再回退到“默认网关优先、非虚拟网卡优先、IPv4 优先”的评分逻辑；最后才回退到监听地址

## 兼容性边界

- 主支持路径：带 `systemd` 的主流 Linux
- 非 `systemd` 环境：可以前台运行，但不承诺自动安装服务
- 不依赖 Python、Node.js、Perl、发行版包管理器
- 命令执行的 shell 路径固定为 `/bin/sh`

这就是当前最简单、最干净的实现边界。

## Agent 原子操作插件

- 注册动作：`agent.atomic_plan.execute@1.0`。
- 执行计划必须包含目标 Agent、租户、插件包哈希、过期时间、幂等键和 HMAC-SHA256 签名。
- 签名密钥读取 `GCAC_AGENT_PLAN_SIGNING_KEY`；开发环境未配置时才使用仓库约定的开发密钥。
- 支持文件备份、原子替换、恢复、权限/属主设置、受控程序执行、systemd Service 控制和 TLS 校验。
- 内置 `builtin.linux.nginx.pem` 插件使用上述原子操作完成证书/私钥替换、`nginx -t`、reload 和指纹验证；旧 `linux.nginx.deploy_certificate` 继续作为 `NATIVE_HANDLER` 兼容回退。
- `command.execute` 只接受 `program + args`，Shell 模式默认并强制禁用；插件不能借用 `/bin/sh -c` 绕过权限声明。
- 每个计划写入恢复账本；重复计划返回缓存结果，失败时逆序执行回滚；`whenOperationCompleted` 防止预检失败时执行无意义回滚，真正回滚失败才进入 `MANUAL_INTERVENTION`。

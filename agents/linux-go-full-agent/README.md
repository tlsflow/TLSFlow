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

## 安装 `systemd` 服务

安装脚本只负责注册和 `enable`，**默认不自动启动**。

```bash
sudo bash ./linux/install-systemd.sh
sudo systemctl start gcac-linux-agent.service
```

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

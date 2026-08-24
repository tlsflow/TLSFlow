# GCAC CA Node（已废弃）

`go-ca-node` 是历史 CA 节点实现，已经从 GCAC 运行期执行链中永久移除。本目录保留可构建的失败关闭入口，用于阻止旧部署被误启动；它不再监听端口、不读取配置、不注册控制面、不租约任务、不保存签发结果，也不执行任何外部程序。

## 当前规则

- 证书签发、吊销和其他厂商能力必须通过独立 Plugin Runner 与 Host API 合同完成。
- 本机通用事实采集和计划执行必须使用通用 Agent v2 的四个动作：`agent.fact.collect`、`agent.plan.validate`、`agent.plan.execute`、`agent.execution.receipt`。
- 本目录不提供历史协议兼容层、旧任务转换、运行期 fallback 或旁路执行入口。
- 启动程序会输出明确的废弃错误并以非零状态码退出，避免旧版本继续运行。

## 测试与构建

在本目录执行：

```powershell
go test ./...
./build.ps1
```

构建脚本只在本目录的 `dist/` 下生成 Windows amd64 和 Linux amd64 失败关闭产物，不会修改其他 Agent 目录。

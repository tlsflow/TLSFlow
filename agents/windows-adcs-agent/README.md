# GCAC Windows ADCS Agent

该目录对应的旧 ADCS Agent 从未发布，现已永久停用。它不再提供 ADCS 发现、证书签发、证书吊销、CRL 发布、任务轮询、任务推送或任何其他厂商业务。

程序保留可执行文件形态仅用于识别并阻止误启动。启动会立即失败，并在标准错误输出中提示：迁移到 `Plugin Runner/Agent v2`。程序不会读取配置文件、访问网络、连接控制面、调用 Windows API，也不会启动外部命令或脚本。

## 构建与验证

在本目录执行：

```powershell
go test -count=1 ./...
go vet ./...
go build -trimpath -ldflags "-s -w" -o gcac-adcs-agent.exe .
```

构建后的 `gcac-adcs-agent.exe` 必须以退出码 `1` 结束，并输出迁移提示。后续功能只能通过 `Plugin Runner/Agent v2` 实现，不得在本目录恢复旧协议或新增厂商业务。

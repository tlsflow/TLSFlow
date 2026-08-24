# GCAC Windows AD CS Agent

该 Agent 安装在 Microsoft AD CS 证书颁发机构服务器上，通过出站任务轮询连接 GCAC。

支持的固定任务：

- CA 配置和已发布模板发现。
- CSR 提交及 AD CS Request ID 返回。
- Pending、Issued、Denied 状态查询。
- 签发证书取回。
- 证书吊销。
- CRL 发布。

Agent 不读取或导出 AD CS CA 私钥，也不执行控制面下发的任意命令。

## 构建

```powershell
go mod tidy
go test ./...
go build -trimpath -ldflags "-s -w" -o gcac-adcs-agent.exe .
```

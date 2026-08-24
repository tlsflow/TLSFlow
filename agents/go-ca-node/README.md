# GCAC CA Node

GCAC CA Node 是独立于 GCAC 主应用部署的最小签发服务，同一份源码可构建 Windows 和 Linux 版本。

- CA 私钥保留在节点或节点连接的 HSM/KMS/PKCS#11 后端。
- 对外提供 `/health`、`/v1/sign` 和 `/v1/revoke`。
- 支持一次性令牌注册、心跳、任务租约和结果回传。
- 使用 `idempotencyKey` 持久化签发结果，避免重试产生重复证书。
- 文件私钥模式属于可导出软件密钥，不得宣称不可导出。

构建命令：

```powershell
./build.ps1
```

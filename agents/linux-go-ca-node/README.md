# Linux GCAC CA Node

可执行文件由 `agents/go-ca-node/build.ps1` 从共享 Go 源码构建。建议通过 systemd 使用专用账户运行；文件私钥权限至少为 `0600`，生产优先使用 HSM 或 PKCS#11。

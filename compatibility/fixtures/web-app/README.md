# Web/App 插件事实 Fixture

本目录只保存不带产品判断的 Agent 原始进程、服务、端口和文件事实。授权 Token、Policy Decision、Nonce、Receipt 和本地策略由定向测试按当前执行绑定生成；缺少任何一项时，六个 Runner 入口都必须失败关闭。

六份 `*-target-missing.json` 是逐插件的目标故障 Fixture：目标 `file_stat` 合法存在，但 `exists=false` 且不带文件摘要。每份 Fixture 都重新计算了 Agent 事实摘要；真实 Runner 对只读执行返回 `FAILED`，对写操作返回 `UNKNOWN`，不会进入旧 Workflow 或 Provider 回退。

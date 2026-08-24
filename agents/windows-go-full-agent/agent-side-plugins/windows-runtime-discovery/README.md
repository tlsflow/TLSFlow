# Windows Runtime Discovery Agent-side Plugin

该进程负责读取 Windows 本机运行进程、服务参数和有效配置，并返回带有
`FULL_WEB_DISCOVERY` 标记的只读快照。IIS、Nginx、Apache、Tomcat 的语法和
证书绑定解释全部位于本进程；Windows Go Agent Core 只负责固定路径启动、超时、
JSONL 协议和结果完整性检查。

进程不接收控制面任务、Secret、数据库句柄、任意命令或脚本，也不能直接调用
Plugin Runner。缺少或崩溃时 Core 只返回空的失败快照，不会把端口、TLS 握手或
候选路径猜测为资产。

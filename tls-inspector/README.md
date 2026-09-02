# TLS Inspector

`tls-inspector` 是 GCAC 监控体系外的独立 TLS 深度检测服务。

## 目标

- 独立进程运行，不和现有 `backend` 共进程。
- 独立文件存储目标和快照，不复用现有轻量监控表。
- 提供 TLS 深度详情 API：证书、认证路径、协议与套件、兼容性模拟、协议细节。

## 运行

```bash
cd tls-inspector
npm start
```

默认监听 `0.0.0.0:8788`，健康检查地址为 `GET /healthz`。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `TLS_INSPECTOR_HOST` | `0.0.0.0` | HTTP 监听地址 |
| `TLS_INSPECTOR_PORT` | `8788` | HTTP 监听端口 |
| `TLS_INSPECTOR_DATA_DIR` | `../data/tls-inspector` | 目标与快照存储目录 |
| `TLS_INSPECTOR_SCAN_TIMEOUT_MS` | `20000` | 单次 TLS 握手/探测超时 |
| `TLS_INSPECTOR_SCHEDULER_INTERVAL_MS` | `30000` | 定时扫描轮询周期 |

目标自动检测间隔默认并最低为 86400 秒（1 天）。存量目标启动时会自动归一化到该间隔；证书更换后可通过详情页手动执行一次检测。

## API

- `GET /healthz`
- `GET /api/v1/tls-inspector/targets`
- `POST /api/v1/tls-inspector/targets`
- `DELETE /api/v1/tls-inspector/targets/:id`
- `POST /api/v1/tls-inspector/targets/:id/inspect`
- `GET /api/v1/tls-inspector/targets/:id/latest`
- `GET /api/v1/tls-inspector/targets/:id/snapshots`
- `GET /api/v1/tls-inspector/snapshots/:id`

## 已知边界

- `Handshake Simulation` 采用“版本化客户端画像 + 服务端能力匹配”的近似推导，不承诺与 SSL Labs 私有评分器一致。
- `Mozilla`、`Java`、`Windows` 视角会尽量使用本地可信根来源；`Apple` 与 `Android` 当前明确返回结构化 `unsupported`。
- 旧协议与弱套件探测依赖本机 `openssl`，如果运行环境裁剪过功能，结果会退化为 `partial` 并给出边界说明。

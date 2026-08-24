# NetScaler NITRO Fixture 规范

- 每个响应必须标记精确版本和 Build。
- `pending-real-build` 只用于合同结构占位，不得作为真实认证证据。
- Fixture 只能来自官方文档或经过脱敏的真实设备响应。
- 禁止保存用户名、密码、Cookie、私钥、PFX 密码、客户域名和管理 IP。
- 同一份响应不得复制后冒充多个版本。
- 实施版本适配时按资源创建 `<version>/<resource>.<scenario>.json`。

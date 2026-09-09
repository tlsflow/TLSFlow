---
title: 插件示例：Nginx Proxy Manager
description: 以 Nginx Proxy Manager 内置插件说明设备管理、发现和证书部署
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - backend/src/modules/plugins/builtin-plugins/device-nginx-proxy-manager
testRefs:
  - backend/src/modules/plugins/builtin-plugin-migration.test.ts
  - backend/src/modules/plugins/application/user-plugin-directory-importer.test.ts
lastVerified: 2026-09-04
---

# 插件示例：Nginx Proxy Manager

Nginx Proxy Manager（NPM）插件当前为内置插件 `device.nginx-proxy-manager`，包内 Manifest 版本为 `0.1.13`；旧示例记录的 `0.1.7` 仅作为历史测试证据，不能覆盖当前 Manifest 事实。它把 NPM 管理实例作为设备，把每个 Proxy Host 映射为可部署站点和 TLS 绑定。

以下请求示例以 NPM 2.11.x API 为准。`BASE_URL` 是 NPM 管理地址（例如 `https://npm.example.test`），所有 Token 只存在于当前 Workflow 的敏感步骤输出；示例响应中的 ID、域名和时间均为演示值。

## 1. 设备管理

设备表单保存管理地址、端口、HTTP/HTTPS 选择和用户名密码凭据。连接测试只访问管理地址根路径，验证网络和 TLS；它不会登录 NPM，也不会把连接测试当成业务 API 可用。

登录凭据只在部署工作流的第一步调用 `POST /api/tokens` 获取 JWT（JSON Web Token，短期登录令牌）。JWT 作为敏感步骤输出传给后续请求，不能写进插件包、普通变量或持久化凭据。后续请求只能使用当前步骤声明的 `secret` 输出引用，不能把 JWT 拼接到普通变量或日志。

登录请求使用表单字段 `identity` 和凭据引用注入的 `secret`（密码）；在 Workflow DSL 中对应 `bodyType: "form"` 与 `formCredentialRefs`，不要把密码直接放入请求 JSON：

```http
POST /api/tokens HTTP/1.1
Host: npm.example.test
Accept: application/json
Content-Type: application/x-www-form-urlencoded

identity=admin%40example.test&secret=<credential-secret>
```

成功响应（HTTP `200`）至少包含 `token`：

```json
{ "token": "<敏感 JWT>", "expires": "2026-09-04T12:00:00.000Z" }
```

后续请求携带 `Authorization: Bearer <token>`。连接测试只请求 `/`，允许 `200/301/302/401/403/404`，不应因未登录返回 `401` 就误报网络不可达。

## 2. 发现

设备连接测试成功后执行标准发现：

1. 调用 NPM 身份接口确认产品族。
2. 读取 Proxy Hosts，映射为 `proxy.nginx-proxy-manager` 框架下的 `proxy.host` 站点。
3. 读取证书并生成 `tls.binding` ManagedTarget，保存 Proxy Host ID、当前证书 ID 和证书有效期。
4. 在设备详情确认站点、证书指纹和绑定关系，再从应用资产向导选择目标。

发现所需的最小请求为：

```http
GET /api/nginx/proxy-hosts HTTP/1.1
Accept: application/json
Authorization: Bearer <token>

GET /api/nginx/certificates HTTP/1.1
Accept: application/json
Authorization: Bearer <token>
```

两者成功响应均为数组（可能为空）；Proxy Host 至少使用 `id`、`domain_names`、`certificate_id`、`forward_scheme`、`forward_host`、`forward_port`、`ssl_forced` 等原字段构建发现事实，不要补造缺失值。

发现结果可能包含部分对象警告；缺少目标 ID 或证书位置时，部署会失败关闭，不会猜测默认站点。

## 3. 证书部署工作流

选择 NPM 目标并提交证书部署后，工作流按以下顺序执行：

1. 登录获取 JWT，并在运行时请求头中引用敏感步骤输出。
2. `POST /api/nginx/certificates` 创建 `provider: other` 的临时自定义证书记录。
3. `POST /api/nginx/certificates/:id/upload` 以 multipart 上传证书、私钥和中间链；NPM 负责解析和有效期校验。
4. 对每个 Proxy Host 读取原配置，仅替换 `certificate_id` 后 `PUT /api/nginx/proxy-hosts/:id`；不要发送 NPM 2.11.3 不接受的字段或用宿主默认值覆盖发现到的地址。
5. 回读新证书的 `expires_on`，再回读每个 Proxy Host，确认 `certificate_id` 已切换。

对应的请求/响应关键字段如下：

```http
POST /api/nginx/certificates HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json

{"provider":"other","nice_name":"GCAC-AB12CD34EF56"}
```

响应为 `201`，至少含新建证书的 `id`。随后上传制品：

```http
POST /api/nginx/certificates/123/upload HTTP/1.1
Authorization: Bearer <token>
Content-Type: multipart/form-data; boundary=<boundary>

certificate=<leaf PEM, filename=certificate.pem>
certificate_key=<private-key PEM, filename=certificate.key>
intermediate_certificate=<chain PEM or empty string, filename=chain.pem>
```

上传成功为 `200`。更新 Proxy Host 时只发送发现到的可写字段，并替换 `certificate_id`：

```http
PUT /api/nginx/proxy-hosts/456 HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json

{"domain_names":["example.test"],"forward_scheme":"http","forward_host":"10.0.0.8","forward_port":8080,"certificate_id":123,"ssl_forced":true}
```

成功为 `200` 且响应含 `id`。最后用 `GET /api/nginx/certificates/123` 检查 `expires_on`，用 `GET /api/nginx/proxy-hosts/456` 断言 `certificate_id=123`；只上传或只收到 `200` 都不算部署成功。

可选中间链缺失时先标准化为空字符串再提交。工作流不发送 NPM 2.11.3 不接受的字段。

## 4. 回滚和失败处理

部署前保存 Proxy Host ID、旧证书 ID 和本轮创建的临时证书 ID。任一步骤失败时：

1. 重新读取当前 Proxy Host 配置，恢复旧 `certificate_id`。
2. 删除本轮创建且未再被引用的临时证书记录。
3. 再次回读 Proxy Host 和证书状态，把回滚结果写入执行记录。

连接中断或写请求超时可能是外部状态未知；不要直接重放写请求，先查看执行记录和 NPM 实际状态。

回滚必须按“旧 Proxy Host 配置 → 旧证书 ID → 本轮临时证书 ID”的顺序使用原始快照。若旧证书仍被其他 Proxy Host 引用，只恢复绑定，不删除旧证书；只有确认本轮临时证书没有引用时才删除。

## 5. 示例的真实边界

当前代码已覆盖 NPM API 的连接、身份、Proxy Host/证书发现和证书切换逻辑；真实 NPM 版本、网络策略、证书链和服务行为仍需在目标环境执行验收。示例不代表所有 NPM 版本或所有厂商设备都自动兼容。

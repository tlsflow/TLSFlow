---
title: 插件示例：Nginx Proxy Manager
description: 以 Nginx Proxy Manager 内置插件说明设备管理、发现和证书部署
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - docs/项目规范/20260819-插件开发流程规范.md
  - specs/004.3-内置产品插件、兼容目录与旧Provider退役治理
codeRefs:
  - backend/src/modules/plugins/builtin-plugins/device-nginx-proxy-manager
  - docs/插件开发/nginx-proxy-manager/README.md
  - docs/插件开发/nginx-proxy-manager/测试文档/20260821-证书更新流程测试.md
testRefs: []
lastVerified: 2026-08-22
---

# 插件示例：Nginx Proxy Manager

Nginx Proxy Manager（NPM）插件当前为内置插件 `device.nginx-proxy-manager`，版本以包内 Manifest 为准（旧示例记录的内置版本为 `0.1.7`，不能覆盖 Manifest 的事实）。它把 NPM 管理实例作为设备，把每个 Proxy Host 映射为可部署站点和 TLS 绑定。

## 1. 设备管理

设备表单保存管理地址、端口、HTTP/HTTPS 选择和用户名密码凭据。连接测试只访问管理地址根路径，验证网络和 TLS；它不会登录 NPM，也不会把连接测试当成业务 API 可用。

登录凭据只在部署工作流的第一步调用 `POST /api/tokens` 获取 JWT（JSON Web Token，短期登录令牌）。JWT 作为敏感步骤输出传给后续请求，不能写进插件包、普通变量或持久化凭据。后续请求只能使用当前步骤声明的 `secret` 输出引用，不能把 JWT 拼接到普通变量或日志。

## 2. 发现

设备连接测试成功后执行标准发现：

1. 调用 NPM 身份接口确认产品族。
2. 读取 Proxy Hosts，映射为 `proxy.nginx-proxy-manager` 框架下的 `proxy.host` 站点。
3. 读取证书并生成 `tls.binding` ManagedTarget，保存 Proxy Host ID、当前证书 ID 和证书有效期。
4. 在设备详情确认站点、证书指纹和绑定关系，再从应用资产向导选择目标。

发现结果可能包含部分对象警告；缺少目标 ID 或证书位置时，部署会失败关闭，不会猜测默认站点。

## 3. 证书部署工作流

选择 NPM 目标并提交证书部署后，工作流按以下顺序执行：

1. 登录获取 JWT，并在运行时请求头中引用敏感步骤输出。
2. `POST /api/nginx/certificates` 创建 `provider: other` 的临时自定义证书记录。
3. `POST /api/nginx/certificates/:id/upload` 以 multipart 上传证书、私钥和中间链；NPM 负责解析和有效期校验。
4. 对每个 Proxy Host 读取原配置，仅替换 `certificate_id` 后 `PUT /api/nginx/proxy-hosts/:id`；不要发送 NPM 2.11.3 不接受的字段或用宿主默认值覆盖发现到的地址。
5. 回读新证书的 `expires_on`，再回读每个 Proxy Host，确认 `certificate_id` 已切换。

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

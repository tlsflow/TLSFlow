---
title: 首次登录
description: TLSFlow v1.0.0 容器启动后的首次登录和安全初始化
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - backend/src/modules/security
  - backend/src/config
testRefs: []
lastVerified: 2026-08-22
---

# 首次登录

## 登录地址

- 标准部署：打开 `http://<主机地址>:<GCAC_PORT>/`，默认端口为 `8085`。
- 单机部署：打开 `http://<主机地址>:<GCAC_PORT>/`，默认端口为 `8085`。

输入用户名 `admin` 和启动时设置的 `GCAC_INITIAL_ADMIN_PASSWORD`。该密码没有内置默认值，必须由你在启动时设置。

登录成功后，浏览器会保存登录状态，进入控制台首页。

## 登录后立即完成

1. 确认当前所在租户，避免在错误租户中创建资产。
2. 修改 `admin` 密码，并为日常操作创建个人账号。
3. 在“系统设置 → 角色”分配最小权限，在“系统设置 → 凭据”录入受控凭据。
4. 在“系统设置 → 许可证”确认授权状态。
5. 先导入一张测试证书，再接入一个测试设备，完成一次可回读的部署验证。
6. 在“日志审计”确认登录、改密、角色变更和测试部署均有记录。

## 首次接入检查

在正式部署前，确认 Agent 或无 Agent 通道的网络出口已经明确；用户名、密码、SSH Key、API Token 和私钥均已保存到“系统设置 → 凭据”。接入后先确认设备可查询，再执行只读发现，核对站点和证书位置，最后才创建部署计划。无 Agent 目标使用 `Standalone + Workflow` 或受管目标工作流覆盖，不需要单独创建部署绑定。

## 登录失败排查

- 确认访问的是 Web 端口，不是标准版 Backend 的 `3003` 端口。
- 检查 `GCAC_INITIAL_ADMIN_PASSWORD` 是否与首次初始化时一致；修改环境变量不会自动重置已存在用户密码。
- 检查 `GCAC_TOKEN_SECRET` 是否在重启前后保持不变，改变它会使现有登录令牌失效。
- 查看 `docker compose logs backend`，先处理迁移、数据库或必填密钥错误。
- 如果页面可以打开但 API 请求失败，检查 Web 到 Backend 的代理配置和请求 ID；不要直接把 Backend 端口暴露给公网。

登录令牌（用于保持会话的签名凭证）和 Secret 加密密钥不能写入截图、日志或问题单。

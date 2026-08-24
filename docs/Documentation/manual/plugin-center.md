---
title: 插件中心
description: 管理 TLSFlow v1.0.0 内置插件和用户插件包
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/004-统一插件平台与厂商扩展治理
  - specs/004.5-插件进程隔离与宿主能力边界重构治理
codeRefs:
  - web/src/views/plugins/PluginsView.vue
  - backend/src/modules/plugins
testRefs: []
lastVerified: 2026-08-22
---

# 插件中心

插件是平台扩展设备发现、证书部署或其他能力的受控包。插件中心只显示当前租户可见的插件版本、来源、状态和能力。

## 使用插件

1. 进入“插件中心”，点击刷新市场，查看内置或用户导入的插件包。
2. 打开详情确认版本、兼容平台、执行位置、输入字段和所需权限。
3. 导入用户插件包时使用统一导入入口，等待包校验和注册完成。
4. 启用插件后，在设备或应用资产向导中选择对应能力，再运行连接测试和发现。

插件包版本不可原地覆盖；升级会产生新版本，已有绑定继续使用固定版本，需在设备或应用资产中明确切换。插件不能直接读取数据库、宿主文件、环境变量或未授权 Secret。

导入、审批、启用、绑定和执行是五个独立门禁。导入后先核对 Manifest（插件清单）中的产品族、版本、能力、执行位置和权限，再审批权限、启用版本并创建绑定；其中任一门禁失败只影响该插件，不应通过赋予管理员权限绕过。`isolated_process` 插件只能被工作流中明确声明的 `plugin.action` 步骤调用，不能接管整份工作流。

刷新插件市场不会改变已创建的部署计划。若插件执行失败，保留插件版本、Binding、请求 ID 和结构化错误，先检查目标兼容性及租户权限；写请求超时按外部状态未知处理。

Nginx Proxy Manager 的完整实现示例见[开发文档中的插件示例](../developer/plugin-example-nginx-proxy-manager.md)。

---
title: 许可证
description: 查看授权状态、导出离线激活请求和导入许可证
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - web/src/views/settings/LicensingView.vue
  - web/src/api/modules/licensing.api.ts
testRefs: []
lastVerified: 2026-08-22
---

# 许可证

进入“系统设置 → 许可证”查看当前计划、版本兼容性、有效期、功能和额度。许可证状态包括无授权、有效、宽限期、过期、撤销和检测到时间回退。

## 离线激活

1. 点击“导出离线请求”，保存生成的 JSON 请求文件。
2. 将文件交给授权方处理；不要编辑安装实例 ID、随机数或公钥。
3. 收到授权响应后，在同一页面导入许可证 JSON；如有撤销列表，单独导入。
4. 刷新页面确认状态为有效且版本兼容。

导入许可证不会改变租户、用户或历史执行。额度用尽、许可证过期或版本不兼容时，页面显示实际限制；不要把比较弹窗中的商业描述当成当前实例已经获得的功能。

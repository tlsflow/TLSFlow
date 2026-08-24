---
title: 报表
description: 查看事件窗口、风险响应和自动化效果报表
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - backend/src/modules/reports/controller/reports.controller.ts
  - backend/src/modules/reports
  - web/src/router/modules/business.ts
testRefs: []
lastVerified: 2026-08-22
---

# 报表

报表不是当前主菜单一级项，也没有单独的导航分组。具备 `report.read` 权限的用户可通过应用内已有链接或直接访问对应路由；导出还需要 `report.export` 权限。当前支持：

| 报表 | 内容 |
| --- | --- |
| 事件窗口 | 指定时间内的证书、目标和部署事件 |
| 风险响应 | 风险发现、处理状态和响应趋势 |
| 自动化效果 | 自动化运行数量、成功/失败和目标明细 |

选择报表类型和时间范围（7、30 或 90 天）后先查看总览，再执行 CSV 导出。导出结果仍是当前租户范围的聚合，不替代执行详情、审计记录或原始探测结果；对账时同时保存报表运行 ID 和导出文件。

三条实际路由分别为 `/reports/incident-window`、`/reports/risk-response` 和 `/reports/automation-effectiveness`。查看需要 `report.read`，导出需要 `report.export`；时间由浏览器本地时区显示。

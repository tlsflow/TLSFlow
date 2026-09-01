---
title: 资产中心
description: 资产中心一级菜单及应用资产、设备、云服务资产和 Gateway 操作地图
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - web/src/router/menu.ts
  - web/src/router/modules/business.ts
  - web/src/views/devices/DevicesView.vue
  - backend/src/modules/assets/controller/assets.controller.ts
testRefs: []
lastVerified: 2026-08-28
---

# 资产中心

资产中心用于管理统一资产、设备和 Gateway（网络转发入口）。应用资产和云服务资产都从“添加资产”进入各自的现行接入链路，不增加云服务独立二级菜单。云服务资产本身是 `ServiceAsset(assetKind=CLOUD_SERVICE)`，不是设备或 Host。

> 【截图占位：资产中心首页，显示应用资产、设备、Gateway 和“添加资产”动作】

阿里云 CDN 从资产中心的“添加资产”进入，复用 `DeviceOnboardingWizard.vue` 和 `POST /api/v1/devices/onboarding`；后端识别云服务能力后创建 `ServiceAsset(CLOUD_SERVICE)`，再执行连接测试和发现。它不使用应用资产的五步会话，不选择证书或创建部署计划。`/providers` 不再作为二级菜单，但旧 CloudAccount API 仍保留兼容实现。

需要云资源发现时，先在同一“添加资产”入口完成云服务接入；证书部署准备仍只针对设备和应用资产。

## 四类资源如何区分

| 资源 | 保存的内容 | 什么时候使用 |
| --- | --- | --- |
| 应用资产 | 业务名称、域名、环境、证书和部署目标 | 创建部署计划和查看业务状态 |
| 设备 | 主机/网络目标、连接方式、健康状态和发现结果 | 提供实际执行位置 |
| 云服务资产 | 云服务提供商、作用域和访问凭据引用 | 连接云平台并发现云资源 |
| Gateway | 网络转发地址和可用状态 | 目标无法直接访问时中转 |

## 推荐准备顺序

1. 选择已启用的云服务插件。
2. 填写插件声明的显示名称和凭据引用。
3. 提交到兼容设备接入 API，由后端创建 `ServiceAsset(CLOUD_SERVICE)`。
4. 执行只读连接测试和资源发现，写入 Framework/Site。
5. 返回资产中心查看资产；当前阿里云 CDN 不创建证书部署计划。

## 选择目标时的判断

| 模式 | 适用情况 |
| --- | --- |
| 无 Agent 设备 | 只有网络连接或标准发现结果，没有安装 Agent |
| 设备默认能力 | 设备已发现可用的系统/站点，按默认方式执行 |
| 工作流覆盖 | 业务明确要求使用自定义工作流步骤 |
| 独立目标 + 工作流 | 目标不属于某台受管设备，只能用单独的工作流连接 |

发现完成后，优先使用发现到的地址、端口、服务名和证书位置；只有业务确实变化时再手工修改。发现成功只代表读到了目标信息，部署前仍要通过预检和目标验证。

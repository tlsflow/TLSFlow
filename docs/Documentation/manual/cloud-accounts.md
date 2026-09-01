---
title: 云服务资产接入
description: 通过统一资产入口配置云服务连接并运行云资产发现
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - web/src/views/assets/AssetsView.vue
  - web/src/views/application-onboarding/ApplicationOnboardingModal.vue
  - web/src/views/application-onboarding/ApplicationOnboardingView.vue
  - backend/src/modules/providers
testRefs: []
lastVerified: 2026-08-26
---

# 云服务资产接入

云服务以统一资产中心中的 `ServiceAsset(assetKind=CLOUD_SERVICE)` 作为根对象。用户从资产中心“添加资产”复用 `DeviceOnboardingWizard.vue`，选择插件声明的表单后提交到 `POST /api/v1/devices/onboarding`，由后端完成连接测试和资源发现；不进入证书选择、部署或回滚阶段。访问密钥等敏感内容应先在“系统设置 → 凭据”中建立。

## 添加云服务资产

1. 进入“资产中心”点击“添加资产”，在平台列表中选择云服务插件。
2. 填写显示名称和插件凭据字段；凭据只保存 CredentialRef。
3. 提交后由兼容设备接入 API 转入云服务接入服务，创建 `ServiceAsset(assetKind=CLOUD_SERVICE)` 并执行连接测试和资源发现。
4. 发现结果写入该 ServiceAsset 所有的 `FrameworkInstance` 和 `SiteAsset`。阿里云 CDN 按中国大陆和国际站 Framework 分组展示；Framework 名称仅显示覆盖范围，不显示账号或资产名称。
5. 发现完成后资产中心即可查看结果；本流程不选择证书、不创建部署计划。

> 【截图占位：统一云服务资产向导，标出 Provider 选择、显示名称、凭据档案、下一步和保存按钮】

## 编辑、查看和删除

- 添加资产流程会执行连接测试和发现；测试为只读操作，不会写入云平台。
- 点击资产记录可以查看最近一次发现得到的产品、Framework、Site 和发现时间（按本地时间显示）。
- 已创建云服务资产不能更换插件提供方；凭据引用和显示名称由统一资产管理接口维护，资产详情页不提供证书部署编辑表单。
- 删除前确认没有其他资产或自动化任务依赖该 ServiceAsset。按页面要求输入确认文字后删除，删除后不能恢复资产记录。

当前首个正式验收对象为阿里云 CDN；其他 Provider 的目录或 Fixture 不代表已经正式支持。阿里云 CDN 使用同一 ServiceAsset 凭据和同一 API 发现中国大陆、国际站域名，并在发现结果中按实际返回的覆盖范围展示 Framework。Framework 名称固定显示“国际站”或“中国大陆”，账号名称只属于 ServiceAsset 展示名。阿里云插件只负责连接测试和资源发现，不负责证书部署、验证或回滚。出现异常时先检查凭据是否启用，再联系云服务管理员。不要在截图、备注或聊天中暴露访问密钥。

云账号动作使用接入时固定并可审计的插件版本；版本升级和重新绑定需要重新通过账号绑定和能力校验。其他 Provider 在完成真实连接、发现和审计验收前不视为正式支持。要确认真实云平台连接成功，请在配置了有效云凭据、可访问外网的环境中单独验收。

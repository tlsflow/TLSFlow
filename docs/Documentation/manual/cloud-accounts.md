---
title: 云账号接入
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
  - web/src/design-system/components/GcPluginForm.vue
  - backend/src/modules/providers
testRefs: []
lastVerified: 2026-08-26
---

# 云账号接入

云账号是平台连接云服务的独立 `CloudAccountAsset`。用户从资产中心“添加资产”或统一服务向导进入同一套五步接入流程：`Platform → Resource → Site → Certificate → Complete`。第二步选择已有云账号或在当前内容区用插件标准表单新建账号，第三步选择发现得到的真实站点，第四步选择证书资产和精确版本；不能通过独立账号模态框完成。访问密钥等敏感内容应先在“系统设置 → 凭据”中建立。

## 添加云账号

1. 进入“资产中心”点击“添加资产”，或从统一服务向导选择云服务插件。
2. 在 Resource 步骤选择已有 `CloudAccountAsset`，或在当前步骤展开插件标准表单新建一条账号资产。
3. 选择凭据档案并测试连接；连接未成功不能进入下一步。
4. 在 Site 步骤运行发现，选择真实的域名/资源。阿里云 CDN 按中国大陆和国际站 Framework 分组展示。
5. 在 Certificate 步骤选择证书资产和精确证书版本。
6. 在 Complete 步骤确认摘要并提交。只有具备 V1 DSL 执行能力的目标才会创建部署计划；当前阿里云 CDN 完成后是“已配置，待部署”，不代表云端证书已更新。

> 【截图占位：统一云服务资产向导，标出 Provider 选择、显示名称、凭据档案、下一步和保存按钮】

## 编辑、查看和删除

- 点击“测试连接”验证账号能否正常连接；测试为只读操作，不会写入云平台。
- 点击“发现资源”读取云平台中的资源。发现完成后，平台按云账号、云产品范围和具体资源建立 Framework/Site 条目，站点选择保存真实 SiteAsset。
- 点击“查看资源”可以查看最近一次发现得到的产品、站点条目及发现时间（按本地时间显示）。
- 点击记录可查看 Provider、状态、Framework、Site 数量和更新时间。
- 点击“编辑”可以修改名称和凭据；已创建账号不能更换 Provider。
- 删除前确认没有应用资产或自动化任务依赖该账号。按页面要求输入确认文字后删除，删除后不能恢复账号档案。

当前首个正式验收对象为阿里云 CDN；其他 Provider 的目录或 Fixture 不代表已经正式支持。阿里云 CDN 使用同一账号和同一 API 发现中国大陆、国际站域名，并在发现结果中分别展示两个 Framework。当前插件只完成账号连接、域名发现和资产配置，证书部署仍由后续 V1 DSL 能力负责。出现异常时先检查凭据是否启用，再联系云服务管理员。不要在截图、备注或聊天中暴露访问密钥。

云账号动作使用接入时固定并可审计的插件版本；版本升级和重新绑定需要重新通过账号绑定和能力校验。其他 Provider 在完成真实连接、发现和审计验收前不视为正式支持。要确认真实云平台连接成功，请在配置了有效云凭据、可访问外网的环境中单独验收。

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

云账号是平台连接云服务的独立 `CloudAccountAsset`。用户从资产中心“添加资产”或统一服务向导进入同一接入流程，选择云服务插件、显示名称和已保存凭据后，由服务端保存账号、插件绑定和连接/发现能力。云发现只投影为 `CloudAccountAsset → Framework → Site`，不创建虚拟设备或证书目标；`/providers` 已不再作为独立二级菜单，迁移期间旧地址只跳转到统一入口。访问密钥等敏感内容应先在“系统设置 → 凭据”中建立。

## 添加云账号

1. 进入“资产中心”，点击“添加资产”，或从统一服务向导选择云服务资产。
2. 在第 1 步选择已启用的云服务提供商。
3. 在平台卡片查看接入能力版本、支持范围和接入前需准备的信息，点击后填写账号显示名称。
4. 在“凭据档案”中选择已保存的云服务凭据，不要把访问密钥直接粘贴到账号表单。
5. 查看摘要，确认云服务插件、账号名称和凭据无误后点击“保存”；云产品、地域范围和资源由发现动作自动读取。
6. 回到列表查看账号状态，必要时打开详情核对发现结果和更新时间。

> 【截图占位：统一云服务资产向导，标出 Provider 选择、显示名称、凭据档案、下一步和保存按钮】

## 编辑、查看和删除

- 点击“测试连接”验证账号能否正常连接；测试为只读操作，不会写入云平台。
- 点击“发现资源”读取云平台中的资源。发现完成后，平台按云账号、云产品范围和具体资源建立 Framework/Site 条目。
- 点击“查看资源”可以查看最近一次发现得到的产品、站点条目及发现时间（按本地时间显示）。
- 点击记录可查看 Provider、状态、Framework、Site 数量和更新时间。
- 点击“编辑”可以修改名称和凭据；已创建账号不能更换 Provider。
- 删除前确认没有应用资产或自动化任务依赖该账号。按页面要求输入确认文字后删除，删除后不能恢复账号档案。

当前首个正式验收对象为阿里云 CDN；其他 Provider 的目录或 Fixture 不代表已经正式支持。阿里云 CDN 使用同一账号和同一 API 发现中国大陆、国际站域名，并在发现结果中分别展示两个 Framework。出现异常时先检查凭据是否启用，再联系云服务管理员。不要在截图、备注或聊天中暴露访问密钥。

云账号动作使用接入时固定并可审计的插件版本；版本升级和重新绑定需要重新通过账号绑定和能力校验。其他 Provider 在完成真实连接、发现和审计验收前不视为正式支持。要确认真实云平台连接成功，请在配置了有效云凭据、可访问外网的环境中单独验收。

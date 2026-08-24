---
title: 证书部署
description: 证书部署一级菜单及自动化、工作流模板、执行记录操作地图
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/007-工作流DSL与模板运行管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - web/src/router/menu.ts
  - web/src/router/modules/business.ts
  - backend/src/modules/deployment-plans
testRefs: []
lastVerified: 2026-08-22
---

# 证书部署

证书部署菜单按“自动化 → 工作流模板 → 执行记录”组织。一次部署的实际顺序是：选择应用资产和证书版本 → 解析输入 → Dry Run 预检 → 审批（如启用）→ 执行 → 目标回读验证。

不要直接编辑执行记录或数据库快照。需要变更时回到应用资产、凭据、工作流绑定或自动化规则修改，再创建新的计划。

## 计划阶段看到什么

计划创建时，宿主会解析应用资产、ManagedTarget、插件或工作流版本、Credential（凭据）版本、Artifact（证书制品）和执行位置，生成 `DeploymentInputSnapshotV1`（不可变部署输入快照）。预检会检查租户权限、目标兼容性、证书版本、凭据授权、输入合同、并发锁、Gateway、验证条件和回滚分支。快照固定后，资产配置或凭据轮换不会改变这次执行。

## 证书部署主链

证书部署阶段按 `prepare → backup → install → refresh → verify` 执行：准备和预检、保存目标原状态、写入制品、刷新服务、从目标服务或 TLS 端点回读 SHA-256 指纹。仅看到上传成功或插件返回成功，不能替代目标回读验证。失败时只执行计划声明的回滚分支；非幂等写操作遇到超时应先确认外部状态，不要无条件重放。

---
title: 工作流开发规范
description: TLSFlow v1.0.0 工作流 DSL、模板来源、输入合同和执行边界
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - docs/项目规范/20260723-工作流模板管理及编写规范.md
  - specs/007-工作流DSL与模板运行管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - backend/src/modules/workflow-templates/dto/workflow-templates.dto.ts
  - backend/src/modules/workflow-templates/schema/workflow-templates.schema.ts
  - backend/src/modules/workflow-templates/domain/workflow-templates.domain-service.ts
  - backend/src/modules/executors/ssh
  - backend/src/modules/executors/curl
  - backend/src/modules/executions/application/executors.ts
testRefs: []
lastVerified: 2026-08-22
---

# 工作流开发规范

工作流 DSL（领域专用语言）是 TLSFlow 私有协议，不是任意 Shell 或 JavaScript 脚本。当前正式模板 API 版本为 `gcac.workflow/v1`，模板必须使用 `CurlSshWorkflow` 结构并通过宿主校验。

最小根对象如下，除此之外的根字段会被 Schema 拒绝：

```json
{
  "apiVersion": "gcac.workflow/v1",
  "kind": "CurlSshWorkflow",
  "metadata": { "name": "example-certificate-deploy", "version": "1.0.0" },
  "inputContract": {
    "apiVersion": "gcac.deployment-input/v1",
    "variables": {}, "connections": {}, "credentials": {}, "artifacts": {}
  },
  "steps": []
}
```

`metadata.name` 是稳定标识，`metadata.version` 使用 SemVer（语义化版本号）；数据库编辑历史的整数版本不能替代 DSL 版本。模板不能携带明文密码、Token、私钥或生产凭据。

## 1. 模板来源和版本

- 内置模板只能放在 `backend/src/modules/workflow-templates/builtin-workflows`，随代码发布并受 Git 跟踪。
- 用户导入模板保存到 `data/workflows`，不与内置目录混用。
- 插件包中的工作流资源必须与 Manifest 插件版本一致；更新资源就递增插件版本。
- 数据库 `WorkflowTemplateVersion` 的整数版本是编辑/发布历史，不能代替 DSL `metadata.version`。

## 2. 输入合同

每个模板都要声明 `DeploymentInputContractV1`：

- `variables`：普通值、枚举、对象或数组；
- `connections`：传输方式、主机、端口、TLS 和 SSH Host Key；
- `credentials`：只保存 `credentialId` 和允许的凭据类型；
- `artifacts`：证书、私钥、中间链及输出格式。

字段必须说明类型、是否必填、来源、生命周期和绑定策略。来源可为资产事实、Binding、默认值、派生值、系统值或前置步骤输出。`fixed` 字段不允许用户覆盖；`runtime_injected` 只在运行时注入，不进入应用资产普通表单。

标准投影入口是 `POST /api/v1/deployment-inputs/projection` 和 `POST /api/v1/managed-targets/:managedTargetId/deployment-input-projection`。保存投影与正式预检必须复用同一解析规则。

解析结果必须是 `ResolvedDeploymentInputV1`，包含 `assetContext`、四类输入、`provenance`（来源链）、`sensitivePaths`（敏感路径）、`issues`、`executable` 和 `resolvedSha256`。存在阻断 Issue 或 `executable=false` 时，不得进入 SSH、HTTP、Agent 或 Gateway。输入快照还要固定 Assignment、PluginVersion、PluginBinding、WorkflowVersion、凭据版本和制品摘要；执行与重试不能重新读取“当前最新”配置。

## 3. 可用步骤和执行器

当前工作流使用 SSH（安全远程登录）和 CURL（HTTP 请求执行器）等受控执行器，并可在明确声明时使用 `plugin.action` 调用插件 Runner。步骤只能读取声明的输入和前一步的结构化输出，不能从模板根作用域猜测 Secret。

证书材料通过 Artifact Slot，密码和令牌通过 Credential/`secret://` 引用获取；PEM、私钥和 Secret 不得进入普通变量、命令文本、日志或计划 JSON。

当前 Step 类型只有：`http`、`ssh`、`sftp`、`scp`、`condition`、`transform`、`foreach`、`checkpoint`、`checkpoint_verify`、`wait` 和 `manual`。证书部署阶段固定为 `prepare → backup → install → refresh → verify`；`rollback` 是同一 WorkflowVersion 的独立数组，不是把命令追加到主流程末尾。

### HTTP/CURL

HTTP Step 必须引用 Contract 中的 `connectionRef`。Basic、Bearer、API Key、Cookie、自定义 Header 和 mTLS（双向 TLS）均通过 Credential/SecretRef 注入；URL 只允许 HTTP(S)，默认拒绝明文远程 HTTP。`tls.verify=false` 只有在 `allowInsecure=true`、审批、审计和隔离测试同时满足时才能使用。`extract` 可读取 JSON 路径、响应 Header、正则或状态码，`assert` 可检查状态码、JSON 路径、Header、文本、正则和证书指纹。

### SSH/SFTP/SCP

SSH、SFTP（安全文件传输）和 SCP（安全复制）使用 `connectionRef` 和 Credential Slot。Host Key（主机密钥）策略必须明确为严格校验、首次信任或人工审批；文件上传优先写临时路径，校验大小或哈希后再原子替换。远程路径、权限、Owner/Group、期望哈希和超时都必须进入计划和审计。

`foreach` 必须声明 `itemsPath`、元素变量和子步骤，最大 1000 项、嵌套最多三层；只有只读发现可以使用 `continueOnError`，部署和回滚禁止用它掩盖失败。`plugin.action` 只能调用单个已固定版本的 Runner Action，不能接管工作流顺序。

## 4. 失败、取消和回滚

部署、变更和回滚默认失败关闭；只有只读发现可以按合同允许部分继续。提交和执行使用当前租户部署任务设置，不能由插件自行跳过 Dry Run 或审批。

工作流应在写操作前保存恢复所需的稳定标识和旧值，在写入后执行目标回读。超时或连接中断可能导致外部状态未知，不能自动重放非幂等写操作；必须把状态收敛为失败或 UNKNOWN，并让用户先确认目标实际状态。

`checkpoint` 必须声明名称、捕获路径和是否为回滚必需；`checkpoint_verify` 用实际值和期望哈希检查漂移。宿主为正式执行创建恢复账本和资源锁，每个成功步骤写入账本，步骤结束后回收 Grant。只有幂等步骤允许自动恢复；非幂等步骤必须转人工处理或执行显式补偿。回滚始终使用原始 WorkflowVersion 和输入快照，并同时保留原始失败、回滚结果和最终验证结果。

Windows Remote 当前只有规划或 Mock（模拟）边界，不能在规范中写成已经具备生产执行能力。真实厂商、Gateway、多实例和外部目标验收必须单独记录，单元测试不能替代现场验证。

## 5. 校验清单

1. Schema 校验、资源路径和版本一致性通过。
2. 输入投影只出现合同声明的字段，敏感字段为引用而非明文。
3. 连接测试、发现、部署、回读和失败回滚均有脱敏测试记录。
4. 权限、租户隔离、审批、取消、重试和审计事件通过。
5. 新增 step、stage、变量或执行器后同步更新项目规范，并重新运行文档和相关测试。

证书部署工作流还必须固定 `certificateVersionId` 和 `certificateFormatId`，由宿主生成叶子证书、私钥、中间链、PFX/P12、JKS 或 P7B/P7C 制品。`verify` 阶段必须读取目标服务实际返回的证书指纹；上传成功不等于部署成功。结果同步只有在正式验证成功或回滚成功后才更新当前绑定状态。

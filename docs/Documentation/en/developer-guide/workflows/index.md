---
title: Workflow development
description: Entry point for GCAC workflow DSL and certificate-deployment workflow development
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/007-工作流DSL与模板运行管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - backend/src/modules/workflow-templates
  - backend/src/modules/executors
testRefs: []
lastVerified: 2026-08-02
---

# Workflow development

The workflow DSL is GCAC's private domain protocol, not a script container. Read the DSL and template-source rules first, then the input contract and executor rules, and finally the certificate-deployment main chain.

Development rules:

- New DSL must use `gcac.workflow/v1` and `CurlSshWorkflow`.
- Template files come only from the built-in template directory or the user-import directory; runtime selection must pass through an enabled `executionMode=declarative` PluginVersion.
- Connections, Credentials, Artifacts, and variables must be declared in `DeploymentInputContractV1`.
- Executors consume `ResolvedDeploymentInputV1` and controlled Grants; they must not infer Secrets from template scope or host objects.
- Deployment, change, and rollback fail closed by default. Only read-only discovery may use contract-approved `foreach.continueOnError`.

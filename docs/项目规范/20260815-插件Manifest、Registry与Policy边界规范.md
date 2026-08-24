# 插件 Manifest、Registry 与 Policy 边界规范

> 定位：**面向开发者的操作指引**。技术事实的权威入口是 `specs/004.1-插件包契约、权限与生命周期治理`（Manifest 字段、资源安全、生命周期）、`specs/004.4-插件与工作流版本管理治理`（版本事实源）与 `specs/004.5-插件进程隔离与宿主能力边界重构治理`（Plugin Runner、Host API、Action IPC、DSL 编排权、证书部署执行主链）；DSL 语法、模板来源和 `plugin.action` 步骤合同见 `docs/项目规范/20260723-工作流模板管理及编写规范.md`。本文件只描述开发操作规则，不复制 Spec 的技术事实；两者冲突时以 Spec 为准。本文件不得把包级 Runner 写成工作流执行来源。

## 当前结论

内置插件的唯一版本事实源是包内 `manifest.json` 的 `version`。该字段必须是完整的 SemVer 2.0.0，例如 `1.2.3`、`1.2.3-beta.1` 或带构建元数据的合法版本；`v1.2.3`、`1.2` 和前导零版本均无效。

P2 发布清单属于历史开发证据，不是当前运行时、数据库切换、版本更新脚本或默认开发门禁的输入。任何 P2 清单中的版本、状态、包摘要、Host API Grant 或“是否发布”字段都不能阻塞插件加载或后续版本开发。

## 正式数据流

1. `BuiltinUnifiedPluginLoader` 扫描 `backend/src/modules/plugins/builtin-plugins` 的直接子目录，读取 Manifest 和声明资源，校验资源路径、资源存在性、固定 `runtime/index.js` 入口，并计算包内容。
2. `builtin-plugin-policy.ts` 在内置边界校验 `source=BUILTIN`、Canonical Plugin ID、`PLUGIN_RUNNER` Action 入口、终态 `gcac.plugin-runner/v2` 合同和权限拒绝项；`PLUGIN_RUNNER` 不得成为整份 Workflow 的执行模式。
3. `BuiltinPluginRegistry` 只从 Loader 的已验证包派生 `pluginId`、Manifest 版本、Capability、普通 Workflow 声明、可选 Action 合同、Manifest/资源/包摘要和 Action 入口。重复扫描同摘要幂等；同一 `pluginId@version` 出现不同包内容时只跳过冲突插件并保留其他插件的快照。
4. `unified_plugin_versions`、资源记录和 Workflow Binding 是 Registry/应用服务派生的运行期状态，不得反向覆盖 Manifest。
5. DSL 执行到 `plugin.action` 时，Runner 才使用 Manifest 权限、步骤 Action Binding、Host Permission、Host API Registry 和 `ExecutionGrantService` 做逐次授权；旧 P2 Grant 表不再参与授权。普通 HTTP/SSH 和控制步骤继续由 DSL 执行器处理。

## DSL 主导边界

- 每个部署或回滚都先固定普通 DSL `WorkflowVersion`；顺序、条件、循环、提取、断言、checkpoint、rollback 和最终验证属于 DSL 执行器。
- 只有 DSL 明确声明 `plugin.action` 时，发布器和计划编译器才固定 `pluginVersionId`、Capability、Action ID/版本、输入/输出 Schema、Grant 和资源摘要。
- Runner 只接收当前 Action 的最小结构化输入并返回结构化输出；不得接收步骤数组、变量全集、checkpoint、rollback 或下一步计划。

## 版本更新

使用 `scripts/plugins/update-plugin-version.mjs` 只修改包内 Manifest 顶层 `version`。脚本会校验当前版本、目标版本、资源映射和版本递进关系，并运行内置版本门禁；它不备份、同步或修改任何历史 P2 发布台账。包内容摘要由 Loader/Registry 在加载时重新计算。

插件包内 Workflow 的 `metadata.version` 仍须由 Workflow Schema 校验为合法 SemVer，并且必须与同一包 Manifest 的 `version` 相等。插件内容变化由 Manifest `pluginId@version`、包/资源摘要和数据库 WorkflowVersion 整数记录；旧用户 Workflow DSL 的独立版本规则仍由 Workflow 模板服务负责。

## 测试边界

- 插件自身的 Manifest、资源、Runtime、Action 和产品协议测试应放在对应内置插件包的 `tests/` 与 `fixtures/` 中；已有 `runtime/index.test.mjs` 等相邻测试可以保留。
- Registry、Loader、Policy、权限、Host API、Runner 协议和租户隔离测试属于宿主测试，放在 `backend/src/modules/plugins` 的对应模块目录；多插件共享的故障矩阵和 Compatibility 测试放在独立批次目录。
- 用户插件测试由插件作者自己的源码仓库维护。宿主导入时只执行统一包契约、权限、哈希、Runner 和失败关闭测试，禁止扫描或执行用户包中任意测试代码。
- 按需测试必须记录 `pluginId`、版本和 `packageHash`、`manifestHash`、`resourceHash`；修改共享宿主能力时必须补跑宿主安全门禁和受影响插件批次。

## 禁止事项

- 不得把 P2 清单恢复为 Registry、启动、执行、数据库切换或版本脚本的依赖。
- 不得通过修改数据库、历史发布台账或摘要文件绕过 Manifest 版本递进。
- 不得在 Manifest 中声明任意代码执行、宿主对象调用或文件系统写入等被拒绝权限。
- 不得把 Canonical Plugin ID Registry 当作版本或包摘要账本；它只负责稳定身份集合。
- 不得把宿主公共测试复制到每个插件目录，也不得把插件局部测试当作宿主安全边界的替代。

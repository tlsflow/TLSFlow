# 插件 Manifest、Registry 与 Policy 边界规范

## 当前结论

内置插件的唯一版本事实源是包内 `manifest.json` 的 `version`。该字段必须是完整的 SemVer 2.0.0，例如 `1.2.3`、`1.2.3-beta.1` 或带构建元数据的合法版本；`v1.2.3`、`1.2` 和前导零版本均无效。

P2 发布清单属于历史开发证据，不是当前运行时、数据库切换、版本更新脚本或默认开发门禁的输入。任何 P2 清单中的版本、状态、包摘要、Host API Grant 或“是否发布”字段都不能阻塞插件加载或后续版本开发。

## 正式数据流

1. `BuiltinUnifiedPluginLoader` 扫描 `backend/src/modules/plugins/builtin-plugins` 的直接子目录，读取 Manifest 和声明资源，校验资源路径、资源存在性、固定 `runtime/index.js` 入口，并计算包内容。
2. `builtin-plugin-policy.ts` 在内置边界校验 `source=BUILTIN`、Canonical Plugin ID、`PLUGIN_RUNNER`、`gcac.plugin-runner/v1`、Runner 入口和权限拒绝项。
3. `BuiltinPluginRegistry` 只从 Loader 的已验证包派生 `pluginId`、Manifest 版本、Capability、Workflow 声明、Manifest/资源/包摘要和 Runner 路径。重复扫描同摘要幂等；同一 `pluginId@version` 出现不同包内容时只跳过冲突插件并保留其他插件的快照。
4. `unified_plugin_versions`、资源记录和 Workflow Binding 是 Registry/应用服务派生的运行期状态，不得反向覆盖 Manifest。
5. Runner 执行时继续使用 Manifest 权限、绑定中的 Host Permission、Host API Registry 和 `ExecutionGrantService` 做逐次授权；旧 P2 Grant 表不再参与授权。

## 版本更新

使用 `scripts/plugins/update-plugin-version.mjs` 只修改包内 Manifest 顶层 `version`。脚本会校验当前版本、目标版本、资源映射和版本递进关系，并运行内置版本门禁；它不备份、同步或修改任何历史 P2 发布台账。包内容摘要由 Loader/Registry 在加载时重新计算。

插件包内 Workflow 的 `metadata.version` 仍须由 Workflow Schema 校验为合法 SemVer，但它不是插件版本事实源，也不需要相对历史 Workflow 内容递进。插件内容变化由 Manifest `pluginId@version`、包/资源摘要和数据库 WorkflowVersion 整数记录；旧用户 Workflow DSL 的独立版本规则仍由 Workflow 模板服务负责。

## 禁止事项

- 不得把 P2 清单恢复为 Registry、启动、执行、数据库切换或版本脚本的依赖。
- 不得通过修改数据库、历史发布台账或摘要文件绕过 Manifest 版本递进。
- 不得在 Manifest 中声明任意代码执行、宿主对象调用或文件系统写入等被拒绝权限。
- 不得把 Canonical Plugin ID Registry 当作版本或包摘要账本；它只负责稳定身份集合。

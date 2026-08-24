import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const backendRequire = createRequire(join(repositoryRoot, 'backend/package.json'));
const ts = backendRequire('typescript');
const debtPath = join(scriptDirectory, 'plugin-architecture-debt.json');
export const architectureScanRoots = Object.freeze([
  'backend/src',
  'web/src',
  'backend/src/modules/plugins/builtin-plugins',
  'backend/src/modules/workflow-templates/builtin-workflows',
  'backend/src/modules/plugins/runner',
  'backend/src/modules/licensing/resources',
  'backend/src/modules/legacy-agents',
  'compatibility',
  'data/workflows',
  'agents/linux-go-full-agent',
  'agents/windows-go-full-agent',
  'agents/windows-compat-full-agent',
  'agents/go-ca-node',
  'agents/windows-go-ca-node',
  'agents/linux-go-ca-node',
  'agents/windows-adcs-agent',
]);
const scanRoots = architectureScanRoots;
const mandatoryArchitectureScanRoots = Object.freeze(architectureScanRoots.filter((root) => root !== 'data/workflows'));
const sourceExtensions = new Set(['.bat', '.bash', '.cmd', '.cs', '.fish', '.go', '.json', '.js', '.key', '.mjs', '.pem', '.ps1', '.psd1', '.psm1', '.sh', '.ts', '.tsx', '.vue', '.yaml', '.yml', '.zsh']);
const typedSourceExtensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.vue']);
const ignoredPatterns = [
  /(?:^|\/)dist(?:\/|$)/,
  /(?:^|\/)node_modules(?:\/|$)/,
  /(?:^|\/)database\/migrations(?:\/|$)/,
  /(?:^|\/)generated(?:\/|$)/,
  /(?:^|\/)tests(?:\/|$)/,
  /\.test\.[^.]+$/,
  /\.spec\.[^.]+$/,
  /_test\.go$/,
];
const productTokens = new Set([
  'iis',
  'nginx',
  'apache',
  'httpd',
  'tomcat',
  'rabbitmq',
  'citrix',
  'netscaler',
  'sangfor',
  'synology',
  'fortinet',
  'paloalto',
  'aliyun',
  'tencent',
  'huawei',
  'volcengine',
  'openssl',
  'acme',
  'adcs',
  'dns',
  'keystore',
]);
const productImplementationPattern = /(?:IIS|Nginx|Apache|Httpd|Tomcat|RabbitMQ|RabbitMq|Citrix|Netscaler|Sangfor|Synology|Fortinet|PaloAlto|Aliyun|Tencent|Huawei|Volcengine|OpenSSL|Acme|Adcs|JavaKeystore).*(?:Driver|Executor|Tester|Projector|Provider|Adapter|Handler)$/i;
const goProductActionPattern = /["'`](?:windows|linux)\.(?:iis|nginx|apache|httpd|tomcat|rabbitmq|citrix|netscaler|sangfor|synology|fortinet|paloalto|aliyun|tencent|huawei|volcengine|openssl|acme|adcs|java-keystore)\.deploy_certificate["'`]/i;
const goProductActionHandlerPattern = /\b(?:windows|linux)?(?:IIS|Nginx|Apache|Httpd|Tomcat|RabbitMQ|RabbitMq|Citrix|Netscaler|Sangfor|Synology|Fortinet|PaloAlto|Aliyun|Tencent|Huawei|Volcengine|OpenSSL|Acme|Adcs|JavaKeystore)\w*ActionHandler\s*\(/i;
const goProductRegistryPattern = /(?:AdapterID\s*:\s*(?:\w+\.)?Product(?:IIS|Nginx|Apache|Httpd|Tomcat|RabbitMQ|RabbitMq|Citrix|Netscaler|Sangfor|Synology|Fortinet|PaloAlto|Aliyun|Tencent|Huawei|Volcengine|OpenSSL|Acme|Adcs|JavaKeystore)|ResolveProduct\s*\()/i;
const goProductCapabilityCatalogPattern = /\bCapability(?:IIS|Nginx|Apache|Httpd|Tomcat|RabbitMQ|RabbitMq|Citrix|Netscaler|Sangfor|Synology|Fortinet|PaloAlto|Aliyun|Tencent|Huawei|Volcengine|OpenSSL|Acme|Adcs|JavaKeystore)\w*\b/;
const csharpProductHandlerPattern = /\b(?:Iis|Nginx|Apache|Httpd|Tomcat|RabbitMq|Citrix|Netscaler|Sangfor|Synology|Fortinet|PaloAlto|Aliyun|Tencent|Huawei|Volcengine|OpenSsl|Acme|Adcs|JavaKeystore)\w*(?:DeploymentHandler|Provider|Executor|Handler)\s*(?:\(|\{|=)/i;
const ownerDriverKinds = new Set(['AGENT_NATIVE', 'AGENT_PLUGIN', 'DEVICE_PLUGIN']);
const legacyApiPattern = /^\/api\/v1\/(?:providers(?:\/discovery-runs)?|provider-discovery-results|provider-discovery-result|plugins\/(?:packages|permissions\/approve|enable|disable|execute|executions|step-draft|permission-summary|capabilities))$/;
const canonicalPluginIds = new Set([
  'web.nginx',
  'web.apache',
  'web.iis',
  'app.tomcat',
  'app.java-keystore',
  'app.rabbitmq',
  'app.service-certificate-file',
  'device.citrix.netscaler-adc',
  'device.synology-dsm',
  'cloud.aliyun',
  'cloud.tencent',
  'cloud.huawei',
  'cloud.volcengine',
  'ca.microsoft-adcs',
]);
const fixturePluginIdPattern = /^(?:fixture|test)\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;
const productIdentifierPattern = /(?:iis|nginx|apache|httpd|tomcat|rabbitmq|citrix|netscaler|synology|aliyun|tencent|huawei|volcengine|openssl|acme|adcs|dns|java[-_. ]?keystore)/i;
const builtinPluginsPathPattern = /(?:^|\/)builtin-plugins(?:\/|$)/;
const pluginPackagePathPattern = /(?:^|\/)builtin-plugins\/[^/]+\//;
const pluginModuleSpecifierPattern = /(?:^|\/)builtin-plugins\/(?!builtin-unified-plugin-loader(?:[./]|$))[^/]+(?:\/|$)/i;
// Registry 和唯一插件 Catalog 只提供插件身份、包摘要和资源索引；它们不是插件 Runtime，宿主可以静态读取其元数据。
const pluginMetadataModuleSpecifierPattern = /(?:^|\/)builtin-plugins\/builtin-plugin-registry(?:\.[^/]+)?$/i;
const builtinWorkflowPathPattern = /(?:^|\/)builtin-workflows(?:\/|$)/;
const pluginWorkflowPathPattern = /(?:^|\/)builtin-plugins\/[^/]+\/workflows(?:\/|$)/;
const userWorkflowPathPattern = /(?:^|\/)data\/workflows(?:\/|$)/;
const workflowPathPattern = new RegExp(`${builtinWorkflowPathPattern.source}|${pluginWorkflowPathPattern.source}|${userWorkflowPathPattern.source}`);
const hostWorkflowPathPattern = new RegExp(`${builtinWorkflowPathPattern.source}|${userWorkflowPathPattern.source}`);
const agentPathPattern = /^agents\/(?:windows-go-full-agent|linux-go-full-agent|windows-compat-full-agent|go-ca-node|windows-go-ca-node|linux-go-ca-node|windows-adcs-agent)(?:\/|$)/;
const agentCorePathPattern = /^agents\/(?:windows-go-full-agent|linux-go-full-agent|go-ca-node|windows-go-ca-node|linux-go-ca-node|windows-adcs-agent)(?:\/|$)|^agents\/windows-compat-full-agent\/(?!agent-side-plugins(?:\/|$))/;
const caNodePathPattern = /^agents\/(?:go-ca-node|windows-go-ca-node|linux-go-ca-node|windows-adcs-agent)(?:\/|$)/;
const compatibilityContractPathPattern = /(?:^|\/)(?:compatibility|legacy-agents)(?:\/|$)/;
const testPathPattern = /(?:^|\/)(?:tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[^.]+$|_test\.go$/;
const architectureFixturePathPattern = /(?:^|\/)scripts\/architecture\/fixtures(?:\/|$)/;
// 安全合同 JSON 是测试输入，不是运行时信任根；只匹配已登记的两份合同 Fixture，避免放行任意生产文件。
const securityContractFixturePathPattern = /(?:^|\/)backend\/src\/modules\/agents\/security\/fixtures\/agent-security\.(?:valid|invalid)\.json$/;
const migrationPathPattern = /(?:^|\/)database\/migrations(?:\/|$)/;
const translationResourcePathPattern = /(?:^|\/)i18n(?:\/|$)/;
const defaultDevelopmentLicenseKeyPattern = /\b(?:builtin[-_]dev|gcac[-_]development)(?:[-_][A-Za-z0-9_-]+)?|\b(?:default|development|test|example|sample|placeholder)(?:[-_ ]?(?:dev|development|default|license|certificate|signing|issuer|policy|trust|private|public|secret|token|password|agent|authority|auth|api|encryption|storage|root))?[-_ ]+(?:key|secret)\b|\bdev[-_ ](?:key|license|certificate|signing|issuer|policy|trust|private|public|secret|token|password|agent|authority|auth|api|encryption|storage|root)[-_ ]*key\b|\b(?:key|secret|token|password|signing|issuer|policy|trust|private|public)[-_ ](?:default|development|test|example|sample|placeholder)[-_ ]+(?:key|secret)\b/gi;
const defaultDevelopmentKeyFieldPattern = String.raw`(?:license(?:[-_ ]?(?:trust|authority))?[-_ ]?key|agent[-_ ]?key|policy[-_ ]?(?:authority[-_ ]?)?key|authority[-_ ]?key|trust[-_ ]?(?:root|anchor|key)|issuer[-_ ]?key|signing[-_ ]?key|api[-_ ]?key|storage[-_ ]?key|encryption[-_ ]?key|secret[-_ ]?key|private[-_ ]?key|public[-_ ]?key|key(?:Id|ID|Name|Set)|defaultKey|developmentKey|secretKey)`;
const defaultDevelopmentLicenseKeyValuePattern = new RegExp(
  String.raw`(?:\b${defaultDevelopmentKeyFieldPattern}\b\s*[:=]\s*|["']${defaultDevelopmentKeyFieldPattern}["']\s*:\s*)["'](?:(?:default|development|dev|test|example|sample|placeholder)(?:[-_ ]?(?:dev|development|default|license|certificate|signing|issuer|policy|trust|private|public|secret|token|password|agent|authority|auth|api|encryption|storage|root))?[-_ ]*(?:key|secret)|change[-_ ]?me|(?:default|development|dev|test|example|sample|placeholder))["']`,
  'gi',
);
const issuerPrivateKeyMaterialPattern = /-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----|["'](?:issuer[-_]?private[-_]?key|private[-_]?key)["']\s*:/gi;
const issuerPrivateKeyPathPattern = /(?:^|\/)(?:issuer|signing)(?:[-_](?:private|signing))?[-_]key(?:\.[^/]+)?$/i;
const licensingSourcePathPattern = /(?:^|\/)backend\/src\/modules\/licensing(?:\/|$)/;
const removedPluginSchemaReferencePattern = /['"][^'"]*(?:agent-deployment-plugins|plugin-action-aliases)\.schema(?:\.[a-z]+)?['"]/gi;
const removedPluginRuntimeReferencePattern = /\bAGENT_ATOMIC\b/g;
const agentPowerShellExecutionPattern = /\b(?:powershell|pwsh)(?:\.exe)?\b[^;\r\n]{0,200}-(?:c|command|encodedcommand|encoded|file)\b|\b(?:Invoke-Expression|iex|Invoke-Command|Invoke-Item|Start-Process|Start-Job|Start-ThreadJob)\b/gi;
const agentPowerShellCallOperatorPattern = /(?:^|[;&|]\s*)&\s*(?:\$(?:(?:command|cmd|shell|script|payload|exec|download)[A-Za-z0-9_$]*|[A-Za-z_][A-Za-z0-9_$]*(?:command|cmd|shell|script|payload|exec|download)[A-Za-z0-9_$]*)|[.][\\/][^\s;&|]+\.(?:ps1|psm1|cmd|bat)\b)|(?:^|[;&|]\s*)\.\s+(?:[.][\\/]|[A-Za-z]:|\/)[^\s;&|]+\.(?:ps1|psm1|cmd|bat)\b/gi;
const agentShellExecutionPattern = /["']--shell["']|\b(?:sh|bash|dash|zsh|fish|cmd|cmd\.exe|command\.com)\s+(?:-c|\/c)\b|\b(?:exec\.Command(?:Context)?|ProcessStartInfo)\s*\([^;\r\n]*\b(?:sh|bash|dash|zsh|fish|cmd|cmd\.exe|command\.com|powershell|powershell\.exe|pwsh|pwsh\.exe)\b[^;\r\n]*(?:-c|\/c|-command|-encodedcommand|-file)\b/gi;
// go-ca-node 已废弃，生产路径不得再保留 OpenSSL 或任何子进程执行旁路。
// Agent 只允许固定通用程序；任何把请求字段直接交给进程启动器的写法都必须失败。
const agentFreeCommandExecutionPattern = /\b(?:exec\.Command(?:Context)?|os\.StartProcess|Process\.Start)\s*\(\s*(?:command|cmd|commandLine|shell|script|payload|request|input|executable|executablePath)\b|\bnew\s+ProcessStartInfo\s*\(\s*(?:command|cmd|commandLine|shell|script|payload|request|input|executable|executablePath)\b/gi;
const agentInterpreterProcessPattern = /\b(?:exec\.Command(?:Context)?|ProcessStartInfo|Process\.Start)\s*\([^;\r\n]*\b(?:sh|bash|dash|zsh|fish|cmd|cmd\.exe|command\.com|powershell|powershell\.exe|pwsh|pwsh\.exe|python|python3|perl|ruby|node)\b[^;\r\n]*\)/gi;
const agentActionAliasPattern = /\b(?:RegisterAlias(?:Descriptor)?|registry\s*\.\s*aliases|aliases\s*(?::|\s)\s*map\s*\[\s*string\s*\]\s*string)\b/gi;
const caNodeOpenSslPattern = /\bopenssl(?:\.exe)?\b/gi;
const caNodeProcessExecutionPattern = /(?:["'](?:os\/exec|node:child_process|child_process)["']|\b(?:exec\.Command(?:Context)?|os\.StartProcess|syscall\.Exec(?:ve)?|ProcessStartInfo|Process\.Start|child_process\.(?:exec|execFile|fork|spawn)|(?:exec|execFile|spawn)(?:Sync)?)\s*\()/gi;
const strictAgentDownloadExecutionSinkPattern = /\b(?:Invoke-Expression|iex|Start-Process)\b|\b(?:Process\.Start|ProcessStartInfo|execFile(?:Sync)?|spawn(?:Sync)?|exec(?:Sync)?|exec\.Command(?:Context)?|os\.StartProcess|syscall\.Exec|eval|new\s+Function|vm\.runIn(?:NewContext|ThisContext))\s*\(|\b(?:powershell|pwsh)(?:\.exe)?\b[^\r\n;|]*(?:-(?:c|command|encodedcommand|encoded|file)\b|(?:\$[A-Za-z_]|[.][\\/]|[A-Za-z]:|\/))|\b(?:cmd|cmd\.exe|command\.com)\s+(?:\/c|\/k)\b|\b(?:sh|bash|dash|zsh|fish|python(?:3)?|perl|ruby|node)(?:\.exe)?\s+(?:-c\b|[.][\\/]|[A-Za-z]:|\/|\$[A-Za-z_]|[A-Za-z0-9_.-]+\.(?:sh|py|js))|(?:^|[;&|]\s*)&\s*(?:\$[A-Za-z_][\w$]*|[.][\\/][^\s;&|]+|[A-Za-z]:[^\s;&|]+|\/[^\s;&|]+)|(?:^|[;&|]\s*)\.\s+\$[A-Za-z_][\w$]*|(?:^|[;&|]\s*)\.[\\/][^\s;&|]+|(?:\|\s*)(?:iex|Invoke-Expression|powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?|command\.com|sh|bash|dash|zsh|fish|python(?:3)?|perl|ruby|node)\b/i;
const agentProductIdentityPattern = /(?:\b(?:product(?:Name|Id|Family)?|product[_-](?:name|id|family)|framework(?:Type|Key)?|framework[_-](?:type|key)|detected(?:Product|Framework)|detected[_-](?:product|framework)|vendor(?:Name|Id)?|vendor[_-](?:name|id)|software(?:Name|Product)?|software[_-](?:name|product))\b\s*(?::=|=|:)\s*["'`][^"'`]*(?:iis|nginx|apache|httpd|tomcat|rabbitmq|citrix|netscaler|sangfor|synology|fortinet|paloalto|aliyun|tencent|huawei|volcengine|openssl|acme|adcs|dns|java[-_. ]?keystore)[^"'`]*["'`]|["'`](?:productName|productId|productFamily|product_name|product_id|product_family|frameworkType|frameworkKey|framework_type|framework_key|detectedProduct|detectedFramework|vendorName|vendorId|softwareName|softwareProduct)["'`]\s*:\s*["'`][^"'`]*(?:iis|nginx|apache|httpd|tomcat|rabbitmq|citrix|netscaler|sangfor|synology|fortinet|paloalto|aliyun|tencent|huawei|volcengine|openssl|acme|adcs|dns|java[-_. ]?keystore)[^"'`]*["'`])/gi;
const agentProductFactPattern = /["'`][^"'`]*(?:iis|nginx|apache|httpd|tomcat|rabbitmq|citrix|netscaler|sangfor|synology|fortinet|paloalto|aliyun|tencent|huawei|volcengine|openssl|acme|adcs|dns|java[-_. ]?keystore)[._:/-](?:version|config|path|site|product|framework)[^"'`]*["'`]/gi;
const hostProviderSignerPattern = /\b(?:ProviderSigner|providerSigner|sign(?:Aliyun|Tencent|Huawei|Volcengine)(?:Rpc|Request)?)\b/g;
const hostProviderBaselinePattern = /\b(?:providerBaselines?|baselineDefinition)\b/g;
const hostTrustedJsRuntimePattern = /\b(?:TrustedJs|TrustedJS|TrustedJsPlugin|TrustedJsRuntime)\w*\b|["'`](?:TRUSTED_JS|trusted_js)["'`]|trusted[-_]js/gi;
const legacyAgentContractPattern = /["'](?:agent\.atomic_plan\.execute|agent\.execute)["']/g;
const workflowRawScriptPattern = /(?:["'`](?:script|rawScript)["'`]\s*:\s*["'`][^"'`\r\n]+["'`]|["'`]mode["'`]\s*:\s*["'`]script["'`]|(?:^|[,{;\s])(?:script|rawScript)\s*[:=]\s*["'`][^"'`\r\n]+["'`])/gi;
const pluginDatabaseAccessPattern = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["'](?:node:)?(?:sqlite|sqlite3|pg|mysql2?|mssql|oracledb|mongodb|sequelize|typeorm|prisma)[^"']*["']|\bnew\s+(?:Database|Client|Pool|PrismaClient)\s*\(|\b(?:database|db|connection|repository)\s*\.\s*(?:query|execute|prepare|transaction)\s*\(/gi;
const directAgentConsumerPattern = /\b(?:AgentDirectClient|agentDirectClient|directAgentClient)\b|["'][^"']*agent-direct-client(?:\.[^"']*)?["']/gi;
const registeredHostApiMethods = new Set([
  'artifact.grant.read',
  'secret.grant.resolve',
  'cloudService.get',
  'http.request',
  'execution.progress',
  'execution.checkpoint.save',
  'execution.checkpoint.load',
  'execution.isCancelled',
  'resourceLock.acquire',
  'resourceLock.release',
  'audit.append',
]);
const hostApiInvocationMethods = new Set(['call', 'invoke', 'request']);
const pluginObjectCallPattern = /\b(?:plugin|pluginObject|pluginInstance)\.(?:invoke|instance(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?)\s*\(/g;
const moduleAssetExtensions = new Set(['.css', '.gif', '.ico', '.jpeg', '.jpg', '.less', '.png', '.sass', '.scss', '.svg', '.webp', '.woff', '.woff2']);
const architectureClassifications = {
  PRODUCTION: 'PRODUCTION',
  BUILTIN_PLUGIN: 'BUILTIN_PLUGIN',
  BUILTIN_WORKFLOW: 'BUILTIN_WORKFLOW',
  TEST_FIXTURE: 'TEST_FIXTURE',
  MIGRATION: 'MIGRATION',
};

function normalizePath(path) { return path.replaceAll('\\', '/'); }
function shouldIgnore(path) { return ignoredPatterns.some((pattern) => pattern.test(path)); }
function classifyPath(path) {
  const normalizedPath = normalizePath(path);
  if (testPathPattern.test(normalizedPath) || architectureFixturePathPattern.test(normalizedPath) || securityContractFixturePathPattern.test(normalizedPath)) return architectureClassifications.TEST_FIXTURE;
  if (migrationPathPattern.test(normalizedPath)) return architectureClassifications.MIGRATION;
  if (builtinWorkflowPathPattern.test(normalizedPath)) return architectureClassifications.BUILTIN_WORKFLOW;
  if (pluginPackagePathPattern.test(normalizedPath)) return architectureClassifications.BUILTIN_PLUGIN;
  if (agentPathPattern.test(normalizedPath)) return architectureClassifications.PRODUCTION;
  return architectureClassifications.PRODUCTION;
}
function isAgentPath(path) { return agentPathPattern.test(normalizePath(path)); }
function isAgentCorePath(path) { return agentCorePathPattern.test(normalizePath(path)); }
function isCaNodePath(path) { return caNodePathPattern.test(normalizePath(path)); }
function isBuiltinPluginPath(path) { return pluginPackagePathPattern.test(normalizePath(path)); }
function isBuiltinWorkflowPath(path) { return builtinWorkflowPathPattern.test(normalizePath(path)); }
function isWorkflowPath(path) { return workflowPathPattern.test(normalizePath(path)); }
function isHostWorkflowPath(path) { return hostWorkflowPathPattern.test(normalizePath(path)); }
function isTranslationResourcePath(path) { return translationResourcePathPattern.test(normalizePath(path)); }
function isAgentContractPath(path) {
  const normalizedPath = normalizePath(path);
  return agentPathPattern.test(normalizedPath)
    || isWorkflowPath(normalizedPath)
    || compatibilityContractPathPattern.test(normalizedPath);
}
function isProductionContractPath(path) {
  const normalizedPath = normalizePath(path);
  return !testPathPattern.test(normalizedPath)
    && !architectureFixturePathPattern.test(normalizedPath)
    && !securityContractFixturePathPattern.test(normalizedPath)
    && !migrationPathPattern.test(normalizedPath);
}
function isCanonicalPluginId(value) { return canonicalPluginIds.has(value); }
function isFixturePluginId(value) { return fixturePluginIdPattern.test(value); }
function shouldReportNonCanonicalPluginBinding(value) { return !isCanonicalPluginId(value) && !isFixturePluginId(value); }
function isProductionHostPath(path) {
  const normalizedPath = normalizePath(path);
  return normalizedPath.startsWith('backend/src/') || normalizedPath.startsWith('web/src/');
}
function isHostCodePath(path) {
  const normalizedPath = normalizePath(path);
  return isProductionHostPath(normalizedPath) && !isBuiltinPluginPath(normalizedPath) && !isWorkflowPath(normalizedPath);
}
function isHostSemanticCodePath(path) {
  return isHostCodePath(path) && !isTranslationResourcePath(path);
}
/**
 * ACME、LEGO DNS Solver 与 OpenSSL 内置 CA 是宿主证书运行时。
 * 这里仅豁免其实现目录和组合根；外部 CA 仍必须通过 PluginVersion 绑定。
 */
function isNativeCaRuntimePath(path) {
  const normalizedPath = normalizePath(path);
  return normalizedPath.startsWith('backend/src/modules/internal-ca/')
    || normalizedPath === 'backend/src/app.module.ts';
}
function isRunnerExecutorLoaderPath(path) {
  return normalizePath(path) === 'backend/src/modules/plugins/runner/plugin-runner-executor.ts';
}
function isRetiredAgentDirectRejectorPath(path) {
  return normalizePath(path) === 'backend/src/modules/agents/application/agent-direct-client.ts';
}
function isApprovedManualWebDiscoveryDirectUsage(path, source, offset) {
  if (normalizePath(path) !== 'backend/src/modules/agents/application/agents.application-service.ts') return false;
  const lineStart = Math.max(source.lastIndexOf('\n', offset - 1), source.lastIndexOf('\r', offset - 1)) + 1;
  const lineEnd = source.indexOf('\n', offset) < 0 ? source.length : source.indexOf('\n', offset);
  const line = source.slice(lineStart, lineEnd);
  return /\bimport\s*\{\s*AgentDirectClient\s*\}/.test(line)
    || /\bprivate\s+readonly\s+directAgentClient\s*=\s*new\s+AgentDirectClient\s*\(\s*\)/.test(line)
    || /\bthis\.directAgentClient\.refreshWebInventory\s*\(/.test(line);
}
function isLegacyApiConsumerPath(path) {
  const normalizedPath = normalizePath(path);
  return normalizedPath.startsWith('web/') || normalizedPath.startsWith('scripts/');
}
function textOf(node, sourceFile) { return node.getText(sourceFile); }
function stringValue(node) { return ts.isStringLiteralLike(node) ? node.text : undefined; }
function propertyName(node) { return node.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) ? node.name.text : undefined; }
function containsProduct(value) {
  const normalized = String(value).toLowerCase().replaceAll(/[^a-z0-9]+/g, ' ');
  return normalized.split(' ').some((token) => productTokens.has(token));
}
function isImplementationConstructor(node) {
  if (!ts.isNewExpression(node)) return false;
  const name = textOf(node.expression, node.getSourceFile());
  return productImplementationPattern.test(name);
}
function isSelectionNode(node) {
  return ts.isIfStatement(node) || ts.isSwitchStatement(node) || ts.isConditionalExpression(node) || ts.isCaseClause(node);
}
function functionAnchor(node) {
  let current = node;
  while (current) {
    if (ts.isMethodDeclaration(current) || ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
      return current.name && ts.isIdentifier(current.name) ? current.name.text : '<anonymous>';
    }
    if (ts.isClassDeclaration(current) && current.name) return current.name.text;
    current = current.parent;
  }
  return '<module>';
}
function fingerprint(rule, path, anchor, excerpt) {
  return createHash('sha256').update(`${rule}\n${path}\n${anchor}\n${excerpt.replace(/\s+/g, ' ').trim()}`).digest('hex').slice(0, 16);
}
function makeFinding(rule, path, sourceFile, node, message) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const excerpt = textOf(node, sourceFile).split(/\r?\n/, 1)[0].trim().slice(0, 240);
  const anchor = functionAnchor(node);
  return {
    rule,
    path,
    line: position.line + 1,
    column: position.character + 1,
    nodeKind: ts.SyntaxKind[node.kind],
    anchor,
    excerpt,
    message,
    classification: classifyPath(path),
    fingerprint: fingerprint(rule, path, anchor, excerpt),
  };
}
function makeTextFinding(rule, path, source, offset, message, anchor = '<text>') {
  const normalizedPath = normalizePath(path);
  const safeOffset = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, safeOffset);
  const line = before.split(/\r?\n/).length;
  const lineStart = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r')) + 1;
  const lineEnd = source.indexOf('\n', safeOffset) < 0 ? source.length : source.indexOf('\n', safeOffset);
  const excerpt = source.slice(lineStart, lineEnd).trim().slice(0, 240);
  return {
    rule,
    path: normalizedPath,
    line,
    column: safeOffset - lineStart + 1,
    nodeKind: 'SourceText',
    anchor,
    excerpt,
    message,
    classification: classifyPath(normalizedPath),
    fingerprint: fingerprint(rule, normalizedPath, anchor, excerpt),
  };
}
function addTextMatches(findings, rule, path, source, pattern, message, anchor = '<text>', shouldReport = () => true) {
  const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
  for (const match of source.matchAll(globalPattern)) {
    const offset = match.index ?? 0;
    if (shouldReport(source, offset, match[0])) findings.push(makeTextFinding(rule, path, source, offset, message, anchor));
  }
}
function isRetiredContractMarker(source, offset) {
  const lineStart = Math.max(source.lastIndexOf('\n', offset - 1), source.lastIndexOf('\r', offset - 1)) + 1;
  const lineEnd = source.indexOf('\n', offset) < 0 ? source.length : source.indexOf('\n', offset);
  const line = source.slice(lineStart, lineEnd);
  return /\b(?:const|let|var)\s+(?:removed|deprecated|forbidden|unsupported|retired)[A-Za-z0-9_$]*\s*=\s*['"](?:command\.execute|agent\.execute|agent\.atomic_plan\.execute)['"]/.test(line);
}
function isDefaultKeyRejectionContext(source, offset) {
  const lineStart = Math.max(source.lastIndexOf('\n', offset - 1), source.lastIndexOf('\r', offset - 1)) + 1;
  const lineEnd = source.indexOf('\n', offset) < 0 ? source.length : source.indexOf('\n', offset);
  const context = source.slice(Math.max(0, lineStart - 240), Math.min(source.length, lineEnd + 240));
  return /(?:reject|revoke|forbid|deny|fail.?closed|invalid|unsafe|return\s+false|throw)/i.test(context)
    && /(?:\.(?:test|includes|some|filter|match)\s*\(|\b(?:strings\.)?(?:contains|hasprefix|hassuffix)\s*\(|\b(?:regexp|regex|matches?)\b|===|!==)/i.test(context);
}
function extractVueScript(source) {
  const output = source.split(/\r?\n/).map(() => '');
  for (const match of source.matchAll(/<script(?:\s+setup)?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const content = match[1] ?? '';
    const start = (match.index ?? 0) + match[0].indexOf(content);
    const before = source.slice(0, start).split(/\r?\n/).length - 1;
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => { output[before + index] = line; });
  }
  return output.join('\n');
}
function collectStringLiterals(node) {
  const values = [];
  const visit = (child) => {
    const value = stringValue(child);
    if (value !== undefined) values.push(value);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return values;
}
function containsOwnerSource(node, sourceFile) {
  return Boolean(node) && /\b(?:agentId|deviceAsset|owner|executionLocation|executionLocations)\b/.test(textOf(node, sourceFile));
}
function containsDriverSink(node, sourceFile) {
  if (!node) return false;
  const text = textOf(node, sourceFile);
  return /\bdriverKind\b/.test(text) || [...ownerDriverKinds].some((kind) => text.includes(`'${kind}'`) || text.includes(`"${kind}"`));
}
function selectionCondition(node) {
  if (ts.isIfStatement(node) || ts.isConditionalExpression(node)) return node.expression;
  if (ts.isSwitchStatement(node)) return node.expression;
  return node;
}
function selectionBranches(node) {
  if (ts.isIfStatement(node)) return [node.thenStatement, node.elseStatement].filter(Boolean);
  if (ts.isConditionalExpression(node)) return [node.whenTrue, node.whenFalse];
  if (ts.isSwitchStatement(node)) return [node.caseBlock];
  return [node];
}
function isFrameworkCollectionName(node, sourceFile) {
  return /frameworkTypes?|FrameworkType/.test(textOf(node, sourceFile));
}
function hasFixedFrameworkProducts(node) {
  return collectStringLiterals(node).filter(containsProduct).length >= 2;
}
function frameworkCollectionOwner(node) {
  let current = node.parent;
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current))) current = current.parent;
  return current;
}
function isFixedCommandTemplateTable(node) {
  if (!ts.isObjectLiteralExpression(node) || node.properties.length < 2) return false;
  return node.properties.every((property) => {
    if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) return false;
    const fields = new Set(property.initializer.properties.map((field) => propertyName(field)).filter(Boolean));
    return fields.has('program') && fields.has('fixedArgs') && fields.has('valueCount');
  });
}
function isVendorDispatchTable(node, sourceFile) {
  if (!ts.isObjectLiteralExpression(node)) return false;
  if (isFixedCommandTemplateTable(node)) return false;
  const ownerText = declarationContextText(node, sourceFile);
  if (!/(?:provider|framework|product|adapter|driver|executor|projector|implementation|runtime|template|preset)/i.test(ownerText)) return false;
  const keys = node.properties.map((property) => propertyName(property)).filter(Boolean);
  return keys.filter(containsProduct).length >= 2;
}
function declarationContextText(node, sourceFile) {
  let current = node;
  for (let depth = 0; current && depth < 6; depth += 1, current = current.parent) {
    if (ts.isVariableDeclaration(current) || ts.isPropertyDeclaration(current) || ts.isTypeAliasDeclaration(current)) {
      return textOf(current, sourceFile);
    }
  }
  return textOf(node.parent ?? node, sourceFile);
}
function declarationContextName(node, sourceFile) {
  let current = node;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parent) {
    if (ts.isVariableDeclaration(current) || ts.isPropertyDeclaration(current) || ts.isTypeAliasDeclaration(current)) {
      return textOf(current.name, sourceFile);
    }
  }
  return '';
}
function isProductCatalogArray(node, sourceFile) {
  if (!ts.isArrayLiteralExpression(node) || !hasFixedFrameworkProducts(node)) return false;
  return /(?:provider|framework|product|runtime|template|preset|operation|permission|scope)/i.test(declarationContextName(node, sourceFile));
}
function isProductOperationContract(node, sourceFile) {
  const values = collectStringLiterals(node);
  if (!values.some((value) => containsProduct(value) && /(?:binding|deploy|certificate|install|update|restore|capture)/i.test(value))) return false;
  if (ts.isUnionTypeNode(node)) return /operation/i.test(declarationContextName(node, sourceFile));
  return ts.isArrayLiteralExpression(node) && /(?:operationTypes?|permissions?|scopes?)/i.test(declarationContextName(node, sourceFile));
}
function isProductCapabilityCatalogCall(node, sourceFile) {
  if (!ts.isCallExpression(node) || textOf(node.expression, sourceFile) !== 'definition') return false;
  const key = stringValue(node.arguments[0]);
  return Boolean(key && containsProduct(key) && /builtInCapabilityDefinitions/.test(declarationContextText(node, sourceFile)));
}
function isProductActionAliasTable(node, sourceFile) {
  if (!ts.isNewExpression(node) || textOf(node.expression, sourceFile) !== 'Map') return false;
  const owner = node.parent;
  if (!/(?:alias|action)/i.test(textOf(owner ?? node, sourceFile))) return false;
  return collectStringLiterals(node).some((value) => containsProduct(value) && /deploy|certificate|install|update/i.test(value));
}
function declaredName(node, sourceFile) {
  const owner = frameworkCollectionOwner(node);
  if (ts.isVariableDeclaration(owner) || ts.isTypeAliasDeclaration(owner) || ts.isPropertyDeclaration(owner) || ts.isParameter(owner)) {
    return textOf(owner.name, sourceFile);
  }
  return undefined;
}
function memberReceiverName(node, sourceFile) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  const receiver = textOf(node.expression.expression, sourceFile);
  return receiver.split('.').at(-1);
}
function isHostApiInvocation(node, sourceFile) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const method = node.expression.name.text;
  if (!hostApiInvocationMethods.has(method)) return false;
  const receiver = textOf(node.expression.expression, sourceFile).split('.').at(-1) ?? '';
  return /^(?:hostApi|hostAPI|pluginHostApi|runnerHostApi)$/i.test(receiver);
}
function isFrameworkAllowlist(node, sourceFile, membershipCollections) {
  if (ts.isArrayLiteralExpression(node) || ts.isUnionTypeNode(node)) {
    if (!hasFixedFrameworkProducts(node)) return false;
    const owner = frameworkCollectionOwner(node);
    if (ts.isNewExpression(owner)) return false;
    const name = declaredName(node, sourceFile);
    if (ts.isUnionTypeNode(node)) return Boolean(name && isFrameworkCollectionName(owner ?? node, sourceFile) && !collectStringLiterals(node).includes('string'));
    return Boolean(name && membershipCollections.has(name));
  }
  if (ts.isNewExpression(node)) {
    const constructor = textOf(node.expression, sourceFile);
    const name = declaredName(node, sourceFile);
    return /^(?:Set|Map)$/.test(constructor) && hasFixedFrameworkProducts(node) && Boolean(name && membershipCollections.has(name));
  }
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const method = node.expression.name.text;
  if (!['includes', 'has', 'get'].includes(method)) return false;
  return isFrameworkCollectionName(node.expression.expression, sourceFile);
}
function findGuardedSelection(node, sourceFile, pattern) {
  let current = node.parent;
  while (current && !ts.isSourceFile(current)) {
    const condition = isSelectionNode(current) ? selectionCondition(current) : undefined;
    if (condition && pattern.test(textOf(condition, sourceFile))) return current;
    if (ts.isFunctionLike(current)) return undefined;
    current = current.parent;
  }
  return undefined;
}

function collectModuleLoadAliases(sourceFile) {
  const aliases = new Set(['require']);
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (ts.isIdentifier(node.initializer) && node.initializer.text === 'require') aliases.add(node.name.text);
      if (ts.isCallExpression(node.initializer) && isCreateRequireCall(node.initializer, sourceFile)) aliases.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return aliases;
}

function memberCallParts(expression, sourceFile) {
  if (ts.isPropertyAccessExpression(expression)) {
    return { receiver: textOf(expression.expression, sourceFile), method: expression.name.text };
  }
  if (ts.isElementAccessExpression(expression)) {
    const method = expression.argumentExpression ? stringValue(expression.argumentExpression) : undefined;
    if (method !== undefined) return { receiver: textOf(expression.expression, sourceFile), method };
  }
  return undefined;
}

function isCreateRequireExpression(expression, sourceFile) {
  if (ts.isIdentifier(expression)) return expression.text === 'createRequire';
  const member = memberCallParts(expression, sourceFile);
  return member?.method === 'createRequire' && /^(?:module|Module)$/.test(member.receiver);
}

function isCreateRequireCall(node, sourceFile) {
  return ts.isCallExpression(node) && isCreateRequireExpression(node.expression, sourceFile);
}

function isDynamicModuleLoad(node, sourceFile, moduleLoadAliases) {
  if (!ts.isCallExpression(node) || node.arguments.length === 0) return false;
  const argument = node.arguments[0];
  if (ts.isIdentifier(node.expression) && moduleLoadAliases.has(node.expression.text)) return !ts.isStringLiteralLike(argument);
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return !ts.isStringLiteralLike(argument);
  const member = memberCallParts(node.expression, sourceFile);
  if (member) {
    const { receiver, method } = member;
    if (method === 'require' && /^(?:module|Module)$/.test(receiver)) return !ts.isStringLiteralLike(argument);
    if (method === 'resolve' && moduleLoadAliases.has(receiver)) return !ts.isStringLiteralLike(argument);
    if (method === '_load' && /(?:module|Module|loader|require)/i.test(receiver)) return !ts.isStringLiteralLike(argument);
  }
  if (isCreateRequireCall(node.expression, sourceFile)) {
    return !ts.isStringLiteralLike(argument);
  }
  return false;
}

function isPluginModuleSpecifier(value) {
  return typeof value === 'string'
    && !pluginMetadataModuleSpecifierPattern.test(normalizePath(value))
    && pluginModuleSpecifierPattern.test(normalizePath(value));
}

function isPluginModuleLoad(node, sourceFile, moduleLoadAliases) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return Boolean(node.moduleSpecifier && isPluginModuleSpecifier(stringValue(node.moduleSpecifier)));
  }
  if (!ts.isCallExpression(node) || node.arguments.length === 0) return false;
  const argument = node.arguments[0];
  const value = stringValue(argument);
  if (!value || !isPluginModuleSpecifier(value)) return false;
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isIdentifier(node.expression) && moduleLoadAliases.has(node.expression.text)) return true;
  const member = memberCallParts(node.expression, sourceFile);
  if (member) {
    const { receiver, method } = member;
    if (method === 'resolve' && moduleLoadAliases.has(receiver)) return true;
    if ((method === 'require' || method === '_load') && /^(?:module|Module)$/.test(receiver)) return true;
  }
  if (isCreateRequireCall(node.expression, sourceFile)) return true;
  return false;
}

function scanAgentDownloadExecution(path, source) {
  const findings = [];
  const seen = new Set();
  const downloadedTargets = new Set();
  const add = (offset) => {
    const finding = makeTextFinding('AGENT_DOWNLOAD_EXECUTION', path, source, offset, 'Agent 不得把网络下载内容或下载文件交给解释器、进程或命令执行器');
    const key = `${finding.line}:${finding.column}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(finding);
    }
  };

  const targetPattern = /(?:^|[\s;&|])(?:-OutFile|-OutputFile|--output|--out-file|-Destination|-O|-o)(?=\s|=)\s*(?:=\s*)?(?:"([^"]+)"|'([^']+)'|([$A-Za-z_][\w$.-]*|[A-Za-z]:[^\s;&|]+|\/[^\s;&|]+))/gi;
  const downloadCallTargetPattern = /(?:\.\s*)?Download(?:File|ToFile)\s*\(\s*[^,\r\n;]+,\s*(?:"([^"]+)"|'([^']+)'|([$A-Za-z_][\w$.-]*|[A-Za-z]:[^\s;&|,)]+|\/[^\s;&|,)]+))/gi;
  const assignmentPattern = /(?:\b(?:const|let|var)\s+)?([$A-Za-z_][\w$]*)\s*(?:,\s*[$A-Za-z_][\w$]*\s*)?(?::=|=)\s*(?:\(\s*)?(?:await\s+)?(?:Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|iwr|irm|curl(?:\.exe)?|wget(?:\.exe)?|fetch|http\.(?:Get|Post)|(?:client|httpClient)\.Do)\b/i;
  const lines = source.split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    const sinkMatch = line.match(strictAgentDownloadExecutionSinkPattern);
    const targets = [];
    for (const match of line.matchAll(targetPattern)) {
      const target = match[1] ?? match[2] ?? match[3];
      if (target) targets.push(target);
    }
    for (const match of line.matchAll(downloadCallTargetPattern)) {
      const target = match[1] ?? match[2] ?? match[3];
      if (target) targets.push(target);
    }
    const assignment = line.match(assignmentPattern)?.[1];
    // 先登记当前行产生的下载目标，再判断执行器参数，避免把同一行的无关编译器调用当成下载后执行。
    for (const target of targets) downloadedTargets.add(target);
    if (assignment) downloadedTargets.add(assignment);
    const sinkText = sinkMatch ? line.slice(sinkMatch.index ?? 0) : '';
    if (sinkMatch && [...downloadedTargets].some((target) => sinkText.includes(target))) {
      add(offset + (sinkMatch.index ?? 0));
    }
    offset += line.length;
    if (source[offset] === '\r' && source[offset + 1] === '\n') offset += 2;
    else if (source[offset] === '\n') offset += 1;
  }

  const pipePattern = new RegExp(
    String.raw`\b(?:Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|iwr|irm|curl(?:\.exe)?|wget(?:\.exe)?|fetch|(?:\.\s*)?Download(?:File|String|Data|ToFile)|http\.(?:Get|Post)|(?:client|httpClient)\.Do)\b[^\r\n;]{0,240}\|\s*(?:iex|Invoke-Expression|powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?|command\.com|sh|bash|dash|zsh|fish|python(?:3)?|perl|ruby|node)\b`,
    'gi',
  );
  for (const match of source.matchAll(pipePattern)) add(match.index ?? 0);
  return findings;
}

const pluginRunnerRuntimePathPattern = /^backend\/src\/modules\/plugins\/builtin-plugins\/[^/]+\/runtime\/index\.js$/i;
const runnerEnvironmentNamePattern = /^GCAC_PLUGIN_(?:ID|VERSION|VERSION_ID|PACKAGE_HASH|MANIFEST_HASH|RESOURCE_HASH)$/;

function sourceLineAt(source, offset) {
  const lineStart = Math.max(source.lastIndexOf('\n', offset - 1), source.lastIndexOf('\r', offset - 1)) + 1;
  const lineEnd = source.indexOf('\n', offset) < 0 ? source.length : source.indexOf('\n', offset);
  return source.slice(lineStart, lineEnd);
}

function fixedRunnerEnvironmentCalls(source) {
  const helperCallPattern = /\b(?:requiredEnvironment|requiredDescriptorEnv|requiredDigestEnv|injected|requiredDigest)\s*\(\s*([^,)\r\n]+?)(?:\s*,|\s*\))/g;
  // 函数定义中的参数名 `name` 不是一次环境读取；这里只接受调用点的固定字符串。
  const calls = [...source.matchAll(helperCallPattern)]
    .map((match) => match[1]?.trim())
    .filter((value) => Boolean(value) && /^['"`]/.test(value));
  return calls.length > 0 && calls.every((value) => {
    const quoted = value.match(/^["'`]([^"'`]+)["'`]$/);
    return Boolean(quoted && runnerEnvironmentNamePattern.test(quoted[1]));
  });
}

function isControlledPluginEnvironmentAccess(path, source, offset) {
  if (!pluginRunnerRuntimePathPattern.test(normalizePath(path))) return false;
  const line = sourceLineAt(source, offset);
  if (/\bprocess\.env\.(?:GCAC_PLUGIN_(?:ID|VERSION|VERSION_ID|PACKAGE_HASH|MANIFEST_HASH|RESOURCE_HASH))\b/.test(line)) return true;
  if (/\bprocess\.env\s*\[\s*(?:["'`]GCAC_PLUGIN_(?:ID|VERSION|VERSION_ID|PACKAGE_HASH|MANIFEST_HASH|RESOURCE_HASH)["'`]|`GCAC_PLUGIN_)/.test(line)) return true;
  if (/\bprocess\.env\s*\[\s*name\s*\]/.test(line) && fixedRunnerEnvironmentCalls(source)) return true;
  if (/\bprocess\.env\s*\[\s*name\s*\]/.test(line)
    && /\bconst\s+names\s*=\s*\[[\s\S]*?GCAC_PLUGIN_(?:VERSION_ID|PACKAGE_HASH|MANIFEST_HASH|RESOURCE_HASH)[\s\S]*?\]\s*;[\s\S]*?names\.map\s*\(/.test(source)) return true;
  return false;
}

function hasPluginPackageResourceBoundary(source) {
  return /\bconst\s+runtimeDirectory\s*=\s*dirname\s*\(\s*fileURLToPath\s*\(\s*import\.meta\.url\s*\)\s*\)/.test(source)
    && /\bconst\s+packageDirectory\s*=\s*resolve\s*\(\s*runtimeDirectory\s*,\s*["']\.\.["']\s*\)/.test(source)
    && /\brelative\s*\(\s*packageDirectory\s*,\s*absolute\s*\)/.test(source)
    && /\brelativePath\s*===\s*["']\.\.["']|\brelativePath\.startsWith\s*\(\s*["']\.\.[\/]["']\s*\)/.test(source)
    && /\breadFileSync\s*\(/.test(source);
}

function isControlledPluginPackageResourceAccess(path, source) {
  return pluginRunnerRuntimePathPattern.test(normalizePath(path)) && hasPluginPackageResourceBoundary(source);
}

function isRejectedRunnerKeyContext(source, offset) {
  const context = source.slice(Math.max(0, offset - 480), Math.min(source.length, offset + 480));
  return /\brejectUnsafeRunnerKeys\s*\(|\bRunner 资源不得声明任意命令或脚本入口/.test(context)
    && /\.includes\s*\(\s*key\s*\)/.test(context);
}

function scanTextArchitectureRules(path, source) {
  const normalizedPath = normalizePath(path);
  const findings = [];
  const hostPath = isHostSemanticCodePath(normalizedPath);
  const agentPath = isAgentPath(normalizedPath);
  const pluginPath = isBuiltinPluginPath(normalizedPath);
  const productionContractPath = isProductionContractPath(normalizedPath);
  const agentContractPath = isAgentContractPath(normalizedPath);
  const securityContractPath = normalizedPath.endsWith('/modules/agents/security/agent-security.contract.ts');
  const hostApiContractPath = normalizedPath.endsWith('/modules/plugins/runner/protocol/host-api.registry.ts');

  if (agentPath) {
    addTextMatches(findings, 'AGENT_SHELL_EXECUTION', normalizedPath, source, agentShellExecutionPattern, 'Agent 不得提供 Shell、CMD 或解释器自由执行入口');
    addTextMatches(findings, 'AGENT_SHELL_EXECUTION', normalizedPath, source, agentInterpreterProcessPattern, 'Agent 不得把 Shell、解释器或脚本交给进程启动器');
    addTextMatches(findings, 'AGENT_SHELL_EXECUTION', normalizedPath, source, agentPowerShellExecutionPattern, 'Agent 不得提供 PowerShell、编码命令或远程脚本执行入口');
    addTextMatches(findings, 'AGENT_SHELL_EXECUTION', normalizedPath, source, agentPowerShellCallOperatorPattern, 'Agent 不得通过 PowerShell 调用运算符或点源执行脚本变量');
    addTextMatches(findings, 'AGENT_FREE_COMMAND_EXECUTION', normalizedPath, source, agentFreeCommandExecutionPattern, 'Agent 不得把请求字段作为自由命令交给进程启动器');
    findings.push(...scanAgentDownloadExecution(normalizedPath, source));
  }

  if (isAgentCorePath(normalizedPath)) {
    addTextMatches(findings, 'AGENT_ACTION_ALIAS', normalizedPath, source, agentActionAliasPattern, 'Agent Core 不得注册或解析 Action Alias');
    addTextMatches(findings, 'AGENT_PRODUCT_IDENTIFICATION', normalizedPath, source, agentProductIdentityPattern, 'Agent Core 不得识别第三方产品或把产品身份写入运行时事实');
    addTextMatches(findings, 'AGENT_PRODUCT_IDENTIFICATION', normalizedPath, source, agentProductFactPattern, 'Agent Core 不得维护第三方产品专用事实键');
  }

  if (isCaNodePath(normalizedPath)) {
    addTextMatches(findings, 'AGENT_OPENSSL_USAGE', normalizedPath, source, caNodeOpenSslPattern, '已废弃的 go-ca-node 不得使用 OpenSSL 或保留 OpenSSL 执行旁路');
    addTextMatches(findings, 'AGENT_PROCESS_EXECUTION', normalizedPath, source, caNodeProcessExecutionPattern, '已废弃的 go-ca-node 不得执行任意外部进程，必须通过统一 Plugin Runner/Host API 合同完成');
  }

  if (hostPath || pluginPath) {
    addTextMatches(findings, 'HOST_TRUSTED_JS_RUNTIME', normalizedPath, source, hostTrustedJsRuntimePattern, '生产运行期不得保留 Trusted JS 入口，插件必须通过正式 Runner 能力执行');
    if (hostPath && /trusted[-_]js/i.test(normalizedPath)) {
      findings.push(makeTextFinding('HOST_TRUSTED_JS_RUNTIME', normalizedPath, source, 0, '宿主不得保留 Trusted JS 运行期文件', '<path>'));
    }
  }

  if (hostPath) {
    addTextMatches(
      findings,
      'HOST_PLUGIN_OBJECT_CALL',
      normalizedPath,
      source,
      pluginObjectCallPattern,
      '宿主不得在 IPC 之外直接调用插件对象',
    );
    addTextMatches(findings, 'HOST_PROVIDER_SIGNER', normalizedPath, source, hostProviderSignerPattern, '宿主不得拥有云厂商签名算法或 Provider signer');
    addTextMatches(findings, 'HOST_PROVIDER_BASELINE', normalizedPath, source, hostProviderBaselinePattern, '宿主不得拥有 Provider baseline，厂商基线必须由插件版本声明');
    if (!isRetiredAgentDirectRejectorPath(normalizedPath)) {
      addTextMatches(
        findings,
        'AGENT_DIRECT_BYPASS',
        normalizedPath,
        source,
        directAgentConsumerPattern,
        '控制面不得创建通用 Agent 直连旁路；手动 Web 重新发现只能使用固定窄端点',
        '<text>',
        (value, offset) => !isApprovedManualWebDiscoveryDirectUsage(normalizedPath, value, offset),
      );
    }
  }

  if (pluginPath) {
    addTextMatches(findings, 'PLUGIN_DIRECT_DATABASE_ACCESS', normalizedPath, source, pluginDatabaseAccessPattern, '插件不得直接连接数据库或调用 Repository，必须使用已登记 Host API');
    addTextMatches(
      findings,
      'PLUGIN_DIRECT_HOST_ACCESS',
      normalizedPath,
      source,
      /\b(?:process\.env|process\.cwd|node:(?:fs|child_process)|require\s*\(\s*['"](?:fs|child_process)['"]|\b(?:Database|Repository)\b|\.(?:query|execute)\s*\()/g,
      '插件不得直接访问宿主环境变量、文件、进程、数据库或 Repository',
      '<text>',
      (value, offset, match) => {
        if (/\bprocess\.env/.test(match)) return !isControlledPluginEnvironmentAccess(normalizedPath, source, offset);
        if (/\bnode:fs\b|require\s*\(\s*['"]fs['"]/.test(match)) return !isControlledPluginPackageResourceAccess(normalizedPath, source);
        return true;
      },
    );
    addTextMatches(findings, 'PLUGIN_DIRECT_HOST_SERVICE', normalizedPath, source, /\b[A-Z][A-Za-z0-9_$]*Service\b|\bhost\.service\.invoke\b/g, '插件不得直接持有或调用宿主内部 Service');
    addTextMatches(findings, 'PLUGIN_OBJECT_OUTSIDE_IPC', normalizedPath, source, pluginObjectCallPattern, '插件对象调用必须通过 IPC v1，不得形成进程外旁路');
  }

  // 当前项目未发布，Compatibility 和 legacy 目录中的旧合同与生产代码同样必须失败关闭。
  if (productionContractPath) {
    addTextMatches(findings, 'REMOVED_PLUGIN_SCHEMA_REFERENCE', normalizedPath, source, removedPluginSchemaReferencePattern, '生产代码不得引用已删除的插件 Schema');
    addTextMatches(findings, 'REMOVED_PLUGIN_RUNTIME_REFERENCE', normalizedPath, source, removedPluginRuntimeReferencePattern, '生产代码不得继续引用已删除的 AGENT_ATOMIC 运行时');
  }

  if (agentContractPath) {
    addTextMatches(findings, 'AGENT_LEGACY_CONTRACT', normalizedPath, source, legacyAgentContractPattern, '生产运行期不得继续使用 agent.atomic_plan.execute 或 agent.execute 旧 Agent 合同', '<text>', (value, offset) => !isRetiredContractMarker(value, offset));
  }
  if (agentPath) {
    addTextMatches(findings, 'AGENT_LEGACY_COMMAND_CONTRACT', normalizedPath, source, /['"]command\.execute['"]/g, 'Agent 只允许 command.execute_allowlisted，不得新增自由 command.execute', '<text>', (value, offset) => !isRetiredContractMarker(value, offset));
    if (isAgentCorePath(normalizedPath)) {
      addTextMatches(findings, 'AGENT_PRODUCT_IMPLEMENTATION', normalizedPath, source, /\b(?:IIS|Iis|Nginx|Apache|Httpd|Tomcat|RabbitMQ|RabbitMq|Citrix|Netscaler|Sangfor|Synology|Fortinet|PaloAlto|Aliyun|Tencent|Huawei|Volcengine|OpenSSL|Openssl|Acme|ADCS|Adcs|JavaKeystore)(?:[A-Z][A-Za-z0-9_]*)+\b/g, 'Agent Core 不得定义厂商产品类名或产品专用执行实现');
    }
  }

  if (productionContractPath) {
    addTextMatches(findings, 'DEFAULT_DEVELOPMENT_KEY', normalizedPath, source, defaultDevelopmentLicenseKeyPattern, '生产代码不得包含默认开发许可证密钥，缺少真实信任根必须失败关闭', '<text>', (value, offset) => !isDefaultKeyRejectionContext(value, offset));
    addTextMatches(findings, 'DEFAULT_DEVELOPMENT_KEY', normalizedPath, source, defaultDevelopmentLicenseKeyValuePattern, '生产代码不得把默认或示例值配置为信任密钥', '<text>', (value, offset) => !isDefaultKeyRejectionContext(value, offset));
    if (licensingSourcePathPattern.test(normalizedPath) || issuerPrivateKeyPathPattern.test(normalizedPath)) {
      addTextMatches(findings, 'ISSUER_PRIVATE_KEY_IN_SOURCE', normalizedPath, source, issuerPrivateKeyMaterialPattern, '生产源码不得包含 issuer 私钥材料，签发私钥只能留在受控的外部密钥环境');
    }
    if (issuerPrivateKeyPathPattern.test(normalizedPath)) {
      findings.push(makeTextFinding('ISSUER_PRIVATE_KEY_IN_SOURCE', normalizedPath, source, 0, '生产源码路径不得交付 issuer 私钥文件', '<path>'));
    }
    addTextMatches(findings, 'POLICY_AUTHORITY_FAIL_OPEN', normalizedPath, source, /(?:policyAuthority|authorityDecision|policyDecision|policyResult)[\s\S]{0,120}(?:\?\?|\|\|)\s*(?:true|allow|ALLOW)/g, 'Policy Authority 缺失或不可用时不得放行高风险动作');
  }

  if (isWorkflowPath(normalizedPath) && extname(normalizedPath).toLowerCase() !== '.json') {
    addTextMatches(findings, 'WORKFLOW_RAW_SCRIPT', normalizedPath, source, workflowRawScriptPattern, 'Workflow DSL 不得包含裸脚本字符串，必须使用受控通用步骤');
  }

  if (productionContractPath && !securityContractPath && !hostApiContractPath) {
    addTextMatches(findings, 'FORBIDDEN_COMMAND_CONTRACT', normalizedPath, source, /['"]command\.execute['"]/g, '长期执行合同不得使用自由 command.execute', '<text>', (value, offset) => !isRetiredContractMarker(value, offset) && !isRejectedRunnerKeyContext(source, offset));
  }
  return findings;
}

function scanJsonPluginArchitectureSource(path, source) {
  const normalizedPath = normalizePath(path);
  const findings = scanTextArchitectureRules(normalizedPath, source);
  const allowBindingLiteral = isProductionContractPath(normalizedPath) && !isTranslationResourcePath(normalizedPath);
  let document;
  try {
    document = JSON.parse(source);
  } catch {
    findings.push(makeTextFinding('JSON_CONTRACT_INVALID', normalizedPath, source, 0, '受扫描的插件或工作流 JSON 不是有效 JSON'));
    return findings.sort((left, right) => left.line - right.line || left.column - right.column || left.rule.localeCompare(right.rule));
  }
  let searchOffset = 0;
  const add = (rule, key, message) => {
    const keyOffset = source.indexOf(`"${key}"`, searchOffset);
    if (keyOffset >= 0) searchOffset = keyOffset + key.length + 2;
    findings.push(makeTextFinding(rule, normalizedPath, source, keyOffset >= 0 ? keyOffset : 0, message, `json.${key}`));
  };
  const walk = (value, keys) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...keys, String(index)]));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      // 先把游标推进到当前属性，避免同名属性的前一次出现被误报为当前行。
      const currentKeyOffset = source.indexOf(`"${key}"`, searchOffset);
      if (currentKeyOffset >= 0) searchOffset = currentKeyOffset;
      const pathKeys = [...keys, key];
      if (isHostWorkflowPath(normalizedPath)) {
        if (key === 'script' && typeof child === 'string' && child.trim() !== '') add('WORKFLOW_RAW_SCRIPT', key, 'Workflow DSL 不得包含裸脚本字符串，必须使用受控通用步骤');
        if (key === 'mode' && child === 'script') add('WORKFLOW_RAW_SCRIPT', key, 'Workflow DSL 不得使用 script 执行模式');
        const directStepProperty = keys.length >= 2 && ['steps', 'rollback'].includes(keys.at(-2));
        if (directStepProperty && ['name', 'type', 'stepType', 'action', 'operation'].includes(key) && typeof child === 'string' && productIdentifierPattern.test(child)) {
          add('WORKFLOW_PRODUCT_STEP', key, 'Workflow 不得在宿主或通用步骤层固化产品专用 Step');
        }
        const productTemplateField = ['frameworkType', 'product', 'productId', 'productFamily', 'targetType'].includes(key)
          || (keys.includes('frameworkType') && ['default', 'enum'].includes(key));
        const productTemplateValue = typeof child === 'string'
          ? child
          : Array.isArray(child)
            ? child.filter((item) => typeof item === 'string').join(' ')
            : '';
        if (productTemplateField && productIdentifierPattern.test(productTemplateValue)) {
          add('WORKFLOW_PRODUCT_TEMPLATE', key, '产品 Workflow 必须由目标 PluginVersion 提供，宿主 builtin-workflows 不得固化产品模板');
        }
      }
      if (allowBindingLiteral && ['pluginId', 'targetPluginId', 'canonicalPluginId'].includes(key) && typeof child === 'string' && shouldReportNonCanonicalPluginBinding(child)) {
        add('NON_CANONICAL_PLUGIN_BINDING', key, `${key} 新绑定必须使用 Canonical Plugin ID，不能使用历史别名或显示名`);
      }
      walk(child, pathKeys);
    }
  };
  walk(document, []);
  return findings.sort((left, right) => left.line - right.line || left.column - right.column || left.rule.localeCompare(right.rule));
}

export function scanPluginArchitectureSource(path, source) {
  const normalizedPath = normalizePath(path);
  // 测试代码里的拒绝断言是守卫输入，不代表生产代码建立了旧合同或执行旁路。
  // 非测试 Fixture 使用独立目录，不匹配 testPathPattern，仍按生产规则扫描。
  if (testPathPattern.test(normalizedPath) || securityContractFixturePathPattern.test(normalizedPath)) return [];
  const extension = extname(normalizedPath).toLowerCase();
  if (extension === '.json') return scanJsonPluginArchitectureSource(normalizedPath, source);
  if (extension === '.go' || extension === '.cs') return scanGoPluginArchitectureSource(normalizedPath, source);
  if (!typedSourceExtensions.has(extension)) return scanTextArchitectureRules(normalizedPath, source);
  const script = extension === '.vue' ? extractVueScript(source) : source;
  const kind = extension === '.tsx' ? ts.ScriptKind.TSX : extension === '.js' || extension === '.mjs' ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(normalizedPath, script, ts.ScriptTarget.Latest, true, kind);
  const findings = scanTextArchitectureRules(normalizedPath, source);
  const hostCodePath = isHostSemanticCodePath(normalizedPath);
  const hostVendorDispatchPath = hostCodePath && !isNativeCaRuntimePath(normalizedPath);
  const pluginCodePath = isBuiltinPluginPath(normalizedPath);
  const bindingScopePath = isProductionContractPath(normalizedPath) && !isTranslationResourcePath(normalizedPath);
  const moduleLoadAliases = collectModuleLoadAliases(sourceFile);
  const membershipCollections = new Set();
  const collectMembership = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const argument = node.arguments[0];
      if (['includes', 'has', 'get'].includes(method) && argument && /frameworkTypes?|FrameworkType/.test(textOf(argument, sourceFile))) {
        const receiver = memberReceiverName(node, sourceFile);
        if (receiver) membershipCollections.add(receiver);
      }
    }
    ts.forEachChild(node, collectMembership);
  };
  collectMembership(sourceFile);
  const add = (rule, node, message) => findings.push(makeFinding(rule, normalizedPath, sourceFile, node, message));
  const visit = (node) => {
    if ((hostCodePath || pluginCodePath) && isHostApiInvocation(node, sourceFile)) {
      const method = stringValue(node.arguments[0]);
      if (!method) add('HOST_API_DYNAMIC_METHOD', node, 'Host API 方法必须使用可审计的已登记固定名称，不得动态拼接');
      else if (!registeredHostApiMethods.has(method)) add('HOST_API_UNREGISTERED_METHOD', node, 'Host API 方法未在 Registry 登记，必须失败关闭');
    }
    if (hostVendorDispatchPath && isImplementationConstructor(node)) add('HOST_VENDOR_DISPATCH', node, '宿主不得构造厂商专用实现');
    if (hostVendorDispatchPath && isVendorDispatchTable(node, sourceFile)) add('HOST_VENDOR_DISPATCH', node, '宿主不得用厂商映射表选择实现');
    if (hostVendorDispatchPath && isProductCatalogArray(node, sourceFile)) add('HOST_VENDOR_DISPATCH', node, '宿主不得维护封闭的产品或运行时目录');
    if (hostCodePath && isProductOperationContract(node, sourceFile)) add('HOST_PRODUCT_OPERATION_CONTRACT', node, '插件 Operation 与权限范围必须使用开放标识并由 Agent 能力校验');
    if (hostCodePath && isProductCapabilityCatalogCall(node, sourceFile)) add('HOST_PRODUCT_CAPABILITY_CATALOG', node, '产品能力定义必须由插件贡献，宿主只保留通用能力');
    if (hostVendorDispatchPath && isSelectionNode(node)) {
      const values = collectStringLiterals(node);
      const text = textOf(node, sourceFile);
      if (values.some(containsProduct) && /(?:providerType|deviceFamily|frameworkType|pluginId|productId|actionType|\.kind|\.type)/.test(text)) {
        add('HOST_VENDOR_DISPATCH', node, '宿主不得按厂商或产品身份选择实现');
      }
      const condition = selectionCondition(node);
      const branches = selectionBranches(node);
      if (containsOwnerSource(condition, sourceFile) && branches.some((branch) => containsDriverSink(branch, sourceFile))) {
        add('OWNER_DRIVER_SELECTION', node, '目标所有者和执行位置不得决定 DriverKind');
      }
    }
    if (hostCodePath && ts.isPropertyAssignment(node) && ['aliases', 'legacyActionType'].includes(propertyName(node) ?? '')) {
      const values = collectStringLiterals(node.initializer);
      if (values.some((value) => containsProduct(value) && /deploy|certificate|install|update/i.test(value))) {
        add('HOST_PRODUCT_ACTION_ALIAS', node, '厂商历史 Action 别名必须由插件包声明');
      }
    }
    if (hostCodePath && isProductActionAliasTable(node, sourceFile)) add('HOST_PRODUCT_ACTION_ALIAS', node, '厂商历史 Action 别名必须由插件包声明');
    if (hostCodePath && isFrameworkAllowlist(node, sourceFile, membershipCollections)) add('FRAMEWORK_DEPLOYMENT_ALLOWLIST', node, 'Framework 部署准入不得使用固定列表');
    if (bindingScopePath && ts.isPropertyAssignment(node) && ['pluginId', 'targetPluginId', 'canonicalPluginId'].includes(propertyName(node) ?? '') && ts.isStringLiteralLike(node.initializer)) {
      const name = propertyName(node) ?? '';
      if (shouldReportNonCanonicalPluginBinding(node.initializer.text)) add('NON_CANONICAL_PLUGIN_BINDING', node, `${name} 新绑定必须使用 Canonical Plugin ID，不能使用历史别名或显示名`);
    }
    // Runner 子进程必须在固定启动参数指定的模块中装载 PluginVersion 执行器；这不是宿主执行插件。
    // 例外只允许这个精确文件，宿主和 Runner 其他文件仍然禁止动态加载。
    if (hostCodePath && !isRunnerExecutorLoaderPath(normalizedPath) && (
      isDynamicModuleLoad(node, sourceFile, moduleLoadAliases)
      || isPluginModuleLoad(node, sourceFile, moduleLoadAliases)
    )) {
      add('HOST_PLUGIN_DYNAMIC_LOAD', node, '宿主不得通过动态 import()/require() 加载插件入口，插件只能由独立 Runner 进程装载');
    }
    if (hostCodePath && ts.isSpreadAssignment(node) && /(?:inputSnapshot|snapshot)/.test(textOf(node.expression, sourceFile))) {
      const guard = findGuardedSelection(node, sourceFile, /actionType\s*!==\s*['"]agent\.atomic_plan\.execute['"]/);
      if (guard) {
        add('RAW_AGENT_ACTION_FORWARD', node, '未知 Agent Action 不得原样转发 Snapshot');
      }
    }
    if (hostCodePath && ts.isNewExpression(node) && /Legacy.*Executor(?:Adapter)?$/.test(textOf(node.expression, sourceFile))) {
      const parentText = node.parent ? textOf(node.parent, sourceFile) : '';
      if (/\.register\s*\(|\[/.test(parentText)) add('LEGACY_EXECUTOR_REGISTRATION', node, 'Legacy Executor 不得加入默认生产注册表');
    }
    const literal = stringValue(node);
    if (isLegacyApiConsumerPath(normalizedPath) && literal && legacyApiPattern.test(literal)) {
      add('LEGACY_API_NEW_DEPENDENCY', node, '旧 Provider 或 Plugin API 不得新增消费者');
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings.sort((left, right) => left.line - right.line || left.column - right.column || left.rule.localeCompare(right.rule));
}

function scanGoPluginArchitectureSource(path, source) {
  const findings = [];
  const checks = [
    ['HOST_PRODUCT_ACTION_ALIAS', goProductActionPattern, '历史产品 Action 必须在控制面转换为签名 Atomic Plan'],
    ['HOST_VENDOR_DISPATCH', goProductActionHandlerPattern, 'Agent 不得注册产品专用 Action Handler'],
    ['HOST_VENDOR_DISPATCH', goProductRegistryPattern, 'Agent 不得按产品适配器选择执行实现'],
    ['HOST_PRODUCT_CAPABILITY_CATALOG', goProductCapabilityCatalogPattern, 'Agent 宿主不得声明插件拥有的产品 Capability'],
    ['HOST_VENDOR_DISPATCH', csharpProductHandlerPattern, 'Compatibility Agent 不得保留产品直连 Handler'],
  ];
  for (const [rule, pattern, message] of checks) {
    const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
    for (const match of source.matchAll(globalPattern)) {
      const offset = match.index ?? 0;
      const before = source.slice(0, offset);
      const line = before.split(/\r?\n/).length;
      const lineStart = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r')) + 1;
      const excerpt = source.slice(lineStart, source.indexOf('\n', offset) < 0 ? source.length : source.indexOf('\n', offset)).trim().slice(0, 240);
      findings.push({
        rule,
        path,
        line,
        column: offset - lineStart + 1,
        nodeKind: 'GoSourceLine',
        anchor: '<go>',
        excerpt,
        message,
        classification: classifyPath(path),
        fingerprint: fingerprint(rule, path, '<go>', excerpt),
      });
    }
  }
  findings.push(...scanTextArchitectureRules(path, source));
  return findings.sort((left, right) => left.line - right.line || left.column - right.column || left.rule.localeCompare(right.rule));
}

function collectFiles(root, directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    const scanPath = normalizePath(relative(root, absolutePath));
    if (shouldIgnore(scanPath)) return [];
    if (entry.isDirectory()) return collectFiles(root, absolutePath);
    const extension = extname(entry.name).toLowerCase();
    return sourceExtensions.has(extension) ? [absolutePath] : [];
  });
}
function isFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}
function sourceModuleCandidates(absolutePath, specifier) {
  const basePath = resolve(dirname(absolutePath), specifier);
  const candidates = [basePath];
  const extension = extname(basePath).toLowerCase();
  if (extension === '.js' || extension === '.mjs') {
    const sourcePath = basePath.slice(0, -extension.length);
    candidates.push(`${sourcePath}.ts`, `${sourcePath}.tsx`, `${sourcePath}.js`, `${sourcePath}.mjs`, `${sourcePath}.vue`, `${sourcePath}.d.ts`);
  } else if (!sourceExtensions.has(extension) && !moduleAssetExtensions.has(extension)) {
    candidates.push(`${basePath}.ts`, `${basePath}.tsx`, `${basePath}.js`, `${basePath}.mjs`, `${basePath}.vue`, `${basePath}.json`, `${basePath}.d.ts`);
  }
  for (const candidate of [...candidates]) {
    candidates.push(join(candidate, 'index.ts'), join(candidate, 'index.js'), join(candidate, 'index.mjs'));
  }
  return [...new Set(candidates)];
}
function collectRelativeModuleSpecifiers(path, source) {
  const extension = extname(path).toLowerCase();
  if (!typedSourceExtensions.has(extension)) return [];
  const script = extension === '.vue' ? extractVueScript(source) : source;
  const kind = extension === '.tsx' ? ts.ScriptKind.TSX : extension === '.js' || extension === '.mjs' ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true, kind);
  const specifiers = [];
  const add = (node) => {
    if (!ts.isStringLiteralLike(node) || !node.text.startsWith('.')) return;
    specifiers.push({ specifier: node.text, offset: node.getStart(sourceFile) });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) add(node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.arguments.length === 1 && (ts.isIdentifier(node.expression) && node.expression.text === 'require' || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}
function scanMissingModuleReferences(path, source, absolutePath) {
  if (testPathPattern.test(path) || migrationPathPattern.test(path)) return [];
  return collectRelativeModuleSpecifiers(path, source)
    .filter(({ specifier }) => !sourceModuleCandidates(absolutePath, specifier).some(isFile))
    .map(({ specifier, offset }) => makeTextFinding(
      'MISSING_PRODUCTION_MODULE_REFERENCE',
      path,
      source,
      offset,
      `生产源码引用的相对模块不存在：${specifier}`,
    ));
}
function validateScanConfiguration(root, roots, enforceComplete) {
  const resolvedRoot = resolve(root);
  if (!Array.isArray(roots) || roots.length === 0) throw new Error('架构扫描至少需要一个扫描根');
  const resolvedRoots = roots.map((configuredRoot) => resolve(resolvedRoot, configuredRoot));
  const escapedRoots = roots.filter((configuredRoot, index) => {
    const relativeRoot = relative(resolvedRoot, resolvedRoots[index]);
    return relativeRoot.startsWith('..') || relativeRoot.includes(':') || relativeRoot.startsWith('/');
  });
  if (escapedRoots.length > 0) throw new Error(`架构扫描根必须位于仓库根内：${escapedRoots.join(', ')}`);
  const requiredRoots = enforceComplete ? (resolvedRoot === repositoryRoot ? mandatoryArchitectureScanRoots : roots) : [];
  const unavailableRoots = requiredRoots.filter((configuredRoot) => !existsSync(resolve(resolvedRoot, configuredRoot)));
  if (unavailableRoots.length > 0) throw new Error(`架构扫描根不存在，不能以缺失目录宣称通过：${unavailableRoots.join(', ')}`);
  if (!enforceComplete || resolvedRoot !== repositoryRoot) return;
  const configuredRoots = new Set(resolvedRoots);
  const missingRoots = mandatoryArchitectureScanRoots.filter((configuredRoot) => !configuredRoots.has(resolve(resolvedRoot, configuredRoot)));
  if (missingRoots.length > 0) throw new Error(`默认架构扫描不得缩小范围，缺少扫描根：${missingRoots.join(', ')}`);
}
export function scanPluginArchitecture(root = repositoryRoot, roots = scanRoots, { enforceComplete = roots === scanRoots } = {}) {
  const resolvedRoot = resolve(root);
  validateScanConfiguration(resolvedRoot, roots, enforceComplete);
  const files = [...new Set(roots.flatMap((configuredRoot) => collectFiles(resolvedRoot, resolve(resolvedRoot, configuredRoot))))];
  return files.flatMap((absolutePath) => {
    const path = normalizePath(relative(resolvedRoot, absolutePath));
    const source = readFileSync(absolutePath, 'utf8');
    return [...scanPluginArchitectureSource(path, source), ...scanMissingModuleReferences(path, source, absolutePath)];
  }).sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.column - right.column || left.rule.localeCompare(right.rule));
}
function debtKey(item) { return `${item.rule}:${normalizePath(item.path)}:${item.anchor}:${item.fingerprint}`; }
export function compareWithDebt(findings, debt, requireZero = false) {
  if (debt.version !== 1 || !Array.isArray(debt.entries)) throw new Error('插件架构债务清单格式无效');
  if (requireZero && debt.entries.length > 0) throw new Error('零债务检查失败：临时架构债务清单仍有条目');
  const allowed = new Set(debt.entries.map((entry) => {
    for (const field of ['rule', 'path', 'anchor', 'fingerprint', 'reason', 'ownerTask', 'removeWhen']) {
      if (!entry[field]) throw new Error(`插件架构债务条目缺少 ${field}：${JSON.stringify(entry)}`);
    }
    return debtKey(entry);
  }));
  return findings.filter((finding) => !allowed.has(debtKey(finding)));
}
function printFindings(findings, stream = process.stdout) {
  for (const finding of findings) stream.write(`${finding.rule} ${finding.path}:${finding.line}:${finding.column} ${finding.message} [${finding.anchor}] ${finding.excerpt}\n`);
}
const findingPresets = {
  'vendor-neutrality': [
    'HOST_VENDOR_DISPATCH',
    'HOST_PRODUCT_ACTION_ALIAS',
    'HOST_PRODUCT_CAPABILITY_CATALOG',
    'HOST_PRODUCT_OPERATION_CONTRACT',
  ],
};
function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function optionValues(name) {
  return process.argv.flatMap((argument, index) => process.argv[index - 1] === name ? [argument] : []);
}
export function filterFindings(findings, {
  preset,
  rules = [],
} = {}) {
  const configuredRules = new Set(rules);
  if (preset) {
    const presetRules = findingPresets[preset];
    if (!presetRules) throw new Error(`未知的规则预设：${preset}`);
    presetRules.forEach((rule) => configuredRules.add(rule));
  }
  if (configuredRules.size === 0) return findings;
  return findings.filter((finding) => configuredRules.has(finding.rule));
}
function main() {
  const configuredRoot = optionValue('--root');
  const configuredScanRoots = process.argv.flatMap((argument, index) => process.argv[index - 1] === '--scan-root' ? [argument] : []);
  let findings;
  try {
    const rawFindings = scanPluginArchitecture(
      configuredRoot ? resolve(configuredRoot) : repositoryRoot,
      configuredScanRoots.length > 0 ? configuredScanRoots : scanRoots,
      { enforceComplete: true },
    );
    findings = filterFindings(rawFindings, {
      preset: optionValue('--preset'),
      rules: optionValues('--rule'),
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes('--json')) { process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`); return; }
  if (process.argv.includes('--list')) { printFindings(findings); return; }
  if (process.argv.includes('--raw')) {
    if (findings.length === 0) {
      process.stdout.write(`统一插件架构原始扫描通过：未发现 ${optionValue('--preset') ?? '指定规则'} 违规。\n`);
      return;
    }
    process.stderr.write('统一插件架构原始扫描失败：发现未豁免的规则违规。\n');
    printFindings(findings, process.stderr);
    process.exitCode = 1;
    return;
  }
  let violations;
  try {
    const configuredDebtPath = optionValue('--debt');
    const debt = JSON.parse(readFileSync(configuredDebtPath ? resolve(configuredDebtPath) : debtPath, 'utf8'));
    violations = compareWithDebt(findings, debt, process.argv.includes('--require-zero'));
  }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; return; }
  if (violations.length === 0) {
    process.stdout.write(`统一插件架构门禁通过：检测到 ${findings.length} 个受治理历史债务点，未发现新增旁路。\n`);
    return;
  }
  process.stderr.write('统一插件架构门禁失败：发现未登记的宿主厂商特例、执行旁路或旧 API 新依赖。\n');
  printFindings(violations, process.stderr);
  process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();

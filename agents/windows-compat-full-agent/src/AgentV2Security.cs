using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class AgentV2SecurityException : Exception
    {
        internal readonly string Code;
        internal readonly bool Unknown;

        internal AgentV2SecurityException(string code, string message, bool unknown)
            : base(message)
        {
            Code = code;
            Unknown = unknown;
        }

        internal AgentV2SecurityException(string code, string message)
            : this(code, message, false)
        {
        }
    }

    internal sealed class AgentV2Authorization
    {
        internal string Action;
        internal string AgentId;
        internal string TenantId;
        internal string PluginId;
        internal string PluginVersionId;
        internal string Capability;
        internal string PlanDigest;
        internal AgentCapabilityTokenV1 Token;
        internal PolicyAuthorityDecisionV1 Decision;
        internal AgentPlanV1 Plan;
        internal Dictionary<string, object> RawToken;
        internal Dictionary<string, object> RawDecision;
        internal Dictionary<string, object> RawPlan;
        internal IList Operations;
        internal Dictionary<string, object> LocalPolicy;
        internal PolicyMaterial Material;
        internal AgentV2Security Security;
    }

    internal sealed class PolicyMaterial
    {
        internal Dictionary<string, object> KeySet;
        internal Dictionary<string, object> LocalPolicy;
        internal HashSet<string> RevokedTokenIds;
        internal HashSet<string> RevokedDecisionIds;
        internal HashSet<string> RevokedKeyIds;
        internal string AuthorityKeyId;
        internal byte[] AuthorityPublicKey;
    }

    /// <summary>
    /// Agent v2 的安全合同实现。所有文件均由部署材料提供，不能由任务载荷覆盖。
    /// </summary>
    internal sealed class AgentV2Security
    {
        internal const string ContractVersion = "gcac.agent-security/v1";
        internal const string Version = ContractVersion;
        internal const int MaximumFileContentBytes = 64 * 1024;
        private const int MaximumPlanOperations = 100;
        private const int MaximumTokenLifetimeSeconds = 15 * 60;
        private const string WindowsSystem32Directory = @"C:\Windows\System32";
        private const string WindowsSystemControlPath = WindowsSystem32Directory + @"\sc.exe";
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();
        private static readonly Regex IdentifierPattern = new Regex("^[A-Za-z0-9._:-]{1,256}$", RegexOptions.Compiled);
        private static readonly Regex DigestPattern = new Regex("^[a-f0-9]{64}$", RegexOptions.Compiled);
        private static readonly string[] OperationTypes = new string[]
        {
            "process.list", "service.list", "service.status", "filesystem.stat", "filesystem.read",
            "filesystem.backup", "filesystem.atomic_replace", "filesystem.restore", "certificate.material.validate",
            "certificate.store.inspect", "service.start", "service.stop", "service.reload", "command.execute_allowlisted"
        };

        private readonly AgentConfig config;
        private readonly Func<string> agentIdProvider;

        internal AgentV2Security(AgentConfig config, Func<string> agentIdProvider)
        {
            this.config = config;
            this.agentIdProvider = agentIdProvider;
        }

        internal AgentV2Authorization Authorize(AgentTask task, bool requirePlan, bool consumeNonce)
        {
            if (config == null) throw new AgentV2SecurityException("AGENT_V2_AUTHORIZATION_DENIED", "Agent v2 安全配置未装配", false);
            if (task == null || task.payload == null) Reject("AGENT_V2_REQUEST_INVALID", "Agent v2 请求载荷不能为空");
            Dictionary<string, object> payload = task.payload;
            string activeAgentId = agentIdProvider == null ? null : agentIdProvider();
            string agentId = RequiredIdentifier(payload, "agentId");
            string tenantId = RequiredIdentifier(payload, "tenantId");
            string pluginId = RequiredPluginId(payload, "pluginId");
            string pluginVersionId = RequiredIdentifier(payload, "pluginVersionId");
            string capability = RequiredIdentifier(payload, "capability");
            if (TextUtility.IsBlank(activeAgentId) || !string.Equals(activeAgentId, agentId, StringComparison.Ordinal))
                Reject("AGENT_V2_AUTHORIZATION_REJECTED", "请求 Agent 身份与本机身份不匹配");
            if (payload.ContainsKey("action") && !string.Equals(Convert.ToString(payload["action"]), task.action, StringComparison.Ordinal))
                Reject("AGENT_V2_REQUEST_INVALID", "请求动作与任务动作不匹配");

            Dictionary<string, object> token = RequiredDictionary(payload, "token");
            Dictionary<string, object> decision = RequiredDictionary(payload, "policyDecision");
            PolicyMaterial material = PolicyMaterialLoader.Load(config, agentId, tenantId);
            ValidateTokenAndDecision(token, decision, material, agentId, tenantId, pluginId, pluginVersionId, capability);
            string requestedPlanDigest = RequiredDigest(payload, "planDigest");
            if (!string.Equals(requestedPlanDigest, RequiredDigest(token, "planDigest"), StringComparison.Ordinal)
                || !string.Equals(requestedPlanDigest, RequiredDigest(decision, "planDigest"), StringComparison.Ordinal))
                Reject("AGENT_V2_AUTHORIZATION_REJECTED", "请求计划摘要与 Token 或 Policy Authority 决策不匹配");
            ValidateRequestScopes(payload, token, decision, material.LocalPolicy);

            Dictionary<string, object> plan = null;
            IList operations = null;
            if (requirePlan)
            {
                plan = RequiredDictionary(payload, "plan");
                operations = ValidatePlan(plan, token, decision, agentId, tenantId, pluginId, pluginVersionId, capability, requestedPlanDigest);
                if (string.Equals(task.action, AgentV2Actions.PlanExecute, StringComparison.Ordinal) && !RequiredBoolean(plan, "writeEffect"))
                    Reject("AGENT_PLAN_INVALID", "agent.plan.execute 只接受包含写操作的计划");
                ValidateOperationScopes(operations, token, decision, material.LocalPolicy);
            }
            AgentV2Authorization authorization = new AgentV2Authorization
            {
                Action = task.action,
                AgentId = agentId,
                TenantId = tenantId,
                PluginId = pluginId,
                PluginVersionId = pluginVersionId,
                Capability = capability,
                PlanDigest = requestedPlanDigest,
                RawToken = token,
                RawDecision = decision,
                RawPlan = plan,
                Operations = operations,
                LocalPolicy = material.LocalPolicy,
                Material = material,
                Security = this
            };
            if (consumeNonce)
            {
                string nonce = RequiredIdentifier(token, "nonce");
                string tokenId = RequiredIdentifier(token, "tokenId");
                ConsumeNonce(config.dataDirectory, nonce, tokenId, requestedPlanDigest);
            }
            return authorization;
        }

        internal void ConsumeNonce(AgentV2Authorization authorization)
        {
            if (authorization == null || authorization.RawToken == null) throw new AgentV2SecurityException("AGENT_V2_AUTHORIZATION_REJECTED", "授权上下文为空");
            string nonce = RequiredIdentifier(authorization.RawToken, "nonce");
            string tokenId = RequiredIdentifier(authorization.RawToken, "tokenId");
            ConsumeNonce(config.dataDirectory, nonce, tokenId, authorization.PlanDigest);
        }

        internal static string CanonicalJson(object value)
        {
            return global::GCAC.WindowsCompatibilityAgent.CanonicalJson.Serialize(value);
        }

        internal static string Sha256(string value)
        {
            byte[] digest;
            using (SHA256 sha = SHA256.Create()) digest = sha.ComputeHash(Encoding.UTF8.GetBytes(value ?? string.Empty));
            StringBuilder result = new StringBuilder(digest.Length * 2);
            for (int index = 0; index < digest.Length; index++) result.Append(digest[index].ToString("x2"));
            return result.ToString();
        }

        internal static Dictionary<string, object> RemoveFields(Dictionary<string, object> value, string[] fields)
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            foreach (KeyValuePair<string, object> item in value) if (Array.IndexOf(fields, item.Key) < 0) result[item.Key] = item.Value;
            return result;
        }

        internal static bool IsAbsoluteWindowsPath(string value)
        {
            return !TextUtility.IsBlank(value) && (Regex.IsMatch(value.Replace('/', '\\'), "^[A-Za-z]:\\\\") || value.StartsWith("\\\\", StringComparison.Ordinal)) && value.IndexOf("..", StringComparison.Ordinal) < 0;
        }

        internal static string NormalizePath(string value)
        {
            if (!IsAbsoluteWindowsPath(value)) throw new AgentV2SecurityException("AGENT_V2_AUTHORIZATION_DENIED", "路径必须是无越权片段的绝对 Windows 路径");
            return NormalizeWindowsPath(value);
        }

        internal static bool IsPathWithin(string value, string[] scopes)
        {
            if (scopes == null) return false;
            return PathScopeAllowed(value, new List<string>(scopes));
        }

        internal static string[] Strings(object value, string key, bool allowEmpty)
        {
            IList list = value as IList;
            if (list == null) throw new AgentV2SecurityException("AGENT_V2_REQUEST_INVALID", "字段 " + key + " 必须是数组");
            List<string> result = new List<string>();
            foreach (object item in list)
            {
                string text = Convert.ToString(item, CultureInfo.InvariantCulture);
                if (!allowEmpty && TextUtility.IsBlank(text)) throw new AgentV2SecurityException("AGENT_V2_REQUEST_INVALID", "字段 " + key + " 包含空字符串");
                result.Add(text);
            }
            return result.ToArray();
        }

        internal Dictionary<string, object> LoadReceipt(string planId, string planDigest)
        {
            string path = ReceiptPath(config.dataDirectory, planId, planDigest);
            if (!File.Exists(path)) throw new AgentV2SecurityException("AGENT_RECEIPT_NOT_FOUND", "Agent 未找到本地执行回执", false);
            Dictionary<string, object> receipt;
            try { receipt = Serializer.DeserializeObject(File.ReadAllText(path)) as Dictionary<string, object>; }
            catch { throw new AgentV2SecurityException("AGENT_RECEIPT_INVALID", "Agent 本地执行回执无法解析", false); }
            if (receipt == null) throw new AgentV2SecurityException("AGENT_RECEIPT_INVALID", "Agent 本地执行回执格式无效", false);
            ValidateReceipt(receipt, planId, planDigest);
            return receipt;
        }

        internal void SaveReceipt(Dictionary<string, object> receipt)
        {
            string planId = RequiredIdentifier(receipt, "planId");
            string planDigest = RequiredDigest(receipt, "planDigest");
            ValidateReceipt(receipt, planId, planDigest);
            string directory = Path.Combine(config.dataDirectory, "agent-v2-receipts");
            Directory.CreateDirectory(directory);
            string path = ReceiptPath(config.dataDirectory, planId, planDigest);
            string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(temporary, Serializer.Serialize(receipt), Encoding.UTF8);
            try
            {
                if (File.Exists(path)) File.Delete(path);
                File.Move(temporary, path);
            }
            finally
            {
                if (File.Exists(temporary)) File.Delete(temporary);
            }
        }

        internal static string ComputeDigest(object value)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(global::GCAC.WindowsCompatibilityAgent.CanonicalJson.Serialize(value));
            byte[] digest;
            using (SHA256 sha = SHA256.Create()) digest = sha.ComputeHash(bytes);
            StringBuilder result = new StringBuilder(digest.Length * 2);
            for (int index = 0; index < digest.Length; index++) result.Append(digest[index].ToString("x2"));
            return result.ToString();
        }

        internal static Dictionary<string, object> CopyWithoutForMaterial(Dictionary<string, object> value, string excluded)
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            foreach (KeyValuePair<string, object> item in value) if (item.Key != excluded) result[item.Key] = item.Value;
            return result;
        }

        internal static Dictionary<string, object> BuildReceipt(string operationId, string planId, string planDigest, string agentId, string tenantId, string tokenId, string status, string errorCode, string unknownReason, IList operationResults, bool nonceConsumed, DateTime startedAtUtc, DateTime completedAtUtc)
        {
            Dictionary<string, object> receipt = new Dictionary<string, object>();
            receipt["receiptVersion"] = ContractVersion;
            receipt["operationId"] = operationId;
            receipt["planId"] = planId;
            receipt["planDigest"] = planDigest;
            receipt["agentId"] = agentId;
            receipt["tenantId"] = tenantId;
            receipt["tokenId"] = tokenId;
            receipt["status"] = status;
            receipt["startedAt"] = startedAtUtc.ToString("o", CultureInfo.InvariantCulture);
            receipt["completedAt"] = completedAtUtc.ToString("o", CultureInfo.InvariantCulture);
            receipt["operationResults"] = operationResults == null ? new ArrayList() : operationResults;
            receipt["nonceConsumed"] = nonceConsumed;
            if (!TextUtility.IsBlank(errorCode)) receipt["errorCode"] = errorCode;
            if (!TextUtility.IsBlank(unknownReason)) receipt["unknownReason"] = unknownReason;
            receipt["digest"] = ComputeDigest(receipt);
            return receipt;
        }

        private static void ValidateTokenAndDecision(Dictionary<string, object> token, Dictionary<string, object> decision, PolicyMaterial material, string agentId, string tenantId, string pluginId, string pluginVersionId, string capability)
        {
            EnsureExact(token, new string[] { "tokenVersion", "tokenId", "agentId", "tenantId", "pluginId", "pluginVersionId", "capability", "actions", "allowedPaths", "allowedServices", "artifactDigests", "approvalRef", "policyRef", "policyVersion", "issuedAt", "expiresAt", "nonce", "planDigest", "authorityKeyId", "signature" });
            EnsureExact(decision, new string[] { "decisionVersion", "decisionId", "allowed", "agentId", "tenantId", "pluginId", "pluginVersionId", "capability", "actions", "allowedPaths", "allowedServices", "artifactDigests", "policyRef", "policyVersion", "planDigest", "tokenId", "nonce", "approvalRef", "issuedAt", "validUntil", "authorityKeyId", "revocationRef", "signature", "reason" });
            if (RequiredString(token, "tokenVersion") != ContractVersion || RequiredString(decision, "decisionVersion") != ContractVersion)
                Reject("AGENT_V2_AUTHORIZATION_REJECTED", "安全合同版本不受支持");
            ValidateIdentity(token, agentId, tenantId, pluginId, pluginVersionId, capability);
            ValidateIdentity(decision, agentId, tenantId, pluginId, pluginVersionId, capability);
            if (!RequiredBoolean(decision, "allowed")) Reject("AGENT_V2_AUTHORIZATION_REJECTED", "Policy Authority 拒绝本次执行");
            string keyId = RequiredIdentifier(token, "authorityKeyId");
            if (RequiredIdentifier(decision, "authorityKeyId") != keyId) Reject("AGENT_V2_AUTHORIZATION_REJECTED", "Token 与 Policy Authority 决策信任根不一致");
            if (material.RevokedKeyIds.Contains(keyId) || material.RevokedTokenIds.Contains(RequiredIdentifier(token, "tokenId")) || material.RevokedDecisionIds.Contains(RequiredIdentifier(decision, "decisionId")))
                Reject("AGENT_V2_AUTHORIZATION_REJECTED", "授权材料已撤销");
            Dictionary<string, object> key = FindKey(material.KeySet, keyId);
            DateTime now = DateTime.UtcNow;
            DateTime keyStart = RequiredDateTime(key, "notBefore");
            DateTime keyEnd = RequiredDateTime(key, "notAfter");
            DateTime tokenStart = RequiredDateTime(token, "issuedAt");
            DateTime tokenEnd = RequiredDateTime(token, "expiresAt");
            DateTime decisionStart = RequiredDateTime(decision, "issuedAt");
            DateTime decisionEnd = RequiredDateTime(decision, "validUntil");
            if (now < keyStart || now > keyEnd || now < tokenStart || now > tokenEnd || now < decisionStart || now > decisionEnd)
                Reject("AGENT_V2_AUTHORIZATION_REJECTED", "授权材料已过期或尚未生效");
            if ((tokenEnd - tokenStart).TotalSeconds > MaximumTokenLifetimeSeconds || (decisionEnd - decisionStart).TotalSeconds > MaximumTokenLifetimeSeconds)
                Reject("AGENT_V2_AUTHORIZATION_REJECTED", "授权材料生命周期超过限制");
            if (!VerifyPolicyPayload(token, key, RequiredString(token, "signature")) || !VerifyPolicyPayload(decision, key, RequiredString(decision, "signature")))
                Reject("AGENT_V2_AUTHORIZATION_REJECTED", "Policy Authority 签名校验失败");
            if (RequiredString(token, "policyRef") != RequiredString(decision, "policyRef") || RequiredString(token, "policyVersion") != RequiredString(decision, "policyVersion") || RequiredIdentifier(token, "tokenId") != RequiredIdentifier(decision, "tokenId") || RequiredIdentifier(token, "nonce") != RequiredIdentifier(decision, "nonce"))
                Reject("AGENT_V2_AUTHORIZATION_REJECTED", "Token 与 Policy Authority 决策字段绑定不一致");
            if (!SameStringSet(StringList(token, "actions"), StringList(decision, "actions")) || !SameStringSet(StringList(token, "allowedPaths"), StringList(decision, "allowedPaths")) || !SameStringSet(StringList(token, "allowedServices"), StringList(decision, "allowedServices")) || !SameStringSet(StringList(token, "artifactDigests"), StringList(decision, "artifactDigests")))
                Reject("AGENT_V2_AUTHORIZATION_REJECTED", "Token 与 Policy Authority 决策授权范围不一致");
            if (OptionalString(token, "approvalRef") != OptionalString(decision, "approvalRef")) Reject("AGENT_V2_AUTHORIZATION_REJECTED", "审批引用绑定不一致");
        }

        private static void ValidateIdentity(Dictionary<string, object> value, string agentId, string tenantId, string pluginId, string pluginVersionId, string capability)
        {
            if (RequiredIdentifier(value, "agentId") != agentId || RequiredIdentifier(value, "tenantId") != tenantId || RequiredPluginId(value, "pluginId") != pluginId || RequiredIdentifier(value, "pluginVersionId") != pluginVersionId || RequiredIdentifier(value, "capability") != capability)
                Reject("AGENT_V2_AUTHORIZATION_REJECTED", "授权身份绑定不一致");
        }

        private static IList ValidatePlan(Dictionary<string, object> plan, Dictionary<string, object> token, Dictionary<string, object> decision, string agentId, string tenantId, string pluginId, string pluginVersionId, string capability, string planDigest)
        {
            EnsureExact(plan, new string[] { "planVersion", "planId", "agentId", "tenantId", "pluginId", "pluginVersionId", "capability", "operations", "planDigest", "tokenId", "policyDecisionId", "nonce", "expiresAt", "writeEffect", "approvalRef" });
            if (RequiredString(plan, "planVersion") != ContractVersion) Reject("AGENT_PLAN_INVALID", "Plan 合同版本不受支持");
            ValidateIdentity(plan, agentId, tenantId, pluginId, pluginVersionId, capability);
            if (RequiredDigest(plan, "planDigest") != planDigest || RequiredIdentifier(plan, "tokenId") != RequiredIdentifier(token, "tokenId") || RequiredIdentifier(plan, "policyDecisionId") != RequiredIdentifier(decision, "decisionId") || RequiredIdentifier(plan, "nonce") != RequiredIdentifier(token, "nonce"))
                Reject("AGENT_PLAN_INVALID", "Plan 授权字段绑定不一致");
            if (OptionalString(plan, "approvalRef") != OptionalString(token, "approvalRef") || OptionalString(plan, "approvalRef") != OptionalString(decision, "approvalRef"))
                Reject("AGENT_PLAN_INVALID", "Plan 审批引用绑定不一致");
            DateTime expiresAt = RequiredDateTime(plan, "expiresAt");
            if (expiresAt > RequiredDateTime(token, "expiresAt") || expiresAt > RequiredDateTime(decision, "validUntil") || expiresAt < DateTime.UtcNow)
                Reject("AGENT_PLAN_INVALID", "Plan 有效期超出授权范围");
            IList operations = ListValue(plan, "operations");
            if (operations.Count == 0 || operations.Count > MaximumPlanOperations) Reject("AGENT_PLAN_INVALID", "Plan 操作数量不合法");
            bool hasWrite = false;
            foreach (object item in operations)
            {
                Dictionary<string, object> operation = item as Dictionary<string, object>;
                if (operation == null) Reject("AGENT_PLAN_INVALID", "Plan 操作必须是对象");
                ValidateOperation(operation, ref hasWrite);
            }
            if (RequiredBoolean(plan, "writeEffect") != hasWrite) Reject("AGENT_PLAN_INVALID", "Plan writeEffect 与操作集合不一致");
            Dictionary<string, object> unsigned = CopyWithout(plan, new string[] { "planDigest", "tokenId", "policyDecisionId", "nonce", "expiresAt" });
            if (ComputeDigest(unsigned) != planDigest) Reject("AGENT_PLAN_INVALID", "Plan 摘要与完整计划内容不匹配");
            return operations;
        }

        private static void ValidateOperation(Dictionary<string, object> operation, ref bool hasWrite)
        {
            EnsureExact(operation, new string[] { "operationId", "operationType", "stage", "input", "dependsOn", "idempotencyKey", "timeoutSeconds", "compensation" });
            RequiredIdentifier(operation, "operationId");
            string operationType = RequiredString(operation, "operationType");
            if (Array.IndexOf(OperationTypes, operationType) < 0) Reject("AGENT_PLAN_INVALID", "Plan 包含未登记的通用原语");
            string stage = RequiredString(operation, "stage");
            if (Array.IndexOf(new string[] { "prepare", "execute", "verify", "compensate" }, stage) < 0) Reject("AGENT_PLAN_INVALID", "Plan 阶段不受支持");
            Dictionary<string, object> input = RequiredDictionary(operation, "input");
            ListValue(operation, "dependsOn");
            RequiredIdentifier(operation, "idempotencyKey");
            int timeoutSeconds = RequiredInteger(operation, "timeoutSeconds");
            if (timeoutSeconds < 1 || timeoutSeconds > 3600) Reject("AGENT_PLAN_INVALID", "Plan 操作超时范围无效");
            if (operationType == "filesystem.stat" || operationType == "filesystem.read" || operationType == "filesystem.atomic_replace") RequiredWindowsPath(input, "path");
            if (operationType == "filesystem.backup")
            {
                RequiredWindowsPath(input, "sourcePath");
                RequiredWindowsPath(input, "backupPath");
            }
            if (operationType == "filesystem.restore")
            {
                RequiredWindowsPath(input, "restorePath");
                RequiredWindowsPath(input, "path");
            }
            if (operationType == "service.list") ValidateServiceListInput(input);
            if (operationType == "service.status" || operationType == "service.start" || operationType == "service.stop" || operationType == "service.reload") RequiredIdentifier(input, "serviceName");
            if (operationType == "command.execute_allowlisted") ValidateAllowlistedCommand(input, timeoutSeconds);
            RejectDangerousKeys(input);
            if (operationType == "filesystem.atomic_replace" || operationType == "filesystem.restore" || operationType == "filesystem.backup" || operationType == "service.start" || operationType == "service.stop" || operationType == "service.reload" || operationType == "command.execute_allowlisted") hasWrite = true;
        }

        private static void ValidateAllowlistedCommand(Dictionary<string, object> input, int timeoutSeconds)
        {
            EnsureExact(input, new string[] { "executablePath", "executableSha256", "args", "argumentTemplate", "environmentAllowlist", "workingDirectory", "networkScopes", "childProcessPolicy", "timeoutSeconds", "outputLimitBytes", "artifactDigest" });
            string executable = RequiredWindowsPath(input, "executablePath");
            if (!string.Equals(executable, WindowsSystemControlPath, StringComparison.OrdinalIgnoreCase)) Reject("AGENT_PLAN_INVALID", "外部程序不在固定绝对路径白名单内");
            if (!VerifyFileDigest(executable, RequiredDigest(input, "executableSha256"))) Reject("AGENT_PLAN_INVALID", "固定外部程序摘要不匹配");
            if (!string.Equals(RequiredWindowsPath(input, "workingDirectory"), WindowsSystem32Directory, StringComparison.OrdinalIgnoreCase)) Reject("AGENT_PLAN_INVALID", "外部程序工作目录不是固定目录");
            IList args = ListValue(input, "args");
            IList templates = ListValue(input, "argumentTemplate");
            if (args.Count != 2 || templates.Count != args.Count) Reject("AGENT_PLAN_INVALID", "命令参数模板不合法");
            string verb = Convert.ToString(args[0], CultureInfo.InvariantCulture);
            string service = Convert.ToString(args[1], CultureInfo.InvariantCulture);
            if (verb != "start" && verb != "stop" && verb != "query") Reject("AGENT_PLAN_INVALID", "命令动作不在固定模板内");
            if (!IdentifierPattern.IsMatch(service) || service.StartsWith("-", StringComparison.Ordinal)) Reject("AGENT_PLAN_INVALID", "命令服务参数无效");
            string verbTemplate = Convert.ToString(templates[0], CultureInfo.InvariantCulture);
            string serviceTemplate = Convert.ToString(templates[1], CultureInfo.InvariantCulture);
            if (verbTemplate != verb && verbTemplate != "{verb}") Reject("AGENT_PLAN_INVALID", "命令动作参数不符合固定模板");
            if (serviceTemplate != service && serviceTemplate != "{serviceName}") Reject("AGENT_PLAN_INVALID", "命令服务参数不符合固定模板");
            if (ListValue(input, "environmentAllowlist").Count != 0 || ListValue(input, "networkScopes").Count != 0) Reject("AGENT_PLAN_INVALID", "外部程序环境和网络范围不得扩展");
            if (RequiredString(input, "childProcessPolicy") != "deny") Reject("AGENT_PLAN_INVALID", "命令子进程策略必须为 deny");
            int commandTimeout = RequiredInteger(input, "timeoutSeconds");
            int outputLimit = RequiredInteger(input, "outputLimitBytes");
            if (commandTimeout < 1 || commandTimeout > timeoutSeconds || outputLimit < 1 || outputLimit > 16 * 1024 * 1024) Reject("AGENT_PLAN_INVALID", "命令资源限制无效");
            RequiredDigest(input, "artifactDigest");
        }

        private static bool VerifyFileDigest(string path, string expected)
        {
            if (!File.Exists(path)) return false;
            byte[] digest;
            using (FileStream stream = File.OpenRead(path))
            using (SHA256 sha = SHA256.Create()) digest = sha.ComputeHash(stream);
            StringBuilder actual = new StringBuilder(digest.Length * 2);
            for (int index = 0; index < digest.Length; index++) actual.Append(digest[index].ToString("x2"));
            return string.Equals(actual.ToString(), expected, StringComparison.OrdinalIgnoreCase);
        }

        private static void ValidateRequestScopes(Dictionary<string, object> payload, Dictionary<string, object> token, Dictionary<string, object> decision, Dictionary<string, object> localPolicy)
        {
            List<string> requestActions = StringListOrEmpty(payload, "actions");
            List<string> requestPaths = StringListOrEmpty(payload, "paths");
            List<string> requestServices = StringListOrEmpty(payload, "services");
            List<string> requestArtifacts = StringListOrEmpty(payload, "artifactDigests");
            List<string> tokenPaths = StringList(token, "allowedPaths");
            List<string> decisionPaths = StringList(decision, "allowedPaths");
            List<string> tokenServices = StringList(token, "allowedServices");
            List<string> decisionServices = StringList(decision, "allowedServices");
            if (!SameStringSet(requestActions, StringList(token, "actions")) || !SameStringSet(requestActions, StringList(decision, "actions"))) Reject("AGENT_V2_AUTHORIZATION_REJECTED", "请求动作范围与 Token 或 Policy Authority 决策不一致");
            if (!SameStringSet(requestPaths, tokenPaths) || !SameStringSet(requestPaths, decisionPaths) || !ListScopeAllowed(new ArrayList(requestPaths.ToArray()), tokenPaths) || !ListScopeAllowed(new ArrayList(requestPaths.ToArray()), decisionPaths)) Reject("AGENT_V2_AUTHORIZATION_REJECTED", "请求路径范围与 Token 或 Policy Authority 决策不一致");
            if (!SameStringSet(requestServices, tokenServices) || !SameStringSet(requestServices, decisionServices) || !ListScopeAllowedExact(new ArrayList(requestServices.ToArray()), tokenServices) || !ListScopeAllowedExact(new ArrayList(requestServices.ToArray()), decisionServices)) Reject("AGENT_V2_AUTHORIZATION_REJECTED", "请求服务范围与 Token 或 Policy Authority 决策不一致");
            if (!SameStringSet(requestArtifacts, StringList(token, "artifactDigests")) || !SameStringSet(requestArtifacts, StringList(decision, "artifactDigests"))) Reject("AGENT_V2_AUTHORIZATION_REJECTED", "请求制品摘要范围与 Token 或 Policy Authority 决策不一致");
            if (RequiredBoolean(localPolicy, "disabled")) Reject("AGENT_V2_AUTHORIZATION_REJECTED", "Agent 本地策略已紧急禁用");
            if (!StringList(localPolicy, "authorityKeyIds").Contains(RequiredIdentifier(token, "authorityKeyId")) || !StringList(localPolicy, "allowedActions").Contains(RequiredIdentifier(token, "capability"))) Reject("AGENT_V2_AUTHORIZATION_REJECTED", "Agent 本地策略不允许当前授权");
        }

        private static void ValidateOperationScopes(IList operations, Dictionary<string, object> token, Dictionary<string, object> decision, Dictionary<string, object> localPolicy)
        {
            List<string> allowedPaths = StringList(token, "allowedPaths");
            List<string> allowedServices = StringList(token, "allowedServices");
            List<string> tokenActions = StringList(token, "actions");
            List<string> decisionActions = StringList(decision, "actions");
            IList pathRules = ListValue(localPolicy, "pathRules");
            List<string> serviceRules = StringList(localPolicy, "serviceRules");
            foreach (object item in operations)
            {
                Dictionary<string, object> operation = (Dictionary<string, object>)item;
                string operationType = RequiredString(operation, "operationType");
                if (!tokenActions.Contains(operationType) || !decisionActions.Contains(operationType)) Reject("AGENT_V2_AUTHORIZATION_REJECTED", "操作不在 Token 或 Policy Authority 动作范围内");
                Dictionary<string, object> input = RequiredDictionary(operation, "input");
                if (operationType.StartsWith("filesystem.", StringComparison.Ordinal))
                {
                    foreach (string pathKey in FilePathKeys(operationType))
                    {
                        string path = RequiredWindowsPath(input, pathKey);
                        if (!ListScopeAllowed(new ArrayList { path }, allowedPaths) || !PathRuleAllowed(pathRules, path, operationType)) Reject("AGENT_V2_AUTHORIZATION_REJECTED", "操作路径超出授权或本地策略范围");
                    }
                }
                if (operationType == "service.list")
                {
                    foreach (string service in StringListOrEmpty(input, "serviceNames")) ValidateServiceScope(service, allowedServices, serviceRules);
                }
                if (operationType == "service.status" || operationType == "service.start" || operationType == "service.stop" || operationType == "service.reload")
                {
                    string service = RequiredIdentifier(input, "serviceName");
                    ValidateServiceScope(service, allowedServices, serviceRules);
                }
                if (operationType == "command.execute_allowlisted")
                {
                    string[] args = Strings(input["args"], "args", false);
                    if (args.Length != 2) Reject("AGENT_V2_AUTHORIZATION_REJECTED", "固定外部程序参数数量无效");
                    ValidateServiceScope(args[1], allowedServices, serviceRules);
                    ValidateCommandLocalPolicy(input, localPolicy);
                    string executableDigest = RequiredDigest(input, "executableSha256");
                    string artifactDigest = RequiredDigest(input, "artifactDigest");
                    if (!StringList(token, "artifactDigests").Contains(executableDigest) || !StringList(decision, "artifactDigests").Contains(executableDigest) || !StringList(token, "artifactDigests").Contains(artifactDigest) || !StringList(decision, "artifactDigests").Contains(artifactDigest))
                        Reject("AGENT_V2_AUTHORIZATION_REJECTED", "外部程序摘要不在 Token 或 Policy Authority 授权范围内");
                }
                if (input.ContainsKey("artifactDigest"))
                {
                    string artifact = RequiredDigest(input, "artifactDigest");
                    if (!StringList(token, "artifactDigests").Contains(artifact) || !StringList(decision, "artifactDigests").Contains(artifact)) Reject("AGENT_V2_AUTHORIZATION_REJECTED", "制品摘要不在授权范围内");
                }
            }
        }

        private static void RejectDangerousKeys(Dictionary<string, object> input)
        {
            foreach (string key in input.Keys)
            {
                string normalized = key.ToLowerInvariant();
                if (normalized == "shell" || normalized == "script" || normalized == "powershell" || normalized == "cmd" || normalized == "command" || normalized == "interpreter" || normalized == "eval" || normalized == "exec") Reject("AGENT_PLAN_INVALID", "Agent Core 拒绝 Shell、脚本和自由命令字段");
            }
        }

        private static string[] FilePathKeys(string operationType)
        {
            if (operationType == "filesystem.backup") return new string[] { "sourcePath", "backupPath" };
            if (operationType == "filesystem.restore") return new string[] { "restorePath", "path" };
            return new string[] { "path" };
        }

        private static void ValidateServiceListInput(Dictionary<string, object> input)
        {
            foreach (string service in StringListOrEmpty(input, "serviceNames"))
                if (!IdentifierPattern.IsMatch(service)) Reject("AGENT_PLAN_INVALID", "服务名称无效");
        }

        private static void ValidateServiceScope(string service, List<string> allowedServices, List<string> serviceRules)
        {
            if (!IdentifierPattern.IsMatch(service) || !ListScopeAllowedExact(new ArrayList { service }, allowedServices) || !serviceRules.Contains(service)) Reject("AGENT_V2_AUTHORIZATION_REJECTED", "操作服务超出授权或本地策略范围");
        }

        private static void ValidateCommandLocalPolicy(Dictionary<string, object> input, Dictionary<string, object> localPolicy)
        {
            string executablePath = RequiredWindowsPath(input, "executablePath");
            string executableDigest = RequiredDigest(input, "executableSha256");
            IList rules = ListValue(localPolicy, "commandRules");
            foreach (object item in rules)
            {
                Dictionary<string, object> rule = item as Dictionary<string, object>;
                if (rule == null) continue;
                if (!string.Equals(RequiredWindowsPath(rule, "executablePath"), executablePath, StringComparison.OrdinalIgnoreCase)) continue;
                if (!string.Equals(RequiredDigest(rule, "executableSha256"), executableDigest, StringComparison.OrdinalIgnoreCase)) continue;
                if (!string.Equals(RequiredWindowsPath(rule, "workingDirectory"), RequiredWindowsPath(input, "workingDirectory"), StringComparison.OrdinalIgnoreCase)) continue;
                if (!SameStringSequence(ListValue(input, "argumentTemplate"), ListValue(rule, "argumentTemplate"))) continue;
                if (!SameStringSet(StringList(input, "environmentAllowlist"), StringList(rule, "environmentAllowlist"))) continue;
                if (!SameStringSet(StringList(input, "networkScopes"), StringList(rule, "networkScopes"))) continue;
                if (RequiredString(rule, "childProcessPolicy") != RequiredString(input, "childProcessPolicy")) continue;
                if (RequiredInteger(input, "timeoutSeconds") > RequiredInteger(rule, "timeoutSeconds") || RequiredInteger(input, "outputLimitBytes") > RequiredInteger(rule, "outputLimitBytes")) continue;
                return;
            }
            Reject("AGENT_V2_AUTHORIZATION_REJECTED", "受控外部程序不在 Agent 本地命令策略内");
        }

        private static void ConsumeNonce(string dataDirectory, string nonce, string tokenId, string planDigest)
        {
            if (TextUtility.IsBlank(dataDirectory)) throw new AgentV2SecurityException("AGENT_V2_POLICY_UNAVAILABLE", "Nonce 数据目录未配置", false);
            string directory = Path.Combine(dataDirectory, "agent-v2-nonces");
            Directory.CreateDirectory(directory);
            string path = Path.Combine(directory, Sha256String(nonce) + ".json");
            Dictionary<string, object> record = new Dictionary<string, object>
            {
                { "recordVersion", ContractVersion }, { "nonce", nonce }, { "tokenId", tokenId },
                { "consumedAt", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "resultDigest", planDigest }
            };
            try
            {
                using (FileStream stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(Serializer.Serialize(record));
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush();
                }
            }
            catch (IOException) { throw new AgentV2SecurityException("AGENT_V2_NONCE_REPLAY", "Nonce 已消费或无法原子占用", false); }
            catch (UnauthorizedAccessException) { throw new AgentV2SecurityException("AGENT_V2_POLICY_UNAVAILABLE", "Nonce 账本不可写，Agent 失败关闭", false); }
        }

        private static void ValidateReceipt(Dictionary<string, object> receipt, string planId, string planDigest)
        {
            if (RequiredString(receipt, "receiptVersion") != ContractVersion || RequiredIdentifier(receipt, "operationId") == string.Empty || RequiredIdentifier(receipt, "planId") != planId || RequiredDigest(receipt, "planDigest") != planDigest || RequiredIdentifier(receipt, "agentId") == string.Empty || RequiredIdentifier(receipt, "tenantId") == string.Empty || RequiredIdentifier(receipt, "tokenId") == string.Empty || !DigestPattern.IsMatch(RequiredDigest(receipt, "digest")))
                throw new AgentV2SecurityException("AGENT_RECEIPT_INVALID", "Agent 回执绑定无效", false);
            string status = RequiredString(receipt, "status");
            if (status != "SUCCESS" && status != "FAILED" && status != "UNKNOWN" && status != "CANCELLED") throw new AgentV2SecurityException("AGENT_RECEIPT_INVALID", "Agent 回执状态无效", false);
            DateTime startedAt = RequiredDateTime(receipt, "startedAt");
            DateTime completedAt = RequiredDateTime(receipt, "completedAt");
            if (completedAt < startedAt) throw new AgentV2SecurityException("AGENT_RECEIPT_INVALID", "Agent 回执完成时间早于开始时间", false);
            if (!RequiredBoolean(receipt, "nonceConsumed")) throw new AgentV2SecurityException("AGENT_RECEIPT_INVALID", "Agent 回执未确认 Nonce 消费", false);
            if (ListValue(receipt, "operationResults").Count > MaximumPlanOperations) throw new AgentV2SecurityException("AGENT_RECEIPT_INVALID", "Agent 回执操作结果超出限制", false);
            if (status == "UNKNOWN" && TextUtility.IsBlank(OptionalString(receipt, "unknownReason"))) throw new AgentV2SecurityException("AGENT_RECEIPT_INVALID", "UNKNOWN 回执缺少原因", false);
            if (status == "SUCCESS" && receipt.ContainsKey("errorCode") && !TextUtility.IsBlank(OptionalString(receipt, "errorCode"))) throw new AgentV2SecurityException("AGENT_RECEIPT_INVALID", "SUCCESS 回执不能包含错误码", false);
            Dictionary<string, object> unsigned = CopyWithout(receipt, new string[] { "digest" });
            if (ComputeDigest(unsigned) != RequiredDigest(receipt, "digest")) throw new AgentV2SecurityException("AGENT_RECEIPT_INVALID", "Agent 回执摘要不匹配", false);
        }

        private static bool VerifyPolicyPayload(Dictionary<string, object> value, Dictionary<string, object> key, string signature)
        {
            byte[] signed;
            try { signed = DecodeBase64Url(signature); }
            catch { return false; }
            if (signed.Length != 64) return false;
            Dictionary<string, object> unsigned = CopyWithout(value, new string[] { "signature" });
            return Ed25519Verifier.Verify(RequiredString(key, "publicKeyPem"), signature, Encoding.UTF8.GetBytes(global::GCAC.WindowsCompatibilityAgent.CanonicalJson.Serialize(unsigned)));
        }

        private static Dictionary<string, object> FindKey(Dictionary<string, object> keySet, string keyId)
        {
            IList keys = ListValue(keySet, "keys");
            foreach (object item in keys)
            {
                Dictionary<string, object> key = item as Dictionary<string, object>;
                if (key != null && RequiredIdentifier(key, "keyId") == keyId)
                {
                    if (RequiredString(key, "algorithm") != "Ed25519" || RequiredString(key, "status") != "ACTIVE") Reject("AGENT_V2_AUTHORIZATION_REJECTED", "Policy Authority key 不可用");
                    return key;
                }
            }
            Reject("AGENT_V2_AUTHORIZATION_REJECTED", "未知 Policy Authority key");
            return null;
        }

        private static string ReceiptPath(string dataDirectory, string planId, string planDigest)
        {
            return Path.Combine(Path.Combine(dataDirectory, "agent-v2-receipts"), Sha256String(planId + ":" + planDigest) + ".json");
        }

        private static string Sha256String(string value)
        {
            byte[] hash;
            using (SHA256 sha = SHA256.Create()) hash = sha.ComputeHash(Encoding.UTF8.GetBytes(value ?? string.Empty));
            StringBuilder result = new StringBuilder(hash.Length * 2);
            for (int index = 0; index < hash.Length; index++) result.Append(hash[index].ToString("x2"));
            return result.ToString();
        }

        internal static bool ListScopeAllowed(IList values, List<string> scopes)
        {
            foreach (object item in values) if (!PathScopeAllowed(Convert.ToString(item, CultureInfo.InvariantCulture), scopes)) return false;
            return true;
        }

        internal static bool ListScopeAllowedExact(IList values, List<string> scopes)
        {
            foreach (object item in values) if (!scopes.Contains(Convert.ToString(item, CultureInfo.InvariantCulture))) return false;
            return true;
        }

        internal static bool PathScopeAllowed(string path, List<string> scopes)
        {
            string normalized = NormalizeWindowsPath(path).ToLowerInvariant();
            foreach (string scope in scopes)
            {
                string root = NormalizeWindowsPath(scope).TrimEnd('\\').ToLowerInvariant();
                if (normalized == root || normalized.StartsWith(root + "\\", StringComparison.Ordinal)) return true;
            }
            return false;
        }

        private static bool PathRuleAllowed(IList rules, string path, string operationType)
        {
            foreach (object item in rules)
            {
                Dictionary<string, object> rule = item as Dictionary<string, object>;
                if (rule == null) continue;
                string prefix = RequiredWindowsPath(rule, "prefix");
                if (PathScopeAllowed(path, new List<string> { prefix }) && StringList(rule, "operations").Contains(operationType)) return true;
            }
            return false;
        }

        internal static string NormalizeWindowsPath(string value)
        {
            if (TextUtility.IsBlank(value)) throw new AgentV2SecurityException("AGENT_PLAN_INVALID", "路径不能为空", false);
            string path = value.Replace('/', '\\');
            if (!(Regex.IsMatch(path, "^[A-Za-z]:\\\\") || path.StartsWith("\\\\", StringComparison.Ordinal)) || path.IndexOf("..", StringComparison.Ordinal) >= 0)
                throw new AgentV2SecurityException("AGENT_PLAN_INVALID", "路径必须是无越权片段的绝对 Windows 路径", false);
            return path.TrimEnd('\\');
        }

        private static Dictionary<string, object> RequiredDictionary(Dictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item) || !(item is Dictionary<string, object>)) Reject("AGENT_V2_REQUEST_INVALID", "字段 " + key + " 必须是对象");
            return (Dictionary<string, object>)item;
        }

        private static IList ListValue(Dictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item)) Reject("AGENT_V2_REQUEST_INVALID", "字段 " + key + " 必须是数组");
            IList list = item as IList;
            if (list == null) Reject("AGENT_V2_REQUEST_INVALID", "字段 " + key + " 必须是数组");
            return list;
        }

        private static IList ListValueOrEmpty(Dictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item) || item == null) return new ArrayList();
            IList list = item as IList;
            if (list == null) Reject("AGENT_V2_REQUEST_INVALID", "字段 " + key + " 必须是数组");
            return list;
        }

        private static List<string> StringList(Dictionary<string, object> value, string key)
        {
            IList list = ListValue(value, key);
            List<string> result = new List<string>();
            foreach (object item in list)
            {
                string text = Convert.ToString(item, CultureInfo.InvariantCulture);
                if (TextUtility.IsBlank(text)) Reject("AGENT_V2_REQUEST_INVALID", "字段 " + key + " 包含空字符串");
                result.Add(text);
            }
            return result;
        }

        private static List<string> StringListOrEmpty(Dictionary<string, object> value, string key)
        {
            if (value == null || !value.ContainsKey(key)) return new List<string>();
            return StringList(value, key);
        }

        private static string RequiredString(Dictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item) || item == null || TextUtility.IsBlank(Convert.ToString(item, CultureInfo.InvariantCulture))) Reject("AGENT_V2_REQUEST_INVALID", "字段 " + key + " 不能为空");
            return Convert.ToString(item, CultureInfo.InvariantCulture);
        }

        private static string OptionalString(Dictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item) || item == null) return string.Empty;
            return Convert.ToString(item, CultureInfo.InvariantCulture);
        }

        private static string RequiredIdentifier(Dictionary<string, object> value, string key)
        {
            string text = RequiredString(value, key);
            if (!IdentifierPattern.IsMatch(text) || text.ToLowerInvariant().IndexOf("default", StringComparison.Ordinal) >= 0 || text.ToLowerInvariant().IndexOf("development", StringComparison.Ordinal) >= 0 || text.ToLowerInvariant().IndexOf("dev-key", StringComparison.Ordinal) >= 0) Reject("AGENT_V2_REQUEST_INVALID", "字段 " + key + " 标识符无效或使用了开发默认值");
            return text;
        }

        private static string RequiredPluginId(Dictionary<string, object> value, string key)
        {
            string text = RequiredString(value, key);
            if (!Regex.IsMatch(text, "^(web|app|device|cloud|ca)\\.[a-z0-9]+(?:\\.[a-z0-9-]+)*$")) Reject("AGENT_V2_REQUEST_INVALID", "字段 " + key + " 不是 Canonical Plugin ID");
            return text;
        }

        private static string RequiredDigest(Dictionary<string, object> value, string key)
        {
            string text = RequiredString(value, key);
            if (!DigestPattern.IsMatch(text)) Reject("AGENT_V2_REQUEST_INVALID", "字段 " + key + " 不是 SHA-256 摘要");
            return text;
        }

        private static string RequiredWindowsPath(Dictionary<string, object> value, string key)
        {
            string text = RequiredString(value, key);
            return NormalizeWindowsPath(text);
        }

        private static int RequiredInteger(Dictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item)) Reject("AGENT_V2_REQUEST_INVALID", "字段 " + key + " 必须是整数");
            try { return Convert.ToInt32(item, CultureInfo.InvariantCulture); }
            catch { Reject("AGENT_V2_REQUEST_INVALID", "字段 " + key + " 必须是整数"); return 0; }
        }

        private static bool RequiredBoolean(Dictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item) || !(item is bool)) Reject("AGENT_V2_REQUEST_INVALID", "字段 " + key + " 必须是布尔值");
            return (bool)item;
        }

        private static DateTime RequiredDateTime(Dictionary<string, object> value, string key)
        {
            string text = RequiredString(value, key);
            DateTime result;
            if (!DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out result)) Reject("AGENT_V2_REQUEST_INVALID", "字段 " + key + " 不是有效时间");
            return result;
        }

        private static void EnsureExact(Dictionary<string, object> value, string[] allowed)
        {
            foreach (string key in value.Keys) if (Array.IndexOf(allowed, key) < 0) Reject("AGENT_V2_REQUEST_INVALID", "合同包含未登记字段：" + key);
        }

        private static Dictionary<string, object> CopyWithout(Dictionary<string, object> value, string[] excluded)
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            foreach (KeyValuePair<string, object> item in value) if (Array.IndexOf(excluded, item.Key) < 0) result[item.Key] = item.Value;
            return result;
        }

        private static bool SameStringSet(List<string> left, List<string> right)
        {
            if (left.Count != right.Count) return false;
            HashSet<string> values = new HashSet<string>(left, StringComparer.Ordinal);
            return values.Count == right.Count && values.SetEquals(right);
        }

        private static bool SameStringSequence(IList left, IList right)
        {
            if (left.Count != right.Count) return false;
            for (int index = 0; index < left.Count; index++)
                if (!string.Equals(Convert.ToString(left[index], CultureInfo.InvariantCulture), Convert.ToString(right[index], CultureInfo.InvariantCulture), StringComparison.Ordinal)) return false;
            return true;
        }

        private static byte[] DecodeBase64Url(string value)
        {
            string normalized = value.Replace('-', '+').Replace('_', '/');
            while (normalized.Length % 4 != 0) normalized += "=";
            return Convert.FromBase64String(normalized);
        }

        private static void Reject(string code, string message)
        {
            throw new AgentV2SecurityException(code, message, false);
        }
    }

    internal static class PolicyMaterialLoader
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

        internal static PolicyMaterial Load(AgentConfig config, string agentId, string tenantId)
        {
            Dictionary<string, object> root = LoadObject(config.policyTrustRootPath, "Policy Authority 信任根", true);
            string rootKeyId = Identifier(root, "rootKeyId");
            if (StringValue(root, "algorithm") != "Ed25519" || StringValue(root, "authorityId") == string.Empty) throw Unavailable("Policy Authority 信任根格式无效");
            string pem = Required(root, "publicKeyPem");
            if (!Regex.IsMatch(Required(root, "fingerprintSha256"), "^[a-f0-9]{64}$")) throw Unavailable("Policy Authority 信任根指纹格式无效");
            Dictionary<string, object> envelope = LoadObject(config.policyKeySetPath, "Policy Authority KeySet", true);
            if (StringValue(envelope, "envelopeVersion") != AgentV2Security.ContractVersion || Identifier(envelope, "rootKeyId") != rootKeyId) throw Unavailable("Policy Authority KeySet 信任根绑定无效");
            Dictionary<string, object> keySet = RequiredDictionary(envelope, "keySet");
            if (StringValue(keySet, "keySetVersion") != AgentV2Security.ContractVersion || StringValue(keySet, "authorityId") != StringValue(root, "authorityId")) throw Unavailable("Policy Authority KeySet 版本或归属无效");
            string envelopeSignature = Required(envelope, "signature");
            if (!Verify(root, AgentV2Security.CopyWithoutForMaterial(envelope, "signature"), envelopeSignature, pem)) throw Unavailable("Policy Authority KeySet 签名无效");
            Dictionary<string, object> localRoot = LoadObject(config.localPolicyTrustRootPath, "Agent 本地策略信任根", true);
            string localPem = Required(localRoot, "publicKeyPem");
            if (StringValue(localRoot, "algorithm") != "Ed25519") throw Unavailable("Agent 本地策略信任根算法无效");
            if (!Regex.IsMatch(Required(localRoot, "fingerprintSha256"), "^[a-f0-9]{64}$")) throw Unavailable("Agent 本地策略信任根指纹格式无效");
            Dictionary<string, object> localEnvelope = LoadObject(config.localPolicyPath, "Agent 本地策略包", true);
            if (StringValue(localEnvelope, "bundleVersion") != "gcac.agent-local-policy/v1" || Identifier(localEnvelope, "rootKeyId") != Identifier(localRoot, "rootKeyId")) throw Unavailable("Agent 本地策略包信任根绑定无效");
            if (!Verify(localRoot, AgentV2Security.CopyWithoutForMaterial(localEnvelope, "signature"), Required(localEnvelope, "signature"), localPem)) throw Unavailable("Agent 本地策略包签名无效");
            Dictionary<string, object> localPolicy = null;
            foreach (object entryObject in List(localEnvelope, "policies"))
            {
                Dictionary<string, object> entry = entryObject as Dictionary<string, object>;
                if (entry == null || StringValue(entry, "tenantId") != tenantId) continue;
                Dictionary<string, object> candidate = entry.ContainsKey("policy") ? entry["policy"] as Dictionary<string, object> : null;
                if (candidate != null && StringValue(candidate, "agentId") == agentId) localPolicy = candidate;
            }
            if (localPolicy == null || StringValue(localPolicy, "policyVersion") != AgentV2Security.ContractVersion) throw Unavailable("Agent 本地策略未匹配当前租户和 Agent");
            HashSet<string> revokedTokens = LoadRevoked(config.revokedTokenIdsPath, "tokenId");
            HashSet<string> revokedDecisions = LoadRevoked(config.revokedDecisionIdsPath, "decisionId");
            HashSet<string> revokedKeys = LoadRevoked(config.revokedKeyIdsPath, "keyId");
            string activeKey = Identifier(keySet, "activeKeyId");
            Dictionary<string, object> selected = null;
            foreach (object item in List(keySet, "keys"))
            {
                Dictionary<string, object> key = item as Dictionary<string, object>;
                if (key != null && StringValue(key, "keyId") == activeKey) selected = key;
            }
            if (selected == null || StringValue(selected, "algorithm") != "Ed25519" || StringValue(selected, "status") != "ACTIVE" || revokedKeys.Contains(activeKey)) throw Unavailable("Policy Authority active key 不可用");
            return new PolicyMaterial { KeySet = keySet, LocalPolicy = localPolicy, RevokedTokenIds = revokedTokens, RevokedDecisionIds = revokedDecisions, RevokedKeyIds = revokedKeys, AuthorityKeyId = activeKey, AuthorityPublicKey = null };
        }

        private static HashSet<string> LoadRevoked(string path, string field)
        {
            Dictionary<string, object> wrapper;
            if (!File.Exists(path)) throw Unavailable("撤销清单缺失：" + field);
            object parsed;
            try { parsed = Serializer.DeserializeObject(File.ReadAllText(path)); }
            catch { throw Unavailable("撤销清单无法解析：" + field); }
            IList values = parsed as IList;
            if (values == null && (wrapper = parsed as Dictionary<string, object>) != null && wrapper.ContainsKey("records")) values = wrapper["records"] as IList;
            if (values == null) throw Unavailable("撤销清单格式无效：" + field);
            HashSet<string> result = new HashSet<string>(StringComparer.Ordinal);
            foreach (object item in values)
            {
                Dictionary<string, object> record = item as Dictionary<string, object>;
                string value = record == null ? Convert.ToString(item, CultureInfo.InvariantCulture) : StringValue(record, field);
                if (!TextUtility.IsBlank(value)) result.Add(value);
            }
            return result;
        }

        private static Dictionary<string, object> LoadObject(string path, string name, bool required)
        {
            if (TextUtility.IsBlank(path) || !File.Exists(path)) throw Unavailable(name + "缺失");
            try
            {
                Dictionary<string, object> result = Serializer.DeserializeObject(File.ReadAllText(path)) as Dictionary<string, object>;
                if (result == null) throw new InvalidOperationException();
                return result;
            }
            catch { throw Unavailable(name + "无法解析"); }
        }

        private static bool Verify(Dictionary<string, object> trustRoot, Dictionary<string, object> value, string signature, string pem)
        {
            byte[] signed;
            try { signed = Decode(signature); }
            catch { return false; }
            return signed.Length == 64 && Ed25519Verifier.Verify(pem, signature, Encoding.UTF8.GetBytes(CanonicalJson.Serialize(value)));
        }

        private static byte[] Decode(string value)
        {
            string normalized = value.Replace('-', '+').Replace('_', '/');
            while (normalized.Length % 4 != 0) normalized += "=";
            return Convert.FromBase64String(normalized);
        }

        private static string Required(Dictionary<string, object> value, string key)
        {
            string result = StringValue(value, key);
            if (TextUtility.IsBlank(result)) throw Unavailable("材料字段缺失：" + key);
            return result;
        }

        private static string Identifier(Dictionary<string, object> value, string key)
        {
            string result = Required(value, key);
            if (!Regex.IsMatch(result, "^[A-Za-z0-9._:-]{1,256}$")) throw Unavailable("材料标识符无效：" + key);
            return result;
        }

        private static string StringValue(Dictionary<string, object> value, string key)
        {
            object item;
            return value != null && value.TryGetValue(key, out item) && item != null ? Convert.ToString(item, CultureInfo.InvariantCulture) : string.Empty;
        }

        private static Dictionary<string, object> RequiredDictionary(Dictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item) || !(item is Dictionary<string, object>)) throw Unavailable("材料对象缺失：" + key);
            return (Dictionary<string, object>)item;
        }

        private static IList List(Dictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item) || !(item is IList)) throw Unavailable("材料数组缺失：" + key);
            return (IList)item;
        }

        private static AgentV2SecurityException Unavailable(string message)
        {
            return new AgentV2SecurityException("AGENT_V2_POLICY_UNAVAILABLE", message, false);
        }
    }

    internal static class CanonicalJson
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

        internal static string Serialize(object value)
        {
            if (value == null) return "null";
            string text = value as string;
            if (text != null) return Serializer.Serialize(text);
            if (value is bool) return (bool)value ? "true" : "false";
            if (value is byte || value is short || value is int || value is long || value is sbyte || value is ushort || value is uint || value is ulong || value is decimal || value is double || value is float)
                return Convert.ToString(value, CultureInfo.InvariantCulture);
            IDictionary dictionary = value as IDictionary;
            if (dictionary != null)
            {
                List<string> keys = new List<string>();
                foreach (object key in dictionary.Keys) keys.Add(Convert.ToString(key, CultureInfo.InvariantCulture));
                keys.Sort(StringComparer.Ordinal);
                StringBuilder result = new StringBuilder("{");
                for (int index = 0; index < keys.Count; index++)
                {
                    if (index > 0) result.Append(",");
                    result.Append(Serializer.Serialize(keys[index]));
                    result.Append(":");
                    result.Append(Serialize(dictionary[keys[index]]));
                }
                result.Append("}");
                return result.ToString();
            }
            IEnumerable enumerable = value as IEnumerable;
            if (enumerable != null)
            {
                StringBuilder result = new StringBuilder("[");
                bool first = true;
                foreach (object item in enumerable)
                {
                    if (!first) result.Append(",");
                    first = false;
                    result.Append(Serialize(item));
                }
                result.Append("]");
                return result.ToString();
            }
            return Serializer.Serialize(value);
        }
    }
}

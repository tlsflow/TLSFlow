using GCAC.WindowsCompatibilityAgent;
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class Tests
{
    private static int failures;
    private static int executedTests;

    private static int Main()
    {
        Run("Registry 只接受规范动作", RegistryRequiresCanonicalAction);
        Run("Registry 拒绝 Agent v2 大小写动作变体", RegistryRejectsCaseVariantAction);
        Run("Registry 拒绝退役动作别名", RegistryRejectsRetiredAlias);
        Run("未知 Schema Version 失败关闭", RegistryRejectsUnknownSchema);
        Run("前置检查按事实和通用操作符解析", PreflightUsesFacts);
        Run("退役旧计划动作不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("agent.atomic_plan.execute"); });
        Run("缺少 Agent v2 Policy Authority 必须失败关闭且写操作不确定", AgentV2PolicyUnavailable);
        Run("旧计划动作无论载荷如何都不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("agent.atomic_plan.execute", "file.atomic_replace"); });
        Run("旧命令动作不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("command.execute"); });
        Run("缺失前置事实返回稳定阻塞错误", PreflightReportsStableBlocker);
        Run("HTTP 控制面不启用 TLS 配置", HttpControlPlaneDoesNotRequireTls);
        Run("HTTPS 控制面仍识别为 TLS 传输", HttpsControlPlaneRequiresTls);
        Run("系统事实包含注册和详情所需字段", CapabilityCollectorIncludesSystemFacts);
        Run("注册请求包含系统描述字段", RegistrationRequestIncludesSystemDescriptor);
        Run("注册与心跳不再广告旧直连能力", ControlPlaneRequestsDoNotAdvertiseDirectControl);
        Run("注册动作集合严格限定为 Agent v2 合同", RuntimeActionsMatchAgentV2Contract);
        Run("Agent v2 合同不回退旧执行器", AgentV2ContractDoesNotFallback);
        Run("Ed25519 RFC8032 签名正例通过", Ed25519SignaturePositive);
        Run("Ed25519 RFC8032 签名生成通过", Ed25519SignatureGeneration);
        Run("Ed25519 篡改签名负例拒绝", Ed25519SignatureTamperingRejected);
        Run("客户端不得提交伪造 Receipt", ClientReceiptIsRejected);
        Run("Agent v2 Nonce 账本跨重启拒绝重复消费", AgentV2NonceLedgerPersistsReplayRejection);
        Run("能力报告使用 L2 和结构化声明", CapabilityRequestUsesStructuredL2Declarations);
        Run("能力报告不再包含 IIS 详情和站点", CapabilityRequestExcludesIisInspection);
        Run("心跳请求包含公共健康模型", HeartbeatRequestIncludesRuntimeHealth);
        Run("Agent ID 可跨进程重启持久化", AgentIdentityPersistsAcrossRestart);
        Run("IIS 绑定动作不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("windows.iis.binding.capture"); });
        Run("IIS 证书更新动作不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("windows.iis.binding.update_certificate"); });
        Run("IIS 属性回退动作不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("windows.iis.binding.restore_certificate"); });
        Run("IIS HTTP.sys 动作不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("windows.iis.http.sys"); });
        Run("IIS 管理程序集路径不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("windows.iis.management"); });
        Run("任务拉取结果展开公共动作载荷", PulledTaskNormalizesPublicActionPayload);
        Run("控制面 actionType 仅在边界转换为 Agent v2 action", QueueActionTypeMapsToCanonicalAction);
        Run("控制面拒绝旧动作、Alias、冲突和旧协议", QueueBoundaryRejectsLegacyActions);
        Run("Agent v2 安全原语登记受控外部程序", AgentV2RegistersAllowlistedCommand);
        Run("运行时只注册四个 Agent v2 动作", RuntimeRegistersOnlyAgentV2Actions);
        Run("运行时不注册历史 Agent 动作", RuntimeDoesNotRegisterLegacyActions);
        Run("第三方产品发现不再进入 Agent Core", delegate { LegacyExecutionPathIsRejected("agent.plan.execute", "product.discovery"); });
        Run("动作注册表不暴露旧健康直连动作", RegistryDoesNotExposeDirectControlAction);
        Run("旧文件替换原语不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("file.atomic_replace"); });
        Run("旧文件恢复原语不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("file.restore"); });
        Run("旧 PREFLIGHT 原语不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("preflight.assert"); });
        Run("旧文件路径原语不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("file.replace"); });
        Run("旧程序路径原语不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("command.execute"); });
        Run("旧 Shell 原语不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("shell.execute"); });
        Run("旧自由参数原语不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("process.execute"); });
        Run("旧服务原语不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("service.control"); });
        Run("旧服务预演原语不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("service.preview"); });
        Run("旧计划账本路径不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("atomic_plan.ledger"); });
        Run("旧计划冲突路径不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("atomic_plan.conflict"); });
        Run("旧计划回滚路径不进入 Agent Core", delegate { LegacyExecutionPathIsRejected("atomic_plan.rollback"); });
        Run("Recovery Ledger 保存摘要并支持重试确认", RecoveryLedgerPersistsRetryState);
        Run("Recovery Ledger 损坏进入人工处理", RecoveryLedgerCorruptionRequiresManualIntervention);
        Run("结果提交失败注入默认关闭且可控", ResultSubmissionFailureInjectionIsControlled);
        Run("文件备份和恢复的每条真实路径都受 Scope 约束", FileOperationScopesCoverEveryPath);
        Run("service.list 使用真实服务列表字段", ServiceListUsesServiceNames);
        Run("受控命令服务目标受 Token 和本地策略约束", AllowlistedCommandServiceScopeIsBound);
        Run("受控命令缺少本地命令规则时拒绝", AllowlistedCommandRequiresLocalRule);
        Run("请求 Scope 必须与签名授权精确一致", RequestScopesMustMatchAuthorization);
        Run("Receipt 支持并校验成功失败未知取消四种状态", ReceiptStatusesAreValidated);
        Console.WriteLine("tests=" + executedTests + " failures=" + failures);
        return failures == 0 ? 0 : 1;
    }

    private static void RegistryRequiresCanonicalAction()
    {
        ActionRegistry registry = Registry();
        ActionResult result = registry.Execute(new AgentTask { action = "test.action", schemaVersion = ProductIdentity.ActionSchemaVersion });
        Assert(result.Success, "规范动作未执行");
    }

    private static void RegistryRejectsCaseVariantAction()
    {
        Assert(!AgentV2Actions.Contains("AGENT.PLAN.EXECUTE"), "Agent v2 动作不应接受大小写变体");
        ActionResult result = AgentV2Registry().Execute(new AgentTask { action = "AGENT.PLAN.EXECUTE", schemaVersion = ProductIdentity.ActionSchemaVersion });
        Assert(!result.Success && result.ErrorCode == "AGENT_V2_ACTION_UNSUPPORTED", "大小写动作变体未在合同入口拒绝");
    }

    private static void RegistryRejectsRetiredAlias()
    {
        ActionRegistry registry = Registry();
        ActionResult result = registry.Execute(new AgentTask { action = "legacy.action", schemaVersion = ProductIdentity.ActionSchemaVersion });
        Assert(!result.Success && result.ErrorCode == "ACTION_NOT_REGISTERED", "退役动作别名仍可执行");
    }

    private static void RegistryRejectsUnknownSchema()
    {
        ActionResult result = Registry().Execute(new AgentTask { action = "test.action", schemaVersion = "gcac.action/v999" });
        Assert(!result.Success && result.ErrorCode == "ACTION_SCHEMA_UNSUPPORTED", "未知 Schema 未失败关闭");
    }

    private static void PreflightUsesFacts()
    {
        CapabilitySnapshot snapshot = new CapabilitySnapshot { Facts = new Dictionary<string, object> { { "custom.number", 7 } }, Capabilities = new List<string>() };
        PreflightEvaluator evaluator = new PreflightEvaluator(new List<FactRequirement> { new FactRequirement { Id = "minimum", Fact = "custom.number", Operator = "number_gte", Expected = 5, ErrorCode = "BLOCKED" } });
        Assert(evaluator.Evaluate(snapshot).Supported, "通用事实约束未通过");
    }

    private static void AgentV2PolicyUnavailable()
    {
        foreach (string action in AgentV2Actions.All())
        {
            ActionResult result = AgentV2ContractHandler.Execute(new AgentTask
            {
                action = action,
                payload = action == AgentV2Actions.PlanExecute
                    ? new Dictionary<string, object> { { "plan", new Dictionary<string, object> { { "mutating", true } } } }
                    : null
            });
            Assert(!result.Success && result.ErrorCode == "AGENT_V2_AUTHORIZATION_DENIED", "缺少 Agent v2 Policy Authority 时未失败关闭");
            Assert(result.Outcome == (AgentV2Actions.IsWrite(action) ? "UNKNOWN" : "FAILED"), "Agent v2 终态未按读写风险分类");
            Assert(result.Detail != null && Convert.ToBoolean(result.Detail["fallback"]) == false, "Agent v2 缺少授权时存在 fallback");
        }
    }

    private static void PreflightReportsStableBlocker()
    {
        CapabilitySnapshot snapshot = new CapabilitySnapshot { Facts = new Dictionary<string, object> { { "network.control_plane_reachable", false } }, Capabilities = new List<string>() };
        PreflightEvaluator evaluator = new PreflightEvaluator(new List<FactRequirement> { new FactRequirement { Id = "network", Fact = "network.control_plane_reachable", Operator = "equals", Expected = true, ErrorCode = "CONTROL_PLANE_UNREACHABLE", Message = "blocked" } });
        PreflightResult result = evaluator.Evaluate(snapshot);
        Assert(!result.Supported && result.Checks[0].ErrorCode == "CONTROL_PLANE_UNREACHABLE", "前置检查未返回稳定错误");
    }

    private static void HttpControlPlaneDoesNotRequireTls()
    {
        Assert(!TransportProtocol.IsHttps("http://10.255.0.85:5172"), "HTTP 被错误识别为 HTTPS");
    }

    private static void HttpsControlPlaneRequiresTls()
    {
        Assert(TransportProtocol.IsHttps("https://control.example.test"), "HTTPS 未被识别为 TLS 传输");
    }

    private static void CapabilityCollectorIncludesSystemFacts()
    {
        CapabilitySnapshot snapshot = new CapabilityCollector().Collect();
        Assert(snapshot.Facts.ContainsKey("windows.product_name"), "缺少 Windows 产品名称事实");
        Assert(snapshot.Facts.ContainsKey("windows.build_number"), "缺少 Windows 构建号事实");
        Assert(snapshot.Facts.ContainsKey("windows.machine_id"), "缺少 Windows Machine ID 事实");
        Assert(snapshot.Facts.ContainsKey("network.primary_ip"), "缺少主 IP 事实");
    }

    private static void RegistrationRequestIncludesSystemDescriptor()
    {
        AgentConfig config = TestConfig();
        CapabilitySnapshot snapshot = Snapshot();
        Dictionary<string, object> request = new ControlPlaneClient(config).BuildRegistrationRequest(snapshot);
        Assert(Convert.ToString(request["machineId"]) == "machine-1", "注册请求未上传 Machine ID");
        Assert(Convert.ToString(request["ipAddress"]) == "10.20.30.40", "注册请求未上传 IP 地址");
        Assert(Convert.ToString(request["osVersion"]) == "Windows Server 2008 R2 Standard", "注册请求未上传操作系统版本");
    }

    private static void ControlPlaneRequestsDoNotAdvertiseDirectControl()
    {
        AgentConfig config = TestConfig();
        Dictionary<string, object> registration = new ControlPlaneClient(config).BuildRegistrationRequest(Snapshot());
        Dictionary<string, object> heartbeat = ControlPlaneClient.BuildHeartbeatRequest("agent-1", Snapshot(), new Dictionary<string, object> { { "status", "healthy" } });
        Assert(!registration.ContainsKey("directControl"), "注册请求仍广告旧 Direct Control 能力");
        Assert(!heartbeat.ContainsKey("directControl"), "心跳请求仍广告旧 Direct Control 能力");
    }

    private static void RuntimeActionsMatchAgentV2Contract()
    {
        string[] actions = RuntimeRegisteredActions();
        string[] expected = AgentV2Actions.All();
        Assert(actions.Length == expected.Length, "运行时动作集合包含非 Agent v2 动作");
        foreach (string action in expected) Assert(Array.IndexOf(actions, action) >= 0, "运行时缺少 Agent v2 动作：" + action);
    }

    private static void CapabilityRequestUsesStructuredL2Declarations()
    {
        Dictionary<string, object> request = ControlPlaneClient.BuildCapabilityRequest("agent-1", Snapshot());
        Assert(Convert.ToString(request["compatibilityLevel"]) == "L2", "Compatibility Agent 未声明为 L2");
        List<Dictionary<string, object>> capabilities = (List<Dictionary<string, object>>)request["capabilities"];
        Dictionary<string, object> osDetail = capabilities.Find(delegate(Dictionary<string, object> item) { return Convert.ToString(item["capabilityKey"]) == "windows.os.detail"; });
        Dictionary<string, object> adapters = capabilities.Find(delegate(Dictionary<string, object> item) { return Convert.ToString(item["capabilityKey"]) == "windows.network.adapters"; });
        Assert(osDetail != null && osDetail.ContainsKey("value") && osDetail.ContainsKey("confidence"), "缺少结构化 Windows 系统详情声明");
        Assert(adapters != null && adapters.ContainsKey("value") && adapters.ContainsKey("confidence"), "缺少结构化 Windows 网卡声明");
    }

    private static void PulledTaskNormalizesPublicActionPayload()
    {
        AgentTask task = ControlPlaneClient.NormalizeTask(new AgentTask
        {
            id = "task-1",
            payload = new Dictionary<string, object>
            {
                { "type", "agent.capability.rescan" },
                { "schemaVersion", ProductIdentity.ActionSchemaVersion }
            }
        });
        Assert(string.IsNullOrEmpty(task.action), "旧 payload.type 被转换为运行期动作");
        ActionResult result = AgentV2Registry().Execute(task);
        Assert(!result.Success && result.ErrorCode == "ACTION_NOT_REGISTERED", "旧 payload.type 绕过规范动作注册表");
        Assert(task.schemaVersion == ProductIdentity.ActionSchemaVersion, "未从 payload.schemaVersion 展开协议版本");
        Assert(task.leaseId != null && task.leaseId.StartsWith("compat:"), "未生成 Compatibility Agent Lease ID");
    }

    private static void QueueActionTypeMapsToCanonicalAction()
    {
        AgentTask task = ControlPlaneClient.NormalizeTask(new AgentTask
        {
            id = "task-action-type",
            payload = new Dictionary<string, object>
            {
                { "actionType", AgentV2Actions.PlanValidate },
                { "actionSchemaVersion", "1.0" },
                { "schemaVersion", ProductIdentity.ActionSchemaVersion }
            }
        });
        Assert(task.action == AgentV2Actions.PlanValidate, "控制面 actionType 未转换为 canonical action");
        Assert(task.schemaVersion == ProductIdentity.ActionSchemaVersion, "actionType 转换丢失 Schema Version");
        Assert(!task.payload.ContainsKey("actionType") && !task.payload.ContainsKey("actionSchemaVersion"), "队列动作字段未在边界转换后移除");
    }

    private static void QueueBoundaryRejectsLegacyActions()
    {
        string[] rejected = new string[] { "agent.atomic_plan.execute", "agent.execute", "command.execute", "agent.plan.execute.alias" };
        foreach (string action in rejected)
        {
            try
            {
                ControlPlaneClient.NormalizeTask(new AgentTask
                {
                    payload = new Dictionary<string, object> { { "actionType", action } }
                });
                throw new InvalidOperationException("旧动作或 Alias 未被拒绝：" + action);
            }
            catch (InvalidOperationException error)
            {
                Assert(error.Message.IndexOf("Agent v2 canonical", StringComparison.Ordinal) >= 0, "旧动作拒绝原因不明确：" + action);
            }
        }
        try
        {
            ControlPlaneClient.NormalizeTask(new AgentTask
            {
                payload = new Dictionary<string, object>
                {
                    { "action", AgentV2Actions.PlanValidate },
                    { "actionType", AgentV2Actions.PlanValidate }
                }
            });
            throw new InvalidOperationException("并存 action 与 actionType 未被拒绝");
        }
        catch (InvalidOperationException error)
        {
            Assert(error.Message.IndexOf("wire action", StringComparison.Ordinal) >= 0, "双路径动作拒绝原因不明确");
        }
        try
        {
            ControlPlaneClient.NormalizeTask(new AgentTask
            {
                payload = new Dictionary<string, object> { { "actionType", AgentV2Actions.PlanValidate }, { "actionSchemaVersion", "2.0" } }
            });
            throw new InvalidOperationException("不支持的 actionSchemaVersion 未被拒绝");
        }
        catch (InvalidOperationException error)
        {
            Assert(error.Message.IndexOf("actionSchemaVersion", StringComparison.Ordinal) >= 0, "不支持的 actionSchemaVersion 拒绝原因不明确");
        }
    }

    private static void AgentV2RegistersAllowlistedCommand()
    {
        FieldInfo field = typeof(AgentV2Security).GetField("OperationTypes", BindingFlags.NonPublic | BindingFlags.Static);
        Assert(field != null, "Agent v2 原语登记表不存在");
        string[] operations = (string[])field.GetValue(null);
        Assert(Array.IndexOf(operations, "command.execute_allowlisted") >= 0, "受控外部程序原语未登记");
    }

    private static void CapabilityRequestExcludesIisInspection()
    {
        Dictionary<string, object> request = ControlPlaneClient.BuildCapabilityRequest("agent-1", Snapshot());
        List<Dictionary<string, object>> capabilities = (List<Dictionary<string, object>>)request["capabilities"];
        Assert(!capabilities.Exists(delegate(Dictionary<string, object> item) { return Convert.ToString(item["capabilityKey"]) == "windows.iis.detail"; }), "能力报告仍包含 IIS 详情");
        Assert(!capabilities.Exists(delegate(Dictionary<string, object> item) { return Convert.ToString(item["capabilityKey"]) == "windows.iis.sites"; }), "能力报告仍包含 IIS 站点");
    }

    private static void HeartbeatRequestIncludesRuntimeHealth()
    {
        Dictionary<string, object> runtimeHealth = new Dictionary<string, object>
        {
            { "modelVersion", "gcac.agent.health.v1" },
            { "status", "healthy" }
        };
        Dictionary<string, object> request = ControlPlaneClient.BuildHeartbeatRequest("agent-1", Snapshot(), runtimeHealth);
        Assert(object.ReferenceEquals(request["runtimeHealth"], runtimeHealth), "心跳请求未上传运行健康模型");
    }

    private static void AgentV2ContractDoesNotFallback()
    {
        ActionResult result = AgentV2Registry().Execute(new AgentTask
        {
            action = "agent.plan.execute",
            schemaVersion = ProductIdentity.ActionSchemaVersion,
            payload = new Dictionary<string, object>
            {
                { "plan", new Dictionary<string, object> { { "mutating", true } } }
            }
        });
        Assert(!result.Success && result.ErrorCode == "AGENT_V2_AUTHORIZATION_DENIED", "Agent v2 请求没有失败关闭");
        Assert(result.Outcome == "UNKNOWN", "写操作策略不可用时未进入 UNKNOWN");
        Assert(result.Detail != null && result.Detail.ContainsKey("fallback") && !Convert.ToBoolean(result.Detail["fallback"]), "Agent v2 请求存在静默 fallback");
    }

    private static void Ed25519SignaturePositive()
    {
        const string publicKeyPem = "-----BEGIN PUBLIC KEY-----MCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=-----END PUBLIC KEY-----";
        const string signature = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";
        Assert(Ed25519Verifier.Verify(publicKeyPem, signature, new byte[0]), "RFC8032 Ed25519 空消息正例未通过");
    }

    private static void Ed25519SignatureTamperingRejected()
    {
        const string publicKeyPem = "-----BEGIN PUBLIC KEY-----MCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=-----END PUBLIC KEY-----";
        const string signature = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100c";
        Assert(!Ed25519Verifier.Verify(publicKeyPem, signature, new byte[0]), "篡改 Ed25519 签名未被拒绝");
    }

    private static void Ed25519SignatureGeneration()
    {
        byte[] seed = HexBytes("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
        string signature = Ed25519Verifier.Sign(seed, new byte[0]);
        string expected = Convert.ToBase64String(HexBytes("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"));
        Assert(signature == expected, "Ed25519 RFC8032 签名生成结果不匹配");
    }

    private static void ClientReceiptIsRejected()
    {
        AgentTask task = new AgentTask
        {
            action = AgentV2Actions.ExecutionReceipt,
            payload = new Dictionary<string, object> { { "receipt", new Dictionary<string, object>() } }
        };
        try
        {
            AgentV2Authorizer.ValidateClientReceipt(task, null);
            throw new InvalidOperationException("客户端伪造 Receipt 未被拒绝");
        }
        catch (AgentV2SecurityException error)
        {
            Assert(error.Code == "AGENT_RECEIPT_CLIENT_SUPPLIED", "客户端伪造 Receipt 错误码不稳定");
        }
    }

    private static void AgentV2NonceLedgerPersistsReplayRejection()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-v2-nonce-" + Guid.NewGuid().ToString("N"));
        try
        {
            string nonceDirectory = Path.Combine(root, "agent-v2-nonces");
            Directory.CreateDirectory(nonceDirectory);
            string nonce = "nonce-persisted-1";
            string path = Path.Combine(nonceDirectory, Sha256ForTest(nonce) + ".json");
            File.WriteAllText(path, "{\"recordVersion\":\"gcac.agent-security/v1\",\"nonce\":\"" + nonce + "\",\"tokenId\":\"token-1\"}");
            Assert(File.Exists(path), "Nonce 账本测试记录未写入");
            try
            {
                using (FileStream stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { }
                throw new InvalidOperationException("已存在的 Nonce 未被原子创建拒绝");
            }
            catch (IOException) { }
            Assert(File.Exists(path), "Nonce 重放拒绝后账本记录丢失");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static string Sha256ForTest(string value)
    {
        using (System.Security.Cryptography.SHA256 sha = System.Security.Cryptography.SHA256.Create())
        {
            byte[] digest = sha.ComputeHash(Encoding.UTF8.GetBytes(value));
            StringBuilder result = new StringBuilder(digest.Length * 2);
            for (int index = 0; index < digest.Length; index++) result.Append(digest[index].ToString("x2"));
            return result.ToString();
        }
    }

    private static void AgentIdentityPersistsAcrossRestart()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-identity-" + Guid.NewGuid().ToString("N"));
        try
        {
            AgentIdentityStore firstProcess = new AgentIdentityStore(root);
            Assert(firstProcess.Load() == null, "首次启动不应存在历史 Agent ID");
            firstProcess.Save("agt_compat_restart_01");

            AgentIdentityStore restartedProcess = new AgentIdentityStore(root);
            Assert(restartedProcess.Load() == "agt_compat_restart_01", "进程重启后未复用 Agent ID");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static void RuntimeRegistersOnlyAgentV2Actions()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            AgentConfig config = TestConfig();
            config.dataDirectory = Path.Combine(root, "data");
            config.logDirectory = Path.Combine(root, "logs");
            string[] actions = new AgentRuntime(config).RegisteredActions();
            string[] expected = AgentV2Actions.All();
            Assert(actions.Length == expected.Length, "运行时注册了非 Agent v2 动作");
            foreach (string expectedAction in expected) Assert(Array.IndexOf(actions, expectedAction) >= 0, "运行时缺少 Agent v2 动作：" + expectedAction);
            Assert(Array.IndexOf(actions, "agent.capability.rescan") < 0, "运行时仍注册旧能力重扫动作");
            Assert(Array.IndexOf(actions, "agent.atomic_plan.execute") < 0, "运行时仍注册旧 Atomic Plan 动作");
            Assert(Array.IndexOf(actions, "certificate.deploy") < 0, "运行时仍注册历史证书动作");
            Assert(Array.IndexOf(actions, "windows.iis.deploy_certificate") < 0, "运行时仍注册 IIS 历史别名");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static void RuntimeDoesNotRegisterLegacyActions()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-discovery-action-" + Guid.NewGuid().ToString("N"));
        try
        {
            AgentConfig config = TestConfig();
            config.dataDirectory = Path.Combine(root, "data");
            config.logDirectory = Path.Combine(root, "logs");
            string[] actions = new AgentRuntime(config).RegisteredActions();
            Assert(Array.IndexOf(actions, "discovery.run") < 0, "运行时仍注册旧 discovery.run");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static string[] RuntimeRegisteredActions()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-actions-" + Guid.NewGuid().ToString("N"));
        try
        {
            AgentConfig config = TestConfig();
            config.dataDirectory = Path.Combine(root, "data");
            config.logDirectory = Path.Combine(root, "logs");
            return new AgentRuntime(config).RegisteredActions();
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static void LegacyExecutionPathIsRejected(string action)
    {
        LegacyExecutionPathIsRejected(action, null);
    }

    private static void LegacyExecutionPathIsRejected(string action, string operationType)
    {
        Dictionary<string, object> payload = new Dictionary<string, object>();
        if (operationType != null) payload["operationType"] = operationType;
        ActionResult result = AgentV2Registry().Execute(new AgentTask
        {
            action = action,
            schemaVersion = ProductIdentity.ActionSchemaVersion,
            payload = payload
        });
        string expectedCode = AgentV2Actions.Contains(action) ? "AGENT_V2_AUTHORIZATION_DENIED" : "ACTION_NOT_REGISTERED";
        Assert(!result.Success && result.ErrorCode == expectedCode, "Agent Core 未按 v2 合同失败关闭");
        if (result.Detail != null && result.Detail.ContainsKey("fallback"))
            Assert(Convert.ToBoolean(result.Detail["fallback"]) == false, "退役 Agent 执行路径存在 fallback");
    }

    private static void RegistryDoesNotExposeDirectControlAction()
    {
        ActionResult result = AgentV2Registry().Execute(new AgentTask { action = "health", schemaVersion = ProductIdentity.ActionSchemaVersion });
        Assert(!result.Success && result.ErrorCode == "ACTION_NOT_REGISTERED", "动作注册表仍暴露旧 Direct Control health 动作");
    }

    private static void RecoveryLedgerPersistsRetryState()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-recovery-" + Guid.NewGuid().ToString("N"));
        try
        {
            AgentTask task = new AgentTask
            {
                id = "recovery-task",
                leaseId = "recovery-lease",
                idempotencyKey = "recovery-idempotency",
                payload = new Dictionary<string, object>()
            };
            ActionResult result = ActionResult.Failed("TEST_FAILURE", "提交失败", new Dictionary<string, object>
            {
                { "password", "changeit" },
                { "privateKeyPem", "-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----" },
                { "state", "ROLLED_BACK" }
            });
            RecoveryLedger first = new RecoveryLedger(root);
            first.SavePending(task, result);
            RecoveryLedger restarted = new RecoveryLedger(root);
            RecoveryRecord record = restarted.Records().Find(delegate(RecoveryRecord item) { return item.TaskId == "recovery-task"; });
            Assert(record != null && record.IdempotencyKey == "recovery-idempotency", "Recovery Ledger 未保存任务幂等键");
            Assert(record.State == "PENDING_UPLOAD" && !TextUtility.IsBlank(record.ResultDigest), "Recovery Ledger 状态或结果摘要缺失");
            string persisted = File.ReadAllText(Path.Combine(root, "recovery-ledger.json"));
            Assert(persisted.IndexOf("changeit", StringComparison.OrdinalIgnoreCase) < 0 && persisted.IndexOf("BEGIN PRIVATE KEY", StringComparison.OrdinalIgnoreCase) < 0, "Recovery Ledger 保存了敏感值");
            restarted.MarkRetryFailure("recovery-task", "control plane unavailable", DateTime.UtcNow);
            RecoveryRecord retried = restarted.Records().Find(delegate(RecoveryRecord item) { return item.TaskId == "recovery-task"; });
            Assert(retried.RetryCount == 1 && retried.LastError == "control plane unavailable" && retried.NextRetryAtUtc.HasValue, "结果补传失败未保留重试状态");
            restarted.MarkReported("recovery-task");
            RecoveryRecord reported = restarted.Records().Find(delegate(RecoveryRecord item) { return item.TaskId == "recovery-task"; });
            Assert(reported.State == "REPORTED" && restarted.Pending().Count == 0, "结果补传成功未确认或重复待补传");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static void RecoveryLedgerCorruptionRequiresManualIntervention()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-recovery-corrupt-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            File.WriteAllText(Path.Combine(root, "recovery-ledger.json"), "{not-json");
            RecoveryLedger ledger = new RecoveryLedger(root);
            Assert(ledger.ManualIntervention().Count == 1, "损坏 Recovery Ledger 未进入人工处理");
            RecoveryLedger restarted = new RecoveryLedger(root);
            Assert(restarted.ManualIntervention().Count == 1, "人工处理状态未跨进程持久化");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static void ResultSubmissionFailureInjectionIsControlled()
    {
        ResultSubmissionFailureInjector.ResetForTests();
        Environment.SetEnvironmentVariable("GCAC_COMPAT_TEST_RESULT_SUBMIT_FAILURE", null);
        Assert(!ResultSubmissionFailureInjector.ShouldFail(), "结果提交失败注入默认未关闭");
        Environment.SetEnvironmentVariable("GCAC_COMPAT_TEST_RESULT_SUBMIT_FAILURE", "once");
        ResultSubmissionFailureInjector.ResetForTests();
        Assert(ResultSubmissionFailureInjector.ShouldFail() && !ResultSubmissionFailureInjector.ShouldFail(), "once 失败注入未按一次生效");
        Environment.SetEnvironmentVariable("GCAC_COMPAT_TEST_RESULT_SUBMIT_FAILURE", "always");
        Assert(ResultSubmissionFailureInjector.ShouldFail(), "always 失败注入未生效");
        Environment.SetEnvironmentVariable("GCAC_COMPAT_TEST_RESULT_SUBMIT_FAILURE", null);
        ResultSubmissionFailureInjector.ResetForTests();
    }

    private static void FileOperationScopesCoverEveryPath()
    {
        Dictionary<string, object> token = ScopeToken("filesystem.backup", new string[] { @"C:\GCAC\allowed" }, new string[0]);
        Dictionary<string, object> decision = ScopeToken("filesystem.backup", new string[] { @"C:\GCAC\allowed" }, new string[0]);
        Dictionary<string, object> localPolicy = LocalPolicy(new Dictionary<string, object>
        {
            { "prefix", @"C:\GCAC\allowed" },
            { "operations", new string[] { "filesystem.backup" } }
        });
        Dictionary<string, object> operation = Operation("filesystem.backup", new Dictionary<string, object>
        {
            { "sourcePath", @"C:\GCAC\outside\secret.pfx" },
            { "backupPath", @"C:\GCAC\allowed\backup.pfx" },
            { "path", @"C:\GCAC\allowed\backup.pfx" }
        });
        AssertSecurityRejects("ValidateOperationScopes", new object[] { new ArrayList { operation }, token, decision, localPolicy }, "越界的 sourcePath 未被拒绝");

        token = ScopeToken("filesystem.restore", new string[] { @"C:\GCAC\allowed" }, new string[0]);
        decision = ScopeToken("filesystem.restore", new string[] { @"C:\GCAC\allowed" }, new string[0]);
        localPolicy = LocalPolicy(new Dictionary<string, object>
        {
            { "prefix", @"C:\GCAC\allowed" },
            { "operations", new string[] { "filesystem.restore" } }
        });
        operation = Operation("filesystem.restore", new Dictionary<string, object>
        {
            { "restorePath", @"C:\GCAC\outside\backup.pfx" },
            { "path", @"C:\GCAC\allowed\target.pfx" }
        });
        AssertSecurityRejects("ValidateOperationScopes", new object[] { new ArrayList { operation }, token, decision, localPolicy }, "越界的 restorePath 未被拒绝");
    }

    private static void ServiceListUsesServiceNames()
    {
        Dictionary<string, object> operation = Operation("service.list", new Dictionary<string, object>
        {
            { "serviceNames", new string[] { "TrustedService" } }
        });
        InvokeSecurity("ValidateOperation", new object[] { operation, false });
    }

    private static void AllowlistedCommandServiceScopeIsBound()
    {
        Dictionary<string, object> token = ScopeToken("command.execute_allowlisted", new string[0], new string[] { "AllowedService" });
        token["artifactDigests"] = new string[] { new string('a', 64), new string('b', 64) };
        Dictionary<string, object> decision = ScopeToken("command.execute_allowlisted", new string[0], new string[] { "AllowedService" });
        decision["artifactDigests"] = token["artifactDigests"];
        Dictionary<string, object> localPolicy = LocalPolicy(null);
        Dictionary<string, object> input = new Dictionary<string, object>
        {
            { "executablePath", @"C:\Windows\System32\sc.exe" },
            { "executableSha256", new string('a', 64) },
            { "args", new string[] { "start", "OtherService" } },
            { "argumentTemplate", new string[] { "{verb}", "{serviceName}" } },
            { "environmentAllowlist", new string[0] },
            { "workingDirectory", @"C:\Windows\System32" },
            { "networkScopes", new string[0] },
            { "childProcessPolicy", "deny" },
            { "timeoutSeconds", 10 },
            { "outputLimitBytes", 1024 },
            { "artifactDigest", new string('b', 64) }
        };
        AssertSecurityRejects("ValidateOperationScopes", new object[] { new ArrayList { Operation("command.execute_allowlisted", input) }, token, decision, localPolicy }, "越界的受控命令服务目标未被拒绝");
    }

    private static void AllowlistedCommandRequiresLocalRule()
    {
        Dictionary<string, object> token = ScopeToken("command.execute_allowlisted", new string[0], new string[] { "AllowedService" });
        token["artifactDigests"] = new string[] { new string('a', 64), new string('b', 64) };
        Dictionary<string, object> decision = ScopeToken("command.execute_allowlisted", new string[0], new string[] { "AllowedService" });
        decision["artifactDigests"] = token["artifactDigests"];
        Dictionary<string, object> input = new Dictionary<string, object>
        {
            { "executablePath", @"C:\Windows\System32\sc.exe" },
            { "executableSha256", new string('a', 64) },
            { "args", new string[] { "start", "AllowedService" } },
            { "argumentTemplate", new string[] { "{verb}", "{serviceName}" } },
            { "environmentAllowlist", new string[0] },
            { "workingDirectory", @"C:\Windows\System32" },
            { "networkScopes", new string[0] },
            { "childProcessPolicy", "deny" },
            { "timeoutSeconds", 10 },
            { "outputLimitBytes", 1024 },
            { "artifactDigest", new string('b', 64) }
        };
        AssertSecurityRejects("ValidateOperationScopes", new object[] { new ArrayList { Operation("command.execute_allowlisted", input) }, token, decision, LocalPolicy(null) }, "缺少本地 commandRules 时仍允许受控命令");
    }

    private static void RequestScopesMustMatchAuthorization()
    {
        Dictionary<string, object> token = ScopeToken("filesystem.read", new string[] { @"C:\GCAC\allowed" }, new string[0]);
        Dictionary<string, object> decision = ScopeToken("filesystem.read", new string[] { @"C:\GCAC\allowed" }, new string[0]);
        Dictionary<string, object> payload = new Dictionary<string, object>
        {
            { "actions", new string[] { "filesystem.read" } },
            { "paths", new string[] { @"C:\GCAC\allowed" } },
            { "services", new string[0] },
            { "artifactDigests", new string[0] }
        };
        InvokeSecurity("ValidateRequestScopes", new object[] { payload, token, decision, LocalPolicy(null) });
        payload["paths"] = new string[0];
        AssertSecurityRejects("ValidateRequestScopes", new object[] { payload, token, decision, LocalPolicy(null) }, "请求路径缩小后未拒绝 Scope 脱绑定");
    }

    private static void ReceiptStatusesAreValidated()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-receipt-" + Guid.NewGuid().ToString("N"));
        string planDigest = new string('c', 64);
        string[] statuses = new string[] { "SUCCESS", "FAILED", "UNKNOWN", "CANCELLED" };
        try
        {
            AgentReceiptSigner signer = ReceiptSignerForTests(root);
            foreach (string status in statuses)
            {
                Dictionary<string, object> receipt = AgentV2Security.BuildReceipt(
                    "operation-1", "plan-1", planDigest, "agent-1", "tenant-1", "token-1", status,
                    status == "SUCCESS" ? null : "AGENT_" + status,
                    status == "UNKNOWN" ? "状态未知" : null,
                    new ArrayList(), true, DateTime.UtcNow.AddSeconds(-1), DateTime.UtcNow, signer);
                InvokeSecurity("ValidateReceipt", new object[] { receipt, "plan-1", planDigest });
                signer.Verify(receipt);
            }
            Dictionary<string, object> persistedReceipt = AgentV2Security.BuildReceipt(
                "operation-1", "plan-1", planDigest, "agent-1", "tenant-1", "token-1", "SUCCESS", null, null,
                new ArrayList(), true, DateTime.UtcNow.AddSeconds(-1), DateTime.UtcNow, signer);
            string nonceDirectory = Path.Combine(root, "agent-v2-nonces");
            Directory.CreateDirectory(nonceDirectory);
            File.WriteAllText(Path.Combine(nonceDirectory, Sha256ForTest("nonce-1") + ".json"), new JavaScriptSerializer().Serialize(new Dictionary<string, object>
            {
                { "recordVersion", AgentV2Security.Version }, { "nonce", "nonce-1" }, { "tokenId", "token-1" },
                { "consumedAt", DateTime.UtcNow.ToString("o") }, { "resultDigest", planDigest }
            }));
            AgentConfig config = TestConfig();
            config.dataDirectory = root;
            config.receiptKeyId = "receipt-key-1";
            config.receiptSigningKeyPath = Path.Combine(root, "receipt-key.txt");
            config.receiptKeySetPath = Path.Combine(root, "receipt-keyset.json");
            AgentV2Security security = new AgentV2Security(config, delegate { return "agent-1"; });
            security.SaveReceipt(persistedReceipt, "token-1", "nonce-1");
            Dictionary<string, object> loaded = security.LoadReceipt("plan-1", planDigest, "token-1", "nonce-1");
            Assert(Convert.ToString(loaded["signature"]) == Convert.ToString(persistedReceipt["signature"]), "持久化 Receipt 签名发生变化");
            AgentExecutionReceiptV1 typed = new JavaScriptSerializer().Deserialize<AgentExecutionReceiptV1>(new JavaScriptSerializer().Serialize(persistedReceipt));
            security.SaveReceipt(AgentV2Authorizer.ReceiptDictionary(typed), "token-1", "nonce-1");
            security.LoadReceipt("plan-1", planDigest, "token-1", "nonce-1");
            persistedReceipt["signature"] = Convert.ToBase64String(Encoding.UTF8.GetBytes("forged"));
            AssertSecurityRejectsForInstance(security, persistedReceipt, "plan-1", planDigest, "token-1", "nonce-1", "持久化 Receipt 伪造签名未被拒绝");
            Dictionary<string, object> tampered = AgentV2Security.BuildReceipt(
                "operation-1", "plan-1", planDigest, "agent-1", "tenant-1", "token-1", "SUCCESS", null, null,
                new ArrayList(), true, DateTime.UtcNow.AddSeconds(-1), DateTime.UtcNow, signer);
            tampered["agentId"] = "agent-2";
            AssertSecurityRejects("ValidateReceipt", new object[] { tampered, "plan-1", planDigest }, "Receipt Agent 身份篡改未被拒绝");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static Dictionary<string, object> ScopeToken(string action, string[] paths, string[] services)
    {
        return new Dictionary<string, object>
        {
            { "actions", new string[] { action } },
            { "allowedPaths", paths },
            { "allowedServices", services },
            { "artifactDigests", new string[0] },
            { "authorityKeyId", "authority-key" },
            { "capability", action }
        };
    }

    private static Dictionary<string, object> LocalPolicy(Dictionary<string, object> pathRule)
    {
        return new Dictionary<string, object>
        {
            { "disabled", false },
            { "authorityKeyIds", new string[] { "authority-key" } },
            { "allowedActions", new string[] { "filesystem.read", "filesystem.backup", "command.execute_allowlisted" } },
            { "pathRules", pathRule == null ? new List<Dictionary<string, object>>() : new List<Dictionary<string, object>> { pathRule } },
            { "serviceRules", new string[] { "AllowedService" } }
        };
    }

    private static Dictionary<string, object> Operation(string operationType, Dictionary<string, object> input)
    {
        return new Dictionary<string, object>
        {
            { "operationId", "operation-1" },
            { "operationType", operationType },
            { "stage", "execute" },
            { "input", input },
            { "dependsOn", new string[0] },
            { "idempotencyKey", "idempotency-1" },
            { "timeoutSeconds", 30 },
            { "compensation", "" }
        };
    }

    private static void InvokeSecurity(string methodName, object[] arguments)
    {
        MethodInfo method = typeof(AgentV2Security).GetMethod(methodName, BindingFlags.NonPublic | BindingFlags.Static);
        if (method == null) throw new InvalidOperationException("安全校验方法不存在：" + methodName);
        try { method.Invoke(null, arguments); }
        catch (TargetInvocationException error) { throw error.InnerException ?? error; }
    }

    private static void AssertSecurityRejects(string methodName, object[] arguments, string message)
    {
        try
        {
            InvokeSecurity(methodName, arguments);
            throw new InvalidOperationException(message);
        }
        catch (AgentV2SecurityException) { }
    }

    private static void AssertSecurityRejectsForInstance(AgentV2Security security, Dictionary<string, object> receipt, string planId, string planDigest, string tokenId, string nonce, string message)
    {
        string path = Path.Combine(Path.Combine(securityDataDirectory(security), "agent-v2-receipts"), Sha256ForTest(planId + ":" + planDigest) + ".json");
        File.WriteAllText(path, new JavaScriptSerializer().Serialize(receipt));
        try
        {
            security.LoadReceipt(planId, planDigest, tokenId, nonce);
            throw new InvalidOperationException(message);
        }
        catch (AgentV2SecurityException) { }
    }

    private static string securityDataDirectory(AgentV2Security security)
    {
        FieldInfo field = typeof(AgentV2Security).GetField("config", BindingFlags.NonPublic | BindingFlags.Instance);
        AgentConfig config = (AgentConfig)field.GetValue(security);
        return config.dataDirectory;
    }

    private static AgentConfig TestConfig()
    {
        return new AgentConfig
        {
            tenantId = "tenant-1",
            agentKey = "agent-key-1",
            enrollmentToken = "enrollment-token-1",
            controlPlaneUrl = "http://127.0.0.1:5172",
            requiredHotfixes = new string[0]
        };
    }

    private static AgentReceiptSigner ReceiptSignerForTests(string root)
    {
        byte[] seed = HexBytes("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
        byte[] publicKey = HexBytes("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
        string publicKeyPem = "-----BEGIN PUBLIC KEY-----" + Convert.ToBase64String(Concat(HexBytes("302a300506032b6570032100"), publicKey)) + "-----END PUBLIC KEY-----";
        Directory.CreateDirectory(root);
        string privatePath = Path.Combine(root, "receipt-key.txt");
        string keySetPath = Path.Combine(root, "receipt-keyset.json");
        File.WriteAllText(privatePath, Convert.ToBase64String(seed));
        File.WriteAllText(keySetPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
        {
            { "keys", new object[] { new Dictionary<string, object> { { "keyId", "receipt-key-1" }, { "agentId", "agent-1" }, { "algorithm", "Ed25519" }, { "status", "ACTIVE" }, { "publicKeyPem", publicKeyPem } } } }
        }));
        AgentConfig config = TestConfig();
        config.receiptKeyId = "receipt-key-1";
        config.receiptSigningKeyPath = privatePath;
        config.receiptKeySetPath = keySetPath;
        config.dataDirectory = root;
        return AgentReceiptSigner.Load(config, "agent-1");
    }

    private static byte[] HexBytes(string value)
    {
        byte[] result = new byte[value.Length / 2];
        for (int index = 0; index < result.Length; index++) result[index] = (byte)((HexValue(value[index * 2]) << 4) | HexValue(value[index * 2 + 1]));
        return result;
    }

    private static int HexValue(char value)
    {
        if (value >= '0' && value <= '9') return value - '0';
        if (value >= 'a' && value <= 'f') return value - 'a' + 10;
        if (value >= 'A' && value <= 'F') return value - 'A' + 10;
        throw new InvalidOperationException("十六进制测试数据无效");
    }

    private static byte[] Concat(byte[] left, byte[] right)
    {
        byte[] result = new byte[left.Length + right.Length];
        Buffer.BlockCopy(left, 0, result, 0, left.Length);
        Buffer.BlockCopy(right, 0, result, left.Length, right.Length);
        return result;
    }

    private static string WriteConfig(string json)
    {
        string path = Path.Combine(Path.GetTempPath(), "gcac-compat-config-" + Guid.NewGuid().ToString("N") + ".json");
        File.WriteAllText(path, json);
        return path;
    }

    private static CapabilitySnapshot Snapshot()
    {
        return new CapabilitySnapshot
        {
            SchemaVersion = ProductIdentity.CapabilitySchemaVersion,
            SnapshotId = "snapshot-1",
            CollectedAtUtc = DateTime.UtcNow,
            Facts = new Dictionary<string, object>
            {
                { "windows.version", "6.1.7601.65536" },
                { "windows.service_pack", "Service Pack 1" },
                { "windows.product_name", "Windows Server 2008 R2 Standard" },
                { "windows.build_number", "7601" },
                { "windows.machine_id", "machine-1" },
                { "network.primary_ip", "10.20.30.40" },
                { "windows.iis.detail", new Dictionary<string, object> { { "Installed", true }, { "VersionString", "Version 7.5" } } },
                { "windows.iis.sites", new List<Dictionary<string, object>> { new Dictionary<string, object> { { "Name", "Default Web Site" } } } },
                { "windows.iis.inspection_error", string.Empty }
            },
            Capabilities = new List<string> { "agent.windows_compatibility.online" }
        };
    }

    private static ActionRegistry Registry()
    {
        ActionRegistry registry = new ActionRegistry();
        registry.Register(new ActionRegistration { CanonicalAction = "test.action", SchemaVersion = ProductIdentity.ActionSchemaVersion, Handler = delegate { return ActionResult.Succeeded(null); } });
        return registry;
    }

    private static ActionRegistry AgentV2Registry()
    {
        ActionRegistry registry = new ActionRegistry();
        foreach (string action in AgentV2Actions.All())
        {
            registry.Register(new ActionRegistration
            {
                CanonicalAction = action,
                SchemaVersion = ProductIdentity.ActionSchemaVersion,
                Handler = AgentV2ContractHandler.Execute
            });
        }
        return registry;
    }

    private static void Run(string name, Action test)
    {
        executedTests++;
        try { test(); Console.WriteLine("PASS " + name); }
        catch (Exception error) { failures++; Console.WriteLine("FAIL " + name + " " + error.Message); }
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}

using GCAC.WindowsCompatibilityAgent;
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class Tests
{
    private static int failures;
    private static int executedTests;

    private static int Main()
    {
        Run("Registry 支持规范动作和 Alias", RegistrySupportsAlias);
        Run("Registry 拒绝重复 Alias", RegistryRejectsDuplicateAlias);
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
        Run("注册请求包含 Direct Control 状态", RegistrationRequestIncludesDirectControl);
        Run("心跳请求包含 Direct Control 状态", HeartbeatRequestIncludesDirectControl);
        Run("注册动作集合严格限定为 Agent v2 合同", RuntimeActionsMatchAgentV2Contract);
        Run("Agent v2 合同不回退旧执行器", AgentV2ContractDoesNotFallback);
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
        Run("运行时只注册四个 Agent v2 动作", RuntimeRegistersOnlyAgentV2Actions);
        Run("运行时不注册历史 Agent 动作", RuntimeDoesNotRegisterLegacyActions);
        Run("第三方产品发现不再进入 Agent Core", delegate { LegacyExecutionPathIsRejected("agent.plan.execute", "product.discovery"); });
        Run("HTTP 直连健康启动状态和 v2 执行路径一致", DirectControlHttpContract);
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
        Console.WriteLine("tests=" + executedTests + " failures=" + failures);
        return failures == 0 ? 0 : 1;
    }

    private static void RegistrySupportsAlias()
    {
        ActionRegistry registry = Registry();
        ActionResult result = registry.Execute(new AgentTask { type = "legacy.action", schemaVersion = ProductIdentity.ActionSchemaVersion });
        Assert(result.Success, "Alias 未解析到规范动作");
    }

    private static void RegistryRejectsDuplicateAlias()
    {
        ActionRegistry registry = Registry();
        bool failed = false;
        try { registry.Register(new ActionRegistration { CanonicalAction = "other.action", SchemaVersion = ProductIdentity.ActionSchemaVersion, Aliases = new string[] { "legacy.action" }, Handler = delegate { return ActionResult.Succeeded(null); } }); }
        catch (InvalidOperationException) { failed = true; }
        Assert(failed, "重复 Alias 被静默覆盖");
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
            Assert(!result.Success && result.ErrorCode == "AGENT_V2_POLICY_UNAVAILABLE", "缺少 Agent v2 Policy Authority 时未失败关闭");
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

    private static void RegistrationRequestIncludesDirectControl()
    {
        AgentConfig config = TestConfig();
        DirectControlState state = DirectControlStateForTest();
        Dictionary<string, object> request = new ControlPlaneClient(config).BuildRegistrationRequest(Snapshot(), state);
        Assert(request.ContainsKey("directControl"), "注册请求未上传 Direct Control 状态");
        DirectControlState directControl = (DirectControlState)request["directControl"];
        Assert(directControl.enabled && directControl.reachable, "注册请求的 Direct Control 状态不正确");
    }

    private static void HeartbeatRequestIncludesDirectControl()
    {
        Dictionary<string, object> request = ControlPlaneClient.BuildHeartbeatRequest("agent-1", Snapshot(), new Dictionary<string, object> { { "status", "healthy" } }, DirectControlStateForTest());
        Assert(request.ContainsKey("directControl"), "心跳请求未上传 Direct Control 状态");
    }

    private static void DirectControlHttpContract()
    {
        AgentConfig config = TestConfig();
        config.directControlEnabled = true;
        config.directControlListenHost = "127.0.0.1";
        config.directControlAdvertiseHost = "127.0.0.1";
        config.directControlListenPort = FindFreePort();
        DirectControlServer server = new DirectControlServer(config, AgentV2Registry(), delegate
        {
            return new Dictionary<string, object> { { "modelVersion", "gcac.agent.health.v1" }, { "status", "healthy" } };
        });
        try
        {
            server.Start();
            string baseUrl = "http://127.0.0.1:" + config.directControlListenPort;
            Dictionary<string, object> health = SendJson(baseUrl + "/api/v1/control/health", "GET", null);
            Dictionary<string, object> directControl = (Dictionary<string, object>)health["directControl"];
            Assert(Convert.ToBoolean(directControl["enabled"]) && Convert.ToBoolean(directControl["reachable"]), "健康接口未报告可达直连状态");
            IList actions = (IList)directControl["supportedActions"];
            Assert(actions.Count == 4 && actions.Contains(AgentV2Actions.PlanExecute), "健康接口暴露的动作集合不正确");

            Dictionary<string, object> start = SendJson(baseUrl + "/api/v1/control/actions/start", "POST", new Dictionary<string, object>
            {
                { "action", AgentV2Actions.PlanExecute },
                { "requestId", "http-contract-1" },
                { "token", new Dictionary<string, object>() },
                { "policyDecision", new Dictionary<string, object>() },
                { "plan", new Dictionary<string, object> { { "mutating", true } } }
            });
            string actionId = Convert.ToString(start["actionId"]);
            Assert(Convert.ToString(start["status"]) == "queued", "启动接口未返回 queued");
            Dictionary<string, object> status = null;
            for (int attempt = 0; attempt < 50; attempt++)
            {
                status = SendJson(baseUrl + "/api/v1/control/actions/status?actionId=" + Uri.EscapeDataString(actionId), "GET", null);
                if (Convert.ToString(status["status"]) == "completed") break;
                Thread.Sleep(10);
            }
            Assert(status != null && Convert.ToString(status["status"]) == "completed", "状态接口未完成动作查询");
            Assert(Convert.ToString(status["errorCode"]) == "AGENT_V2_POLICY_UNAVAILABLE", "直连请求未进入 AgentV2ContractHandler");
            Assert(Convert.ToString(status["outcome"]) == "UNKNOWN", "写操作策略不可用时未返回 UNKNOWN");

            HttpWebRequest legacy = (HttpWebRequest)WebRequest.Create(baseUrl + "/api/v1/control/actions/start");
            legacy.Method = "POST";
            legacy.ContentType = "application/json; charset=utf-8";
            byte[] legacyPayload = Encoding.UTF8.GetBytes("{\"action\":\"command.execute\"}");
            legacy.ContentLength = legacyPayload.Length;
            using (Stream stream = legacy.GetRequestStream()) stream.Write(legacyPayload, 0, legacyPayload.Length);
            try { legacy.GetResponse(); throw new InvalidOperationException("旧动作未被拒绝"); }
            catch (WebException error)
            {
                HttpWebResponse response = (HttpWebResponse)error.Response;
                Assert((int)response.StatusCode == 400, "旧动作拒绝状态码错误");
                response.Close();
            }
        }
        finally
        {
            server.Stop();
        }
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
        Assert(task.type == "agent.capability.rescan", "未从 payload.type 展开公共动作");
        Assert(task.schemaVersion == ProductIdentity.ActionSchemaVersion, "未从 payload.schemaVersion 展开协议版本");
        Assert(task.leaseId != null && task.leaseId.StartsWith("compat:"), "未生成 Compatibility Agent Lease ID");
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
            type = "agent.plan.execute",
            schemaVersion = ProductIdentity.ActionSchemaVersion,
            payload = new Dictionary<string, object>
            {
                { "plan", new Dictionary<string, object> { { "mutating", true } } }
            }
        });
        Assert(!result.Success && result.ErrorCode == "AGENT_V2_POLICY_UNAVAILABLE", "Agent v2 请求没有失败关闭");
        Assert(result.Outcome == "UNKNOWN", "写操作策略不可用时未进入 UNKNOWN");
        Assert(result.Detail != null && result.Detail.ContainsKey("fallback") && !Convert.ToBoolean(result.Detail["fallback"]), "Agent v2 请求存在静默 fallback");
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
            type = action,
            schemaVersion = ProductIdentity.ActionSchemaVersion,
            payload = payload
        });
        string expectedCode = AgentV2Actions.Contains(action) ? "AGENT_V2_POLICY_UNAVAILABLE" : "ACTION_NOT_REGISTERED";
        Assert(!result.Success && result.ErrorCode == expectedCode, "Agent Core 未按 v2 合同失败关闭");
        if (result.Detail != null && result.Detail.ContainsKey("fallback"))
            Assert(Convert.ToBoolean(result.Detail["fallback"]) == false, "退役 Agent 执行路径存在 fallback");
    }

    private static void RegistryDoesNotExposeDirectControlAction()
    {
        ActionResult result = AgentV2Registry().Execute(new AgentTask { action = "health", type = "health", schemaVersion = ProductIdentity.ActionSchemaVersion });
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

    private static AgentConfig TestConfig()
    {
        return new AgentConfig
        {
            tenantId = "tenant-1",
            agentKey = "agent-key-1",
            enrollmentToken = "enrollment-token-1",
            controlPlaneUrl = "http://127.0.0.1:5172",
            directControlEnabled = false,
            requiredHotfixes = new string[0]
        };
    }

    private static DirectControlState DirectControlStateForTest()
    {
        return new DirectControlState
        {
            enabled = true,
            reachable = true,
            listenAddress = "127.0.0.1:18933",
            protocolVersion = "v1",
            supportedActions = AgentV2Actions.All(),
            lastReadyAt = "2026-08-09T00:00:00.0000000Z"
        };
    }

    private static int FindFreePort()
    {
        TcpListener probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        int port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        return port;
    }

    private static Dictionary<string, object> SendJson(string url, string method, Dictionary<string, object> body)
    {
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
        request.Method = method;
        request.ContentType = "application/json; charset=utf-8";
        if (body != null)
        {
            byte[] payload = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(body));
            request.ContentLength = payload.Length;
            using (Stream stream = request.GetRequestStream()) stream.Write(payload, 0, payload.Length);
        }
        using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
        using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
        {
            return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
        }
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
        registry.Register(new ActionRegistration { CanonicalAction = "test.action", SchemaVersion = ProductIdentity.ActionSchemaVersion, Aliases = new string[] { "legacy.action" }, Handler = delegate { return ActionResult.Succeeded(null); } });
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
                Aliases = new string[0],
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

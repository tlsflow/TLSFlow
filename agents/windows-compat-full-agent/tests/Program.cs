using GCAC.WindowsCompatibilityAgent;
using System;
using System.Collections.Generic;
using System.IO;

internal static class Tests
{
    private static int failures;

    private static int Main()
    {
        Run("Registry 支持规范动作和 Alias", RegistrySupportsAlias);
        Run("Registry 拒绝重复 Alias", RegistryRejectsDuplicateAlias);
        Run("未知 Schema Version 失败关闭", RegistryRejectsUnknownSchema);
        Run("前置检查按事实和通用操作符解析", PreflightUsesFacts);
        Run("签名 Atomic Plan 可进入通用执行入口", AtomicPlanAcceptsSignedPlan);
        Run("未签名 Atomic Plan 失败关闭", AtomicPlanRejectsUnsignedPlan);
        Run("未知 Atomic Operation 失败关闭", AtomicPlanRejectsUnknownOperation);
        Run("未知 Atomic Action Schema 失败关闭", AtomicPlanRejectsUnknownActionSchema);
        Run("缺失前置事实返回稳定阻塞错误", PreflightReportsStableBlocker);
        Run("HTTP 控制面不启用 TLS 配置", HttpControlPlaneDoesNotRequireTls);
        Run("HTTPS 控制面仍识别为 TLS 传输", HttpsControlPlaneRequiresTls);
        Run("系统事实包含注册和详情所需字段", CapabilityCollectorIncludesSystemFacts);
        Run("注册请求包含系统描述字段", RegistrationRequestIncludesSystemDescriptor);
        Run("注册请求包含独立 Direct Control 端口", RegistrationRequestIncludesDirectControl);
        Run("注册请求声明能力重扫 Direct Control 动作", RegistrationRequestIncludesCapabilityRescanDirectControl);
        Run("旧配置自动启用 Direct Control 和十秒心跳", LegacyConfigEnablesDirectControl);
        Run("显式关闭 Direct Control 时保持关闭", ExplicitDirectControlDisableIsPreserved);
        Run("能力报告使用 L2 和结构化声明", CapabilityRequestUsesStructuredL2Declarations);
        Run("能力报告包含 IIS 详情和站点", CapabilityRequestIncludesIisInspection);
        Run("心跳请求包含公共健康模型", HeartbeatRequestIncludesRuntimeHealth);
        Run("Agent ID 可跨进程重启持久化", AgentIdentityPersistsAcrossRestart);
        Run("IIS Binding 信息解析兼容主机头", IisBindingInformationParsesHostHeader);
        Run("IIS 证书哈希兼容字节数组和字符串", IisCertificateHashSupportsLegacyValues);
        Run("IIS 证书哈希支持属性缺失时的 Attribute 兜底", IisCertificateHashUsesAttributeFallback);
        Run("IIS HTTP.sys SSL 绑定支持按端口回退发现", IisHttpSysSslBindingFallback);
        Run("任务拉取结果展开公共动作载荷", PulledTaskNormalizesPublicActionPayload);
        Run("运行时注册手动重扫动作", RuntimeRegistersCapabilityRescan);
        Run("Direct Control 复用 Atomic Plan Registry", DirectControlUsesAtomicPlanRegistry);
        Console.WriteLine("tests=" + 28 + " failures=" + failures);
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

    private static void AtomicPlanAcceptsSignedPlan()
    {
        Dictionary<string, object> plan = AtomicPlan("preflight.assert", new Dictionary<string, object> { { "value", true } });
        Assert(AtomicPlanSecurity.ComputeSignature(plan) == "31cb3999874d81bcecafc1b550ef1a51f4204ca32df1ab46e0d79d2ee45ebc6c", "Atomic Plan 规范化签名与控制面不一致");
        SignPlan(plan);
        ActionResult result = new AtomicPlanHandler(delegate { return "agent-1"; }).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", plan } } });
        Assert(result.Success && Convert.ToString(result.Detail["state"]) == "SUCCEEDED", "签名 Atomic Plan 未执行成功");
    }

    private static void AtomicPlanRejectsUnsignedPlan()
    {
        Dictionary<string, object> plan = AtomicPlan("preflight.assert", new Dictionary<string, object> { { "value", true } });
        ActionResult result = new AtomicPlanHandler(delegate { return "agent-1"; }).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", plan } } });
        Assert(!result.Success && result.ErrorCode == "AGENT_PLAN_SIGNATURE_INVALID", "未签名 Atomic Plan 未失败关闭");
    }

    private static void AtomicPlanRejectsUnknownOperation()
    {
        Dictionary<string, object> plan = AtomicPlan("windows.iis.unknown", new Dictionary<string, object>());
        SignPlan(plan);
        ActionResult result = new AtomicPlanHandler(delegate { return "agent-1"; }).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", plan } } });
        Assert(!result.Success && result.ErrorCode == "AGENT_ATOMIC_PREFLIGHT_FAILED", "未知 Atomic Operation 未失败关闭");
    }

    private static void AtomicPlanRejectsUnknownActionSchema()
    {
        Dictionary<string, object> plan = AtomicPlan("preflight.assert", new Dictionary<string, object> { { "value", true } });
        SignPlan(plan);
        ActionResult result = new AtomicPlanHandler(delegate { return "agent-1"; }).Execute(new AgentTask { payload = new Dictionary<string, object> { { "actionSchemaVersion", "2.0" }, { "plan", plan } } });
        Assert(!result.Success && result.ErrorCode == "AGENT_ACTION_SCHEMA_UNSUPPORTED", "未知 Atomic Action Schema 未失败关闭");
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
        config.directControlEnabled = true;
        config.directControlListenPort = 18933;
        Dictionary<string, object> request = new ControlPlaneClient(config).BuildRegistrationRequest(Snapshot());
        Dictionary<string, object> directControl = request["directControl"] as Dictionary<string, object>;
        Assert(directControl != null, "注册请求未上传 Direct Control");
        Assert(Convert.ToString(directControl["listenAddress"]) == "10.20.30.40:18933", "Compatibility Agent 管理端口错误");
    }

    private static void LegacyConfigEnablesDirectControl()
    {
        string path = WriteConfig("{\"tenantId\":\"tenant-1\",\"agentKey\":\"agent-1\",\"controlPlaneUrl\":\"http://127.0.0.1:5172\",\"heartbeatIntervalSeconds\":30}");
        try
        {
            AgentConfig config = AgentConfig.Load(path);
            Assert(config.directControlEnabled, "旧配置未自动启用 Direct Control");
            Assert(config.directControlListenPort == 18933, "旧配置未补齐 Direct Control 端口");
            Assert(config.heartbeatIntervalSeconds == 10, "旧配置未迁移到十秒心跳");
        }
        finally
        {
            File.Delete(path);
        }
    }

    private static void ExplicitDirectControlDisableIsPreserved()
    {
        string path = WriteConfig("{\"tenantId\":\"tenant-1\",\"agentKey\":\"agent-1\",\"controlPlaneUrl\":\"http://127.0.0.1:5172\",\"heartbeatIntervalSeconds\":15,\"directControlEnabled\":false}");
        try
        {
            AgentConfig config = AgentConfig.Load(path);
            Assert(!config.directControlEnabled, "显式关闭 Direct Control 被错误覆盖");
            Assert(config.heartbeatIntervalSeconds == 15, "显式心跳周期被错误覆盖");
        }
        finally
        {
            File.Delete(path);
        }
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

    private static void CapabilityRequestIncludesIisInspection()
    {
        Dictionary<string, object> request = ControlPlaneClient.BuildCapabilityRequest("agent-1", Snapshot());
        List<Dictionary<string, object>> capabilities = (List<Dictionary<string, object>>)request["capabilities"];
        Assert(capabilities.Exists(delegate(Dictionary<string, object> item) { return Convert.ToString(item["capabilityKey"]) == "windows.iis.detail"; }), "能力报告缺少 IIS 详情");
        Assert(capabilities.Exists(delegate(Dictionary<string, object> item) { return Convert.ToString(item["capabilityKey"]) == "windows.iis.sites"; }), "能力报告缺少 IIS 站点");
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

    private static void RegistrationRequestIncludesCapabilityRescanDirectControl()
    {
        Dictionary<string, object> request = new ControlPlaneClient(TestConfig()).BuildRegistrationRequest(Snapshot());
        Dictionary<string, object> directControl = (Dictionary<string, object>)request["directControl"];
        string[] supportedActions = (string[])directControl["supportedActions"];
        Assert(Array.IndexOf(supportedActions, "agent.capability.rescan") >= 0, "注册请求未声明能力重扫 Direct Control 动作");
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

    private static void IisBindingInformationParsesHostHeader()
    {
        Dictionary<string, object> parsed = IisInspector.ParseBindingInformation("*:443:portal.example.com");
        Assert(Convert.ToString(parsed["IPAddress"]) == "*", "IIS Binding IP 解析错误");
        Assert(Convert.ToInt32(parsed["Port"]) == 443, "IIS Binding 端口解析错误");
        Assert(Convert.ToString(parsed["HostHeader"]) == "portal.example.com", "IIS Binding 主机头解析错误");
    }

    private static void IisCertificateHashSupportsLegacyValues()
    {
        Assert(IisInspector.NormalizeCertificateThumbprint(new byte[] { 0xAA, 0xBb, 0x01 }) == "AABB01", "byte[] 证书哈希解析错误");
        Assert(IisInspector.NormalizeCertificateThumbprint(new int[] { 170, 187, 1 }) == "AABB01", "数组形式证书哈希解析错误");
        Assert(IisInspector.NormalizeCertificateThumbprint(" aa:bb-01 ") == "AABB01", "字符串证书哈希解析错误");
    }

    private static void IisCertificateHashUsesAttributeFallback()
    {
        Assert(IisInspector.ReadCertificateThumbprint(new FakeIisBinding()) == "AABB01", "CertificateHash 属性缺失时未读取 certificateHash Attribute");
    }

    private static void IisHttpSysSslBindingFallback()
    {
        string output = "IP:port                      : 0.0.0.0:443\r\n"
            + "Certificate Hash             : AA:BB:01\r\n"
            + "Application ID              : {fixture}\r\n"
            + "Certificate Store Name      : MY\r\n\r\n"
            + "IP:port                      : 0.0.0.0:8443\r\n"
            + "Certificate Hash             : CC:DD:02\r\n";
        Dictionary<string, string> result = IisInspector.ParseHttpSysSslCertOutput(output, "*", 443);
        Assert(result != null, "未从 HTTP.sys 输出匹配 443 端口");
        Assert(result["CertificateThumbprint"] == "AABB01", "HTTP.sys 证书指纹解析错误");
        Assert(result["CertificateStoreName"] == "MY", "HTTP.sys 证书存储解析错误");
    }

    private sealed class FakeIisBinding
    {
        public object CertificateHash { get { return null; } }

        public object GetAttributeValue(string name)
        {
            return name == "certificateHash" ? "aa:bb:01" : null;
        }
    }

    private static void RuntimeRegistersCapabilityRescan()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            AgentConfig config = TestConfig();
            config.dataDirectory = Path.Combine(root, "data");
            config.logDirectory = Path.Combine(root, "logs");
            string[] actions = new AgentRuntime(config).RegisteredActions();
            Assert(Array.IndexOf(actions, "agent.capability.rescan") >= 0, "运行时未注册手动重扫动作");
            Assert(Array.IndexOf(actions, "agent.atomic_plan.execute") >= 0, "运行时未注册 Atomic Plan 动作");
            Assert(Array.IndexOf(actions, "certificate.deploy") < 0, "运行时仍注册历史证书动作");
            Assert(Array.IndexOf(actions, "windows.iis.deploy_certificate") < 0, "运行时仍注册 IIS 历史别名");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static void DirectControlUsesAtomicPlanRegistry()
    {
        Dictionary<string, object> plan = AtomicPlan("preflight.assert", new Dictionary<string, object> { { "value", true } });
        SignPlan(plan);
        ActionRegistry registry = new ActionRegistry();
        registry.Register(new ActionRegistration { CanonicalAction = "agent.atomic_plan.execute", SchemaVersion = ProductIdentity.ActionSchemaVersion, Aliases = new string[0], Handler = new AtomicPlanHandler(delegate { return "agent-1"; }).Execute });
        Dictionary<string, object> response = DirectControlServer.ExecuteAction(registry, "agent.atomic_plan.execute", new Dictionary<string, object> { { "plan", plan } }, "request-1");
        Assert(Convert.ToBoolean(response["success"]), "Direct Control 未复用 Atomic Plan Registry");
        Assert(Convert.ToString(response["requestId"]) == "request-1", "Direct Control 未回传 requestId");
    }

    private static AgentConfig TestConfig()
    {
        return new AgentConfig
        {
            tenantId = "tenant-1",
            agentKey = "agent-key-1",
            enrollmentToken = "enrollment-token-1",
            controlPlaneUrl = "http://127.0.0.1:5172",
            directControlListenPort = 18933,
            requiredHotfixes = new string[0]
        };
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

    private static Dictionary<string, object> AtomicPlan(string operationType, Dictionary<string, object> input)
    {
        return new Dictionary<string, object>
        {
            { "apiVersion", "gcac.agent-plan/v1" },
            { "planId", "plan-test-1" },
            { "tenantId", "tenant-1" },
            { "agentId", "agent-1" },
            { "executionRunId", "run-1" },
            { "executionStepId", "step-1" },
            { "issuedAt", "2026-07-31T00:00:00.000Z" },
            { "expiresAt", "2099-07-31T00:00:00.000Z" },
            { "idempotencyKey", "atomic-test-" + operationType },
            { "plugin", new Dictionary<string, object> { { "pluginId", "fixture.atomic" }, { "version", "1.0.0" } } },
            { "permissions", new object[0] },
            { "variablesDigest", "fixture" },
            { "executionMode", "PREFLIGHT" },
            { "operations", new object[] { new Dictionary<string, object> { { "id", "operation-1" }, { "name", "test" }, { "stage", "prepare" }, { "operationType", operationType }, { "schemaVersion", "1.0" }, { "input", input } } } },
            { "rollback", new object[0] }
        };
    }

    private static void SignPlan(Dictionary<string, object> plan)
    {
        plan["authorization"] = new Dictionary<string, object> { { "keyId", "agent-plan-v1" }, { "signature", AtomicPlanSecurity.ComputeSignature(plan) } };
    }

    private static void Run(string name, Action test)
    {
        try { test(); Console.WriteLine("PASS " + name); }
        catch (Exception error) { failures++; Console.WriteLine("FAIL " + name + " " + error.Message); }
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}

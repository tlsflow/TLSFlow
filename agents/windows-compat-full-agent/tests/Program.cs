using GCAC.WindowsCompatibilityAgent;
using System;
using System.Collections.Generic;
using System.IO;
using System.ServiceProcess;

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
        Run("注册请求声明运行时 Direct Control 动作", RegistrationRequestIncludesRuntimeDirectControlActions);
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
        Run("IIS 管理程序集路径解析稳定", IisAdministrationAssemblyPathIsStable);
        Run("任务拉取结果展开公共动作载荷", PulledTaskNormalizesPublicActionPayload);
        Run("运行时注册手动重扫动作", RuntimeRegistersCapabilityRescan);
        Run("Direct Control 复用 Atomic Plan Registry", DirectControlUsesAtomicPlanRegistry);
        Run("文件备份替换失败后自动恢复", AtomicFileReplaceRollsBack);
        Run("不存在文件的备份和恢复保持幂等", AtomicMissingFileBackupRollsBack);
        Run("PREFLIGHT 不修改文件", AtomicPreflightDoesNotMutate);
        Run("文件路径越权被拒绝", AtomicFilePermissionIsEnforced);
        Run("程序路径越权被拒绝", AtomicProgramPermissionIsEnforced);
        Run("Shell 程序被拒绝", AtomicShellProgramIsRejected);
        Run("参数数组程序执行成功", AtomicCommandArgumentsExecute);
        Run("服务权限越权被拒绝", AtomicServicePermissionIsEnforced);
        Run("服务状态预演只读成功", AtomicServiceStatusPreflight);
        Run("Atomic Plan 账本跨实例幂等", AtomicLedgerPersistsIdempotency);
        Run("相同幂等键的不同计划被拒绝", AtomicLedgerRejectsPlanConflict);
        Run("回滚失败进入人工处理", AtomicRollbackFailureRequiresManualIntervention);
        Console.WriteLine("tests=" + 41 + " failures=" + failures);
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
        Dictionary<string, object> request = new ControlPlaneClient(config).BuildRegistrationRequest(snapshot, RuntimeRegisteredActions());
        Assert(Convert.ToString(request["machineId"]) == "machine-1", "注册请求未上传 Machine ID");
        Assert(Convert.ToString(request["ipAddress"]) == "10.20.30.40", "注册请求未上传 IP 地址");
        Assert(Convert.ToString(request["osVersion"]) == "Windows Server 2008 R2 Standard", "注册请求未上传操作系统版本");
    }

    private static void RegistrationRequestIncludesDirectControl()
    {
        AgentConfig config = TestConfig();
        config.directControlEnabled = true;
        config.directControlListenPort = 18933;
        Dictionary<string, object> request = new ControlPlaneClient(config).BuildRegistrationRequest(Snapshot(), RuntimeRegisteredActions());
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

    private static void RegistrationRequestIncludesRuntimeDirectControlActions()
    {
        Dictionary<string, object> request = new ControlPlaneClient(TestConfig()).BuildRegistrationRequest(Snapshot(), RuntimeRegisteredActions());
        Dictionary<string, object> directControl = (Dictionary<string, object>)request["directControl"];
        string[] supportedActions = (string[])directControl["supportedActions"];
        Assert(Array.IndexOf(supportedActions, "agent.capability.rescan") >= 0, "注册请求未声明能力重扫 Direct Control 动作");
        Assert(Array.IndexOf(supportedActions, "agent.atomic_plan.execute") >= 0, "注册请求未声明 Atomic Plan Direct Control 动作");
        Assert(Array.IndexOf(supportedActions, "certificate.deploy") < 0, "注册请求仍声明历史证书动作");
        Assert(Array.IndexOf(supportedActions, "windows.iis.deploy_certificate") < 0, "注册请求仍声明历史 IIS 证书动作");
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

    private static void IisAdministrationAssemblyPathIsStable()
    {
        string windir = Environment.GetEnvironmentVariable("WINDIR");
        string expected = string.IsNullOrEmpty(windir) ? string.Empty : Path.Combine(Path.Combine(Path.Combine(windir, "System32"), "inetsrv"), "Microsoft.Web.Administration.dll");
        Assert(IisInspector.ResolveAdministrationAssemblyPath() == expected, "IIS 管理程序集路径解析不稳定");
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

    private static void AtomicFileReplaceRollsBack()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-atomic-" + Guid.NewGuid().ToString("N"));
        string target = Path.Combine(root, "server.pem");
        Directory.CreateDirectory(root);
        File.WriteAllText(target, "old-certificate");
        try
        {
            Dictionary<string, object> plan = AtomicPlanWithOperations(
                "file-rollback-plan",
                "file-rollback-key",
                "EXECUTE",
                new object[]
                {
                    Operation("backup-file", "file.backup", new Dictionary<string, object> { { "path", target } }),
                    Operation("replace-file", "file.atomic_replace", new Dictionary<string, object> { { "path", target }, { "content", "new-certificate" } }),
                    Operation("force-failure", "preflight.assert", new Dictionary<string, object> { { "value", false }, { "message", "forced failure" } })
                },
                new object[]
                {
                    Operation("restore-file", "file.restore", new Dictionary<string, object> { { "backupOperationId", "backup-file" } })
                },
                new object[] { Permission("filesystem", target) });
            SignPlan(plan);
            ActionResult result = new AtomicPlanHandler(delegate { return "agent-1"; }, Path.Combine(root, "data")).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", plan } } });
            Assert(!result.Success && result.ErrorCode == "AGENT_ATOMIC_OPERATION_FAILED", "失败计划未返回原子操作错误");
            Assert(Convert.ToString(result.Detail["state"]) == "ROLLED_BACK", "失败计划未进入 ROLLED_BACK");
            Assert(File.ReadAllText(target) == "old-certificate", "失败回滚未恢复旧文件内容");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static void AtomicMissingFileBackupRollsBack()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-atomic-missing-" + Guid.NewGuid().ToString("N"));
        string target = Path.Combine(root, "missing.pem");
        Directory.CreateDirectory(root);
        try
        {
            Dictionary<string, object> plan = AtomicPlanWithOperations(
                "missing-file-plan",
                "missing-file-key",
                "EXECUTE",
                new object[]
                {
                    Operation("backup-file", "file.backup", new Dictionary<string, object> { { "path", target } }),
                    Operation("replace-file", "file.atomic_replace", new Dictionary<string, object> { { "path", target }, { "content", "new-certificate" } }),
                    Operation("force-failure", "preflight.assert", new Dictionary<string, object> { { "value", false } })
                },
                new object[]
                {
                    Operation("restore-file", "file.restore", new Dictionary<string, object> { { "backupOperationId", "backup-file" } })
                },
                new object[] { Permission("filesystem", target) });
            SignPlan(plan);
            ActionResult result = new AtomicPlanHandler(delegate { return "agent-1"; }, Path.Combine(root, "data")).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", plan } } });
            Assert(!result.Success && Convert.ToString(result.Detail["state"]) == "ROLLED_BACK", "不存在文件的失败计划未回滚");
            Assert(!File.Exists(target), "不存在文件的回滚错误创建或保留了文件");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static void AtomicPreflightDoesNotMutate()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-atomic-preflight-" + Guid.NewGuid().ToString("N"));
        string target = Path.Combine(root, "server.pem");
        Directory.CreateDirectory(root);
        File.WriteAllText(target, "old-certificate");
        try
        {
            Dictionary<string, object> plan = AtomicPlanWithOperations(
                "preflight-file-plan",
                "preflight-file-key",
                "PREFLIGHT",
                new object[]
                {
                    Operation("backup-file", "file.backup", new Dictionary<string, object> { { "path", target } }),
                    Operation("replace-file", "file.atomic_replace", new Dictionary<string, object> { { "path", target }, { "content", "new-certificate" } })
                },
                new object[0],
                new object[] { Permission("filesystem", target) });
            SignPlan(plan);
            ActionResult result = new AtomicPlanHandler(delegate { return "agent-1"; }, Path.Combine(root, "data")).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", plan } } });
            Assert(result.Success, "PREFLIGHT 未通过");
            Assert(Convert.ToBoolean(result.Detail["preview"]) && !Convert.ToBoolean(result.Detail["mutating"]), "PREFLIGHT 未声明非变更语义");
            Assert(File.ReadAllText(target) == "old-certificate", "PREFLIGHT 修改了目标文件");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static void AtomicFilePermissionIsEnforced()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-atomic-permission-" + Guid.NewGuid().ToString("N"));
        string target = Path.Combine(root, "server.pem");
        string other = Path.Combine(root, "other.pem");
        Directory.CreateDirectory(root);
        File.WriteAllText(target, "old");
        try
        {
            Dictionary<string, object> plan = AtomicPlanWithOperations(
                "file-permission-plan",
                "file-permission-key",
                "PREFLIGHT",
                new object[] { Operation("backup-file", "file.backup", new Dictionary<string, object> { { "path", target } }) },
                new object[0],
                new object[] { Permission("filesystem", other) });
            SignPlan(plan);
            ActionResult result = new AtomicPlanHandler(delegate { return "agent-1"; }).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", plan } } });
            Assert(!result.Success && result.ErrorCode == "AGENT_ATOMIC_PREFLIGHT_FAILED", "文件路径越权未失败关闭");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static void AtomicProgramPermissionIsEnforced()
    {
        string program = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "whoami.exe");
        Dictionary<string, object> plan = AtomicPlanWithOperations(
            "program-permission-plan",
            "program-permission-key",
            "PREFLIGHT",
            new object[] { Operation("execute", "command.execute", new Dictionary<string, object> { { "program", program }, { "args", new string[] { "/user" } } }) },
            new object[0],
            new object[] { Permission("process", program + ".not-allowed") });
        SignPlan(plan);
        ActionResult result = new AtomicPlanHandler(delegate { return "agent-1"; }).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", plan } } });
        Assert(!result.Success && result.ErrorCode == "AGENT_ATOMIC_PREFLIGHT_FAILED", "程序路径越权未失败关闭");
    }

    private static void AtomicShellProgramIsRejected()
    {
        string program = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe");
        Dictionary<string, object> plan = AtomicPlanWithOperations(
            "shell-program-plan",
            "shell-program-key",
            "PREFLIGHT",
            new object[] { Operation("execute", "command.execute", new Dictionary<string, object> { { "program", program }, { "args", new string[] { "/c", "echo blocked" } } }) },
            new object[0],
            new object[] { Permission("process", program) });
        SignPlan(plan);
        ActionResult result = new AtomicPlanHandler(delegate { return "agent-1"; }).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", plan } } });
        Assert(!result.Success && result.ErrorCode == "AGENT_ATOMIC_PREFLIGHT_FAILED", "Shell 程序未被拒绝");
    }

    private static void AtomicCommandArgumentsExecute()
    {
        string program = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "whoami.exe");
        Assert(File.Exists(program), "测试环境缺少 whoami.exe");
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-atomic-command-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            Dictionary<string, object> plan = AtomicPlanWithOperations(
                "command-plan",
                "command-key",
                "EXECUTE",
                new object[]
                {
                    Operation("execute", "command.execute", new Dictionary<string, object> { { "program", program }, { "args", new string[] { "/user" } }, { "timeoutSeconds", 30 } })
                },
                new object[0],
                new object[] { Permission("process", program) });
            SignPlan(plan);
            ActionResult result = new AtomicPlanHandler(delegate { return "agent-1"; }, Path.Combine(root, "data")).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", plan } } });
            Assert(result.Success, "参数数组程序未执行成功");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static void AtomicServicePermissionIsEnforced()
    {
        Dictionary<string, object> plan = AtomicPlanWithOperations(
            "service-permission-plan",
            "service-permission-key",
            "PREFLIGHT",
            new object[] { Operation("status", "service.control", new Dictionary<string, object> { { "service", "Spooler" }, { "action", "status" } }) },
            new object[0],
            new object[] { Permission("service", "OtherService") });
        SignPlan(plan);
        ActionResult result = new AtomicPlanHandler(delegate { return "agent-1"; }).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", plan } } });
        Assert(!result.Success && result.ErrorCode == "AGENT_ATOMIC_PREFLIGHT_FAILED", "服务越权未失败关闭");
    }

    private static void AtomicServiceStatusPreflight()
    {
        ServiceController[] services = ServiceController.GetServices();
        Assert(services.Length > 0, "测试环境没有可读取的 Windows 服务");
        string serviceName = services[0].ServiceName;
        foreach (ServiceController service in services) service.Dispose();
        Dictionary<string, object> plan = AtomicPlanWithOperations(
            "service-status-plan",
            "service-status-key",
            "PREFLIGHT",
            new object[] { Operation("status", "service.control", new Dictionary<string, object> { { "service", serviceName }, { "action", "status" } }) },
            new object[0],
            new object[] { Permission("service", serviceName) });
        SignPlan(plan);
        ActionResult result = new AtomicPlanHandler(delegate { return "agent-1"; }).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", plan } } });
        Assert(result.Success, "服务状态预演失败");
        Assert(Convert.ToBoolean(result.Detail["preview"]) && !Convert.ToBoolean(result.Detail["mutating"]), "服务状态预演不是只读");
    }

    private static void AtomicLedgerPersistsIdempotency()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-atomic-ledger-" + Guid.NewGuid().ToString("N"));
        string target = Path.Combine(root, "server.pem");
        Directory.CreateDirectory(root);
        File.WriteAllText(target, "old");
        try
        {
            Dictionary<string, object> plan = AtomicPlanWithOperations(
                "ledger-plan",
                "ledger-key",
                "EXECUTE",
                new object[]
                {
                    Operation("backup-file", "file.backup", new Dictionary<string, object> { { "path", target } }),
                    Operation("replace-file", "file.atomic_replace", new Dictionary<string, object> { { "path", target }, { "content", "new" } })
                },
                new object[0],
                new object[] { Permission("filesystem", target) });
            SignPlan(plan);
            string data = Path.Combine(root, "data");
            ActionResult first = new AtomicPlanHandler(delegate { return "agent-1"; }, data).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", plan } } });
            ActionResult second = new AtomicPlanHandler(delegate { return "agent-1"; }, data).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", plan } } });
            Assert(first.Success && second.Success, "账本幂等重放未成功");
            Assert(File.ReadAllText(target) == "new", "幂等重放破坏了文件内容");
            Assert(Directory.GetFiles(Path.Combine(data, "atomic-plans")).Length == 1, "账本未持久化为单一计划记录");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static void AtomicLedgerRejectsPlanConflict()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-atomic-conflict-" + Guid.NewGuid().ToString("N"));
        string target = Path.Combine(root, "server.pem");
        Directory.CreateDirectory(root);
        File.WriteAllText(target, "old");
        try
        {
            string data = Path.Combine(root, "data");
            Dictionary<string, object> firstPlan = AtomicPlanWithOperations(
                "conflict-plan",
                "conflict-key",
                "EXECUTE",
                new object[] { Operation("replace", "file.atomic_replace", new Dictionary<string, object> { { "path", target }, { "content", "one" } }) },
                new object[0],
                new object[] { Permission("filesystem", target) });
            SignPlan(firstPlan);
            ActionResult first = new AtomicPlanHandler(delegate { return "agent-1"; }, data).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", firstPlan } } });
            Dictionary<string, object> secondPlan = AtomicPlanWithOperations(
                "conflict-plan",
                "conflict-key",
                "EXECUTE",
                new object[] { Operation("replace", "file.atomic_replace", new Dictionary<string, object> { { "path", target }, { "content", "two" } }) },
                new object[0],
                new object[] { Permission("filesystem", target) });
            SignPlan(secondPlan);
            ActionResult second = new AtomicPlanHandler(delegate { return "agent-1"; }, data).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", secondPlan } } });
            Assert(first.Success, "冲突计划基线执行失败");
            Assert(!second.Success && second.ErrorCode == "AGENT_ATOMIC_OPERATION_FAILED", "相同幂等键的不同计划未拒绝");
            Assert(File.ReadAllText(target) == "one", "冲突计划修改了原文件");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static void AtomicRollbackFailureRequiresManualIntervention()
    {
        string root = Path.Combine(Path.GetTempPath(), "gcac-compat-atomic-manual-" + Guid.NewGuid().ToString("N"));
        string target = Path.Combine(root, "server.pem");
        Directory.CreateDirectory(root);
        File.WriteAllText(target, "old");
        try
        {
            Dictionary<string, object> plan = AtomicPlanWithOperations(
                "manual-plan",
                "manual-key",
                "EXECUTE",
                new object[]
                {
                    Operation("backup-file", "file.backup", new Dictionary<string, object> { { "path", target } }),
                    Operation("force-failure", "preflight.assert", new Dictionary<string, object> { { "value", false } })
                },
                new object[] { Operation("restore-file", "file.restore", new Dictionary<string, object> { { "backupOperationId", "missing-backup" } }) },
                new object[] { Permission("filesystem", target) });
            SignPlan(plan);
            ActionResult result = new AtomicPlanHandler(delegate { return "agent-1"; }, Path.Combine(root, "data")).Execute(new AgentTask { payload = new Dictionary<string, object> { { "plan", plan } } });
            Assert(!result.Success && result.ErrorCode == "AGENT_ROLLBACK_FAILED", "回滚失败未返回稳定错误");
            Assert(Convert.ToString(result.Detail["state"]) == "MANUAL_INTERVENTION", "回滚失败未进入人工处理");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
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

    private static Dictionary<string, object> AtomicPlanWithOperations(string planId, string idempotencyKey, string executionMode, object[] operations, object[] rollback, object[] permissions)
    {
        return new Dictionary<string, object>
        {
            { "apiVersion", "gcac.agent-plan/v1" },
            { "planId", planId },
            { "tenantId", "tenant-1" },
            { "agentId", "agent-1" },
            { "executionRunId", "run-" + planId },
            { "executionStepId", "step-" + planId },
            { "issuedAt", "2026-07-31T00:00:00.000Z" },
            { "expiresAt", "2099-07-31T00:00:00.000Z" },
            { "idempotencyKey", idempotencyKey },
            { "plugin", new Dictionary<string, object> { { "pluginId", "fixture.atomic" }, { "version", "1.0.0" } } },
            { "permissions", permissions },
            { "variablesDigest", "fixture" },
            { "executionMode", executionMode },
            { "operations", operations },
            { "rollback", rollback }
        };
    }

    private static Dictionary<string, object> Operation(string id, string operationType, Dictionary<string, object> input)
    {
        return new Dictionary<string, object>
        {
            { "id", id },
            { "name", id },
            { "stage", "install" },
            { "operationType", operationType },
            { "schemaVersion", "1.0" },
            { "input", input }
        };
    }

    private static Dictionary<string, object> Permission(string scope, params string[] values)
    {
        return new Dictionary<string, object>
        {
            { "name", scope },
            { "scope", scope },
            { "values", values }
        };
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

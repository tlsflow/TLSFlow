using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class AgentRuntime
    {
        private readonly AgentConfig config;
        private readonly AuditLogger logger;
        private readonly RecoveryLedger ledger;
        private readonly AgentIdentityStore identityStore;
        private readonly ControlPlaneClient client;
        private readonly CapabilityCollector capabilityCollector;
        private readonly ActionRegistry registry;
        private string activeAgentId;
        private DateTime? lastRecoveryAtUtc;
        private DateTime? lastTaskPollAtUtc;
        private DateTime? lastTaskResultAtUtc;
        private DateTime? lastSelfCheckAtUtc;
        private PreflightResult lastSelfCheck;
        private string lastError;
        private int heartbeatFailures;
        private int taskPollFailures;
        private int recoveryFailures;
        private ManagementTcpServer managementServer;
        private readonly object directDiscoverySync = new object();

        public AgentRuntime(AgentConfig config)
        {
            this.config = config;
            logger = new AuditLogger(config.logDirectory);
            ledger = new RecoveryLedger(config.dataDirectory);
            identityStore = new AgentIdentityStore(config.dataDirectory);
            client = new ControlPlaneClient(config);
            capabilityCollector = new CapabilityCollector(config);
            registry = BuildRegistry();
        }

        public void Run(WaitHandle stopSignal)
        {
            try
            {
                CapabilitySnapshot snapshot = capabilityCollector.Collect();
                UpdateSelfCheck(snapshot);
                managementServer = new ManagementTcpServer(config, ExecuteDirectWebDiscovery);
                managementServer.Start();
                string agentId = identityStore.Load();
                bool materialReady = !TextUtility.IsBlank(agentId) && PolicyMaterialBootstrap.Exists(config);
                if (materialReady)
                {
                    try { PolicyMaterialLoader.Load(config, agentId, config.tenantId); }
                    catch { materialReady = false; }
                }
                if (!materialReady)
                {
                    RegistrationResponse registration = client.Register(snapshot);
                    agentId = registration.id;
                    PolicyMaterialBootstrap.Persist(config, agentId, registration.trustMaterial);
                    identityStore.Save(agentId);
                    logger.Write("info", "registration.completed", "agentId=" + agentId);
                }
                else
                {
                    logger.Write("info", "registration.reused", "agentId=" + agentId);
                }
                activeAgentId = agentId;
                AgentV2ContractHandler.SetRuntimeIdentity(config, agentId);
                TryReportInitialCapabilities(agentId, snapshot);
                ReplayPending(agentId);
                DateTime nextHeartbeat = DateTime.MinValue;
                logger.Write("info", "runtime.started", "agentId=" + agentId);
                while (!stopSignal.WaitOne(0))
                {
                    if (DateTime.UtcNow >= nextHeartbeat)
                    {
                        try
                        {
                            snapshot = capabilityCollector.Collect();
                            UpdateSelfCheck(snapshot);
                            client.Heartbeat(agentId, snapshot, BuildRuntimeHealth(snapshot));
                            heartbeatFailures = 0;
                            ClearLastErrorWhenRecovered();
                        }
                        catch (Exception error)
                        {
                            heartbeatFailures++;
                            lastError = error.Message;
                            logger.Write("error", "heartbeat.failed", error.Message);
                        }
                        nextHeartbeat = DateTime.UtcNow.AddSeconds(config.heartbeatIntervalSeconds);
                    }
                    try
                    {
                        ReplayPending(agentId);
                        AgentTask task = client.Poll(agentId);
                        lastTaskPollAtUtc = DateTime.UtcNow;
                        taskPollFailures = 0;
                        if (task != null) Execute(agentId, task);
                        ClearLastErrorWhenRecovered();
                    }
                    catch (Exception error)
                    {
                        taskPollFailures++;
                        lastError = error.Message;
                        logger.Write("error", "task.poll_failed", error.Message);
                    }
                    stopSignal.WaitOne(TimeSpan.FromSeconds(config.taskPollIntervalSeconds));
                }
                logger.Write("info", "runtime.stopped", "Agent 已停止");
                if (managementServer != null) managementServer.Stop();
            }
            catch (Exception error)
            {
                if (managementServer != null) managementServer.Stop();
                RecordFatal(error);
                throw;
            }
        }

        public PreflightResult SelfCheck()
        {
            return new PreflightEvaluator(PreflightEvaluator.MinimumRequirements()).Evaluate(capabilityCollector.Collect());
        }

        internal void RecordFatal(Exception error)
        {
            logger.Write("error", "runtime.fatal", error == null ? "未知异常" : error.ToString());
        }

        public string[] RegisteredActions()
        {
            return registry.ListCanonicalActions();
        }

        private void Execute(string agentId, AgentTask task)
        {
            client.Acknowledge(agentId, task);
            logger.Write("info", "task.started", "taskId=" + task.id + " action=" + task.action);
            ActionResult result = null;
            try
            {
                result = registry.Execute(task);
                if (result.Success && IsWebInventoryRefresh(task))
                {
                    CapabilitySnapshot refreshed = capabilityCollector.Collect();
                    client.ReportCapabilities(agentId, refreshed);
                    if (result.Detail == null) result.Detail = new Dictionary<string, object>();
                    result.Detail["capabilityRescan"] = new Dictionary<string, object>
                    {
                        { "trigger", "manual" }, { "requestedBy", RequestedBy(task) }, { "success", true }
                    };
                }
            }
            catch (Exception error)
            {
                string action = task == null ? string.Empty : task.action;
                if (IsWebInventoryRefresh(task))
                {
                    Dictionary<string, object> detail = result == null || result.Detail == null
                        ? new Dictionary<string, object>() : new Dictionary<string, object>(result.Detail);
                    detail["capabilityRescan"] = new Dictionary<string, object>
                    {
                        { "trigger", "manual" }, { "requestedBy", RequestedBy(task) }, { "success", false }, { "error", error.Message }
                    };
                    result = ActionResult.Failed("CAPABILITY_RESCAN_FAILED", "Web 库存上报失败: " + error.Message, detail);
                }
                else result = AgentV2Actions.IsWrite(action)
                    ? ActionResult.Unknown("AGENT_EXECUTION_UNKNOWN", error.Message, new Dictionary<string, object> { { "fallback", false }, { "replayed", false } })
                    : ActionResult.Failed("ACTION_EXECUTION_FAILED", error.Message, null);
            }
            ledger.SavePending(task, result);
            try
            {
                client.SubmitResult(agentId, task.id, task.leaseId, result);
                ledger.MarkReported(task.id);
            }
            catch (Exception error)
            {
                ledger.MarkRetryFailure(task.id, error.Message);
                recoveryFailures++;
                lastError = error.Message;
                logger.Write("error", "task.result_submit_failed", "taskId=" + task.id + " error=" + error.Message);
            }
            lastTaskResultAtUtc = DateTime.UtcNow;
            logger.Write(result.Success ? "info" : "error", "task.completed", "taskId=" + task.id + " success=" + result.Success);
        }

        // 管理端口的唯一直接执行出口。只允许带签名授权的只读 Web 事实采集，
        // 不能把 Compatibility Agent 变成通用任务或命令执行服务。
        private DirectDiscoveryResponse ExecuteDirectWebDiscovery(Dictionary<string, object> payload)
        {
            lock (directDiscoverySync)
            {
                if (TextUtility.IsBlank(activeAgentId))
                    return DirectFailure("AGENT_DIRECT_DISCOVERY_UNAVAILABLE", "Agent 运行时尚未完成注册", null);
                try
                {
                    AgentTask task = new AgentTask
                    {
                        id = "direct:" + DirectRequestId(payload),
                        payload = payload == null ? new Dictionary<string, object>() : new Dictionary<string, object>(payload)
                    };
                    task = ControlPlaneClient.NormalizeTask(task);
                    if (!string.Equals(task.action, AgentV2Actions.FactCollect, StringComparison.Ordinal) || !IsWebInventoryRefresh(task))
                        return DirectFailure("AGENT_DIRECT_DISCOVERY_INVALID", "管理端点只接受 agent.fact.collect Web 库存刷新", null);

                    ActionResult result = registry.Execute(task);
                    if (!result.Success)
                        return DirectFailure(
                            TextUtility.IsBlank(result.ErrorCode) ? "AGENT_DIRECT_DISCOVERY_DENIED" : result.ErrorCode,
                            TextUtility.IsBlank(result.ErrorMessage) ? "Agent v2 授权校验失败" : result.ErrorMessage,
                            null);

                    CapabilitySnapshot refreshed = capabilityCollector.Collect();
                    client.ReportCapabilities(activeAgentId, refreshed);
                    Dictionary<string, object> inventory = WebInventory(refreshed);
                    Dictionary<string, object> detail = new Dictionary<string, object>
                    {
                        { "capabilityRescan", new Dictionary<string, object> { { "trigger", "direct" }, { "requestedBy", RequestedBy(task) }, { "success", true } } },
                        { "webInventory", new Dictionary<string, object>
                            {
                                { "configFiles", CountInventory(inventory, "configFiles") },
                                { "certificateFiles", CountInventory(inventory, "certificateFiles") },
                                { "listeningPorts", CountInventory(inventory, "listeningPorts") }
                            }
                        }
                    };
                    logger.Write("info", "discovery.direct_completed", "agentId=" + activeAgentId);
                    return new DirectDiscoveryResponse { success = true, detail = detail };
                }
                catch (Exception error)
                {
                    logger.Write("error", "discovery.direct_failed", error.Message);
                    return DirectFailure("CAPABILITY_RESCAN_FAILED", "Web 库存上报失败: " + error.Message, null);
                }
            }
        }

        private static DirectDiscoveryResponse DirectFailure(string code, string message, Dictionary<string, object> detail)
        {
            return new DirectDiscoveryResponse { success = false, errorCode = code, errorMessage = message, detail = detail };
        }

        private static string DirectRequestId(Dictionary<string, object> payload)
        {
            object value;
            return payload != null && payload.TryGetValue("requestId", out value) && value is string && !TextUtility.IsBlank((string)value)
                ? (string)value : Guid.NewGuid().ToString("N");
        }

        private static Dictionary<string, object> WebInventory(CapabilitySnapshot snapshot)
        {
            object value;
            return snapshot != null && snapshot.Facts != null && snapshot.Facts.TryGetValue("web.inventory", out value)
                ? value as Dictionary<string, object> ?? new Dictionary<string, object>()
                : new Dictionary<string, object>();
        }

        private static int CountInventory(Dictionary<string, object> inventory, string key)
        {
            object value;
            ICollection collection = inventory != null && inventory.TryGetValue(key, out value) ? value as ICollection : null;
            return collection == null ? 0 : collection.Count;
        }

        internal static bool IsWebInventoryRefresh(AgentTask task)
        {
            object value;
            return task != null && task.action == AgentV2Actions.FactCollect && task.payload != null
                && task.payload.TryGetValue("refreshWebInventory", out value) && value is bool && (bool)value;
        }

        private static string RequestedBy(AgentTask task)
        {
            object value;
            return task != null && task.payload != null && task.payload.TryGetValue("requestedBy", out value) && value is string
                ? (string)value : string.Empty;
        }

        private void ReplayPending(string agentId)
        {
            List<RecoveryRecord> pending = ledger.Pending();
            foreach (RecoveryRecord record in pending)
            {
                try
                {
                    client.SubmitResult(agentId, record.TaskId, record.LeaseId, record.Result);
                    ledger.MarkReported(record.TaskId);
                    lastRecoveryAtUtc = DateTime.UtcNow;
                    recoveryFailures = 0;
                    logger.Write("info", "task.result_replayed", "taskId=" + record.TaskId);
                }
                catch (Exception error)
                {
                    ledger.MarkRetryFailure(record.TaskId, error.Message);
                    recoveryFailures++;
                    lastError = error.Message;
                    logger.Write("error", "task.result_replay_failed", "taskId=" + record.TaskId + " error=" + error.Message);
                }
            }
        }

        private void TryReportInitialCapabilities(string agentId, CapabilitySnapshot snapshot)
        {
            try
            {
                client.ReportCapabilities(agentId, snapshot);
            }
            catch (Exception error)
            {
                logger.Write("error", "capability.initial_report_failed", error.Message);
                lastError = error.Message;
            }
        }

        internal Dictionary<string, object> BuildRuntimeHealth(CapabilitySnapshot snapshot)
        {
            List<string> degradedReasons = new List<string>();
            if (lastSelfCheck != null && !lastSelfCheck.Supported)
                foreach (PreflightCheck check in lastSelfCheck.Checks)
                    if (!check.Passed) degradedReasons.Add(TextUtility.IsBlank(check.ErrorCode) ? check.Message : check.ErrorCode);
            if (heartbeatFailures > 0) degradedReasons.Add("HEARTBEAT_FAILED");
            if (taskPollFailures > 0) degradedReasons.Add("TASK_POLL_FAILED");
            if (recoveryFailures > 0) degradedReasons.Add("RECOVERY_FAILED");
            int pendingCount = ledger.Pending().Count;
            Dictionary<string, object> health = new Dictionary<string, object>();
            health["modelVersion"] = "gcac.agent.health.v1";
            health["status"] = degradedReasons.Count == 0 ? "healthy" : "degraded";
            health["pendingResultCount"] = pendingCount;
            health["recoverableTaskCount"] = pendingCount;
            AddTime(health, "lastRecoveryAt", lastRecoveryAtUtc);
            AddTime(health, "lastTaskPollAt", lastTaskPollAtUtc);
            AddTime(health, "lastTaskResultAt", lastTaskResultAtUtc);
            AddTime(health, "lastSelfCheckAt", lastSelfCheckAtUtc);
            if (!TextUtility.IsBlank(lastError)) health["lastError"] = lastError;
            health["degradedReasons"] = degradedReasons.ToArray();
            health["failureCounts"] = new Dictionary<string, object>
            {
                { "heartbeat", heartbeatFailures },
                { "taskPoll", taskPollFailures },
                { "recovery", recoveryFailures }
            };
            return health;
        }

        private void UpdateSelfCheck(CapabilitySnapshot snapshot)
        {
            lastSelfCheck = new PreflightEvaluator(PreflightEvaluator.MinimumRequirements()).Evaluate(snapshot);
            lastSelfCheckAtUtc = DateTime.UtcNow;
        }

        private void ClearLastErrorWhenRecovered()
        {
            if (heartbeatFailures == 0 && taskPollFailures == 0 && recoveryFailures == 0) lastError = null;
        }

        private static void AddTime(Dictionary<string, object> target, string key, DateTime? value)
        {
            if (value.HasValue) target[key] = value.Value.ToString("o");
        }

        private ActionRegistry BuildRegistry()
        {
            ActionRegistry actionRegistry = new ActionRegistry();
            foreach (string action in AgentV2Actions.All())
            {
                actionRegistry.Register(new ActionRegistration
                {
                    CanonicalAction = action,
                    SchemaVersion = ProductIdentity.ActionSchemaVersion,
                    Handler = AgentV2ContractHandler.Execute
                });
            }
            return actionRegistry;
        }
    }

    /// <summary>
    /// 只接受注册响应中携带的完整签名材料，先在暂存目录校验，再提交到正式目录。
    /// 任何缺项或中断都会回滚旧材料，避免将半套策略暴露给任务执行路径。
    /// </summary>
    internal static class PolicyMaterialBootstrap
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

        internal static bool Exists(AgentConfig config)
        {
            return config != null && File.Exists(config.policyTrustRootPath) && File.Exists(config.policyKeySetPath)
                && File.Exists(config.localPolicyTrustRootPath) && File.Exists(config.localPolicyPath)
                && File.Exists(config.revokedTokenIdsPath) && File.Exists(config.revokedDecisionIdsPath) && File.Exists(config.revokedKeyIdsPath);
        }

        internal static void Persist(AgentConfig config, string agentId, Dictionary<string, object> material)
        {
            if (config == null || TextUtility.IsBlank(agentId) || material == null) throw new InvalidOperationException("注册响应缺少 Compatibility Agent 信任材料");
            object localPolicyBundleValue;
            if (!material.TryGetValue("compatibilityLocalPolicyBundle", out localPolicyBundleValue)) throw new InvalidOperationException("注册响应缺少本地策略包");
            Dictionary<string, object> localPolicyBundle = localPolicyBundleValue as Dictionary<string, object>;
            if (localPolicyBundle == null || !BundleContainsAgent(localPolicyBundle, config.tenantId, agentId)) throw new InvalidOperationException("注册响应本地策略未绑定当前租户和 Agent");
            string policyDirectory = Path.GetDirectoryName(config.policyTrustRootPath);
            if (TextUtility.IsBlank(policyDirectory)) throw new InvalidOperationException("信任材料目录为空");
            string stagingDirectory = policyDirectory + ".staging-" + Guid.NewGuid().ToString("N");
            string backupDirectory = policyDirectory + ".backup-" + Guid.NewGuid().ToString("N");
            string[] names = new string[] { "trust-root.json", "key-set.json", "local-policy-root.json", "local-policy.json", "revoked-tokens.json", "revoked-decisions.json", "revoked-keys.json" };
            string[] targetPaths = new string[] { config.policyTrustRootPath, config.policyKeySetPath, config.localPolicyTrustRootPath, config.localPolicyPath, config.revokedTokenIdsPath, config.revokedDecisionIdsPath, config.revokedKeyIdsPath };
            try
            {
                Directory.CreateDirectory(stagingDirectory);
                WriteJson(Path.Combine(stagingDirectory, names[0]), Required(material, "policyAuthorityTrustRoot"));
                WriteJson(Path.Combine(stagingDirectory, names[1]), Required(material, "compatibilityPolicyAuthorityKeySet"));
                WriteJson(Path.Combine(stagingDirectory, names[2]), Required(material, "localPolicyTrustRoot"));
                WriteJson(Path.Combine(stagingDirectory, names[3]), localPolicyBundle);
                WriteJson(Path.Combine(stagingDirectory, names[4]), RequiredArray(material, "revokedTokenIds"));
                WriteJson(Path.Combine(stagingDirectory, names[5]), RequiredArray(material, "revokedDecisionIds"));
                WriteJson(Path.Combine(stagingDirectory, names[6]), RequiredArray(material, "revokedKeyIds"));

                AgentConfig validationConfig = PolicyConfig(config, stagingDirectory);
                PolicyMaterialLoader.Load(validationConfig, agentId, config.tenantId);

                Directory.CreateDirectory(backupDirectory);
                for (int index = 0; index < targetPaths.Length; index++)
                    if (File.Exists(targetPaths[index])) File.Copy(targetPaths[index], Path.Combine(backupDirectory, names[index]), true);
                try
                {
                    Directory.CreateDirectory(policyDirectory);
                    for (int index = 0; index < targetPaths.Length; index++) File.Copy(Path.Combine(stagingDirectory, names[index]), targetPaths[index], true);
                }
                catch
                {
                    for (int index = 0; index < targetPaths.Length; index++)
                    {
                        string backup = Path.Combine(backupDirectory, names[index]);
                        if (File.Exists(backup)) File.Copy(backup, targetPaths[index], true);
                        else if (File.Exists(targetPaths[index])) File.Delete(targetPaths[index]);
                    }
                    throw;
                }
            }
            finally
            {
                if (Directory.Exists(stagingDirectory)) Directory.Delete(stagingDirectory, true);
                if (Directory.Exists(backupDirectory)) Directory.Delete(backupDirectory, true);
            }
        }

        private static bool BundleContainsAgent(Dictionary<string, object> bundle, string tenantId, string agentId)
        {
            object values;
            System.Collections.IList policies;
            if (!bundle.TryGetValue("policies", out values) || (policies = values as System.Collections.IList) == null) return false;
            foreach (object value in policies)
            {
                Dictionary<string, object> entry = value as Dictionary<string, object>;
                Dictionary<string, object> policy;
                if (entry == null || Convert.ToString(entry["tenantId"]) != tenantId || !entry.TryGetValue("policy", out values) || (policy = values as Dictionary<string, object>) == null) continue;
                if (Convert.ToString(policy["agentId"]) == agentId) return true;
            }
            return false;
        }

        private static object Required(Dictionary<string, object> material, string key)
        {
            object value;
            if (!material.TryGetValue(key, out value) || value == null) throw new InvalidOperationException("注册响应缺少信任材料字段：" + key);
            return value;
        }

        private static object RequiredArray(Dictionary<string, object> material, string key)
        {
            object value = Required(material, key);
            if (!(value is System.Collections.IList)) throw new InvalidOperationException("注册响应撤销清单格式无效：" + key);
            return value;
        }

        private static AgentConfig PolicyConfig(AgentConfig source, string directory)
        {
            return new AgentConfig
            {
                tenantId = source.tenantId,
                policyTrustRootPath = Path.Combine(directory, "trust-root.json"),
                policyKeySetPath = Path.Combine(directory, "key-set.json"),
                localPolicyTrustRootPath = Path.Combine(directory, "local-policy-root.json"),
                localPolicyPath = Path.Combine(directory, "local-policy.json"),
                revokedTokenIdsPath = Path.Combine(directory, "revoked-tokens.json"),
                revokedDecisionIdsPath = Path.Combine(directory, "revoked-decisions.json"),
                revokedKeyIdsPath = Path.Combine(directory, "revoked-keys.json")
            };
        }

        private static void WriteJson(string path, object value)
        {
            string directory = Path.GetDirectoryName(path);
            if (!Directory.Exists(directory)) Directory.CreateDirectory(directory);
            File.WriteAllText(path, Serializer.Serialize(value));
        }
    }
}

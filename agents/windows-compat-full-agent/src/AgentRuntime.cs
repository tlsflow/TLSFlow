using System;
using System.Collections.Generic;
using System.Threading;

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
        private readonly WindowsRuntimeDiscovery runtimeDiscovery;
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

        public AgentRuntime(AgentConfig config)
        {
            this.config = config;
            logger = new AuditLogger(config.logDirectory);
            ledger = new RecoveryLedger(config.dataDirectory);
            identityStore = new AgentIdentityStore(config.dataDirectory);
            client = new ControlPlaneClient(config);
            capabilityCollector = new CapabilityCollector(config);
            runtimeDiscovery = new WindowsRuntimeDiscovery(config);
            registry = BuildRegistry(config.dataDirectory);
        }

        public void Run(WaitHandle stopSignal)
        {
            DirectControlServer directControl = null;
            try
            {
                if (config.directControlEnabled)
                {
                    directControl = new DirectControlServer(config, logger, registry);
                    directControl.Start();
                    client.SetDirectControlState(true, null);
                }
            }
            catch (Exception error)
            {
                client.SetDirectControlState(false, error.Message);
                logger.Write("error", "direct_control.start_failed", error.Message);
            }
            try
            {
            CapabilitySnapshot snapshot = capabilityCollector.Collect();
            UpdateSelfCheck(snapshot);
            string agentId = identityStore.Load();
            if (TextUtility.IsBlank(agentId))
            {
                agentId = client.Register(snapshot, RegisteredActions());
                identityStore.Save(agentId);
                logger.Write("info", "registration.completed", "agentId=" + agentId);
            }
            else
            {
                logger.Write("info", "registration.reused", "agentId=" + agentId);
            }
            activeAgentId = agentId;
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
                        client.Heartbeat(agentId, snapshot, BuildRuntimeHealth(snapshot), RegisteredActions());
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
            }
            finally
            {
                if (directControl != null) directControl.Dispose();
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
            logger.Write("info", "task.started", "taskId=" + task.id + " action=" + (task.action ?? task.type));
            ActionResult result;
            try { result = registry.Execute(task); }
            catch (Exception error) { result = ActionResult.Failed("ACTION_EXECUTION_FAILED", error.Message, null); }
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
            object iisError;
            if (snapshot != null && snapshot.Facts != null && snapshot.Facts.TryGetValue("windows.iis.inspection_error", out iisError) && !TextUtility.IsBlank(Convert.ToString(iisError)))
                degradedReasons.Add("IIS_INSPECTION_FAILED: " + Convert.ToString(iisError));
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

        private ActionRegistry BuildRegistry(string dataDirectory)
        {
            ActionRegistry actionRegistry = new ActionRegistry();
            actionRegistry.Register(new ActionRegistration
            {
                CanonicalAction = "agent.capability.rescan",
                SchemaVersion = ProductIdentity.ActionSchemaVersion,
                Aliases = new string[0],
                Handler = delegate(AgentTask task)
                {
                    if (TextUtility.IsBlank(activeAgentId)) return ActionResult.Failed("AGENT_NOT_REGISTERED", "Agent 尚未完成注册", null);
                    CapabilitySnapshot snapshot = capabilityCollector.Collect();
                    UpdateSelfCheck(snapshot);
                    client.ReportCapabilities(activeAgentId, snapshot);
                    return ActionResult.Succeeded(new Dictionary<string, object>
                    {
                        { "snapshotId", snapshot.SnapshotId },
                        { "reportedAt", snapshot.CollectedAtUtc.ToString("o") },
                        { "factCount", snapshot.Facts.Count },
                        { "capabilityCount", snapshot.Capabilities.Count }
                    });
                }
            });
            actionRegistry.Register(new ActionRegistration
            {
                CanonicalAction = "discovery.run",
                SchemaVersion = ProductIdentity.ActionSchemaVersion,
                Aliases = new string[] { "agent.discovery.run" },
                Handler = delegate(AgentTask task)
                {
                    if (TextUtility.IsBlank(activeAgentId)) return ActionResult.Failed("AGENT_NOT_REGISTERED", "Agent 尚未完成注册", null);
                    string requestId = task == null || task.payload == null ? string.Empty : AtomicValue.String(task.payload, "requestId");
                    Dictionary<string, object> discovery = runtimeDiscovery.Collect(requestId);
                    CapabilitySnapshot snapshot = capabilityCollector.Collect();
                    UpdateSelfCheck(snapshot);
                    client.ReportCapabilities(activeAgentId, snapshot);
                    discovery["reportedCapability"] = true;
                    return ActionResult.Succeeded(discovery);
                }
            });
            actionRegistry.Register(new ActionRegistration
            {
                CanonicalAction = "agent.self_check",
                SchemaVersion = ProductIdentity.ActionSchemaVersion,
                Aliases = new string[] { "SELF_TEST" },
                Handler = delegate(AgentTask task)
                {
                    CapabilitySnapshot snapshot = new CapabilityCollector().Collect();
                    PreflightResult result = new PreflightEvaluator(PreflightEvaluator.MinimumRequirements()).Evaluate(snapshot);
                    return result.Supported
                        ? ActionResult.Succeeded(new Dictionary<string, object> { { "supported", true }, { "checks", result.Checks } })
                        : ActionResult.Failed("PREFLIGHT_BLOCKED", "前置检查未通过", new Dictionary<string, object> { { "supported", false }, { "checks", result.Checks } });
                }
            });
            AtomicPlanHandler atomicPlanHandler = new AtomicPlanHandler(delegate { return activeAgentId; }, dataDirectory);
            actionRegistry.Register(new ActionRegistration
            {
                CanonicalAction = "agent.atomic_plan.execute",
                SchemaVersion = ProductIdentity.ActionSchemaVersion,
                Aliases = new string[0],
                Handler = atomicPlanHandler.Execute
            });
            return actionRegistry;
        }
    }
}

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
        private readonly ActionRegistry registry;
        private readonly DirectControlServer directControl;
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
            registry = BuildRegistry();
            directControl = new DirectControlServer(config, registry, delegate { return BuildRuntimeHealth(null); });
        }

        public void Run(WaitHandle stopSignal)
        {
            try
            {
                try
                {
                    directControl.Start();
                }
                catch (Exception error)
                {
                    logger.Write("error", "direct_control.start_failed", error.Message);
                }
                CapabilitySnapshot snapshot = capabilityCollector.Collect();
                UpdateSelfCheck(snapshot);
                string agentId = identityStore.Load();
                if (TextUtility.IsBlank(agentId))
                {
                    agentId = client.Register(snapshot, directControl.Snapshot());
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
                            client.Heartbeat(agentId, snapshot, BuildRuntimeHealth(snapshot), directControl.Snapshot());
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
            catch (Exception error)
            {
                RecordFatal(error);
                throw;
            }
            finally
            {
                directControl.Stop();
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
            catch (Exception error)
            {
                string action = task == null ? string.Empty : (task.action ?? task.type);
                result = AgentV2Actions.IsWrite(action)
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
                    Aliases = new string[0],
                    Handler = AgentV2ContractHandler.Execute
                });
            }
            return actionRegistry;
        }
    }
}

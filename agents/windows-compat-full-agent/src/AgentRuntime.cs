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
        private readonly ControlPlaneClient client;
        private readonly CapabilityCollector capabilityCollector;
        private readonly ActionRegistry registry;

        public AgentRuntime(AgentConfig config)
        {
            this.config = config;
            logger = new AuditLogger(config.logDirectory);
            ledger = new RecoveryLedger(config.dataDirectory);
            client = new ControlPlaneClient(config);
            capabilityCollector = new CapabilityCollector(config);
            registry = BuildRegistry(config.dataDirectory);
        }

        public void Run(CancellationToken cancellationToken)
        {
            CapabilitySnapshot snapshot = capabilityCollector.Collect();
            string agentId = client.Register(snapshot);
            client.ReportCapabilities(agentId, snapshot);
            ReplayPending(agentId);
            DateTime nextHeartbeat = DateTime.MinValue;
            logger.Write("info", "runtime.started", "agentId=" + agentId);
            while (!cancellationToken.IsCancellationRequested)
            {
                if (DateTime.UtcNow >= nextHeartbeat)
                {
                    snapshot = capabilityCollector.Collect();
                    client.Heartbeat(agentId, snapshot);
                    nextHeartbeat = DateTime.UtcNow.AddSeconds(config.heartbeatIntervalSeconds);
                }
                AgentTask task = client.Poll(agentId);
                if (task != null) Execute(agentId, task);
                cancellationToken.WaitHandle.WaitOne(TimeSpan.FromSeconds(config.taskPollIntervalSeconds));
            }
            logger.Write("info", "runtime.stopped", "Agent 已停止");
        }

        public PreflightResult SelfCheck()
        {
            return new PreflightEvaluator(PreflightEvaluator.MinimumRequirements()).Evaluate(capabilityCollector.Collect());
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
            ledger.SavePending(task.id, task.leaseId, result);
            client.SubmitResult(agentId, task.id, task.leaseId, result);
            ledger.MarkReported(task.id);
            logger.Write(result.Success ? "info" : "error", "task.completed", "taskId=" + task.id + " success=" + result.Success);
        }

        private void ReplayPending(string agentId)
        {
            foreach (RecoveryRecord record in ledger.Pending())
            {
                client.SubmitResult(agentId, record.TaskId, record.LeaseId, record.Result);
                ledger.MarkReported(record.TaskId);
                logger.Write("info", "task.result_replayed", "taskId=" + record.TaskId);
            }
        }

        private static ActionRegistry BuildRegistry(string dataDirectory)
        {
            ActionRegistry actionRegistry = new ActionRegistry();
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
            IisCertificateDeploymentHandler iisHandler = new IisCertificateDeploymentHandler(dataDirectory);
            actionRegistry.Register(new ActionRegistration
            {
                CanonicalAction = "certificate.deploy",
                SchemaVersion = ProductIdentity.ActionSchemaVersion,
                Aliases = new string[] { "windows.iis.deploy_certificate" },
                Handler = iisHandler.Execute
            });
            return actionRegistry;
        }
    }
}

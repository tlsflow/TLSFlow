using System;
using System.Collections.Generic;

namespace GCAC.WindowsCompatibilityAgent
{
    /// <summary>
    /// Agent Core 的长期动作合同。产品适配能力不得通过新增 Core 动作扩展。
    /// </summary>
    internal static class AgentV2Actions
    {
        internal const string FactCollect = "agent.fact.collect";
        internal const string PlanValidate = "agent.plan.validate";
        internal const string PlanExecute = "agent.plan.execute";
        internal const string ExecutionReceipt = "agent.execution.receipt";

        internal static string[] All()
        {
            return new string[] { FactCollect, PlanValidate, PlanExecute, ExecutionReceipt };
        }

        internal static bool Contains(string action)
        {
            foreach (string supported in All())
                if (string.Equals(supported, action, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        internal static bool IsWrite(string action)
        {
            return string.Equals(action, PlanExecute, StringComparison.OrdinalIgnoreCase);
        }
    }

    /// <summary>
    /// Compatibility Agent 的 v2 唯一执行出口。所有信任材料由本地安全资源装配，
    /// 任务载荷只能携带待验证的授权材料，不能覆盖 Agent 本地策略或信任根。
    /// </summary>
    internal static class AgentV2ContractHandler
    {
        private static readonly object Sync = new object();
        private static AgentConfig config;
        private static string activeAgentId;

        internal static void SetRuntimeIdentity(AgentConfig runtimeConfig, string agentId)
        {
            lock (Sync) { config = runtimeConfig; activeAgentId = agentId; }
        }

        internal static ActionResult Execute(AgentTask task)
        {
            string action = task == null ? string.Empty : (task.action ?? string.Empty);
            if (!AgentV2Actions.Contains(action))
            {
                return ActionResult.Failed(
                    "AGENT_V2_ACTION_UNSUPPORTED",
                    "动作不属于 Agent v2 长期合同",
                    new Dictionary<string, object>
                    {
                        { "contractVersion", "AgentV2" },
                        { "action", action },
                        { "fallback", false }
                    });
            }
            try
            {
                AgentConfig runtimeConfig;
                string runtimeAgentId;
                lock (Sync) { runtimeConfig = config; runtimeAgentId = activeAgentId; }
                if (action == AgentV2Actions.FactCollect)
                {
                    AgentV2Authorization authorization = AgentV2Authorizer.Validate(task, runtimeConfig, runtimeAgentId, false);
                    return ActionResult.Succeeded(new Dictionary<string, object>
                    {
                        { "contractVersion", AgentV2Security.Version }, { "action", action }, { "fallback", false }, { "factEnvelope", AgentV2Operations.CollectFacts(task, authorization) }
                    });
                }
                if (action == AgentV2Actions.PlanValidate)
                {
                    AgentV2Authorization authorization = AgentV2Authorizer.Validate(task, runtimeConfig, runtimeAgentId, true);
                    return ActionResult.Succeeded(new Dictionary<string, object>
                    {
                        { "contractVersion", AgentV2Security.Version }, { "action", action }, { "fallback", false }, { "validated", true }, { "planDigest", authorization.Plan.planDigest }
                    });
                }
                if (action == AgentV2Actions.ExecutionReceipt)
                {
                    AgentV2Authorization authorization = AgentV2Authorizer.Validate(task, runtimeConfig, runtimeAgentId, false);
                    AgentExecutionReceiptV1 receipt = AgentV2Authorizer.ValidateClientReceipt(task, authorization);
                    return ActionResult.Succeeded(new Dictionary<string, object>
                    {
                        { "contractVersion", AgentV2Security.Version }, { "action", action }, { "fallback", false }, { "receiptAccepted", true }, { "receipt", AgentV2Authorizer.ReceiptDictionary(receipt) }
                    });
                }

                AgentV2Authorization executionAuthorization = AgentV2Authorizer.Validate(task, runtimeConfig, runtimeAgentId, true);
                AgentV2Authorizer.ConsumeNonce(executionAuthorization);
                DateTime startedAt = DateTime.UtcNow;
                List<Dictionary<string, object>> operationResults = new List<Dictionary<string, object>>();
                try
                {
                    operationResults = AgentV2Operations.ExecutePlan(executionAuthorization);
                    AgentExecutionReceiptV1 receipt = AgentV2Authorizer.BuildReceipt(executionAuthorization, "SUCCESS", operationResults, startedAt, null, null);
                    AgentV2Authorizer.SaveReceipt(executionAuthorization, receipt);
                    return ActionResult.Succeeded(new Dictionary<string, object>
                    {
                        { "contractVersion", AgentV2Security.Version }, { "action", action }, { "fallback", false }, { "receipt", AgentV2Authorizer.ReceiptDictionary(receipt) }
                    });
                }
                catch (Exception error)
                {
                    Dictionary<string, object> failed = new Dictionary<string, object> { { "operationId", executionAuthorization.Plan.operations.Count == 0 ? string.Empty : executionAuthorization.Plan.operations[executionAuthorization.Plan.operations.Count - 1].operationId }, { "status", "UNKNOWN" }, { "errorCode", "AGENT_EXECUTION_UNKNOWN" }, { "error", error.Message } };
                    operationResults.Add(failed);
                    AgentExecutionReceiptV1 receipt = AgentV2Authorizer.BuildReceipt(executionAuthorization, "UNKNOWN", operationResults, startedAt, "AGENT_EXECUTION_UNKNOWN", error.Message);
                    AgentV2Authorizer.SaveReceipt(executionAuthorization, receipt);
                    return ActionResult.Unknown("AGENT_EXECUTION_UNKNOWN", "写操作结果不明，禁止自动重试或回退", new Dictionary<string, object>
                    {
                        { "contractVersion", AgentV2Security.Version }, { "action", action }, { "fallback", false }, { "replayed", false }, { "receipt", AgentV2Authorizer.ReceiptDictionary(receipt) }
                    });
                }
            }
            catch (AgentV2SecurityException error)
            {
                Dictionary<string, object> detail = new Dictionary<string, object> { { "contractVersion", AgentV2Security.Version }, { "action", action }, { "fallback", false }, { "replayed", false } };
                return AgentV2Actions.IsWrite(action) ? ActionResult.Unknown(error.Code, error.Message, detail) : ActionResult.Failed(error.Code, error.Message, detail);
            }
            catch (Exception error)
            {
                Dictionary<string, object> detail = new Dictionary<string, object> { { "contractVersion", AgentV2Security.Version }, { "action", action }, { "fallback", false }, { "replayed", false } };
                return AgentV2Actions.IsWrite(action) ? ActionResult.Unknown("AGENT_EXECUTION_UNKNOWN", error.Message, detail) : ActionResult.Failed("AGENT_ACTION_FAILED", error.Message, detail);
            }
        }
    }
}

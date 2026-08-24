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
    /// Compatibility Agent 的 v2 合同边界。
    /// 当前生产授权链尚未装配时，所有 v2 请求统一失败关闭，不回退旧执行器。
    /// </summary>
    internal static class AgentV2ContractHandler
    {
        internal static ActionResult Execute(AgentTask task)
        {
            string action = task == null ? string.Empty : (task.action ?? task.type ?? string.Empty);
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
            Dictionary<string, object> detail = new Dictionary<string, object>
            {
                { "contractVersion", "AgentV2" },
                { "action", action },
                { "requiredPolicyAuthority", true },
                { "fallback", false },
                { "replayed", false }
            };
            if (AgentV2Actions.IsWrite(action))
            {
                return ActionResult.Unknown(
                    "AGENT_V2_POLICY_UNAVAILABLE",
                    "Agent v2 Policy Authority 生产信任根尚未装配，写操作结果不确定",
                    detail);
            }
            return ActionResult.Failed(
                "AGENT_V2_POLICY_UNAVAILABLE",
                "Agent v2 Policy Authority 生产信任根尚未装配，Compatibility Agent 已失败关闭",
                detail);
        }
    }
}

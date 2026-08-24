using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    /// <summary>
    /// 将安全合同校验结果转换为 Agent Core 使用的强类型模型。
    /// </summary>
    internal static class AgentV2Authorizer
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

        internal static AgentV2Authorization Validate(AgentTask task, AgentConfig config, string agentId, bool requirePlan)
        {
            AgentV2Security security = new AgentV2Security(config, delegate { return agentId; });
            AgentV2Authorization authorization = security.Authorize(task, requirePlan, false);
            authorization.Token = Deserialize<AgentCapabilityTokenV1>(authorization.RawToken);
            authorization.Decision = Deserialize<PolicyAuthorityDecisionV1>(authorization.RawDecision);
            if (requirePlan) authorization.Plan = Deserialize<AgentPlanV1>(authorization.RawPlan);
            return authorization;
        }

        internal static void ConsumeNonce(AgentV2Authorization authorization)
        {
            if (authorization == null || authorization.Security == null) throw new AgentV2SecurityException("AGENT_V2_AUTHORIZATION_REJECTED", "授权上下文缺失");
            authorization.Security.ConsumeNonce(authorization);
        }

        internal static void EnsureReceiptSigner(AgentV2Authorization authorization)
        {
            if (authorization == null || authorization.Security == null) throw new AgentV2SecurityException("AGENT_RECEIPT_SIGNER_UNAVAILABLE", "Receipt 签名上下文缺失", false);
            authorization.Security.LoadReceiptSigner();
        }

        internal static AgentExecutionReceiptV1 ValidateClientReceipt(AgentTask task, AgentV2Authorization authorization)
        {
            if (task != null && task.payload != null && task.payload.ContainsKey("receipt"))
                throw new AgentV2SecurityException("AGENT_RECEIPT_CLIENT_SUPPLIED", "Agent 不接受客户端提交的 Receipt 摘要");
            string planId = RequiredPlanId(task);
            Dictionary<string, object> raw = authorization.Security.LoadReceipt(planId, authorization.PlanDigest, authorization.Token.tokenId, authorization.Token.nonce);
            AgentExecutionReceiptV1 receipt = Deserialize<AgentExecutionReceiptV1>(raw);
            if (receipt.agentId != authorization.Token.agentId || receipt.tenantId != authorization.Token.tenantId || receipt.tokenId != authorization.Token.tokenId || receipt.planDigest != authorization.PlanDigest)
                throw new AgentV2SecurityException("AGENT_RECEIPT_INVALID", "本地 Receipt 绑定不一致");
            return receipt;
        }

        internal static AgentExecutionReceiptV1 BuildReceipt(AgentV2Authorization authorization, string status, List<Dictionary<string, object>> operationResults, DateTime startedAtUtc, string errorCode, string unknownReason)
        {
            string operationId = authorization.Plan.operations.Count == 0 ? authorization.Plan.planId : authorization.Plan.operations[authorization.Plan.operations.Count - 1].operationId;
            Dictionary<string, object> raw = AgentV2Security.BuildReceipt(
                operationId,
                authorization.Plan.planId,
                authorization.PlanDigest,
                authorization.Token.agentId,
                authorization.Token.tenantId,
                authorization.Token.tokenId,
                status,
                errorCode,
                unknownReason,
                operationResults,
                true,
                startedAtUtc,
                DateTime.UtcNow,
                authorization.Security.LoadReceiptSigner());
            return Deserialize<AgentExecutionReceiptV1>(raw);
        }

        internal static void SaveReceipt(AgentV2Authorization authorization, AgentExecutionReceiptV1 receipt)
        {
            authorization.Security.SaveReceipt(ReceiptDictionary(receipt), authorization.Token.tokenId, authorization.Token.nonce);
        }

        internal static Dictionary<string, object> ReceiptDictionary(AgentExecutionReceiptV1 receipt)
        {
            Dictionary<string, object> result = Serializer.DeserializeObject(Serializer.Serialize(receipt)) as Dictionary<string, object>;
            if (result == null) throw new InvalidOperationException("Receipt 无法转换为合同对象");
            if (result.ContainsKey("errorCode") && result["errorCode"] == null) result.Remove("errorCode");
            if (result.ContainsKey("unknownReason") && result["unknownReason"] == null) result.Remove("unknownReason");
            return result;
        }

        private static T Deserialize<T>(Dictionary<string, object> value)
        {
            return Serializer.Deserialize<T>(Serializer.Serialize(value));
        }

        private static string RequiredPlanId(AgentTask task)
        {
            object value;
            if (task == null || task.payload == null || !task.payload.TryGetValue("planId", out value) || !(value is string) || TextUtility.IsBlank((string)value))
                throw new AgentV2SecurityException("AGENT_V2_REQUEST_INVALID", "execution.receipt 缺少 planId");
            return (string)value;
        }
    }
}

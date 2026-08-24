using System;
using System.Collections.Generic;

namespace GCAC.WindowsCompatibilityAgent
{
    internal static class ProductIdentity
    {
        public const string ProductLine = "windows-compat-full-agent";
        public const string Runtime = "csharp-dotnet-framework";
        public const string ActionSchemaVersion = "gcac.action/v1";
        public const string CapabilitySchemaVersion = "gcac.capability/v1";
        public const string ServiceName = "GCACWindowsCompatibilityAgent";
        public const string DisplayName = "GCAC Windows Compatibility Agent";
        public const string Version = "0.1.11";
    }

    internal sealed class RegistrationResponse
    {
        public string id { get; set; }
    }

    internal sealed class AgentTaskEnvelope
    {
        public AgentTask task { get; set; }
    }

    internal sealed class AgentTask
    {
        public string id { get; set; }
        public string leaseId { get; set; }
        public string action { get; set; }
        public string schemaVersion { get; set; }
        public string idempotencyKey { get; set; }
        public Dictionary<string, object> payload { get; set; }
        public Dictionary<string, object> audit { get; set; }
    }

    internal sealed class AgentCapabilityTokenV1
    {
        public string tokenVersion { get; set; }
        public string tokenId { get; set; }
        public string agentId { get; set; }
        public string tenantId { get; set; }
        public string pluginId { get; set; }
        public string pluginVersionId { get; set; }
        public string capability { get; set; }
        public string[] actions { get; set; }
        public string[] allowedPaths { get; set; }
        public string[] allowedServices { get; set; }
        public string[] artifactDigests { get; set; }
        public string approvalRef { get; set; }
        public string policyRef { get; set; }
        public string policyVersion { get; set; }
        public string issuedAt { get; set; }
        public string expiresAt { get; set; }
        public string nonce { get; set; }
        public string planDigest { get; set; }
        public string authorityKeyId { get; set; }
        public string signature { get; set; }
    }

    internal sealed class PolicyAuthorityDecisionV1
    {
        public string decisionVersion { get; set; }
        public string decisionId { get; set; }
        public bool allowed { get; set; }
        public string agentId { get; set; }
        public string tenantId { get; set; }
        public string pluginId { get; set; }
        public string pluginVersionId { get; set; }
        public string capability { get; set; }
        public string[] actions { get; set; }
        public string[] allowedPaths { get; set; }
        public string[] allowedServices { get; set; }
        public string[] artifactDigests { get; set; }
        public string policyRef { get; set; }
        public string policyVersion { get; set; }
        public string planDigest { get; set; }
        public string tokenId { get; set; }
        public string nonce { get; set; }
        public string approvalRef { get; set; }
        public string issuedAt { get; set; }
        public string validUntil { get; set; }
        public string authorityKeyId { get; set; }
        public string revocationRef { get; set; }
        public string signature { get; set; }
        public string reason { get; set; }
    }

    internal sealed class AgentPlanV1
    {
        public string planVersion { get; set; }
        public string planId { get; set; }
        public string agentId { get; set; }
        public string tenantId { get; set; }
        public string pluginId { get; set; }
        public string pluginVersionId { get; set; }
        public string capability { get; set; }
        public List<AgentPlanOperationV1> operations { get; set; }
        public string planDigest { get; set; }
        public string tokenId { get; set; }
        public string policyDecisionId { get; set; }
        public string nonce { get; set; }
        public string expiresAt { get; set; }
        public bool writeEffect { get; set; }
        public string approvalRef { get; set; }
    }

    internal sealed class AgentPlanOperationV1
    {
        public string operationId { get; set; }
        public string operationType { get; set; }
        public string stage { get; set; }
        public Dictionary<string, object> input { get; set; }
        public string[] dependsOn { get; set; }
        public string idempotencyKey { get; set; }
        public int timeoutSeconds { get; set; }
        public string compensation { get; set; }
    }

    internal sealed class AgentExecutionReceiptV1
    {
        public string receiptVersion { get; set; }
        public string operationId { get; set; }
        public string planId { get; set; }
        public string planDigest { get; set; }
        public string agentId { get; set; }
        public string tenantId { get; set; }
        public string tokenId { get; set; }
        public string status { get; set; }
        public string startedAt { get; set; }
        public string completedAt { get; set; }
        public List<Dictionary<string, object>> operationResults { get; set; }
        public bool nonceConsumed { get; set; }
        public string errorCode { get; set; }
        public string unknownReason { get; set; }
        public string digest { get; set; }
        public string agentKeyId { get; set; }
        public string signature { get; set; }
    }

    internal sealed class AgentLocalPathRuleV1
    {
        public string prefix { get; set; }
        public string[] operations { get; set; }
    }

    internal sealed class AgentLocalCommandRuleV1
    {
        public string executablePath { get; set; }
        public string executableSha256 { get; set; }
        public string[] argumentTemplate { get; set; }
        public string[] environmentAllowlist { get; set; }
        public string workingDirectory { get; set; }
        public string[] networkScopes { get; set; }
        public string childProcessPolicy { get; set; }
        public int timeoutSeconds { get; set; }
        public int outputLimitBytes { get; set; }
    }

    internal sealed class AgentLocalPolicyV1
    {
        public string policyVersion { get; set; }
        public string agentId { get; set; }
        public string receiptKeyId { get; set; }
        public string[] authorityKeyIds { get; set; }
        public string[] allowedActions { get; set; }
        public List<AgentLocalPathRuleV1> pathRules { get; set; }
        public string[] serviceRules { get; set; }
        public List<AgentLocalCommandRuleV1> commandRules { get; set; }
        public bool disabled { get; set; }
        public string updatedAt { get; set; }
    }

    internal sealed class ActionResult
    {
        public bool Success { get; set; }
        public string ErrorCode { get; set; }
        public string ErrorMessage { get; set; }
        public string Outcome { get; set; }
        public Dictionary<string, object> Detail { get; set; }

        public static ActionResult Succeeded(Dictionary<string, object> detail)
        {
            return new ActionResult { Success = true, Outcome = "SUCCESS", Detail = detail ?? new Dictionary<string, object>() };
        }

        public static ActionResult Failed(string code, string message, Dictionary<string, object> detail)
        {
            return new ActionResult
            {
                Success = false,
                ErrorCode = code,
                ErrorMessage = message,
                Outcome = string.Equals(code, "AGENT_EXECUTION_UNKNOWN", StringComparison.Ordinal) ? "UNKNOWN" : "FAILED",
                Detail = detail ?? new Dictionary<string, object>()
            };
        }

        public static ActionResult Unknown(string code, string message, Dictionary<string, object> detail)
        {
            return new ActionResult
            {
                Success = false,
                ErrorCode = code,
                ErrorMessage = message,
                Outcome = "UNKNOWN",
                Detail = detail ?? new Dictionary<string, object>()
            };
        }
    }

    internal sealed class CapabilitySnapshot
    {
        public string SchemaVersion { get; set; }
        public string SnapshotId { get; set; }
        public DateTime CollectedAtUtc { get; set; }
        public Dictionary<string, object> Facts { get; set; }
        public List<string> Capabilities { get; set; }
    }

    internal sealed class PreflightResult
    {
        public bool Supported { get; set; }
        public List<PreflightCheck> Checks { get; set; }
    }

    internal sealed class PreflightCheck
    {
        public string Id { get; set; }
        public bool Passed { get; set; }
        public string ErrorCode { get; set; }
        public string Message { get; set; }
        public string Suggestion { get; set; }
    }
}

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
        public const string Version = "0.1.5";
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
        public string type { get; set; }
        public string action { get; set; }
        public string schemaVersion { get; set; }
        public string idempotencyKey { get; set; }
        public Dictionary<string, object> payload { get; set; }
        public Dictionary<string, object> audit { get; set; }
    }

    internal sealed class ActionResult
    {
        public bool Success { get; set; }
        public string ErrorCode { get; set; }
        public string ErrorMessage { get; set; }
        public Dictionary<string, object> Detail { get; set; }

        public static ActionResult Succeeded(Dictionary<string, object> detail)
        {
            return new ActionResult { Success = true, Detail = detail ?? new Dictionary<string, object>() };
        }

        public static ActionResult Failed(string code, string message, Dictionary<string, object> detail)
        {
            return new ActionResult { Success = false, ErrorCode = code, ErrorMessage = message, Detail = detail ?? new Dictionary<string, object>() };
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

using System;
using System.IO;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class AgentConfig
    {
        public string schemaVersion { get; set; }
        public string tenantId { get; set; }
        public string agentKey { get; set; }
        public string enrollmentToken { get; set; }
        public string controlPlaneUrl { get; set; }
        public string managementListenAddress { get; set; }
        public int managementPort { get; set; }
        public int heartbeatIntervalSeconds { get; set; }
        public int taskPollIntervalSeconds { get; set; }
        public string dataDirectory { get; set; }
        public string logDirectory { get; set; }
        public string policyAuthorityKeySetPath { get; set; }
        public string policyTrustRootPath { get; set; }
        public string policyKeySetPath { get; set; }
        public string localPolicyPath { get; set; }
        public string localPolicyTrustRootPath { get; set; }
        public string revocationStatePath { get; set; }
        public string revokedTokenIdsPath { get; set; }
        public string revokedDecisionIdsPath { get; set; }
        public string revokedKeyIdsPath { get; set; }
        public string receiptKeyId { get; set; }
        public string receiptSigningKeyPath { get; set; }
        public string receiptKeySetPath { get; set; }
        public string[] requiredHotfixes { get; set; }

        public static AgentConfig Load(string path)
        {
            if (!File.Exists(path)) throw new InvalidOperationException("配置文件不存在：" + path);
            string json = File.ReadAllText(path);
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            AgentConfig config = serializer.Deserialize<AgentConfig>(json);
            if (config == null) throw new InvalidOperationException("配置文件无法解析");
            if (TextUtility.IsBlank(config.controlPlaneUrl)) throw new InvalidOperationException("controlPlaneUrl 不能为空");
            if (TextUtility.IsBlank(config.tenantId)) throw new InvalidOperationException("tenantId 不能为空");
            if (TextUtility.IsBlank(config.agentKey)) throw new InvalidOperationException("agentKey 不能为空");
            if (config.heartbeatIntervalSeconds <= 0) config.heartbeatIntervalSeconds = 10;
            if (TextUtility.IsBlank(config.managementListenAddress)) config.managementListenAddress = "0.0.0.0";
            if (config.managementPort <= 0) config.managementPort = 18932;
            if (config.taskPollIntervalSeconds <= 0) config.taskPollIntervalSeconds = 5;
            if (config.requiredHotfixes == null) config.requiredHotfixes = new string[0];
            string root = Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "GCAC"), "WindowsCompatibilityAgent");
            if (TextUtility.IsBlank(config.dataDirectory)) config.dataDirectory = Path.Combine(root, "data");
            if (TextUtility.IsBlank(config.logDirectory)) config.logDirectory = Path.Combine(root, "logs");
            string policyDirectory = Path.Combine(config.dataDirectory, "policy");
            if (TextUtility.IsBlank(config.policyTrustRootPath)) config.policyTrustRootPath = Path.Combine(policyDirectory, "trust-root.json");
            if (TextUtility.IsBlank(config.policyKeySetPath)) config.policyKeySetPath = TextUtility.IsBlank(config.policyAuthorityKeySetPath) ? Path.Combine(policyDirectory, "key-set.json") : config.policyAuthorityKeySetPath;
            if (TextUtility.IsBlank(config.localPolicyTrustRootPath)) config.localPolicyTrustRootPath = Path.Combine(policyDirectory, "local-policy-root.json");
            if (TextUtility.IsBlank(config.localPolicyPath)) config.localPolicyPath = Path.Combine(policyDirectory, "local-policy.json");
            if (TextUtility.IsBlank(config.revokedTokenIdsPath)) config.revokedTokenIdsPath = Path.Combine(policyDirectory, "revoked-tokens.json");
            if (TextUtility.IsBlank(config.revokedDecisionIdsPath)) config.revokedDecisionIdsPath = Path.Combine(policyDirectory, "revoked-decisions.json");
            if (TextUtility.IsBlank(config.revokedKeyIdsPath)) config.revokedKeyIdsPath = Path.Combine(policyDirectory, "revoked-keys.json");
            if (TextUtility.IsBlank(config.receiptKeySetPath)) config.receiptKeySetPath = Path.Combine(policyDirectory, "agent-receipt-keyset.json");
            if (TextUtility.IsBlank(config.receiptSigningKeyPath)) config.receiptSigningKeyPath = Path.Combine(policyDirectory, "agent-receipt-signing-key.bin");
            return config;
        }
    }
}

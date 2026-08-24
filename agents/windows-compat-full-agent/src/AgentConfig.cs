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
        public int heartbeatIntervalSeconds { get; set; }
        public int taskPollIntervalSeconds { get; set; }
        public string dataDirectory { get; set; }
        public string logDirectory { get; set; }
        public string[] requiredHotfixes { get; set; }

        public static AgentConfig Load(string path)
        {
            if (!File.Exists(path)) throw new InvalidOperationException("配置文件不存在：" + path);
            AgentConfig config = new JavaScriptSerializer().Deserialize<AgentConfig>(File.ReadAllText(path));
            if (config == null) throw new InvalidOperationException("配置文件无法解析");
            if (TextUtility.IsBlank(config.controlPlaneUrl)) throw new InvalidOperationException("controlPlaneUrl 不能为空");
            if (TextUtility.IsBlank(config.tenantId)) throw new InvalidOperationException("tenantId 不能为空");
            if (TextUtility.IsBlank(config.agentKey)) throw new InvalidOperationException("agentKey 不能为空");
            if (config.heartbeatIntervalSeconds <= 0) config.heartbeatIntervalSeconds = 30;
            if (config.taskPollIntervalSeconds <= 0) config.taskPollIntervalSeconds = 5;
            if (config.requiredHotfixes == null) config.requiredHotfixes = new string[0];
            string root = Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "GCAC"), "WindowsCompatibilityAgent");
            if (TextUtility.IsBlank(config.dataDirectory)) config.dataDirectory = Path.Combine(root, "data");
            if (TextUtility.IsBlank(config.logDirectory)) config.logDirectory = Path.Combine(root, "logs");
            return config;
        }
    }
}

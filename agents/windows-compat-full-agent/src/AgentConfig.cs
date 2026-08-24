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
        public bool directControlEnabled { get; set; }
        public string directControlListenHost { get; set; }
        public int directControlListenPort { get; set; }
        public string directControlAdvertiseHost { get; set; }
        public string dataDirectory { get; set; }
        public string logDirectory { get; set; }
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
            if (config.taskPollIntervalSeconds <= 0) config.taskPollIntervalSeconds = 5;
            if (config.directControlListenPort <= 0) config.directControlListenPort = 18933;
            if (TextUtility.IsBlank(config.directControlListenHost)) config.directControlListenHost = "0.0.0.0";
            if (config.requiredHotfixes == null) config.requiredHotfixes = new string[0];
            string root = Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "GCAC"), "WindowsCompatibilityAgent");
            if (TextUtility.IsBlank(config.dataDirectory)) config.dataDirectory = Path.Combine(root, "data");
            if (TextUtility.IsBlank(config.logDirectory)) config.logDirectory = Path.Combine(root, "logs");
            return config;
        }
    }
}

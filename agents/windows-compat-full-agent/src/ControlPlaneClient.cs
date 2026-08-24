using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class ControlPlaneClient
    {
        private readonly AgentConfig config;
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer();

        public ControlPlaneClient(AgentConfig config)
        {
            this.config = config;
            if (TransportProtocol.IsHttps(config.controlPlaneUrl))
            {
                try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; }
                catch { }
            }
        }

        public string Register(CapabilitySnapshot snapshot, DirectControlState directControl)
        {
            RegistrationResponse response = Send<RegistrationResponse>("/api/v1/agents/register", BuildRegistrationRequest(snapshot, directControl));
            return response.id;
        }

        public string Register(CapabilitySnapshot snapshot)
        {
            return Register(snapshot, null);
        }

        private static bool Is64BitOperatingSystem()
        {
            string architectureOverride = Environment.GetEnvironmentVariable("PROCESSOR_ARCHITEW6432");
            if (!string.IsNullOrEmpty(architectureOverride)) return string.Equals(architectureOverride, "AMD64", StringComparison.OrdinalIgnoreCase) || string.Equals(architectureOverride, "IA64", StringComparison.OrdinalIgnoreCase) || string.Equals(architectureOverride, "ARM64", StringComparison.OrdinalIgnoreCase);
            string architecture = Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE");
            return string.Equals(architecture, "AMD64", StringComparison.OrdinalIgnoreCase) || string.Equals(architecture, "IA64", StringComparison.OrdinalIgnoreCase) || string.Equals(architecture, "ARM64", StringComparison.OrdinalIgnoreCase);
        }

        public void Heartbeat(string agentId, CapabilitySnapshot snapshot, Dictionary<string, object> runtimeHealth, DirectControlState directControl)
        {
            Dictionary<string, object> body = BuildHeartbeatRequest(agentId, snapshot, runtimeHealth, directControl);
            Send<object>("/api/v1/agents/heartbeat", body);
        }

        public void Heartbeat(string agentId, CapabilitySnapshot snapshot, Dictionary<string, object> runtimeHealth)
        {
            Heartbeat(agentId, snapshot, runtimeHealth, null);
        }

        internal static Dictionary<string, object> BuildHeartbeatRequest(string agentId, CapabilitySnapshot snapshot, Dictionary<string, object> runtimeHealth)
        {
            return BuildHeartbeatRequest(agentId, snapshot, runtimeHealth, null);
        }

        internal static Dictionary<string, object> BuildHeartbeatRequest(string agentId, CapabilitySnapshot snapshot, Dictionary<string, object> runtimeHealth, DirectControlState directControl)
        {
            Dictionary<string, object> body = BaseIdentity(snapshot);
            body["agentId"] = agentId;
            body["version"] = ProductIdentity.Version;
            body["runtimeHealth"] = runtimeHealth;
            if (directControl != null) body["directControl"] = directControl;
            body["taskSummary"] = new Dictionary<string, object> { { "running", 0 }, { "queued", 0 } };
            return body;
        }

        public void ReportCapabilities(string agentId, CapabilitySnapshot snapshot)
        {
            Send<object>("/api/v1/agents/capabilities", BuildCapabilityRequest(agentId, snapshot));
        }

        public AgentTask Poll(string agentId)
        {
            List<AgentTask> tasks = Get<List<AgentTask>>("/api/v1/agents/tasks/pull?agentId=" + Uri.EscapeDataString(agentId) + "&limit=1");
            if (tasks == null || tasks.Count == 0) return null;
            return NormalizeTask(tasks[0]);
        }

        internal Dictionary<string, object> BuildRegistrationRequest(CapabilitySnapshot snapshot)
        {
            return BuildRegistrationRequest(snapshot, null);
        }

        internal Dictionary<string, object> BuildRegistrationRequest(CapabilitySnapshot snapshot, DirectControlState directControl)
        {
            Dictionary<string, object> body = BaseIdentity(snapshot);
            body["agentKey"] = config.agentKey;
            body["enrollmentToken"] = config.enrollmentToken;
            body["hostname"] = Environment.MachineName;
            body["version"] = ProductIdentity.Version;
            body["osType"] = "WINDOWS";
            body["arch"] = Is64BitOperatingSystem() ? "amd64" : "386";
            body["machineId"] = ReadFact(snapshot, "windows.machine_id");
            body["ipAddress"] = ReadFact(snapshot, "network.primary_ip");
            body["osVersion"] = ReadFact(snapshot, "windows.product_name");
            body["role"] = "full_agent";
            if (directControl != null) body["directControl"] = directControl;
            return body;
        }

        internal static Dictionary<string, object> BuildCapabilityRequest(string agentId, CapabilitySnapshot snapshot)
        {
            Dictionary<string, object> body = BaseIdentity(snapshot);
            body["agentId"] = agentId;
            body["compatibilityLevel"] = "L2";
            body["capabilities"] = BuildCapabilityReports(snapshot);
            return body;
        }

        internal static AgentTask NormalizeTask(AgentTask task)
        {
            if (task == null) return null;
            task.leaseId = "compat:" + Guid.NewGuid().ToString("N");
            object value;
            if (task.payload != null && task.payload.TryGetValue("type", out value)) task.type = Convert.ToString(value);
            if (task.payload != null && task.payload.TryGetValue("action", out value)) task.action = Convert.ToString(value);
            if (task.payload != null && task.payload.TryGetValue("schemaVersion", out value)) task.schemaVersion = Convert.ToString(value);
            return task;
        }

        public void Acknowledge(string agentId, AgentTask task)
        {
            Send<object>("/api/v1/agents/tasks/ack", new Dictionary<string, object> { { "agentId", agentId }, { "taskId", task.id }, { "leaseId", task.leaseId } });
        }

        public void SubmitResult(string agentId, string taskId, string leaseId, ActionResult result)
        {
            if (ResultSubmissionFailureInjector.ShouldFail())
                throw new InvalidOperationException("测试注入：结果提交失败");
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["agentId"] = agentId;
            body["taskId"] = taskId;
            body["leaseId"] = leaseId;
            body["success"] = result.Success;
            body["outcome"] = result.Outcome;
            body["errorCode"] = result.ErrorCode;
            body["errorMessage"] = result.ErrorMessage;
            body["detail"] = result.Detail;
            Send<object>("/api/v1/agents/tasks/result", body);
        }

        private static Dictionary<string, object> BaseIdentity(CapabilitySnapshot snapshot)
        {
            return new Dictionary<string, object>
            {
                { "productLine", ProductIdentity.ProductLine },
                { "runtime", ProductIdentity.Runtime },
                { "adapters", new string[] { "windows.compat.files", "windows.compat.scm", "windows.compat.cert-store", "windows.compat.tls" } },
                { "capabilities", snapshot.Capabilities.ToArray() }
            };
        }

        internal static List<Dictionary<string, object>> BuildCapabilityReports(CapabilitySnapshot snapshot)
        {
            List<Dictionary<string, object>> reports = new List<Dictionary<string, object>>();
            foreach (string capability in snapshot.Capabilities)
                reports.Add(Capability(capability, true, 0.95, "compatibility-runtime"));

            Dictionary<string, object> osDetail = new Dictionary<string, object>();
            osDetail["goos"] = "windows";
            osDetail["goarch"] = Is64BitOperatingSystem() ? "amd64" : "386";
            osDetail["osVersion"] = ReadFact(snapshot, "windows.version");
            osDetail["machineId"] = ReadFact(snapshot, "windows.machine_id");
            osDetail["primaryIp"] = ReadFact(snapshot, "network.primary_ip");
            osDetail["runtime"] = ProductIdentity.Runtime;
            osDetail["hostType"] = "windows-service";
            osDetail["agentModel"] = "compatibility-agent";
            osDetail["ProductName"] = ReadFact(snapshot, "windows.product_name");
            osDetail["CurrentBuild"] = ReadFact(snapshot, "windows.build_number");
            osDetail["BuildRevision"] = ReadFact(snapshot, "windows.service_pack");
            osDetail["Version"] = ReadFact(snapshot, "windows.version");
            reports.Add(Capability("windows.os.detail", osDetail, 0.98, "runtime-inspection"));

            string primaryIp = ReadFact(snapshot, "network.primary_ip");
            List<Dictionary<string, object>> adapters = new List<Dictionary<string, object>>();
            if (!TextUtility.IsBlank(primaryIp))
                adapters.Add(new Dictionary<string, object> { { "Name", "primary" }, { "IPv4", new string[] { primaryIp } } });
            reports.Add(Capability("windows.network.adapters", adapters, 0.9, "runtime-inspection"));
            return reports;
        }

        private static Dictionary<string, object> Capability(string capabilityKey, object value, double confidence, string source)
        {
            return new Dictionary<string, object>
            {
                { "capabilityKey", capabilityKey },
                { "value", value },
                { "confidence", confidence },
                { "evidence", new Dictionary<string, object> { { "source", source } } }
            };
        }

        private static string ReadFact(CapabilitySnapshot snapshot, string key)
        {
            object value;
            return snapshot != null && snapshot.Facts != null && snapshot.Facts.TryGetValue(key, out value) && value != null
                ? Convert.ToString(value)
                : string.Empty;
        }


        private T Get<T>(string path)
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(config.controlPlaneUrl.TrimEnd('/') + path);
            request.Method = "GET";
            request.Headers["x-tenant-id"] = config.tenantId;
            request.Headers["x-agent-token"] = config.enrollmentToken;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                string json = reader.ReadToEnd();
                return TextUtility.IsBlank(json) ? default(T) : serializer.Deserialize<T>(json);
            }
        }

        private T Send<T>(string path, object body)
        {
            byte[] payload = Encoding.UTF8.GetBytes(serializer.Serialize(body));
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(config.controlPlaneUrl.TrimEnd('/') + path);
            request.Method = "POST";
            request.ContentType = "application/json; charset=utf-8";
            request.Headers["x-tenant-id"] = config.tenantId;
            request.Headers["x-agent-token"] = config.enrollmentToken;
            request.ContentLength = payload.Length;
            using (Stream stream = request.GetRequestStream()) stream.Write(payload, 0, payload.Length);
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                string json = reader.ReadToEnd();
                if (typeof(T) == typeof(object) || TextUtility.IsBlank(json)) return default(T);
                return serializer.Deserialize<T>(json);
            }
        }
    }

    internal static class ResultSubmissionFailureInjector
    {
        private static int onceConsumed;

        public static bool ShouldFail()
        {
            string mode = Environment.GetEnvironmentVariable("GCAC_COMPAT_TEST_RESULT_SUBMIT_FAILURE");
            if (string.Equals(mode, "always", StringComparison.OrdinalIgnoreCase)) return true;
            if (!string.Equals(mode, "once", StringComparison.OrdinalIgnoreCase)) return false;
            return Interlocked.Exchange(ref onceConsumed, 1) == 0;
        }

        internal static void ResetForTests()
        {
            Interlocked.Exchange(ref onceConsumed, 0);
        }
    }
}

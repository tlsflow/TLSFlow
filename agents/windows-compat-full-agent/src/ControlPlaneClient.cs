using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
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
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
        }

        public string Register(CapabilitySnapshot snapshot)
        {
            Dictionary<string, object> body = BaseIdentity(snapshot);
            body["agentKey"] = config.agentKey;
            body["enrollmentToken"] = config.enrollmentToken;
            body["hostname"] = Environment.MachineName;
            body["version"] = ProductIdentity.Version;
            body["osType"] = "WINDOWS";
            body["arch"] = Environment.Is64BitOperatingSystem ? "amd64" : "386";
            body["role"] = "full_agent";
            RegistrationResponse response = Send<RegistrationResponse>("/api/v1/agents/register", body);
            return response.id;
        }

        public void Heartbeat(string agentId, CapabilitySnapshot snapshot)
        {
            Dictionary<string, object> body = BaseIdentity(snapshot);
            body["agentId"] = agentId;
            body["version"] = ProductIdentity.Version;
            body["taskSummary"] = new Dictionary<string, object> { { "running", 0 }, { "queued", 0 } };
            Send<object>("/api/v1/agents/heartbeat", body);
        }

        public void ReportCapabilities(string agentId, CapabilitySnapshot snapshot)
        {
            Dictionary<string, object> body = BaseIdentity(snapshot);
            body["agentId"] = agentId;
            body["snapshotId"] = snapshot.SnapshotId;
            body["schemaVersion"] = snapshot.SchemaVersion;
            body["collectedAt"] = snapshot.CollectedAtUtc.ToString("o");
            body["facts"] = snapshot.Facts;
            Send<object>("/api/v1/agents/capabilities", body);
        }

        public AgentTask Poll(string agentId)
        {
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["agentId"] = agentId;
            AgentTaskEnvelope response = Send<AgentTaskEnvelope>("/api/v1/agents/tasks/poll", body);
            return response == null ? null : response.task;
        }

        public void Acknowledge(string agentId, AgentTask task)
        {
            Send<object>("/api/v1/agents/tasks/ack", new Dictionary<string, object> { { "agentId", agentId }, { "taskId", task.id }, { "leaseId", task.leaseId } });
        }

        public void SubmitResult(string agentId, string taskId, string leaseId, ActionResult result)
        {
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["agentId"] = agentId;
            body["taskId"] = taskId;
            body["leaseId"] = leaseId;
            body["success"] = result.Success;
            body["errorCode"] = result.ErrorCode;
            body["errorMessage"] = result.ErrorMessage;
            body["detail"] = result.Detail;
            Send<object>("/api/v1/agents/tasks/result", body);
        }

        private Dictionary<string, object> BaseIdentity(CapabilitySnapshot snapshot)
        {
            return new Dictionary<string, object>
            {
                { "productLine", ProductIdentity.ProductLine },
                { "runtime", ProductIdentity.Runtime },
                { "adapters", new string[] { "windows.compat.files", "windows.compat.scm", "windows.compat.cert-store", "windows.compat.tls" } },
                { "capabilities", snapshot.Capabilities.ToArray() }
            };
        }

        private T Send<T>(string path, object body)
        {
            byte[] payload = Encoding.UTF8.GetBytes(serializer.Serialize(body));
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(config.controlPlaneUrl.TrimEnd('/') + path);
            request.Method = "POST";
            request.ContentType = "application/json; charset=utf-8";
            request.Headers["x-tenant-id"] = config.tenantId;
            request.ContentLength = payload.Length;
            using (Stream stream = request.GetRequestStream()) stream.Write(payload, 0, payload.Length);
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                string json = reader.ReadToEnd();
                if (typeof(T) == typeof(object) || string.IsNullOrWhiteSpace(json)) return default(T);
                return serializer.Deserialize<T>(json);
            }
        }
    }
}

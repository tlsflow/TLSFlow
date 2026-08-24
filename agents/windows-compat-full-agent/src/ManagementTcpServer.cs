using System;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    internal delegate DirectDiscoveryResponse DirectDiscoveryHandler(Dictionary<string, object> payload);

    // 管理监听只暴露健康检查和受签名授权约束的 Web 重新发现。
    // 它不接受部署计划、任意命令或插件调用。
    internal sealed class ManagementTcpServer
    {
        private readonly AgentConfig config;
        private readonly DirectDiscoveryHandler executeDiscovery;
        private TcpListener listener;
        private Thread worker;
        private volatile bool stopping;

        public ManagementTcpServer(AgentConfig config, DirectDiscoveryHandler executeDiscovery)
        {
            this.config = config;
            this.executeDiscovery = executeDiscovery;
        }

        public void Start()
        {
            IPAddress address;
            if (!IPAddress.TryParse(config.managementListenAddress, out address)) address = IPAddress.Any;
            listener = new TcpListener(address, config.managementPort);
            listener.Start();
            stopping = false;
            worker = new Thread(Serve);
            worker.IsBackground = true;
            worker.Start();
        }

        public void Stop()
        {
            stopping = true;
            try { if (listener != null) listener.Stop(); } catch { }
            if (worker != null && worker.IsAlive) worker.Join(2000);
        }

        private void Serve()
        {
            while (!stopping)
            {
                TcpClient client = null;
                try { client = listener.AcceptTcpClient(); Handle(client); }
                catch { if (!stopping) Thread.Sleep(100); }
                finally { if (client != null) client.Close(); }
            }
        }

        private void Handle(TcpClient client)
        {
            NetworkStream stream = client.GetStream();
            try
            {
                HttpRequest request = ReadRequest(stream);
                bool healthy = request.firstLine.StartsWith("GET /api/v1/control/health ", StringComparison.Ordinal)
                    || request.firstLine.StartsWith("GET /healthz ", StringComparison.Ordinal);
                if (healthy)
                {
                    WriteJson(stream, "200 OK", new Dictionary<string, object> { { "success", true }, { "status", "healthy" }, { "agentVersion", ProductIdentity.Version } });
                    return;
                }
                if (!request.firstLine.StartsWith("POST /api/v1/control/discovery ", StringComparison.Ordinal))
                {
                    WriteJson(stream, "404 Not Found", new Dictionary<string, object> { { "success", false }, { "errorCode", "AGENT_DIRECT_DISCOVERY_NOT_FOUND" } });
                    return;
                }
                if (executeDiscovery == null)
                {
                    WriteJson(stream, "503 Service Unavailable", new DirectDiscoveryResponse { success = false, errorCode = "AGENT_DIRECT_DISCOVERY_UNAVAILABLE", errorMessage = "Agent 运行时尚未完成注册" });
                    return;
                }
                Dictionary<string, object> payload = new JavaScriptSerializer().DeserializeObject(request.body) as Dictionary<string, object>;
                if (payload == null)
                {
                    WriteJson(stream, "400 Bad Request", new DirectDiscoveryResponse { success = false, errorCode = "AGENT_DIRECT_DISCOVERY_INVALID", errorMessage = "直接重新发现请求不是 JSON 对象" });
                    return;
                }
                DirectDiscoveryResponse result = executeDiscovery(payload);
                WriteJson(stream, result != null && result.success ? "200 OK" : "400 Bad Request", result ?? new DirectDiscoveryResponse { success = false, errorCode = "AGENT_DIRECT_DISCOVERY_FAILED" });
            }
            catch (Exception error)
            {
                WriteJson(stream, "400 Bad Request", new DirectDiscoveryResponse { success = false, errorCode = "AGENT_DIRECT_DISCOVERY_INVALID", errorMessage = error.Message });
            }
        }

        private static HttpRequest ReadRequest(NetworkStream stream)
        {
            const int MaxHeaderBytes = 16384;
            const int MaxBodyBytes = 1048576;
            List<byte> received = new List<byte>();
            byte[] chunk = new byte[4096];
            int headerEnd = -1;
            while (headerEnd < 0)
            {
                int count = stream.Read(chunk, 0, chunk.Length);
                if (count <= 0) throw new InvalidOperationException("管理端点请求为空");
                for (int index = 0; index < count; index++) received.Add(chunk[index]);
                if (received.Count > MaxHeaderBytes) throw new InvalidOperationException("管理端点请求头过长");
                headerEnd = HeaderEnd(received);
            }
            string header = Encoding.ASCII.GetString(received.ToArray(), 0, headerEnd);
            string[] lines = header.Split(new[] { "\r\n" }, StringSplitOptions.None);
            if (lines.Length == 0 || string.IsNullOrEmpty(lines[0])) throw new InvalidOperationException("管理端点请求行无效");
            int contentLength = ContentLength(lines);
            if (contentLength < 0 || contentLength > MaxBodyBytes) throw new InvalidOperationException("管理端点请求体长度无效");
            int bodyOffset = headerEnd + 4;
            while (received.Count - bodyOffset < contentLength)
            {
                int count = stream.Read(chunk, 0, Math.Min(chunk.Length, contentLength - (received.Count - bodyOffset)));
                if (count <= 0) throw new InvalidOperationException("管理端点请求体不完整");
                for (int index = 0; index < count; index++) received.Add(chunk[index]);
            }
            return new HttpRequest
            {
                firstLine = lines[0],
                body = contentLength == 0 ? string.Empty : Encoding.UTF8.GetString(received.ToArray(), bodyOffset, contentLength)
            };
        }

        private static int HeaderEnd(List<byte> bytes)
        {
            for (int index = 3; index < bytes.Count; index++)
                if (bytes[index - 3] == 13 && bytes[index - 2] == 10 && bytes[index - 1] == 13 && bytes[index] == 10)
                    return index - 3;
            return -1;
        }

        private static int ContentLength(string[] lines)
        {
            for (int index = 1; index < lines.Length; index++)
            {
                const string Prefix = "Content-Length:";
                if (!lines[index].StartsWith(Prefix, StringComparison.OrdinalIgnoreCase)) continue;
                int value;
                if (!int.TryParse(lines[index].Substring(Prefix.Length).Trim(), out value)) throw new InvalidOperationException("Content-Length 无效");
                return value;
            }
            return 0;
        }

        private static void WriteJson(NetworkStream stream, string status, object body)
        {
            byte[] payload = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(body));
            string header = "HTTP/1.1 " + status + "\r\nContent-Type: application/json\r\nContent-Length: " + payload.Length.ToString() + "\r\nConnection: close\r\n\r\n";
            byte[] headerBytes = Encoding.ASCII.GetBytes(header);
            stream.Write(headerBytes, 0, headerBytes.Length);
            stream.Write(payload, 0, payload.Length);
        }

        private sealed class HttpRequest
        {
            public string firstLine;
            public string body;
        }
    }
}

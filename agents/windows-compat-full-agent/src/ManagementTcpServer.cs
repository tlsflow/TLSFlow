using System;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace GCAC.WindowsCompatibilityAgent
{
    // 只读健康监听，禁止承载任务执行、命令执行或插件调用。
    internal sealed class ManagementTcpServer
    {
        private readonly AgentConfig config;
        private TcpListener listener;
        private Thread worker;
        private volatile bool stopping;

        public ManagementTcpServer(AgentConfig config) { this.config = config; }

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

        private static void Handle(TcpClient client)
        {
            NetworkStream stream = client.GetStream();
            byte[] buffer = new byte[2048];
            int count = stream.Read(buffer, 0, buffer.Length);
            string request = Encoding.ASCII.GetString(buffer, 0, count);
            string firstLine = request.Split(new[] { '\r', '\n' })[0];
            bool healthy = firstLine.StartsWith("GET /api/v1/control/health ", StringComparison.Ordinal)
                || firstLine.StartsWith("GET /healthz ", StringComparison.Ordinal);
            string body = healthy ? "{\"success\":true,\"status\":\"healthy\"}" : "{\"success\":false}";
            string status = healthy ? "200 OK" : "404 Not Found";
            byte[] payload = Encoding.UTF8.GetBytes(body);
            string header = "HTTP/1.1 " + status + "\r\nContent-Type: application/json\r\nContent-Length: " + payload.Length.ToString() + "\r\nConnection: close\r\n\r\n";
            byte[] headerBytes = Encoding.ASCII.GetBytes(header);
            stream.Write(headerBytes, 0, headerBytes.Length);
            stream.Write(payload, 0, payload.Length);
        }
    }
}

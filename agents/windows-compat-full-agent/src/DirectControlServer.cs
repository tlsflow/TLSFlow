using System;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class DirectControlServer : IDisposable
    {
        private readonly HttpListener listener = new HttpListener();
        private readonly AuditLogger logger;
        private Thread worker;

        public DirectControlServer(AgentConfig config, AuditLogger logger)
        {
            this.logger = logger;
            string prefixHost = config.directControlListenHost == "127.0.0.1" || config.directControlListenHost == "localhost" ? config.directControlListenHost : "+";
            listener.Prefixes.Add("http://" + prefixHost + ":" + config.directControlListenPort + "/");
        }

        public void Start()
        {
            listener.Start();
            worker = new Thread(ListenLoop);
            worker.IsBackground = true;
            worker.Name = "GCAC Compatibility Direct Control";
            worker.Start();
        }

        private void ListenLoop()
        {
            while (listener.IsListening)
            {
                try { Handle(listener.GetContext()); }
                catch (HttpListenerException) { if (listener.IsListening) throw; }
                catch (ObjectDisposedException) { return; }
                catch (Exception error) { logger.Write("error", "direct_control.request_failed", error.Message); }
            }
        }

        private static void Handle(HttpListenerContext context)
        {
            string path = context.Request.Url == null ? string.Empty : context.Request.Url.AbsolutePath;
            if (string.Equals(path, "/api/v1/control/health", StringComparison.OrdinalIgnoreCase))
            {
                WriteJson(context, 200, new { success = true, protocolVersion = "v1", checkedAt = DateTime.UtcNow.ToString("o") });
                return;
            }
            WriteJson(context, 404, new { success = false, errorCode = "DIRECT_CONTROL_ROUTE_NOT_FOUND" });
        }

        private static void WriteJson(HttpListenerContext context, int statusCode, object body)
        {
            byte[] payload = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(body));
            context.Response.StatusCode = statusCode;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.ContentLength64 = payload.Length;
            context.Response.OutputStream.Write(payload, 0, payload.Length);
            context.Response.OutputStream.Close();
        }

        public void Dispose()
        {
            if (listener.IsListening) listener.Stop();
            listener.Close();
            if (worker != null && worker.IsAlive) worker.Join(TimeSpan.FromSeconds(2));
        }
    }
}
